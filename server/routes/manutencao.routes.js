const express = require('express');
const { admin, db, projectId } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');
const { preencherDatasFaltantes } = require('../services/datasFaltantes');
const { unificarConfiguracoesGerais } = require('../services/configuracoesGerais');
const { registrarLog } = require('../services/auditoria');
const { protegerSegredos } = require('../services/protegerSegredos');
const { zerarEstoqueECustosDaMigracao } = require('../services/zerarEstoqueMigracao');
const { corrigirVendaFracionada } = require('../services/vendaFracionadaProdutos');
const { ligarCreditosAoCliente } = require('../services/creditosDoCliente');

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

// Segredos fiscais (19/10/2026): CSC da NFC-e e chave antiga da Spedy saem do
// documento que todos da empresa leem. Sem "desfazer" (ver protegerSegredos.js).
router.post('/proteger-segredos', limite, async (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode rodar a manutenção do banco.' });
  }
  const modo = typeof req.body?.modo === 'string' ? req.body.modo : 'simular';
  if (modo !== 'simular' && modo !== 'aplicar') {
    return res.status(400).json({ error: 'Esta tarefa só tem Simular e Aplicar (desfazer poria o segredo de volta onde todos leem).' });
  }
  if (emAndamento) {
    return res.status(409).json({ error: 'Já tem uma tarefa de manutenção rodando. Espere ela terminar e tente de novo.' });
  }
  emAndamento = true;
  const projeto = projectId || admin.app().options.projectId || null;
  try {
    const resultado = await protegerSegredos({ db, apagar: () => admin.firestore.FieldValue.delete(), aplicar: modo === 'aplicar' });
    console.log(`[Manutencao] proteger segredos: ${modo} por ${req.user.email || req.user.uid} no projeto ${projeto} -- ${resultado.empresas.length} empresas`);
    if (modo === 'aplicar' && resultado.empresas.length > 0) {
      registrarLog(req.user, {
        modulo: 'manutencao',
        acao: 'segredos_protegidos',
        descricao: `CSC da NFC-e e chave da Spedy movidos para a área protegida em ${resultado.empresas.length} empresa(s): ${resultado.empresas.map((e) => e.nome).join(', ')}.`,
        critico: true,
      });
    }
    return res.json({ projeto, modo, ...resultado });
  } catch (erro) {
    console.error(`[Manutencao] proteger segredos (${modo}) falhou:`, erro.message);
    return res.status(500).json({
      error: modo === 'aplicar'
        ? 'A tarefa parou no meio. Rode "Simular" de novo para ver o que falta (rodar de novo é seguro: só mexe em quem ainda tem segredo no documento comum).'
        : 'Não foi possível ler as configurações agora. Tente de novo em alguns minutos.',
    });
  } finally {
    emAndamento = false;
  }
});

