const express = require('express');
const { authenticate } = require('../middleware/auth');
const { db } = require('../config/firebase');
const { registrarLog } = require('../services/auditoria');
const b = require('../services/balanco');
const { PERMISSAO_BALANCO_GERENCIAR, PERMISSAO_BALANCO_CONTAR, ROTULO_REGRA_NEGATIVO } = require('../domain/balancoDomain');

/**
 * BALANCO (INVENTARIO) -- 21/10/2026. Ver services/balanco.js.
 * "Estoque: Balanco -- abrir, conferir e fechar" (gestor) e "Estoque: Balanco -- contar".
 */
const router = express.Router();
router.use(authenticate);

const tem = (user, permissao) => Boolean(
  user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)),
);
const SEM_GERENCIAR = 'Você não tem permissão para abrir, conferir ou fechar balanço. Peça a um responsável liberar "Estoque: Balanço — abrir, conferir e fechar" no seu usuário.';
const SEM_CONTAR = 'Você não tem permissão para contar balanço. Peça a um responsável liberar "Estoque: Balanço — contar" no seu usuário.';

const rota = (permissao, oQue, fn) => async (req, res) => {
  try {
    if (!tem(req.user, permissao)) return res.status(403).json({ error: permissao === PERMISSAO_BALANCO_CONTAR ? SEM_CONTAR : SEM_GERENCIAR });
    return res.json({ ok: true, ...(await fn(req)) });
  } catch (erro) {
    if (erro instanceof b.ErroBalanco || (erro && erro.status && erro.message)) return res.status(erro.status).json({ error: erro.message });
    console.error(`[Balanco] erro ao ${oQue}:`, erro);
    return res.status(500).json({ error: `Não foi possível ${oQue}. Tente de novo em instantes.` });
  }
};

const ctx = (req) => ({ user: req.user, tenantId: req.user.tenantId, balancoId: req.params.id, corpo: req.body || {} });

/**
 * Historico de alteracoes (09/11/2026): nome e quem conta, lidos DEPOIS da acao,
 * so' para o texto do registro. Falha aqui nunca derruba a acao (devolve null).
 */
const resumoDoBalanco = async (tenantId, id) => {
  try {
    const s = await db.collection('balancos').doc(String(id || '-')).get();
    if (!s.exists || s.data().tenantId !== tenantId) return null;
    const d = s.data();
    return { nome: String(d.nome || ''), contadores: Array.isArray(d.contadores) ? d.contadores : [] };
  } catch (erro) {
    console.error('[Balanco] falha ao ler o balanço para o Histórico de alterações:', erro.message);
    return null;
  }
};
const nomeDoContador = (resumo, uid) => {
  const c = resumo && resumo.contadores.find((x) => x.uid === uid);
  return c && c.nome ? String(c.nome) : 'outra pessoa';
};

