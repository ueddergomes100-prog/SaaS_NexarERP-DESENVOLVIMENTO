/**
 * DATAS AUSENTES QUE AS TELAS USAM PARA O PERIODO (2026-10-14).
 *
 * Com a otimizacao de leituras, as telas pedem ao banco so' o periodo, pelo
 * campo de data de cada uma. Documento gravado sem esse campo sumia do
 * periodo. A regra que as telas ja' usavam como reserva e' o dia em que o
 * documento foi criado; aqui ela e' gravada de vez (decisao do dono, 14/10:
 * "preencher no banco"). Dois casos:
 *
 *  - Pedido sem `dataVenda` (vendas antigas e as convertidas de orcamento
 *    antes de 13/10/2026) -> dataVenda = dia da criacao.
 *  - Lancamento PAGO sem `dataPagamento` e sem `data` -> dataPagamento = dia
 *    da criacao (o relatorio financeiro ja' fazia dataPagamento -> data ->
 *    criacao). Lancamento pendente sem vencimento NAO e' preenchido: inventar
 *    vencimento faria o titulo aparecer como vencido; ele e' so' listado.
 *
 * Documento sem a data E sem `createdAt` nao tem de onde tirar: fica de fora e
 * aparece no resumo do script, para ser corrigido no cadastro.
 */

const FUSO = 'America/Sao_Paulo';

const ehDia = (valor) => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);

/** `createdAt` (Timestamp do Admin, Date ou mapa {_seconds}) -> Date, ou null. */
const dataDeCriacao = (valor) => {
  if (!valor) return null;
  if (typeof valor.toDate === 'function') return valor.toDate();
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (Number.isInteger(valor._seconds)) return new Date(valor._seconds * 1000);
  if (Number.isInteger(valor.seconds)) return new Date(valor.seconds * 1000);
  return null;
};

/** Dia (AAAA-MM-DD) no fuso da empresa. */
const diaNoFuso = (data) => new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(data);

/**
 * Decide o que fazer com um documento: 'ok' (algum dos campos ja' tem dia
 * valido), 'preencher' (grava `campo` com o dia da criacao) ou 'sem_data'.
 */
const decidirDataFaltante = (dados, campo, alternativas = []) => {
  if ([campo, ...alternativas].some((nome) => ehDia(dados?.[nome]))) return { acao: 'ok' };
  const criacao = dataDeCriacao(dados?.createdAt);
  if (!criacao) return { acao: 'sem_data' };
  return { acao: 'preencher', campo, valor: diaNoFuso(criacao) };
};

/** Pedido de venda: `dataVenda`. */
const decidirDataVenda = (pedido) => decidirDataFaltante(pedido, 'dataVenda');

/**
 * Lancamento financeiro: so' o PAGO sem `dataPagamento` e sem `data` ganha
 * `dataPagamento`. Os demais ficam como estao ('ok') ou sao so' listados
 * ('pendente_sem_vencimento').
 */
const decidirDataDoLancamento = (lancamento) => {
  if (lancamento?.status === 'Paga') return decidirDataFaltante(lancamento, 'dataPagamento', ['data']);
  if (lancamento?.status === 'Pendente' && !ehDia(lancamento?.data)) return { acao: 'pendente_sem_vencimento' };
  return { acao: 'ok' };
};

module.exports = { decidirDataFaltante, decidirDataVenda, decidirDataDoLancamento, dataDeCriacao, diaNoFuso };
