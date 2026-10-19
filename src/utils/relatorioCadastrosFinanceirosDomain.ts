import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { normalizeCreditCardFeeSchedule } from './financeDomain';

/*
 * RELATORIOS DE CADASTRO: BANDEIRAS DE CARTAO E BANCOS (19/10/2026, pedido do
 * dono no levantamento de 16/10 -- "Relatorios que faltam").
 *
 * "Mais opcoes › Relatorio" na lista: sai exatamente o que a lista mostra
 * (busca e situacao ja aplicadas pela tela), no padrao de relatorio do sistema
 * (PDF na tela, colunas por caixa de marcar). Regra pura: recebe os cadastros
 * ja lidos e devolve o documento.
 */

export interface DocumentoRelatorioDeCadastro {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const percentual = (valor: unknown): string => {
  const n = Number(valor);
  return Number.isFinite(n) ? `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}%` : '';
};

const dias = (valor: unknown): number | null => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const situacao = (ativo: unknown): string => (ativo === false ? 'Inativo' : 'Ativo');

// ---------------------------------------------------------------------------
// BANDEIRAS DE CARTAO
// ---------------------------------------------------------------------------

export interface BandeiraDoRelatorio {
  id: string;
  nome: string;
  ativo?: boolean;
  ordem?: number;
  taxaDebitoPercentual?: number;
  taxasCreditoPorParcela?: Record<string, number>;
  prazoRecebimentoCreditoDias?: number;
  prazoRecebimentoDebitoDias?: number;
}

/** Parcelas que ja' vem marcadas; as outras ficam na caixa de marcar. */
const PARCELAS_PADRAO = new Set([1, 2, 3, 6, 10, 12]);

export const montarDocumentoBandeiras = (
  bandeiras: BandeiraDoRelatorio[],
  opcoes: { filtrosAplicados: string[] },
): DocumentoRelatorioDeCadastro => {
  const ativas = bandeiras.filter((b) => b.ativo !== false).length;
  const colunasDeParcela: ColunaRelatorio<BandeiraDoRelatorio>[] = Array.from({ length: 12 }, (_, i) => i + 1).map((parcela) => ({
    id: `credito${parcela}x`,
    titulo: `Crédito ${parcela}x`,
    tipo: 'texto',
    largura: 16,
    padrao: PARCELAS_PADRAO.has(parcela),
    valor: (b) => percentual(normalizeCreditCardFeeSchedule(b.taxasCreditoPorParcela)[String(parcela)]),
  }));

  const colunas: ColunaRelatorio<BandeiraDoRelatorio>[] = [
    { id: 'ordem', titulo: 'Ordem', tipo: 'inteiro', total: 'nenhum', largura: 12, padrao: false, valor: (b) => (Number(b.ordem) > 0 ? Number(b.ordem) : null) },
    { id: 'bandeira', titulo: 'Bandeira', tipo: 'texto', largura: 34, valor: (b) => b.nome || '' },
    { id: 'debito', titulo: 'Débito', tipo: 'texto', largura: 16, valor: (b) => percentual(b.taxaDebitoPercentual ?? 0) },
    ...colunasDeParcela,
    // Prazo nao se soma entre bandeiras: sem total.
    { id: 'prazoDebito', titulo: 'Recebe débito (dias)', tipo: 'inteiro', total: 'nenhum', largura: 20, valor: (b) => dias(b.prazoRecebimentoDebitoDias) },
    { id: 'prazoCredito', titulo: 'Recebe crédito (dias)', tipo: 'inteiro', total: 'nenhum', largura: 20, valor: (b) => dias(b.prazoRecebimentoCreditoDias) },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, padrao: false, valor: (b) => situacao(b.ativo) },
  ];

  return {
    titulo: 'Bandeiras de Cartão',
    periodo: 'Cadastro atual',
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Bandeiras', valor: String(bandeiras.length) },
      { rotulo: 'Ativas', valor: String(ativas) },
      { rotulo: 'Inativas', valor: String(bandeiras.length - ativas) },
    ],
    secoes: [{
      id: 'bandeiras',
      titulo: 'Taxas e prazos por bandeira',
      colunas,
      linhas: bandeiras,
      unidade: ['bandeira', 'bandeiras'],
      mensagemVazia: 'Nenhuma bandeira com esses filtros.',
    } as SecaoRelatorio],
  };
};

// ---------------------------------------------------------------------------
// BANCOS
// ---------------------------------------------------------------------------

export interface BancoDoRelatorio {
  id: string;
  nome: string;
  banco?: string;
  agencia?: string;
  conta?: string;
  contaDv?: string;
  tipoConta?: string;
  saldoInicialCentavos?: number;
  saldoCentavos?: number;
  ativo?: boolean;
  /** Convenio de boleto configurado (so' interessa se existe). */
  boleto?: { banco?: string; ativo?: boolean } | null;
}

const ROTULO_TIPO_CONTA: Record<string, string> = { corrente: 'Corrente', poupanca: 'Poupança', outro: 'Outro' };

export const montarDocumentoBancos = (
  bancos: BancoDoRelatorio[],
  opcoes: { filtrosAplicados: string[] },
): DocumentoRelatorioDeCadastro => {
  const ativos = bancos.filter((b) => b.ativo !== false).length;
  const saldoTotal = bancos.reduce((soma, b) => soma + (Number(b.saldoCentavos) || 0), 0);
  const reais = (centavos: number) => `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)}`;

  const colunas: ColunaRelatorio<BancoDoRelatorio>[] = [
    { id: 'nome', titulo: 'Nome', tipo: 'texto', largura: 40, valor: (b) => b.nome || '' },
    { id: 'banco', titulo: 'Banco', tipo: 'texto', largura: 30, valor: (b) => b.banco || '' },
    { id: 'agencia', titulo: 'Agência', tipo: 'texto', largura: 16, valor: (b) => b.agencia || '' },
    { id: 'conta', titulo: 'Conta', tipo: 'texto', largura: 22, valor: (b) => (b.conta ? `${b.conta}${b.contaDv ? `-${b.contaDv}` : ''}` : '') },
    { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 16, padrao: false, valor: (b) => ROTULO_TIPO_CONTA[String(b.tipoConta || '')] || '' },
    { id: 'boleto', titulo: 'Emite boleto', tipo: 'texto', largura: 16, padrao: false, valor: (b) => (b.boleto && b.boleto.ativo !== false ? 'Sim' : 'Não') },
    { id: 'saldoInicial', titulo: 'Saldo inicial', tipo: 'moeda', largura: 24, padrao: false, valor: (b) => Number(b.saldoInicialCentavos) || 0 },
    { id: 'saldo', titulo: 'Saldo atual', tipo: 'moeda', largura: 24, valor: (b) => Number(b.saldoCentavos) || 0 },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, padrao: false, valor: (b) => situacao(b.ativo) },
  ];

  return {
    titulo: 'Contas Bancárias',
    periodo: 'Cadastro atual',
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Contas', valor: String(bancos.length) },
      { rotulo: 'Ativas', valor: String(ativos) },
      { rotulo: 'Saldo das contas listadas', valor: reais(saldoTotal) },
    ],
    secoes: [{
      id: 'bancos',
      titulo: 'Contas bancárias',
      colunas,
      linhas: bancos,
      rotuloTotal: 'Total das contas listadas',
      unidade: ['conta', 'contas'],
      mensagemVazia: 'Nenhuma conta com esses filtros.',
    } as SecaoRelatorio],
  };
};
