/**
 * RESUMO DO GRUPO (Filiais, fase 5 -- 2026-10-06): vendas, contas a receber e
 * valor em estoque de cada filial, lado a lado, para o dono. Puro (o servidor
 * le as filiais e chama estas contas -- ver server/services/filiais.js).
 *
 * Mesmas regras das telas:
 *  - venda conta como no Dashboard: status que conta como faturamento
 *    (contaComoFaturamento -- pre-venda, em aberto e cancelada ficam fora) e
 *    data da venda (dataVenda; sem ela, a de criacao) dentro do periodo, pelo
 *    total gravado em centavos;
 *  - a receber = transacoes de entrada "Pendente", sem cartao (o cartao fica
 *    na tela Banco -- contasReceberQuery.ts), pelo valor liquido;
 *  - estoque = quantidade positiva x custo do produto.
 */
import { transactionNetCents } from './financeDomain';
import { contaComoFaturamento } from './preVendaDomain';
import { getDateInputInTimeZone } from './dateTime';

export interface ResumoDaFilial {
  tenantId: string;
  codigo: string;
  nome: string;
  vendasCentavos: number;
  pedidos: number;
  ticketMedioCentavos: number;
  aReceberCentavos: number;
  estoqueCentavos: number;
}

const FORMAS_FORA_DO_A_RECEBER = ['Cartão de Crédito', 'Cartão de Débito'];

const DATA = /^\d{4}-\d{2}-\d{2}/;

/** 'AAAA-MM-DD' da venda no fuso de Brasilia: dataVenda; sem ela, createdAt. */
export const dataDoPedido = (p: Record<string, unknown>): string => {
  if (typeof p.dataVenda === 'string' && DATA.test(p.dataVenda)) return p.dataVenda.slice(0, 10);
  const criado = p.createdAt as { toDate?: () => Date; seconds?: number } | Date | string | undefined;
  let data: Date | null = null;
  if (criado instanceof Date) data = criado;
  else if (criado && typeof criado === 'object' && typeof criado.toDate === 'function') data = criado.toDate();
  else if (criado && typeof criado === 'object' && typeof criado.seconds === 'number') data = new Date(criado.seconds * 1000);
  else if (typeof criado === 'string') data = new Date(criado);
  return data && !Number.isNaN(data.getTime()) ? getDateInputInTimeZone(data) : '';
};

/** Periodo opcional em 'AAAA-MM-DD' (inclusivo). */
export const somarVendas = (
  pedidos: Array<Record<string, unknown>>,
  periodo?: { inicio: string; fim: string },
): { centavos: number; quantidade: number } => {
  let centavos = 0;
  let quantidade = 0;
  for (const p of pedidos) {
    if (!contaComoFaturamento(p.status)) continue;
    if (periodo) {
      const dia = dataDoPedido(p);
      if (!dia || dia < periodo.inicio || dia > periodo.fim) continue;
    }
    const total = Number(p.valorTotalCentavos ?? Math.round(Number(p.valorTotal || 0) * 100));
    if (!Number.isFinite(total)) continue;
    centavos += total;
    quantidade += 1;
  }
  return { centavos, quantidade };
};

export const somarAReceber = (transacoes: Array<Record<string, unknown>>): number => transacoes.reduce<number>((total, t) => {
  if (t.tipo !== 'entrada' || t.status !== 'Pendente') return total;
  if (FORMAS_FORA_DO_A_RECEBER.includes(String(t.formaPagamento ?? ''))) return total;
  return total + transactionNetCents(t as Parameters<typeof transactionNetCents>[0]);
}, 0);

export const valorEmEstoque = (produtos: Array<Record<string, unknown>>): number => produtos.reduce<number>((total, p) => {
  if (p.ativo === false || p.statusAtivo === false) return total;
  const quantidade = Math.max(0, Number(p.quantidade) || 0);
  const custo = Math.max(0, Number(p.precoCusto) || 0);
  return total + Math.round(quantidade * custo * 100);
}, 0);

export const resumoDaFilial = (
  filial: { tenantId: string; codigo: string; nome: string },
  dados: { pedidos: Array<Record<string, unknown>>; transacoes: Array<Record<string, unknown>>; produtos: Array<Record<string, unknown>> },
  periodo?: { inicio: string; fim: string },
): ResumoDaFilial => {
  const vendas = somarVendas(dados.pedidos, periodo);
  return {
    tenantId: filial.tenantId,
    codigo: filial.codigo,
    nome: filial.nome,
    vendasCentavos: vendas.centavos,
    pedidos: vendas.quantidade,
    ticketMedioCentavos: vendas.quantidade > 0 ? Math.round(vendas.centavos / vendas.quantidade) : 0,
    aReceberCentavos: somarAReceber(dados.transacoes),
    estoqueCentavos: valorEmEstoque(dados.produtos),
  };
};

/** Linha "Total do grupo". */
export const totalDoGrupo = (linhas: ResumoDaFilial[]): Omit<ResumoDaFilial, 'tenantId' | 'codigo' | 'nome'> => {
  const vendasCentavos = linhas.reduce((s, l) => s + l.vendasCentavos, 0);
  const pedidos = linhas.reduce((s, l) => s + l.pedidos, 0);
  return {
    vendasCentavos,
    pedidos,
    ticketMedioCentavos: pedidos > 0 ? Math.round(vendasCentavos / pedidos) : 0,
    aReceberCentavos: linhas.reduce((s, l) => s + l.aReceberCentavos, 0),
    estoqueCentavos: linhas.reduce((s, l) => s + l.estoqueCentavos, 0),
  };
};
