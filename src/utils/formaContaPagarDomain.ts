import { FORMAS_DE_PAGAMENTO } from './pagamentoEntradaDomain';
import { toCents } from './financeDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * CONTAS A PAGAR POR FORMA DE PAGAMENTO (pedido do dono, 24/11/2026).
 *
 * O cliente quer controlar o que tem a pagar em boleto e o que tem em cheque,
 * conforme lancou na nota de entrada. A lista ganha a coluna "Forma", o filtro
 * por forma, o resumo "a pagar por forma" e o relatorio em PDF com a coluna.
 *
 * Qual forma o titulo tem:
 *  - pago: a forma da baixa (`formaPagamento`), ou a prevista;
 *  - em aberto: a prevista (`formaPagamentoPrevista`), ou `formaPagamento`.
 * Titulo antigo sem nenhuma das duas fica sem forma ("—"): nao se inventa.
 *
 * O filtro junta os nomes que o sistema grava de jeitos diferentes ("Pix" da
 * baixa e "PIX" da entrada; "Cartao de Credito/Debito" e "Cartao").
 *
 * Regra pura: sem tela, sem Firestore.
 */

export const FORMAS_DO_FILTRO = FORMAS_DE_PAGAMENTO;
export const SEM_FORMA = 'Sem forma informada';

