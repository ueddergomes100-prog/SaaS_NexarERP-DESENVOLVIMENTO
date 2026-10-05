const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { PERMISSAO_CONDICIONAL } = require('../domain/condicionalDomain');
const {
  ErroCondicional,
  criarCondicional,
  devolverItens,
  fecharCondicional,
  cancelarCondicional,
} = require('../services/condicionais');

/**
 * CONDICIONAL -- ver services/condicionais.js e src/utils/condicionalDomain.ts.
 * Toda escrita em `condicionais` (e o estoque reservado por ela) acontece aqui;
 * as firestore.rules deixam a colecao so' para leitura.
 */
const router = express.Router();
router.use(authenticate);

const temPermissao = (user) => Boolean(
  user.isPlatformAdmin
  || user.isTenantManager
  || (Array.isArray(user.permissoes) && user.permissoes.includes(PERMISSAO_CONDICIONAL)),
);

/** Empresa da operacao: a do token. Admin da plataforma pode agir na empresa escolhida na tela. */
const empresaDaOperacao = (user, corpo) => {
  const pedida = typeof corpo?.tenantId === 'string' ? corpo.tenantId.trim() : '';
  if (!pedida || pedida === user.tenantId) return user.tenantId;
  if (user.isPlatformAdmin) return pedida;
  throw new ErroCondicional(403, 'Você não pode mexer nos condicionais de outra empresa.');
};

const responderErro = (res, erro, acao) => {
  if (erro instanceof ErroCondicional) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Condicional] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao}. Nada foi alterado. Tente de novo em instantes.` });
};

const acao = (nome, operacao, descreverLog) => async (req, res) => {
  try {
    if (!temPermissao(req.user)) {
      return res.status(403).json({ error: 'Você não tem permissão para usar o condicional. Peça a um responsável liberar "Vendas: Condicional" no seu usuário.' });
    }
    const tenantId = empresaDaOperacao(req.user, req.body);
    const resultado = await operacao({
      user: req.user,
      tenantId,
      id: req.params.id,
      corpo: req.body || {},
      hoje: getDateInputInTimeZone(),
    });
    const descricao = descreverLog(resultado);
    if (descricao) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'condicional',
        acao: 'edicao',
        descricao,
        registroId: String(req.params.id || resultado.id || ''),
      });
    }
    return res.json({ ok: true, ...resultado });
  } catch (erro) {
    return responderErro(res, erro, nome);
  }
};

/** POST /api/condicionais  { clienteId, itens:[{id,quantidade}], prazoDevolucao, observacao?, idDocumento?, tenantId? } */
router.post('/', acao('criar o condicional', criarCondicional,
  (r) => (r.jaEnviado ? '' : `Condicional nº ${r.numeroCondicional} criado (saída de mercadoria para o cliente).`)));

/** POST /api/condicionais/:id/devolucao  { itens:[{id,quantidade}] } */
router.post('/:id/devolucao', acao('registrar a devolução', devolverItens,
  (r) => `Condicional nº ${r.numeroCondicional} (${r.clienteNome}): devolução de ${r.pecasDevolvidas} peça(s)${r.tudoDevolvido ? ' — tudo devolvido' : ''}.`));

/** POST /api/condicionais/:id/fechar  { itens?:[{id,quantidade}] }  -- itens = devolução final */
router.post('/:id/fechar', acao('fechar o condicional', fecharCondicional,
  (r) => (r.numeroPedido
    ? `Condicional nº ${r.numeroCondicional} (${r.clienteNome}) fechado: ${r.pecasVendidas} peça(s) viraram a pré-venda nº ${r.numeroPedido}.`
    : `Condicional nº ${r.numeroCondicional} (${r.clienteNome}) fechado: tudo devolvido.`)));

/** POST /api/condicionais/:id/cancelar  { motivo } */
router.post('/:id/cancelar', acao('cancelar o condicional', cancelarCondicional,
  (r) => `Condicional nº ${r.numeroCondicional} (${r.clienteNome}) cancelado: ${r.motivo}`));

module.exports = router;
