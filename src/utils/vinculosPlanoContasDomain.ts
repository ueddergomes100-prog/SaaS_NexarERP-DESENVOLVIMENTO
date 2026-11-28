/**
 * LANCAMENTOS AUTOMATICOS x PLANO DE CONTAS (28/11/2026, pedido do dono: "aqui
 * tinha que ter os ja' pre-definidos -- venda cartao, pix, dinheiro e todas as
 * formas de pagamento que a empresa usa, recebimento, pagamento, tudo 100%
 * vinculado em todas as telas do sistema que envolvem pagamento, recebimento e
 * lancamentos").
 *
 * Cada situacao em que o SISTEMA lanca dinheiro sozinho (venda em cada forma,
 * OS, juros, descontos, tarifa do banco, compra de mercadoria, frete, despesas
 * de rota...) tem um VINCULO com uma categoria do plano de contas. O padrao ja'
 * vem preenchido; o dono troca em Configuracoes Gerais > Plano de Contas >
 * Lancamentos automaticos. Toda tela que grava lancamento pergunta aqui
 * (`categoriaDoEvento`) -- nenhuma escreve o nome da categoria por conta.
 *
 * Decisoes do dono (28/11/2026):
 *  - uma categoria por forma na venda ("Venda no Pix", "Venda a Prazo"...);
 *  - titulo de venda recebido depois (boleto, a prazo) TROCA para a categoria
 *    da forma em que o cliente pagou (`categoriaNaBaixa`);
 *  - empresas que ja' usam ganham o que falta sem perder nada: o plano que as
 *    telas mostram e' o salvo + as categorias dos vinculos (`planoEfetivo`),
 *    sem precisar regravar nada no banco.
 *
 * Fora daqui, de proposito: Cancelamento de Venda/OS, Devolucao de Venda,
 * Renegociacao e "boleto pago de venda cancelada" -- o DRE usa esses nomes
 * para ABATER a receita (financeDomain: REVENUE_REVERSAL_CATEGORIES); trocar o
 * nome quebraria a conta. Aparecem na tela so' como informacao.
 */

export type TipoDoEvento = 'receita' | 'despesa';

/** Formas de pagamento (as mesmas de PaymentMethod em financeDomain.ts). */
export const FORMAS_DO_PLANO = [
  'Dinheiro',
  'Pix',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Transferência',
  'Boleto',
  'Cheque',
  'Pagamento a Prazo',
  'Crédito de Devolução',
  'Cashback',
  'Outros',
] as const;

export type FormaDoPlano = typeof FORMAS_DO_PLANO[number];

const CATEGORIA_DA_VENDA: Record<FormaDoPlano, string> = {
  Dinheiro: 'Venda em Dinheiro',
  Pix: 'Venda no Pix',
  'Cartão de Crédito': 'Venda no Cartão de Crédito',
  'Cartão de Débito': 'Venda no Cartão de Débito',
  'Transferência': 'Venda por Transferência',
  Boleto: 'Venda no Boleto',
  Cheque: 'Venda no Cheque',
  'Pagamento a Prazo': 'Venda a Prazo',
  'Crédito de Devolução': 'Venda com Crédito de Devolução',
  Cashback: 'Venda com Cashback',
  Outros: 'Venda em Outras Formas',
};

export type EventoFixo =
  | 'os'
  | 'juros_recebidos'
  | 'descontos_obtidos'
  | 'pago_a_mais'
  | 'devolucao_compra'
  | 'juros_pagos'
  | 'descontos_concedidos'
  | 'tarifa_bancaria'
  | 'compra_mercadoria'
  | 'frete'
  | 'despesas_rota';

export type EventoFinanceiro = `venda:${FormaDoPlano}` | EventoFixo;

export interface DefinicaoDoEvento {
  evento: EventoFinanceiro;
  tipo: TipoDoEvento;
  /** Como aparece na tela ("Venda no Pix", "Juros e multa recebidos na baixa"). */
  rotulo: string;
  /** Categoria pre-definida. */
  padrao: string;
  /** Grupo da tela. */
  grupo: 'vendas' | 'recebimentos' | 'pagamentos' | 'compras';
}

const eventoDaVenda = (forma: FormaDoPlano): EventoFinanceiro => `venda:${forma}`;

