const express = require('express');
const { authenticate } = require('../middleware/auth');
const { db } = require('../config/firebase');
const { canUseFiscal, resolveTenantId } = require('../services/spedyAcesso');
const { registrarLog } = require('../services/auditoria');
const { ErroDevolucaoCompra, registrar, emitir, listar } = require('../services/devolucaoCompra');

/**
 * DEVOLUCAO DE COMPRA AO FORNECEDOR (21/10/2026). Ver services/devolucaoCompra.js.
 * Registrar mexe em estoque e financeiro: pede "Fiscal: Entrada de XML" (quem lanca a
 * nota de entrada). Emitir a NF-e pede "Fiscal: Emitir Nota Fiscal".
 */
const router = express.Router();
router.use(authenticate);

const temPermissao = (user, permissao) => Boolean(
  user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)),
);

const responderErro = (res, erro, oQue) => {
  if (erro instanceof ErroDevolucaoCompra || (erro && erro.status && erro.message)) {
    return res.status(erro.status).json({ error: erro.message });
  }
  console.error(`[Devolucao compra] erro ao ${oQue}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${oQue}. Nada foi gravado. Tente de novo em instantes.` });
};

const reais = (centavos) => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;

/** Numero da nota para o historico; '' quando ainda nao tem (fila da SEFAZ, rejeitada, numero 0). */
const numeroDaNotaNoHistorico = (numero) => {
  const n = String(numero ?? '').trim().replace(/^0+(?=\d)/, '');
  return n && n !== '0' ? n : '';
};

/**
 * Historico de alteracoes (09/11/2026): envio da NF-e de devolucao ao
 * fornecedor -- na nota, na devolucao e na nota de entrada. `nota` = o que a
 * Spedy respondeu; `recusa` = mensagem quando a Spedy recusou o envio. Le a
 * devolucao so' para o texto (fornecedor, NF de entrada); falha aqui nunca
 * derruba a resposta.
 */