// ---- gestor ----
router.get('/', rota(PERMISSAO_BALANCO_GERENCIAR, 'carregar os balanços', async (req) => ({ balancos: await b.listar(ctx(req)) })));
router.get('/grupos', rota(PERMISSAO_BALANCO_GERENCIAR, 'carregar os grupos', async (req) => ({ grupos: await b.gruposDisponiveis(ctx(req)) })));
router.post('/', rota(PERMISSAO_BALANCO_GERENCIAR, 'abrir o balanço', async (req) => {
  const r = await b.abrir(ctx(req));
  registrarLog(req.user, {
    modulo: 'estoque', acao: 'balanco_abrir', registroId: r.id,
    descricao: `Balanço "${r.nome}" aberto com ${r.totalItens} itens para ${r.contadores.map((c) => c.nome).join(', ')}${req.body && req.body.travaVendas ? ' (vendas travadas)' : ''}.`,
  });
  return { balanco: r };
}));
router.get('/:id/conferencia', rota(PERMISSAO_BALANCO_GERENCIAR, 'carregar a conferência', async (req) => b.conferencia(ctx(req))));
router.post('/:id/trocar-contador', rota(PERMISSAO_BALANCO_GERENCIAR, 'trocar quem conta', async (req) => {
  const r = await b.trocarContador(ctx(req));
  // Uma troca = um registro (nao um por item passado).
  const corpo = req.body || {};
  const resumo = await resumoDoBalanco(req.user.tenantId, req.params.id);
  const de = nomeDoContador(resumo, String(corpo.de || ''));
  const para = nomeDoContador(resumo, String(corpo.para || ''));
  registrarLog(req.user, {
    modulo: 'estoque',
    acao: 'edicao',
    descricao: `Balanço "${resumo ? resumo.nome : ''}": ${r.movidos} item(ns) ${corpo.grupo ? `do grupo ${String(corpo.grupo)} ` : ''}passaram a ser contados por ${para} (antes: ${de}).`,
    registroId: req.params.id,
    documentoTipo: 'balanco',
    documentoNumero: resumo && resumo.nome ? `Balanço ${resumo.nome}` : null,
    alteracoes: [{ campo: `Quem conta${corpo.grupo ? ` (grupo ${String(corpo.grupo)})` : ''}`, valorAnterior: de, valorNovo: para }],
  });
  return r;
}));
router.post('/:id/fechar', rota(PERMISSAO_BALANCO_GERENCIAR, 'fechar o balanço', async (req) => {
  const r = await b.fechar(ctx(req));
  const s = r.resumo || {};
  registrarLog(req.user, {
    modulo: 'estoque', acao: 'balanco_fechar', registroId: req.params.id, critico: true,
    descricao: `Balanço "${r.nome}" fechado (${ROTULO_REGRA_NEGATIVO[r.regraNegativo]}): ${s.itens || 0} itens, ${s.sobras || 0} com sobra, ${s.faltas || 0} com falta, ${s.naoContados || 0} não contados zerados.`,
  });
  return r;
}));
router.post('/:id/cancelar', rota(PERMISSAO_BALANCO_GERENCIAR, 'cancelar o balanço', async (req) => {
  const r = await b.cancelar(ctx(req));
  // Mesmo texto do motivo que o servico gravou no balanco (espacos juntados).
  const motivo = String((req.body && req.body.motivo) || '').replace(/\s+/g, ' ').trim();
  registrarLog(req.user, {
    modulo: 'estoque',
    acao: 'balanco_cancelar',
    registroId: req.params.id,
    descricao: `Balanço "${r.nome}" cancelado. Nenhum saldo foi ajustado. Motivo: ${motivo}.`,
    documentoTipo: 'balanco',
    documentoNumero: `Balanço ${r.nome}`,
    motivo,
    alteracoes: [{ campo: 'Situação', valorAnterior: 'Contando', valorNovo: 'Cancelado' }],
    critico: true,
  });
  return r;
}));

// ---- quem conta ----
router.get('/para-contar', rota(PERMISSAO_BALANCO_CONTAR, 'carregar os balanços', async (req) => ({ balancos: await b.paraContar(ctx(req)) })));
router.get('/:id/minha-lista', rota(PERMISSAO_BALANCO_CONTAR, 'carregar a sua lista', async (req) => b.minhaLista(ctx(req))));
router.post('/:id/contar', rota(PERMISSAO_BALANCO_CONTAR, 'gravar a contagem', async (req) => ({ item: await b.contar(ctx(req)) })));
// Codigo bipado que nao esta' na lista de quem bipou (22/10/2026).
router.get('/:id/procurar', rota(PERMISSAO_BALANCO_CONTAR, 'procurar o código', async (req) => b.procurarCodigo({ ...ctx(req), codigo: req.query.codigo })));
router.post('/:id/concluir', rota(PERMISSAO_BALANCO_CONTAR, 'concluir a sua parte', async (req) => {
  const r = await b.concluirMinhaParte(ctx(req));
  // Concluir a parte e' marco (um registro); cada item contado NAO vira registro.
  const resumo = await resumoDoBalanco(req.user.tenantId, req.params.id);
  const concluidos = resumo ? resumo.contadores.filter((c) => c.concluido === true).length : 0;
  registrarLog(req.user, {
    modulo: 'estoque',
    acao: 'finalizacao',
    descricao: `Concluiu a sua parte da contagem do balanço "${resumo ? resumo.nome : ''}"${resumo ? ` (${concluidos} de ${resumo.contadores.length} pessoa(s) já concluíram)` : ''}.`,
    registroId: req.params.id,
    documentoTipo: 'balanco',
    documentoNumero: resumo && resumo.nome ? `Balanço ${resumo.nome}` : null,
  });
  return r;
}));

module.exports = router;