// Migracao de cliente (17/11/2026): zera saldo e custos dos produtos de UMA
// empresa, mantendo o preco de venda, com um unico registro no historico dela.
router.post('/zerar-estoque-migracao', limite, async (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode rodar a manutenção do banco.' });
  }
  const modo = typeof req.body?.modo === 'string' ? req.body.modo : 'simular';
  if (modo !== 'simular' && modo !== 'aplicar') {
    return res.status(400).json({ error: 'Esta tarefa só tem Simular e Aplicar.' });
  }
  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  if (!tenantId) {
    return res.status(400).json({ error: 'Informe o código da empresa (tenant) cujo estoque será zerado.' });
  }
  if (emAndamento) {
    return res.status(409).json({ error: 'Já tem uma tarefa de manutenção rodando. Espere ela terminar e tente de novo.' });
  }
  emAndamento = true;
  const projeto = projectId || admin.app().options.projectId || null;
  try {
    const resultado = await zerarEstoqueECustosDaMigracao({
      db,
      apagar: () => admin.firestore.FieldValue.delete(),
      agora: () => admin.firestore.FieldValue.serverTimestamp(),
      tenantId,
      aplicar: modo === 'aplicar',
      usuarioId: req.user.uid,
      zerar: req.body?.zerar !== false,
      renumerar: req.body?.renumerar === true,
      apagarCodigoAntigo: req.body?.apagarCodigoAntigo === true,
    });
    console.log(`[Manutencao] zerar estoque da migracao: ${modo} por ${req.user.email || req.user.uid} no projeto ${projeto} -- empresa ${tenantId}: ${resultado.alterados} de ${resultado.produtos} produtos`);
    if (modo === 'aplicar' && resultado.alterados > 0) {
      // UM registro, no historico DA EMPRESA migrada (nao no da plataforma).
      await registrarLog({ ...req.user, tenantId, filialNome: resultado.empresa }, {
        modulo: 'estoque',
        acao: 'migracao_importacao',
        descricao: `Migração de sistema, importação de dados: ${[
          req.body?.zerar !== false ? `estoque zerado e custos apagados (saldo anterior somado: ${resultado.somaSaldo}; preço de venda mantido; preço à vista, custo, custo médio e custo comercial para preencher no cadastro)` : '',
          resultado.codigosTrocados > 0 ? `códigos renumerados 1, 2, 3... pela ordem alfabética do nome (${resultado.codigosTrocados} produto(s))` : '',
          resultado.referenciasApagadas > 0 || resultado.barrasApagadas > 0 ? `código do sistema antigo apagado (${resultado.referenciasApagadas} referência(s) e ${resultado.barrasApagadas} código(s) de barras feitos dele)` : '',
        ].filter(Boolean).join('; ')}. ${resultado.alterados} produto(s) alterado(s).`,
        documentoTipo: 'produto',
        alteracoes: [
          { campo: 'Produtos alterados', valorAnterior: '', valorNovo: String(resultado.alterados) },
          { campo: 'Produtos com saldo', valorAnterior: String(resultado.comSaldo), valorNovo: '0' },
          { campo: 'Soma dos saldos', valorAnterior: String(resultado.somaSaldo), valorNovo: '0' },
          { campo: 'Códigos renumerados', valorAnterior: '', valorNovo: String(resultado.codigosTrocados) },
          { campo: 'Códigos antigos apagados', valorAnterior: '', valorNovo: `${resultado.referenciasApagadas} referência(s), ${resultado.barrasApagadas} código(s) de barras` },
        ],
        critico: true,
      });
    }
    return res.json({ projeto, modo, ...resultado });
  } catch (erro) {
    console.error(`[Manutencao] zerar estoque da migracao (${modo}) falhou:`, erro.message);
    return res.status(erro.status || 500).json({
      error: erro.status === 404 || erro.status === 409
        ? erro.message
        : modo === 'aplicar'
          ? 'A tarefa parou no meio. Rode "Simular" de novo para ver o que falta (rodar de novo é seguro: só mexe no que ainda não foi zerado).'
          : 'Não foi possível ler os produtos da empresa agora. Tente de novo em alguns minutos.',
    });
  } finally {
    emAndamento = false;
  }
});

// Venda fracionada (21/11/2026): produto ativo em unidade fracionada passa a
// vender fracionado. Uma empresa por vez. Ver services/vendaFracionadaProdutos.js.
router.post('/venda-fracionada', limite, async (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode rodar a manutenção do banco.' });
  }
  const modo = typeof req.body?.modo === 'string' ? req.body.modo : 'simular';
  if (modo !== 'simular' && modo !== 'aplicar') {
    return res.status(400).json({ error: 'Esta tarefa só tem Simular e Aplicar.' });
  }
  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  if (!tenantId) {
    return res.status(400).json({ error: 'Informe o código da empresa (tenant) cujos produtos serão conferidos.' });
  }
  if (emAndamento) {
    return res.status(409).json({ error: 'Já tem uma tarefa de manutenção rodando. Espere ela terminar e tente de novo.' });
  }
  emAndamento = true;
  const projeto = projectId || admin.app().options.projectId || null;
  try {
    const resultado = await corrigirVendaFracionada({
      db,
      agora: () => admin.firestore.FieldValue.serverTimestamp(),
      tenantId,
      aplicar: modo === 'aplicar',
      usuarioId: req.user.uid,
    });
    console.log(`[Manutencao] venda fracionada: ${modo} por ${req.user.email || req.user.uid} no projeto ${projeto} -- empresa ${tenantId}: ${resultado.alterados} de ${resultado.naUnidadeFracionada} produtos em unidade fracionada (${resultado.travados} travados)`);
    if (modo === 'aplicar' && resultado.alterados > 0) {
      await registrarLog({ ...req.user, tenantId, filialNome: resultado.empresa }, {
        modulo: 'estoque',
        acao: 'venda_fracionada',
        descricao: `Venda fracionada acertada nos produtos ativos em unidade fracionada (${resultado.unidadesFracionadas.join(', ')}): "Produto fracionado" marcado e a configuração da unidade copiada de novo. ${resultado.alterados} produto(s) alterado(s), ${resultado.travados} deles recusavam quantidade quebrada na venda.${resultado.embalagensAcertadas > 0 ? ` Embalagens com a unidade copiada de novo: ${resultado.embalagensAcertadas} (${resultado.embalagensTravadas} recusavam fração).` : ''}`,
        documentoTipo: 'produto',
        alteracoes: resultado.porSigla.map((s) => ({ campo: `Unidade ${s.sigla}`, valorAnterior: `${s.travados} recusando fração`, valorNovo: `${s.alterados} produto(s) acertado(s)` })),
        critico: true,
      });
    }
    return res.json({ projeto, modo, ...resultado });
  } catch (erro) {
    console.error(`[Manutencao] venda fracionada (${modo}) falhou:`, erro.message);
    return res.status(erro.status || 500).json({
      error: erro.status === 404
        ? erro.message
        : modo === 'aplicar'
          ? 'A tarefa parou no meio. Rode "Simular" de novo para ver o que falta (rodar de novo é seguro: só mexe no que ainda não foi acertado).'
          : 'Não foi possível ler os produtos da empresa agora. Tente de novo em alguns minutos.',
    });
  } finally {
    emAndamento = false;
  }
});