const registrarEnvioDaDevolucao = async (req, tenantId, { nota = null, recusa = '' }) => {
  try {
    const devolucaoId = String((req.body && req.body.devolucaoId) || '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(devolucaoId)) return;
    const snap = await db.collection('devolucoes_compra').doc(devolucaoId).get();
    if (!snap.exists || snap.data().tenantId !== tenantId) return;
    const d = snap.data();
    const fornecedor = d.fornecedorNome || 'fornecedor não informado';
    const deQual = `ao fornecedor ${fornecedor}${d.notaNumero ? ` (NF de entrada ${d.notaNumero})` : ''}`;
    if (!nota) {
      await registrarLog({ ...req.user, tenantId }, {
        modulo: 'fiscal',
        acao: 'emissao',
        descricao: `NF-e de devolução ${deQual} não emitida: ${recusa}`,
        registroId: devolucaoId,
        documentosRelacionados: [d.notaEntradaId],
        documentoTipo: 'devolucao_compra',
        documentoNumero: `NF-e de devolução ${deQual}`,
        motivo: recusa,
      });
      return;
    }
    const numero = numeroDaNotaNoHistorico(nota.numero);
    const rejeitada = nota.status === 'rejected' || nota.status === 'denied';
    const titulo = `NF-e de devolução${numero ? ` ${numero}` : ''} ${deQual}`;
    await registrarLog({ ...req.user, tenantId }, {
      modulo: 'fiscal',
      acao: 'emissao',
      descricao: nota.status === 'authorized'
        ? `${titulo} emitida e autorizada pela SEFAZ, no valor de ${reais(d.totalCentavos)}.`
        : rejeitada
          ? `${titulo} não emitida: a SEFAZ rejeitou (${nota.mensagem || 'motivo não informado'}).`
          : `${titulo} enviada para emissão, no valor de ${reais(d.totalCentavos)}; aguardando a SEFAZ.`,
      registroId: nota.notaId,
      documentosRelacionados: [devolucaoId, d.notaEntradaId],
      documentoTipo: 'nota_fiscal',
      documentoNumero: numero ? `NF-e ${numero}` : `NF-e de devolução ${deQual}`,
      ...(rejeitada && nota.mensagem ? { motivo: nota.mensagem } : {}),
    });
  } catch (erro) {
    console.error('[Devolucao compra] historico da emissao nao gravado:', erro.message);
  }
};

/** GET /api/devolucao-compra?notaEntradaId=... -- devolucoes da nota. */
router.get('/', async (req, res) => {
  try {
    if (!temPermissao(req.user, 'fiscal.entrada') && !canUseFiscal(req.user)) {
      return res.status(403).json({ error: 'Você não tem permissão para ver devoluções ao fornecedor.' });
    }
    return res.json({ ok: true, devolucoes: await listar({ tenantId: resolveTenantId(req), notaEntradaId: req.query.notaEntradaId }) });
  } catch (erro) {
    return responderErro(res, erro, 'carregar as devoluções');
  }
});

/** POST /api/devolucao-compra -- { notaEntradaId, itens: [{ indice, quantidade }], motivo }. */
router.post('/', async (req, res) => {
  try {
    if (!temPermissao(req.user, 'fiscal.entrada')) {
      return res.status(403).json({ error: 'Você não tem permissão para devolver ao fornecedor. Peça a um responsável liberar "Fiscal: Entrada de XML" no seu usuário.' });
    }
    const tenantId = resolveTenantId(req);
    const r = await registrar({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'fiscal',
      acao: 'devolucao_compra',
      descricao: `Devolução ao fornecedor ${r.fornecedorNome} (NF ${r.notaNumero}) de ${reais(r.totalCentavos)}: `
        + `${r.itens.map((i) => `${i.quantidade} ${i.unidade} de ${i.nome}`).join('; ')}. `
        + `Abatido do a pagar: ${reais(r.abatidoCentavos)}${r.aReceberCentavos > 0 ? `; a receber do fornecedor: ${reais(r.aReceberCentavos)}` : ''}. Motivo: ${r.motivo}.`,
      registroId: r.id,
      // Historico de alteracoes (09/11/2026): aparece tambem na nota de entrada e nos titulos mexidos.
      documentosRelacionados: [r.notaEntradaId, r.contaReceberId, ...(r.titulosAbatidos || []).map((t) => t.id)],
      documentoTipo: 'devolucao_compra',
      documentoNumero: `Devolução ao fornecedor ${r.fornecedorNome}${r.notaNumero ? ` (NF ${r.notaNumero})` : ''}`,
      ...(r.motivo ? { motivo: r.motivo } : {}),
      critico: true,
    });
    return res.json({ ok: true, devolucao: { id: r.id, totalCentavos: r.totalCentavos, abatidoCentavos: r.abatidoCentavos, aReceberCentavos: r.aReceberCentavos } });
  } catch (erro) {
    return responderErro(res, erro, 'registrar a devolução');
  }
});

/** POST /api/devolucao-compra/emitir -- { devolucaoId }. */
router.post('/emitir', async (req, res) => {
  let tenantId = '';
  try {
    if (!canUseFiscal(req.user, 'emit')) {
      return res.status(403).json({ error: 'Você não tem permissão para emitir nota fiscal. Peça a um responsável liberar "Fiscal: Emitir Nota Fiscal" no seu usuário.' });
    }
    tenantId = resolveTenantId(req);
    const r = await emitir({ user: req.user, tenantId, corpo: req.body || {} });
    void registrarEnvioDaDevolucao(req, tenantId, { nota: r });
    return res.json({ ok: true, nota: r });
  } catch (erro) {
    // Recusa da Spedy (o servico responde 400/429 com a mensagem dela; as outras
    // travas -- 404, 409, 422 -- barram antes de enviar e nao viram registro).
    if (tenantId && erro instanceof ErroDevolucaoCompra && (erro.status === 400 || erro.status === 429)) {
      void registrarEnvioDaDevolucao(req, tenantId, { recusa: erro.message });
    }
    return responderErro(res, erro, 'emitir a nota de devolução');
  }
});

module.exports = router;
