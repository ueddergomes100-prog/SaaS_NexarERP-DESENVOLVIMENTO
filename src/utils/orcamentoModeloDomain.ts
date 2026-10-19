import { toCents } from './financeDomain';
import { getServiceHours, getServiceTotal } from './osServicePricing';

/*
 * MODELO DO ORCAMENTO POR FILIAL (pedido do dono, 16/10/2026).
 *
 * O orcamento nasceu para oficina: pede veiculo, servico e converte em OS.
 * Loja de roupa, acessorio ou eletronico nao tem nada disso -- e precisa de
 * vendedor, condicao de pagamento, prazo de entrega e frete. Decisoes do
 * dono (caixa de perguntas):
 *
 * - "Modelo pronto + caixas": escolhe Oficina, Prestacao de servicos ou
 *   Comercio e o sistema marca as caixas; depois da' para ajustar cada uma.
 * - Por filial (Configuracoes da filial), como a de maquinas pesadas.
 * - No PDF, servico sai em horas x valor/hora numa tabela propria (o
 *   cliente lia "3 trocas de retentores" quando era uma troca de 3 horas).
 * - Comercio ganha vendedor, condicao de pagamento, prazo de entrega e frete.
 *
 * Sem configuracao gravada = modelo Oficina = o orcamento de sempre.
 * Esconder uma caixa nunca apaga dado: orcamento antigo que ja tem veiculo,
 * servico ou frete continua mostrando o que tem (design so' visual).
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface ConfigOrcamento {
  /** Bloco "Dados do Veiculo/Equipamento" (placa, modelo, ano, cor). */
  mostrarVeiculo: boolean;
  /** Lancar servico (mao de obra) no orcamento. */
  usaServicos: boolean;
  /** Botao "Converter para OS". */
  converterEmOS: boolean;
  vendedor: boolean;
  condicaoPagamento: boolean;
  prazoEntrega: boolean;
  frete: boolean;
}

export type ModeloOrcamento = 'oficina' | 'servicos' | 'comercio';

export const MODELOS_ORCAMENTO: Record<ModeloOrcamento, { rotulo: string; descricao: string; config: ConfigOrcamento }> = {
  oficina: {
    rotulo: 'Oficina (veículos ou máquinas)',
    descricao: 'Dados do veículo/equipamento, serviços e "Converter para OS" — o orçamento de sempre.',
    config: { mostrarVeiculo: true, usaServicos: true, converterEmOS: true, vendedor: false, condicaoPagamento: false, prazoEntrega: false, frete: false },
  },
  servicos: {
    rotulo: 'Prestação de serviços (sem veículo)',
    descricao: 'Serviços e produtos, com OS, mas sem dados de veículo (assistência técnica, instalação, manutenção...).',
    config: { mostrarVeiculo: false, usaServicos: true, converterEmOS: true, vendedor: true, condicaoPagamento: true, prazoEntrega: true, frete: false },
  },
  comercio: {
    rotulo: 'Comércio (loja)',
    descricao: 'Só produtos, sem veículo, serviço nem OS; com vendedor, condição de pagamento, prazo de entrega e frete.',
    config: { mostrarVeiculo: false, usaServicos: false, converterEmOS: false, vendedor: true, condicaoPagamento: true, prazoEntrega: true, frete: true },
  },
};

export const CONFIG_ORCAMENTO_PADRAO: ConfigOrcamento = MODELOS_ORCAMENTO.oficina.config;

const CHAVES: Array<keyof ConfigOrcamento> = ['mostrarVeiculo', 'usaServicos', 'converterEmOS', 'vendedor', 'condicaoPagamento', 'prazoEntrega', 'frete'];

/** As caixas, na ordem da tela de Configuracoes. */
export const CAIXAS_DO_ORCAMENTO: Array<{ chave: keyof ConfigOrcamento; rotulo: string; descricao: string }> = [
  { chave: 'mostrarVeiculo', rotulo: 'Dados do veículo/equipamento', descricao: 'Placa, modelo, ano e cor (frota/série nas máquinas pesadas), na tela e no PDF.' },
  { chave: 'usaServicos', rotulo: 'Serviços (mão de obra)', descricao: 'Lançar serviço no orçamento; no PDF sai em horas × valor/hora.' },
  { chave: 'converterEmOS', rotulo: 'Botão "Converter para OS"', descricao: 'Transforma o orçamento aprovado em Ordem de Serviço.' },
  { chave: 'vendedor', rotulo: 'Vendedor responsável', descricao: 'Quem fez o orçamento; vai junto para o Pedido de Venda.' },
  { chave: 'condicaoPagamento', rotulo: 'Condição de pagamento', descricao: 'Forma e parcelas previstas (ex.: 3x sem juros), impressas para o cliente.' },
  { chave: 'prazoEntrega', rotulo: 'Prazo de entrega', descricao: 'Em quantos dias a mercadoria fica pronta/entregue.' },
  { chave: 'frete', rotulo: 'Frete', descricao: 'Somado ao total; vai junto para o Pedido de Venda.' },
];