export interface TituloComForma {
  status?: string;
  formaPagamento?: string | null;
  formaPagamentoPrevista?: string | null;
  bancoNome?: string | null;
  cheque?: { numeroCheque?: string; bancoEmissor?: string } | null;
  valor?: number;
}

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Forma gravada no titulo ('' quando nao ha'). */
export const formaDoTitulo = (titulo: TituloComForma): string => {
  const efetiva = String(titulo.formaPagamento ?? '').trim();
  const prevista = String(titulo.formaPagamentoPrevista ?? '').trim();
  return titulo.status === 'Paga' ? (efetiva || prevista) : (prevista || efetiva);
};

/** Grupo do filtro de uma forma ('' = sem forma). */
export const grupoDaForma = (forma: string): string => {
  const chave = semAcento(forma);
  if (!chave) return '';
  if (chave === 'pix') return 'PIX';
  if (chave.startsWith('cartao')) return 'Cartão';
  if (chave.startsWith('transferencia') || chave === 'ted' || chave === 'doc') return 'Transferência';
  if (chave.startsWith('boleto')) return 'Boleto';
  if (chave === 'dinheiro') return 'Dinheiro';
  if (chave === 'cheque') return 'Cheque';
  return 'Outros';
};

/** O titulo passa no filtro de forma? ('' = todas) */
export const passaNoFiltroDeForma = (titulo: TituloComForma, filtro: string): boolean => (
  !filtro || grupoDaForma(formaDoTitulo(titulo)) === filtro
);

/** Texto da coluna "Forma": "Boleto", "Cheque nº 123 · SICOOB", ou "—". */
export const rotuloDaFormaDoTitulo = (titulo: TituloComForma): string => {
  const forma = formaDoTitulo(titulo);
  if (!forma) return '—';
  if (grupoDaForma(forma) !== 'Cheque') return forma;
  const numero = String(titulo.cheque?.numeroCheque ?? '').trim();
  const banco = String(titulo.bancoNome || titulo.cheque?.bancoEmissor || '').trim();
  return [numero ? `Cheque nº ${numero}` : 'Cheque', banco].filter(Boolean).join(' · ');
};

export interface LinhaDoResumoPorForma {
  forma: string;
  quantidade: number;
  centavos: number;
}

/**
 * O que esta' EM ABERTO por forma (so' os Pendentes da lista recebida), na
 * ordem das formas da entrada e "Sem forma informada" por ultimo.
 */
export const resumoAPagarPorForma = (titulos: TituloComForma[]): LinhaDoResumoPorForma[] => {
  const mapa = new Map<string, LinhaDoResumoPorForma>();
  titulos.forEach((titulo) => {
    if (titulo.status !== 'Pendente') return;
    const forma = grupoDaForma(formaDoTitulo(titulo)) || SEM_FORMA;
    const linha = mapa.get(forma) || { forma, quantidade: 0, centavos: 0 };
    linha.quantidade += 1;
    linha.centavos += toCents(Number(titulo.valor || 0));
    mapa.set(forma, linha);
  });
  const ordem = [...FORMAS_DO_FILTRO, SEM_FORMA] as string[];
  return [...mapa.values()].filter((l) => l.centavos !== 0 || l.quantidade > 0).sort((a, b) => ordem.indexOf(a.forma) - ordem.indexOf(b.forma));
};

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

/** "Boleto R$ 1.000,00 · Cheque R$ 500,00" ('' quando nao ha' nada em aberto). */
export const textoDoResumoPorForma = (resumo: LinhaDoResumoPorForma[]): string => (
  resumo.map((linha) => `${linha.forma} ${moeda(linha.centavos)}`).join(' · ')
);

// ---------------------------------------------------------------- relatorio

export interface TituloDoRelatorioPagar extends TituloComForma {
  id: string;
  data?: string;
  dataPagamento?: string;
  descricao?: string;
  categoria?: string;
  fornecedorNome?: string;
}

const dataBr = (dia?: string): string => (dia && /^\d{4}-\d{2}-\d{2}/.test(dia) ? dia.slice(0, 10).split('-').reverse().join('/') : '');

const situacaoDoTitulo = (titulo: TituloDoRelatorioPagar, hoje: string): string => {
  if (titulo.status === 'Paga') return 'Paga';
  if (titulo.status === 'Cancelada') return 'Cancelada';
  return titulo.data && titulo.data < hoje ? 'Vencida' : 'Em aberto';
};

export interface DocumentoContasPagar {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

/**
 * Relatorio da tela de Contas a Pagar (Mais opcoes › Relatorio): os titulos
 * que a lista mostra (situacao, periodo, busca e forma ja' aplicados), com a
 * coluna "Forma" e o resumo do que esta' em aberto por forma.
 */
export const montarDocumentoContasPagar = (
  titulos: TituloDoRelatorioPagar[],
  opcoes: { filtrosAplicados: string[]; periodo: string; dataHoje: string },
): DocumentoContasPagar => {
  const lista = [...titulos].sort((a, b) => String(a.data || '9999-12-31').localeCompare(String(b.data || '9999-12-31')));
  const centavos = (t: TituloDoRelatorioPagar) => toCents(Number(t.valor || 0));
  const total = lista.reduce((soma, t) => soma + centavos(t), 0);
  const emAberto = lista.filter((t) => t.status === 'Pendente').reduce((soma, t) => soma + centavos(t), 0);
  const porForma = resumoAPagarPorForma(lista);

  const colunas: ColunaRelatorio<TituloDoRelatorioPagar>[] = [
    { id: 'vencimento', titulo: 'Vencimento', tipo: 'texto', largura: 20, valor: (t) => dataBr(t.data) },
    { id: 'fornecedor', titulo: 'Fornecedor', tipo: 'texto', largura: 46, valor: (t) => t.fornecedorNome || '' },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 56, valor: (t) => t.descricao || '' },
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 30, padrao: false, valor: (t) => t.categoria || '' },
    { id: 'forma', titulo: 'Forma', tipo: 'texto', largura: 36, valor: (t) => rotuloDaFormaDoTitulo(t) },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (t) => centavos(t) },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 20, valor: (t) => situacaoDoTitulo(t, opcoes.dataHoje) },
    { id: 'pagoEm', titulo: 'Pago em', tipo: 'texto', largura: 20, padrao: false, valor: (t) => (t.status === 'Paga' ? dataBr(t.dataPagamento) : '') },
  ];
  const colunasForma: ColunaRelatorio<LinhaDoResumoPorForma>[] = [
    { id: 'forma', titulo: 'Forma', tipo: 'texto', largura: 50, valor: (l) => l.forma },
    { id: 'quantidade', titulo: 'Títulos', tipo: 'inteiro', valor: (l) => l.quantidade },
    { id: 'valor', titulo: 'Em aberto', tipo: 'moeda', valor: (l) => l.centavos },
  ];

  return {
    titulo: 'Contas a Pagar',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Títulos', valor: String(lista.length) },
      { rotulo: 'Valor total', valor: moeda(total) },
      { rotulo: 'Em aberto', valor: moeda(emAberto) },
    ],
    secoes: [
      {
        id: 'titulos', titulo: 'Títulos', colunas, linhas: lista, opcional: true, padrao: true,
        unidade: ['título', 'títulos'], mensagemVazia: 'Nenhuma conta com esses filtros.',
      } as SecaoRelatorio,
      {
        id: 'porForma', titulo: 'Em aberto por forma de pagamento', colunas: colunasForma, linhas: porForma,
        opcional: true, padrao: true, unidade: ['forma', 'formas'], mensagemVazia: 'Nenhuma conta em aberto com esses filtros.',
      } as SecaoRelatorio,
    ],
  };
};
