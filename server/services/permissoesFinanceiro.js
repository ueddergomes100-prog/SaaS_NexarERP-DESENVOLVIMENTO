/*
 * PERMISSAO POR ACAO NO FINANCEIRO (item 15 da Embala Minas, fase 1, 25/11/2026).
 *
 * Cada acao do Contas a Receber/Pagar que ja' grava pelo servidor (baixa,
 * baixa em lote, juros e multa, data anterior, lancar/editar/cancelar conta,
 * categoria nova, acerto com fornecedor) passa a pedir a SUA permissao, e nao
 * mais a permissao que abre a tela. Puro (sem Firestore), para testar sozinho.
 *
 * As permissoes sao conferidas pelas EFETIVAS do funcionario
 * (permissoesNovasDomain.ts): quem tem "Contas a Receber" e ainda nao teve as
 * permissoes salvas de novo tem as novas do Receber -- ninguem perde acesso no
 * dia do deploy. Escolha (documentada aqui): a conta e' feita NO PONTO DA
 * CHECAGEM, e nao no middleware de login (auth.js), para nao mudar o que
 * `req.user.permissoes` significa para as outras ~40 rotas.
 *
 * Dono/administrador (Master/Admin) e plataforma seguem liberados pelo
 * `temPermissao` de sempre (o administrador so' passa a depender de permissao
 * no fim do projeto).
 */
const { temPermissao } = require('./baixaFinanceiraRegras');
const { PERMISSAO_FINANCEIRO: PF, permissoesEfetivas } = require('../domain/permissoesNovasDomain');
const { permissionLabelMap } = require('../domain/permissionCatalog');

/** Dar baixa, pelo tipo do titulo. */
const PERMISSAO_DE_BAIXAR = { entrada: PF.receberBaixar, saida: PF.pagarBaixar };

/** Pode, contando as permissoes novas que ja' vem marcadas. */
const podeNoFinanceiro = (user, permissao) => temPermissao(
  { ...(user || {}), permissoes: permissoesEfetivas(user && user.permissoes) },
  permissao,
);

/** O que cada permissao deixa fazer, na frase "Voce nao tem permissao para ...", e o que fazer sem ela. */
const ACOES = {
  [PF.receberBaixar]: { acao: 'dar baixa em contas a receber' },
  [PF.pagarBaixar]: { acao: 'dar baixa em contas a pagar' },
  [PF.baixaJurosMulta]: { acao: 'alterar juros e multa na baixa', dica: 'Sem ela, juros e multa ficam no padrão da filial.' },
  [PF.baixaDataAnterior]: { acao: 'dar baixa com data anterior a hoje', dica: 'Sem ela, dê a baixa com a data de hoje.' },
  [PF.baixaLote]: { acao: 'dar baixa em lote', dica: 'Sem ela, dê baixa conta por conta.' },
  [PF.receberLancar]: { acao: 'lançar contas a receber' },
  [PF.receberEditar]: { acao: 'alterar contas a receber' },
  [PF.receberCancelar]: { acao: 'cancelar contas a receber' },
  [PF.categorias]: { acao: 'criar categorias no plano de contas', dica: 'Escolha uma categoria que já existe.' },
  [PF.acertoFornecedor]: { acao: 'fazer acerto com fornecedor' },
};

const rotulo = (id) => permissionLabelMap[id] || id;
const juntar = (itens) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`);

/**
 * Frase para o usuario quando faltam permissoes (ids). Cita o rotulo que o
 * dono ve no cadastro do funcionario e diz o que fazer.
 */
const mensagemSemPermissao = (faltam) => {
  const ids = [...new Set(faltam)];
  const acoes = ids.map((id) => (ACOES[id] ? ACOES[id].acao : `usar "${rotulo(id)}"`));
  const rotulos = ids.map((id) => `"${rotulo(id)}"`);
  const dica = ids.length === 1 && ACOES[ids[0]] && ACOES[ids[0]].dica ? ` ${ACOES[ids[0]].dica}` : '';
  return `Você não tem permissão para ${juntar(acoes)}. Peça a um responsável liberar ${juntar(rotulos)} no seu cadastro de funcionário.${dica}`;
};

/** Das permissoes pedidas, as que o usuario nao tem (efetivas). [] = pode. */
const permissoesQueFaltam = (user, ids) => [...new Set(ids)].filter((id) => !podeNoFinanceiro(user, id));

/**
 * Permissoes que uma baixa (ou baixa em lote) pede. `pedidos` ja' validados
 * (validarPedidoDeBaixa/validarPedidoDeBaixaEmLote): o `acrescimoCentavos`
 * antigo ja' chega convertido em `jurosCentavos` (ajustesDoPedido), mas
 * tambem conta aqui se vier. Data anterior: `dataPagamento` (AAAA-MM-DD) antes
 * de `hoje` (hojeNoBrasil).
 */
const permissoesDaBaixa = ({ tipo, pedidos, hoje, lote = false }) => {
  const ids = [PERMISSAO_DE_BAIXAR[tipo]];
  if (lote) ids.push(PF.baixaLote);
  const positivo = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
  // Contas a Receber (decisao do dono, 25/11/2026): sem a permissao, juros e
  // multa nao ficam em branco -- ficam NO PADRAO DA FILIAL e nao mudam
  // (jurosNoPadrao, conferido dentro da baixa). No Pagar, juros/multa so' com ela.
  if (tipo !== 'entrada' && pedidos.some((p) => positivo(p.jurosCentavos) || positivo(p.multaCentavos) || positivo(p.acrescimoCentavos))) ids.push(PF.baixaJurosMulta);
  if (pedidos.some((p) => typeof p.dataPagamento === 'string' && p.dataPagamento < hoje)) ids.push(PF.baixaDataAnterior);
  return ids;
};

/**
 * Contas a Receber sem "alterar juros e multa": a baixa tem de levar
 * exatamente os juros e a multa do padrao da filial (conferido em registrarBaixa).
 */
const jurosNoPadrao = (user, tipo) => tipo === 'entrada' && !podeNoFinanceiro(user, PF.baixaJurosMulta);

module.exports = {
  jurosNoPadrao,
  PERMISSAO_DE_BAIXAR,
  podeNoFinanceiro,
  permissoesQueFaltam,
  permissoesDaBaixa,
  mensagemSemPermissao,
};
