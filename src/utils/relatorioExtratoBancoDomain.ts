import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { transactionNetCents } from './financeDomain';

/*
 * RELATORIO DO BANCO (Financeiro › Banco) -- 19/10/2026, levantamento de 16/10
 * ("Relatorios que faltam": extrato do Banco).
 *
 * Sai o que a tela mostra: o extrato digital confirmado do periodo escolhido
 * (Pix, transferencia, cartao conciliado...) e, como secao opcional, o cartao
 * ainda a conciliar. Saida entra negativa: o total da secao e' o movimento
 * liquido do periodo. Regra pura: recebe os lancamentos ja' filtrados pela tela.
 */

export interface LancamentoDoExtrato {
  id: string;
  data?: string;
  dataPagamento?: string;
  dataPrevistaRecebimento?: string;
  descricao?: string;
  clienteNome?: string;
  formaPagamento?: string;
  tipo?: 'entrada' | 'saida';
  valor?: number;
  valorCentavos?: number;
  bancoNome?: string;
  cartao?: { bandeira?: string; numero?: number; totalParcelas?: number; valorTaxaCentavos?: number; valorLiquidoCentavos?: number } | null;
}

export interface SaldoDeConta {
  nome: string;
  saldoCentavos: number;
}

const dataBr = (dia: unknown): string => {
  const texto = String(dia ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10).split('-').reverse().join('/') : '';
};

const reais = (centavos: number): string => `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)}`;

/** Valor com sinal: entrada soma, saida subtrai (liquido de taxa, como a tela). */
export const valorNoExtratoCentavos = (l: LancamentoDoExtrato): number => {
  const liquido = transactionNetCents(l as Parameters<typeof transactionNetCents>[0]);
  return l.tipo === 'saida' ? -liquido : liquido;
};

export const montarDocumentoExtratoBanco = (args: {
  extrato: LancamentoDoExtrato[];
  cartaoAConciliar: LancamentoDoExtrato[];
  saldos: SaldoDeConta[];
  periodo: string;
  filtrosAplicados: string[];
}): { titulo: string; periodo: string; filtros: string[]; indicadores: IndicadorRelatorio[]; secoes: SecaoRelatorio[] } => {
  const entradas = args.extrato.filter((l) => l.tipo !== 'saida').reduce((s, l) => s + valorNoExtratoCentavos(l), 0);
  const saidas = args.extrato.filter((l) => l.tipo === 'saida').reduce((s, l) => s - valorNoExtratoCentavos(l), 0);
  const aConciliar = args.cartaoAConciliar.reduce((s, l) => s + transactionNetCents(l as Parameters<typeof transactionNetCents>[0]), 0);

  const colunasExtrato: ColunaRelatorio<LancamentoDoExtrato>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 20, valor: (l) => dataBr(l.dataPagamento || l.data) },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 70, valor: (l) => l.descricao || '' },
    { id: 'cliente', titulo: 'Cliente / Fornecedor', tipo: 'texto', largura: 44, padrao: false, valor: (l) => l.clienteNome || '' },
    { id: 'forma', titulo: 'Forma', tipo: 'texto', largura: 28, valor: (l) => l.formaPagamento || 'Não informada' },
    { id: 'banco', titulo: 'Banco', tipo: 'texto', largura: 28, valor: (l) => l.bancoNome || '' },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', largura: 24, valor: valorNoExtratoCentavos },
  ];

  const colunasCartao: ColunaRelatorio<LancamentoDoExtrato>[] = [
    { id: 'previsto', titulo: 'Vencimento previsto', tipo: 'texto', largura: 22, valor: (l) => dataBr(l.dataPrevistaRecebimento || l.data) },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 60, valor: (l) => `${l.descricao || ''}${l.cartao?.numero ? ` (${l.cartao.numero}/${l.cartao.totalParcelas})` : ''}` },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 40, valor: (l) => l.clienteNome || '' },
    { id: 'bandeira', titulo: 'Bandeira', tipo: 'texto', largura: 22, valor: (l) => l.cartao?.bandeira || '' },
    { id: 'banco', titulo: 'Banco', tipo: 'texto', largura: 26, padrao: false, valor: (l) => l.bancoNome || 'A definir' },
    { id: 'bruto', titulo: 'Valor bruto', tipo: 'moeda', largura: 22, valor: (l) => Number(l.valorCentavos ?? Math.round(Number(l.valor || 0) * 100)) },
    { id: 'taxa', titulo: 'Taxa', tipo: 'moeda', largura: 18, valor: (l) => Number(l.cartao?.valorTaxaCentavos || 0) },
    { id: 'liquido', titulo: 'Valor líquido', tipo: 'moeda', largura: 22, valor: (l) => transactionNetCents(l as Parameters<typeof transactionNetCents>[0]) },
  ];

  return {
    titulo: 'Extrato do Banco',
    periodo: args.periodo,
    filtros: args.filtrosAplicados,
    indicadores: [
      { rotulo: 'Entradas', valor: reais(entradas) },
      { rotulo: 'Saídas', valor: reais(saidas) },
      { rotulo: 'Movimento do período', valor: reais(entradas - saidas) },
      { rotulo: 'Cartão a conciliar', valor: reais(aConciliar) },
      ...args.saldos.map((s) => ({ rotulo: `Saldo hoje — ${s.nome}`, valor: reais(s.saldoCentavos) })),
    ],
    secoes: [
      {
        id: 'extrato',
        titulo: 'Extrato digital confirmado',
        colunas: colunasExtrato,
        linhas: args.extrato,
        rotuloTotal: 'Movimento do período',
        unidade: ['lançamento', 'lançamentos'],
        mensagemVazia: 'Nenhuma movimentação digital no período selecionado.',
      } as SecaoRelatorio,
      {
        id: 'cartao',
        titulo: 'Cartão pendente de conciliação',
        colunas: colunasCartao,
        linhas: args.cartaoAConciliar,
        opcional: true,
        padrao: true,
        rotuloTotal: 'Total a conciliar',
        unidade: ['título', 'títulos'],
        mensagemVazia: 'Nenhum cartão pendente de conciliação.',
      } as SecaoRelatorio,
    ],
  };
};
