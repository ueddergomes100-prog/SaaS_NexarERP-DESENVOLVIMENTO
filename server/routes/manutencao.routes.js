const express = require('express');
const { admin, db, projectId } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');
const { preencherDatasFaltantes } = require('../services/datasFaltantes');
const { unificarConfiguracoesGerais } = require('../services/configuracoesGerais');
const { registrarLog } = require('../services/auditoria');

/**
 * MANUTENCAO DO BANCO, pelo Painel da Plataforma (2026-10-15).
 *
 * Tarefas de uma vez so' que precisam do banco do PROPRIO ambiente. Em
 * producao nao ha terminal com as credenciais (o backend da Hostinger e' o
 * unico lugar com acesso ao banco de producao, e da maquina local nada roda
 * contra producao), entao a tarefa roda aqui, disparada pelo dono.
 *
 * So' o administrador da PLATAFORMA (NexarAdmin/SuperAdmin) usa. Sempre
 * "simular" antes de "aplicar"; "desfazer" volta so' o que esta tarefa gravou.
 */
const router = express.Router();
router.use(authenticate);

const porUsuario = (req) => (req.user && req.user.uid) || req.ip;
// Cada execucao le pedidos_venda e transacoes inteiros: poucas vezes por hora.
const limite = limitadorPorChave('manutencao-datas', porUsuario, {
  limite: 10,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Limite de execuções por hora atingido. Aguarde um pouco antes de rodar de novo.',
});

const MODOS = {
  simular: { aplicar: false, desfazer: false },
  aplicar: { aplicar: true, desfazer: false },
  desfazer: { aplicar: true, desfazer: true },
};

// Uma execucao por vez neste servidor: dois cliques nao gravam em paralelo.
let emAndamento = false;

router.post('/datas-faltantes', limite, async (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode rodar a manutenção do banco.' });
  }
  const modo = typeof req.body?.modo === 'string' ? req.body.modo : 'simular';
  const config = MODOS[modo];
  if (!config) {
    return res.status(400).json({ error: 'Modo inválido. Use simular, aplicar ou desfazer.' });
  }
  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  if (emAndamento) {
    return res.status(409).json({ error: 'Já tem um preenchimento de datas rodando. Espere ele terminar e tente de novo.' });
  }

  emAndamento = true;
  // O projeto em que o SDK foi iniciado (config/firebase): a tela mostra o
  // ambiente antes de gravar. admin.app().options.projectId vem vazio quando o
  // SDK entra pela conta de servico -- era o caso da producao (15/10/2026).
  const projeto = projectId || admin.app().options.projectId || null;
  try {
    const resultado = await preencherDatasFaltantes({
      db,
      apagar: () => admin.firestore.FieldValue.delete(),
      tenantId,
      ...config,
    });
    const total = resultado.colecoes.reduce((soma, c) => soma + c.alterados, 0);
    console.log(`[Manutencao] datas faltantes: ${modo} por ${req.user.email || req.user.uid} no projeto ${projeto}${tenantId ? ` (empresa ${tenantId})` : ''} -- ${resultado.colecoes.map((c) => `${c.nome}: ${c.alterados}`).join(', ')}`);
    if (config.aplicar) {
      registrarLog(req.user, {
        modulo: 'manutencao',
        acao: modo === 'desfazer' ? 'datas_faltantes_desfeitas' : 'datas_faltantes_preenchidas',
        descricao: `${modo === 'desfazer' ? 'Desfeito o preenchimento' : 'Preenchidas'} ${total} datas faltantes (${resultado.colecoes.map((c) => `${c.nome}: ${c.alterados}`).join(', ')})${tenantId ? ` da empresa ${tenantId}` : ' de todas as empresas'}.`,
        alteracoes: resultado.colecoes.map((c) => ({ colecao: c.nome, campo: c.campo, alterados: c.alterados })),
        critico: true,
      });
    }
    return res.json({ projeto, modo, ...resultado });
  } catch (erro) {
    console.error(`[Manutencao] datas faltantes (${modo}) falhou:`, erro.message);
    return res.status(500).json({
      error: config.aplicar
        ? 'O preenchimento parou no meio. Parte das datas pode ter sido gravada; rode "Simular" de novo para ver o que falta (rodar de novo é seguro: só mexe no que continua sem data).'
        : 'Não foi possível ler os pedidos e lançamentos agora. Tente de novo em alguns minutos.',
    });
  } finally {
    emAndamento = false;
  }
});

// Configuracoes Gerais (15/10/2026): deixa os campos que valem para o grupo
// iguais em todas as filiais, pelo valor da matriz (plano de contas: junta tudo).
router.post('/configuracoes-gerais', limite, async (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode rodar a manutenção do banco.' });
  }
  const modo = typeof req.body?.modo === 'string' ? req.body.modo : 'simular';
  const config = MODOS[modo];
  if (!config) {
    return res.status(400).json({ error: 'Modo inválido. Use simular, aplicar ou desfazer.' });
  }
  if (emAndamento) {
    return res.status(409).json({ error: 'Já tem uma tarefa de manutenção rodando. Espere ela terminar e tente de novo.' });
  }
  emAndamento = true;
  const projeto = projectId || admin.app().options.projectId || null;
  try {
    const resultado = await unificarConfiguracoesGerais(config);
    console.log(`[Manutencao] configuracoes gerais: ${modo} por ${req.user.email || req.user.uid} no projeto ${projeto} -- ${resultado.filiaisAlteradas} filiais em ${resultado.grupos.length} grupos`);
    if (config.aplicar && resultado.filiaisAlteradas > 0) {
      registrarLog(req.user, {
        modulo: 'manutencao',
        acao: modo === 'desfazer' ? 'configuracoes_gerais_desfeitas' : 'configuracoes_gerais_unificadas',
        descricao: `${modo === 'desfazer' ? 'Desfeita a unificação das' : 'Unificadas as'} configurações gerais de ${resultado.filiaisAlteradas} filiais (${resultado.grupos.map((g) => g.grupo).join(', ')}).`,
        critico: true,
      });
    }
    return res.json({ projeto, modo, ...resultado });
  } catch (erro) {
    console.error(`[Manutencao] configuracoes gerais (${modo}) falhou:`, erro.message);
    return res.status(500).json({
      error: config.aplicar
        ? 'A unificação parou no meio. Rode "Simular" de novo para ver o que falta (rodar de novo é seguro: só mexe no que continua diferente).'
        : 'Não foi possível ler as configurações das filiais agora. Tente de novo em alguns minutos.',
    });
  } finally {
    emAndamento = false;
  }
});

module.exports = router;