/** Todas as situacoes, na ordem da tela. Nomes padrao iguais aos que o sistema ja' gravava. */
export const EVENTOS_FINANCEIROS: readonly DefinicaoDoEvento[] = [
  ...FORMAS_DO_PLANO.map((forma): DefinicaoDoEvento => ({
    evento: eventoDaVenda(forma),
    tipo: 'receita',
    rotulo: forma === 'Pagamento a Prazo' ? 'Venda a prazo' : forma === 'Outros' ? 'Venda em outras formas' : `Venda em ${forma}`,
    padrao: CATEGORIA_DA_VENDA[forma],
    grupo: 'vendas',
  })),
  { evento: 'os', tipo: 'receita', rotulo: 'Ordem de serviço', padrao: 'Serviços', grupo: 'vendas' },
  { evento: 'juros_recebidos', tipo: 'receita', rotulo: 'Juros e multa recebidos', padrao: 'Juros e multa recebidos', grupo: 'recebimentos' },
  { evento: 'descontos_concedidos', tipo: 'despesa', rotulo: 'Desconto dado na baixa', padrao: 'Descontos concedidos', grupo: 'recebimentos' },
  { evento: 'pago_a_mais', tipo: 'receita', rotulo: 'Boleto pago a mais', padrao: 'Valor pago a mais', grupo: 'recebimentos' },
  { evento: 'tarifa_bancaria', tipo: 'despesa', rotulo: 'Tarifa do banco (boleto)', padrao: 'Tarifas bancárias', grupo: 'recebimentos' },
  { evento: 'juros_pagos', tipo: 'despesa', rotulo: 'Juros e multa pagos', padrao: 'Juros e multa pagos', grupo: 'pagamentos' },
  { evento: 'descontos_obtidos', tipo: 'receita', rotulo: 'Desconto ganho no pagamento', padrao: 'Descontos obtidos', grupo: 'pagamentos' },
  { evento: 'despesas_rota', tipo: 'despesa', rotulo: 'Despesas de rota (romaneio)', padrao: 'Despesas de Rota', grupo: 'pagamentos' },
  { evento: 'compra_mercadoria', tipo: 'despesa', rotulo: 'Compra de mercadoria (nota de entrada, nota avulsa, cheque repassado)', padrao: 'Fornecedores de Peças', grupo: 'compras' },
  { evento: 'frete', tipo: 'despesa', rotulo: 'Frete da nota de entrada', padrao: 'Fretes', grupo: 'compras' },
  { evento: 'devolucao_compra', tipo: 'receita', rotulo: 'Devolução de compra ao fornecedor', padrao: 'Devolução de Compra', grupo: 'compras' },
];

export const ROTULO_DO_GRUPO: Record<DefinicaoDoEvento['grupo'], string> = {
  vendas: 'Vendas e serviços',
  recebimentos: 'Recebimentos',
  pagamentos: 'Pagamentos',
  compras: 'Compras',
};

/** Lancamentos que o sistema faz com nome fixo (abatem a receita no DRE). So' informacao na tela. */
export const CATEGORIAS_FIXAS_DO_SISTEMA: readonly string[] = [
  'Cancelamento de Venda',
  'Cancelamento de OS',
  'Devolução de Venda',
  'Renegociação',
];

/** Nome antigo de toda venda, antes das categorias por forma (o DRE e a baixa continuam reconhecendo). */
export const CATEGORIA_ANTIGA_DE_VENDA = 'Venda de Peças';

const DEFINICAO = new Map(EVENTOS_FINANCEIROS.map((d) => [d.evento, d]));

export type VinculosDoPlano = Partial<Record<EventoFinanceiro, string>>;

const limpar = (valor: unknown): string => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '');
const chave = (nome: string) => nome.toLocaleLowerCase('pt-BR');

export const ehEventoFinanceiro = (valor: unknown): valor is EventoFinanceiro => typeof valor === 'string' && DEFINICAO.has(valor as EventoFinanceiro);

/** Le o que esta' gravado em configuracoes (campo `vinculosPlanoContas`): so' eventos conhecidos com nome. */
export const lerVinculos = (valor: unknown): VinculosDoPlano => {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const lidos: VinculosDoPlano = {};
  for (const [evento, categoria] of Object.entries(valor as Record<string, unknown>)) {
    const nome = limpar(categoria);
    if (ehEventoFinanceiro(evento) && nome) lidos[evento] = nome.slice(0, 60);
  }
  return lidos;
};

/** Evento da venda para uma forma de pagamento; forma desconhecida cai em "Outros". */
export const eventoDaVendaNaForma = (forma: unknown): EventoFinanceiro => {
  const texto = limpar(forma);
  const conhecida = FORMAS_DO_PLANO.find((f) => chave(f) === chave(texto));
  return eventoDaVenda(conhecida || 'Outros');
};

/**
 * A categoria em que o lancamento da situacao cai: o vinculo da empresa, ou o
 * padrao. `config` e' o documento `configuracoes/{filial}` (usa o campo `vinculosPlanoContas`).
 */
export const categoriaDoEvento = (config: unknown, evento: EventoFinanceiro): string => {
  const doc = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const vinculos = lerVinculos(doc.vinculosPlanoContas);
  return vinculos[evento] || DEFINICAO.get(evento)?.padrao || 'Outros';
};

/** Categoria da venda paga em `forma`. */
export const categoriaDaVenda = (config: unknown, forma: unknown): string => categoriaDoEvento(config, eventoDaVendaNaForma(forma));

/** Todas as categorias que valem como "venda" para esta empresa (DRE e baixa), mais o nome antigo. */
export const categoriasDeVenda = (config: unknown): string[] => {
  const nomes = FORMAS_DO_PLANO.map((forma) => categoriaDaVenda(config, forma));
  return [...new Set([CATEGORIA_ANTIGA_DE_VENDA, ...nomes])];
};