/** Leitura defensiva de `configuracoes/{filial}.configOrcamento`. So' `true`/`false` contam; o resto vale o padrao. */
export const parseConfigOrcamento = (raw: unknown): ConfigOrcamento => {
  const dado = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const config = { ...CONFIG_ORCAMENTO_PADRAO };
  CHAVES.forEach((chave) => {
    if (typeof dado[chave] === 'boolean') config[chave] = dado[chave] as boolean;
  });
  return config;
};

/** Qual modelo as caixas formam; 'personalizado' quando nenhum bate. */
export const modeloDaConfig = (config: ConfigOrcamento): ModeloOrcamento | 'personalizado' => {
  const achado = (Object.keys(MODELOS_ORCAMENTO) as ModeloOrcamento[])
    .find((modelo) => CHAVES.every((chave) => MODELOS_ORCAMENTO[modelo].config[chave] === config[chave]));
  return achado || 'personalizado';
};

/** Aviso da tela de Configuracoes quando a combinacao nao fecha. */
export const avisoDaConfigOrcamento = (config: ConfigOrcamento): string | null => {
  if (config.usaServicos && !config.converterEmOS) {
    return 'Serviço não entra em Pedido de Venda: sem "Converter para OS", os serviços do orçamento não têm como ser cobrados.';
  }
  if (config.converterEmOS && !config.usaServicos) {
    return 'A OS gerada vai só com os produtos. Se a loja não faz serviço, desmarque "Converter para OS".';
  }
  return null;
};

// ---------------------------------------------------------------------------
// TELA DO ORCAMENTO
// ---------------------------------------------------------------------------

export interface DadosVeiculoDoOrcamento {
  placa?: string;
  modelo?: string;
  ano?: string;
  cor?: string;
}

/** Orcamento que ja' tem veiculo continua mostrando, mesmo com a caixa desligada. */
export const temDadosDeVeiculo = (d: DadosVeiculoDoOrcamento): boolean => [d.placa, d.modelo, d.ano, d.cor].some((v) => String(v ?? '').trim() !== '');

export const mostraVeiculo = (config: ConfigOrcamento, d: DadosVeiculoDoOrcamento): boolean => config.mostrarVeiculo || temDadosDeVeiculo(d);

