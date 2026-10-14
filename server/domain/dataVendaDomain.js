/**
 * DATA DA VENDA AUSENTE (2026-10-14).
 *
 * As telas filtram o periodo pela `dataVenda` (AAAA-MM-DD) -- Pedidos de
 * Venda, Relatorio de Vendas, importador da NF-e. Pedido gravado sem ela
 * (vendas antigas e as convertidas de orcamento antes de 13/10/2026) sumia
 * desses periodos. A regra que a tela ja' usava como reserva e' a data em que
 * o pedido foi criado; aqui ela e' gravada de vez no pedido (decisao do dono,
 * 14/10: "preencher no banco").
 *
 * Pedido sem `dataVenda` E sem `createdAt` nao tem de onde tirar a data: fica
 * de fora e aparece no resumo do script, para ser corrigido no cadastro.
 */

const FUSO = 'America/Sao_Paulo';

/** Ja' tem data da venda valida (texto AAAA-MM-DD)? */
const temDataVenda = (dados) => typeof dados?.dataVenda === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dados.dataVenda);

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
 * O que fazer com um pedido: 'ok' (ja' tem), 'preencher' (com `dataVenda`
 * calculada) ou 'sem_data' (nao ha' de onde tirar).
 */
const decidirDataVenda = (dados) => {
  if (temDataVenda(dados)) return { acao: 'ok' };
  const criacao = dataDeCriacao(dados?.createdAt);
  if (!criacao) return { acao: 'sem_data' };
  return { acao: 'preencher', dataVenda: diaNoFuso(criacao) };
};

module.exports = { decidirDataVenda, temDataVenda, dataDeCriacao, diaNoFuso };