// Creditos de devolucao antigos so' tinham o NOME do cliente: renomear o
// cadastro escondia o credito (Jomarly, 21/11/2026). Grava o codigo do
// cliente pelo pedido de origem. Ver services/creditosDoCliente.js.
router.post('/creditos-do-cliente', limite, async (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode rodar a manutenção do banco.' });
  }
  const modo = typeof req.body?.modo === 'string' ? req.body.modo : 'simular';
  if (modo !== 'simular' && modo !== 'aplicar') {
    return res.status(400).json({ error: 'Esta tarefa só tem Simular e Aplicar.' });
  }
  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  if (!tenantId) {
    return res.status(400).json({ error: 'Informe o código da empresa (tenant) cujos créditos serão conferidos.' });
  }
  if (emAndamento) {
    return res.status(409).json({ error: 'Já tem uma tarefa de manutenção rodando. Espere ela terminar e tente de novo.' });
  }
  emAndamento = true;
  const projeto = projectId || admin.app().options.projectId || null;
  try {
    const resultado = await ligarCreditosAoCliente({
      db,
      agora: () => admin.firestore.FieldValue.serverTimestamp(),
      tenantId,
      aplicar: modo === 'aplicar',
      usuarioId: req.user.uid,
    });
    console.log(`[Manutencao] creditos do cliente: ${modo} por ${req.user.email || req.user.uid} no projeto ${projeto} -- empresa ${tenantId}: ${resultado.ligados} de ${resultado.semCodigo} creditos sem codigo (${resultado.escondidos} escondidos)`);
    if (modo === 'aplicar' && resultado.ligados > 0) {
      await registrarLog({ ...req.user, tenantId, filialNome: resultado.empresa }, {
        modulo: 'financeiro',
        acao: 'creditos_do_cliente',
        descricao: `Créditos de devolução ligados ao cadastro do cliente pelo pedido de origem: ${resultado.ligados} crédito(s). ${resultado.escondidos} deles estavam com o nome antigo do cliente e não apareciam na venda (R$ ${(resultado.escondidosCentavos / 100).toFixed(2).replace('.', ',')}).`,
        documentoTipo: 'credito_cliente',
        alteracoes: resultado.exemplos.filter((e) => e.escondido).map((e) => ({ campo: `Crédito do pedido #${e.numeroPedido}`, valorAnterior: e.nomeNoCredito, valorNovo: e.nomeNoCadastro })),
        critico: true,
      });
    }
    return res.json({ projeto, modo, ...resultado });
  } catch (erro) {
    console.error(`[Manutencao] creditos do cliente (${modo}) falhou:`, erro.message);
    return res.status(erro.status || 500).json({
      error: erro.status === 404
        ? erro.message
        : modo === 'aplicar'
          ? 'A tarefa parou no meio. Rode "Simular" de novo para ver o que falta (rodar de novo é seguro: só mexe no crédito que ainda não tem o cliente).'
          : 'Não foi possível ler os créditos da empresa agora. Tente de novo em alguns minutos.',
    });
  } finally {
    emAndamento = false;
  }
});

module.exports = router;