/** Valor digitado ("12,50", "12.5", "") -> reais (0 quando vazio ou invalido). Negativo vira 0. */
export const reaisDoCampo = (texto: unknown): number => {
  const bruto = String(texto ?? '').trim();
  // "1.234,56" (milhar com ponto) ou "12.5" (decimal com ponto).
  const n = Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

/** Total do orcamento em centavos: itens - desconto (nunca negativo) + frete. */
export const totalDoOrcamentoCentavos = (subtotalCentavos: number, descontoCentavos: number, freteCentavos: number): number => (
  Math.max(0, subtotalCentavos - descontoCentavos) + Math.max(0, freteCentavos)
);

/** "Pronta entrega" (0), "1 dia", "5 dias"; vazio quando nao informado. */
export const textoPrazoEntrega = (dias: unknown): string => {
  const texto = String(dias ?? '').trim();
  if (texto === '') return '';
  const n = Math.floor(Number(texto));
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'Pronta entrega';
  return `${n} ${n === 1 ? 'dia' : 'dias'}`;
};

/** "Cartão de Crédito — 3x sem juros", "30/60/90", ou vazio. */
export const textoCondicaoPagamento = (condicao: { forma?: string; detalhe?: string } | null | undefined): string => (
  [String(condicao?.forma ?? '').trim(), String(condicao?.detalhe ?? '').trim()].filter(Boolean).join(' — ')
);

export interface ValoresExtrasDoOrcamento {
  vendedorId: string;
  vendedorNome: string;
  condicaoForma: string;
  condicaoDetalhe: string;
  prazoEntregaDias: string;
  /** Texto do campo, em reais. */
  frete: string;
}

/**
 * O que o orcamento grava dos campos de comercio. Caixa ligada OU valor ja'
 * preenchido entram (desligar a caixa depois nao apaga o que foi gravado);
 * nada sai `undefined` (regra 3 do CLAUDE.md).
 */
export const camposExtrasParaGravar = (config: ConfigOrcamento, v: ValoresExtrasDoOrcamento): Record<string, unknown> => {
  const campos: Record<string, unknown> = {};
  if (config.vendedor || v.vendedorId) {
    campos.vendedorId = v.vendedorId || '';
    campos.vendedorNome = v.vendedorId ? v.vendedorNome || '' : '';
  }
  if (config.condicaoPagamento || v.condicaoForma || v.condicaoDetalhe.trim()) {
    campos.condicaoPagamento = { forma: v.condicaoForma || '', detalhe: v.condicaoDetalhe.trim() };
  }
  if (config.prazoEntrega || v.prazoEntregaDias.trim()) {
    campos.prazoEntregaDias = textoPrazoEntrega(v.prazoEntregaDias) ? String(Math.floor(Number(v.prazoEntregaDias))) : '';
  }
  const frete = reaisDoCampo(v.frete);
  if (config.frete || frete > 0) campos.frete = frete;
  return campos;
};

// ---------------------------------------------------------------------------
// PDF DO ORCAMENTO
// ---------------------------------------------------------------------------

export interface LinhaServicoPdf {
  nome: string;
  horas: number;
  valorHora: number;
  total: number;
}

export interface LinhaProdutoPdf {
  nome: string;
  quantidade: number;
  unidade: string;
  unitario: number;
  total: number;
}

interface ItemGravado {
  nome?: string;
  preco?: number;
  quantidade?: number;
  tempoHoras?: number | string | null;
  unidadeMedidaSigla?: string;
}

/** Servico: a quantidade do orcamento SAO as horas (catalogo em valor/hora) -- mesma regra da OS. */
export const linhasDoPdfDoOrcamento = (orcamento: { servicos?: ItemGravado[]; pecas?: ItemGravado[] }): { servicos: LinhaServicoPdf[]; produtos: LinhaProdutoPdf[] } => ({
  servicos: (Array.isArray(orcamento.servicos) ? orcamento.servicos : []).map((s) => ({
    nome: String(s.nome || ''),
    horas: getServiceHours(s),
    valorHora: Number(s.preco || 0),
    total: getServiceTotal(s),
  })),
  produtos: (Array.isArray(orcamento.pecas) ? orcamento.pecas : []).map((p) => {
    const quantidade = Number(p.quantidade || 0) || 0;
    const unitario = Number(p.preco || 0);
    return { nome: String(p.nome || ''), quantidade, unidade: String(p.unidadeMedidaSigla || 'UN'), unitario, total: unitario * quantidade };
  }),
});

/** "3 h", "1,5 h", "0,25 h". */
export const textoHoras = (horas: number): string => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(horas) || 0)} h`;

export interface TotaisDoPdf {
  servicos: number;
  produtos: number;
  desconto: number;
  frete: number;
  total: number;
}

/** Quadro de totais do PDF (reais). O total e' o gravado; se faltar, recalcula. */
export const totaisDoPdfDoOrcamento = (
  linhas: { servicos: LinhaServicoPdf[]; produtos: LinhaProdutoPdf[] },
  orcamento: { valorTotal?: number; frete?: number; desconto?: { valorAplicadoCentavos?: number } | null },
): TotaisDoPdf => {
  const servicos = linhas.servicos.reduce((s, l) => s + l.total, 0);
  const produtos = linhas.produtos.reduce((s, l) => s + l.total, 0);
  const desconto = Math.max(0, Number(orcamento.desconto?.valorAplicadoCentavos || 0)) / 100;
  const frete = Math.max(0, Number(orcamento.frete || 0));
  const calculado = totalDoOrcamentoCentavos(toCents(servicos + produtos), toCents(desconto), toCents(frete)) / 100;
  const gravado = Number(orcamento.valorTotal);
  return { servicos, produtos, desconto, frete, total: Number.isFinite(gravado) && gravado > 0 ? gravado : calculado };
};

// ---------------------------------------------------------------------------
// ORCAMENTO -> PEDIDO DE VENDA
// ---------------------------------------------------------------------------

/**
 * Peca gravada pelo app Vendas ate' 19/10/2026: tinha so' `precoUnitario` (o
 * formato do pedido), e o orcamento le `preco` -- abria e convertia com preco
 * zero. O app passou a gravar `preco`; aqui o formato antigo e' lido certo.
 */
export const pecaComPreco = <T>(peca: T): T => {
  const p = peca as unknown as Record<string, unknown>;
  return p && p.preco === undefined && typeof p.precoUnitario === 'number' ? { ...peca, preco: p.precoUnitario } : peca;
};

/**
 * Linhas gravadas do orcamento, com o tipo. O OrcamentoForm grava `servicos`
 * e `pecas`; o "Converter para Venda" de 13/10 lia `itens` (que o orcamento
 * nunca gravou) e abria o pedido vazio. `itens` fica como reserva.
 */
export const linhasDoOrcamentoGravado = <T extends { tipo?: string }>(orcamento: { itens?: unknown; pecas?: unknown; servicos?: unknown }): T[] => {
  const lista = (valor: unknown): T[] => (Array.isArray(valor) ? valor as T[] : []);
  const pecas = lista(orcamento.pecas).map((p) => ({ ...pecaComPreco(p), tipo: 'peca' }));
  const servicos = lista(orcamento.servicos).map((s) => ({ ...s, tipo: 'servico' }));
  if (pecas.length > 0 || servicos.length > 0) return [...pecas, ...servicos];
  return lista(orcamento.itens);
};