export const ehCategoriaDeVenda = (config: unknown, categoria: unknown): boolean => {
  const nome = chave(limpar(categoria));
  return Boolean(nome) && categoriasDeVenda(config).some((c) => chave(c) === nome);
};

/**
 * Baixa de titulo (decisao do dono, 28/11/2026): titulo de VENDA recebido numa
 * forma passa para a categoria da venda nessa forma (venda a prazo paga no Pix
 * vira "Venda no Pix"). Titulo que nao e' de venda (aluguel, servico, juros...)
 * fica com a categoria que tem. Devolve a categoria que o titulo deve ter.
 */
export const categoriaNaBaixa = (config: unknown, categoriaAtual: unknown, formaPaga: unknown): string | null => {
  const atual = limpar(categoriaAtual);
  if (!ehCategoriaDeVenda(config, atual)) return atual || null;
  if (!limpar(formaPaga)) return atual;
  return categoriaDaVenda(config, formaPaga);
};

/**
 * O plano que as telas mostram: o salvo mais as categorias dos vinculos que
 * faltam (cada uma na lista do tipo dela). Empresa que ja' usava o sistema
 * ganha as pre-definidas sem regravar nada; nada do que ela criou some.
 * Vendas das formas que a filial escondeu nao entram (nao vende nelas).
 */
export const planoEfetivo = (config: unknown): { receitas: string[]; despesas: string[] } => {
  const doc = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const lista = (valor: unknown): string[] => {
    const bruto = Array.isArray(valor) ? valor : typeof valor === 'string' ? valor.split('\n') : [];
    const vistos = new Set<string>();
    const saida: string[] = [];
    bruto.forEach((item) => {
      const nome = limpar(item);
      if (nome && !vistos.has(chave(nome))) { vistos.add(chave(nome)); saida.push(nome); }
    });
    return saida;
  };
  const receitas = lista(doc.planoContasReceitas);
  const despesas = lista(doc.planoContasDespesas);
  const ocultas = new Set(lista(doc.formasPagamentoOcultas).map(chave));
  const existe = new Set([...receitas, ...despesas].map(chave));
  EVENTOS_FINANCEIROS.forEach((definicao) => {
    if (definicao.grupo === 'vendas' && definicao.evento.startsWith('venda:') && ocultas.has(chave(definicao.evento.slice(6)))) return;
    const nome = categoriaDoEvento(doc, definicao.evento);
    if (existe.has(chave(nome))) return;
    existe.add(chave(nome));
    (definicao.tipo === 'receita' ? receitas : despesas).push(nome);
  });
  return { receitas, despesas };
};

/**
 * Confere os vinculos que a tela mandou salvar contra o plano que vai ser
 * gravado: receita so' aponta para categoria que nao e' de despesa, e vice-versa.
 */
export const conferirVinculos = (
  valor: unknown,
  plano: { receitas: readonly string[]; despesas: readonly string[] },
): { ok: true; vinculos: VinculosDoPlano } | { ok: false; erro: string } => {
  const vinculos = lerVinculos(valor);
  const receitas = new Set(plano.receitas.map(chave));
  const despesas = new Set(plano.despesas.map(chave));
  for (const [evento, categoria] of Object.entries(vinculos) as Array<[EventoFinanceiro, string]>) {
    const definicao = DEFINICAO.get(evento);
    if (!definicao) continue;
    const errada = definicao.tipo === 'receita' ? despesas.has(chave(categoria)) && !receitas.has(chave(categoria)) : receitas.has(chave(categoria)) && !despesas.has(chave(categoria));
    if (errada) {
      return {
        ok: false,
        erro: `"${definicao.rotulo}" é ${definicao.tipo === 'receita' ? 'uma entrada de dinheiro' : 'uma saída de dinheiro'} e está ligada a "${categoria}", que é uma categoria de ${definicao.tipo === 'receita' ? 'despesa' : 'receita'}. Em Plano de Contas › Lançamentos automáticos, escolha uma categoria de ${definicao.tipo}.`,
      };
    }
  }
  // Grava so' o que difere do padrao (o padrao pode melhorar sem regravar a empresa).
  const soDiferentes: VinculosDoPlano = {};
  (Object.entries(vinculos) as Array<[EventoFinanceiro, string]>).forEach(([evento, categoria]) => {
    if (chave(categoria) !== chave(DEFINICAO.get(evento)?.padrao || '')) soDiferentes[evento] = categoria;
  });
  return { ok: true, vinculos: soDiferentes };
};

/** Categoria que esta' ligada a alguma situacao (nao pode ser excluida do plano sem trocar o vinculo). */
export const situacoesDaCategoria = (config: unknown, categoria: string): string[] => (
  EVENTOS_FINANCEIROS
    .filter((d) => chave(categoriaDoEvento(config, d.evento)) === chave(categoria))
    .map((d) => d.rotulo)
);
