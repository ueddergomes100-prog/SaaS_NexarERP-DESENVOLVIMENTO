import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { serieDaChaveDeAcesso } from './sintegraDomain';
import { cfopEntradaSugerido } from './cfopDomain';

/*
 * RELATORIO DO CONTADOR (pedido do dono, 20/10/2026).
 *
 * Junta, num periodo, as notas que a empresa EMITIU (`notas_fiscais`: NF-e,
 * NFC-e, NFS-e, devolucao, transferencia) e as que RECEBEU por XML
 * (`notas_fiscais_entrada`), e deixa o contador filtrar por movimento
 * (entrada/saida), modelo, operacao, situacao, CFOP, UF e carta de correcao.
 * Sai em PDF e Excel pelo RelatorioPreview: resumo por CFOP, resumo por
 * operacao, a lista das notas e as cartas de correcao.
 *
 * Regras que importam para o contador:
 *  - Valores somam so' nota AUTORIZADA (cancelada, rejeitada e em
 *    processamento aparecem na lista, com a situacao, mas nao somam).
 *  - Nota emitida e' de ENTRADA quando os CFOPs dela sao de entrada (1/2/3):
 *    e' a NF-e de devolucao de venda que a loja emite.
 *  - Na nota recebida o XML traz o CFOP do FORNECEDOR (5.xxx/6.xxx/7.xxx):
 *    o relatorio converte para o CFOP de entrada (1.xxx/2.xxx/3.xxx), que e'
 *    o que vai na escrituracao, e mostra o original na lista.
 *
 * Puro (sem Firestore): a tela le as notas e passa para ca.
 */

export type MovimentoFiscal = 'saida' | 'entrada';
export type ModeloFiscal = 'NF-e' | 'NFC-e' | 'NFS-e';
export type SituacaoFiscal = 'autorizada' | 'cancelada' | 'rejeitada' | 'processando';
export type OperacaoFiscal =
  | 'venda'
  | 'servico'
  | 'devolucao_venda_propria'
  | 'transferencia_saida'
  | 'compra'
  | 'devolucao_venda_cliente'
  | 'transferencia_entrada';
export type OrigemFiscal = 'emitida' | 'recebida';

export const ROTULO_MOVIMENTO: Record<MovimentoFiscal, string> = { saida: 'Saída', entrada: 'Entrada' };
export const ROTULO_SITUACAO: Record<SituacaoFiscal, string> = {
  autorizada: 'Autorizada',
  cancelada: 'Cancelada',
  rejeitada: 'Rejeitada/denegada',
  processando: 'Em processamento',
};
export const ROTULO_OPERACAO: Record<OperacaoFiscal, string> = {
  venda: 'Venda',
  servico: 'Serviço (NFS-e)',
  devolucao_venda_propria: 'Devolução de venda (nota da empresa)',
  transferencia_saida: 'Transferência entre filiais (saída)',
  compra: 'Compra / entrada de mercadoria',
  devolucao_venda_cliente: 'Devolução de venda (nota do cliente)',
  transferencia_entrada: 'Transferência entre filiais (entrada)',
};
export const ROTULO_ORIGEM: Record<OrigemFiscal, string> = { emitida: 'Emitida pela empresa', recebida: 'Recebida (XML)' };

export const MODELOS_FISCAIS: ModeloFiscal[] = ['NF-e', 'NFC-e', 'NFS-e'];
export const SITUACOES_FISCAIS: SituacaoFiscal[] = ['autorizada', 'cancelada', 'rejeitada', 'processando'];
export const OPERACOES_FISCAIS: OperacaoFiscal[] = [
  'venda', 'servico', 'devolucao_venda_propria', 'transferencia_saida', 'compra', 'devolucao_venda_cliente', 'transferencia_entrada',
];

const numero = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const centavos = (reais: unknown): number => Math.round(numero(reais) * 100);
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const soDigitos = (v: unknown): string => texto(v).replace(/\D/g, '');

/** CFOP so' com digitos ("5.102" -> "5102"); vazio quando nao tem 4 digitos. */
export const normalizarCfop = (v: unknown): string => {
  const d = soDigitos(v);
  return d.length === 4 ? d : '';
};

/** "5102" -> "5.102" (como o contador escreve). */
export const formatarCfop = (cfop: string): string => (cfop.length === 4 ? `${cfop[0]}.${cfop.slice(1)}` : cfop || 'Sem CFOP');

/**
 * CFOP de saida do fornecedor -> CFOP de entrada da empresa, pela tabela de
 * CFOP do sistema (cfopDomain: venda com ST 5.405 -> 1.403, nao 1.405). Sem
 * equivalente na tabela, troca so' o primeiro digito (5->1, 6->2, 7->3), como
 * referencia. Ja' de entrada: igual.
 */
export const cfopDeEntradaDoFornecedor = (cfopFornecedor: unknown): string => {
  const c = normalizarCfop(cfopFornecedor);
  if (!c) return '';
  const pelaTabela = cfopEntradaSugerido(c);
  if (pelaTabela) return pelaTabela;
  const mapa: Record<string, string> = { 5: '1', 6: '2', 7: '3' };
  return mapa[c[0]] ? `${mapa[c[0]]}${c.slice(1)}` : c;
};

/** CFOP de entrada do item: o escolhido na entrada (cfopEntrada), senao o equivalente ao do fornecedor. */
const cfopEntradaDoItem = (cfopGravado: unknown, cfopFornecedor: unknown): string => (
  normalizarCfop(cfopGravado) || cfopDeEntradaDoFornecedor(cfopFornecedor)
);

const ehCfopDeEntrada = (cfop: string): boolean => ['1', '2', '3'].includes(cfop[0] ?? '');
/** x.201, x.202, x.410, x.411: devolucao de venda. */
const ehCfopDeDevolucaoDeVenda = (cfop: string): boolean => ['201', '202', '410', '411'].includes(cfop.slice(1));

/**
 * Instante (ms) que vale como emissao da nota da empresa: o da ULTIMA
 * transmissao a' SEFAZ (campo `data`, regravado a cada envio). A nota rejeitada
 * corrigida e reenviada dias depois mantem o `createdAt` antigo, mas sai com a
 * data do reenvio: e' nesse mes que o contador escritura. Sem `data`, o createdAt.
 */
export const instanteDaEmissao = (data: unknown, createdAtMs: number | null): number | null => {
  const ms = typeof data === 'string' && data ? Date.parse(data) : NaN;
  if (Number.isFinite(ms)) return ms;
  return createdAtMs !== null && Number.isFinite(createdAtMs) ? createdAtMs : null;
};

/**
 * Quantos dias antes do periodo a tela busca notas criadas (pelo createdAt),
 * para achar a rejeitada que foi reenviada e autorizada dentro do periodo.
 */
export const DIAS_ANTES_PARA_REENVIO = 62;

export const situacaoDaNotaEmitida = (status: unknown): SituacaoFiscal => {
  const s = texto(status).toLowerCase();
  if (s === 'authorized') return 'autorizada';
  if (s === 'canceled' || s === 'cancelada') return 'cancelada';
  if (s === 'rejected' || s === 'denied' || s === 'error') return 'rejeitada';
  return 'processando';
};

// ---------------------------------------------------------------------------
// Linha normalizada (uma por nota)
// ---------------------------------------------------------------------------

export interface ValoresFiscais {
  /** Tudo em centavos. `valor` = valor contabil (o que soma no total da nota:
   *  produto + frete + seguro + outras despesas + IPI + ICMS-ST - desconto). */
  valor: number;
  baseIcms: number;
  icms: number;
  baseSt: number;
  st: number;
  ipi: number;
  pis: number;
  cofins: number;
}

const CAMPOS_VALORES: Array<keyof ValoresFiscais> = ['valor', 'baseIcms', 'icms', 'baseSt', 'st', 'ipi', 'pis', 'cofins'];

export const valoresZerados = (): ValoresFiscais => ({ valor: 0, baseIcms: 0, icms: 0, baseSt: 0, st: 0, ipi: 0, pis: 0, cofins: 0 });

/** Soma `v` em `alvo` (muta e devolve `alvo`). */
const acumular = <T extends ValoresFiscais>(alvo: T, v: ValoresFiscais): T => {
  for (const campo of CAMPOS_VALORES) alvo[campo] += v[campo];
  return alvo;
};

export interface GrupoCfop extends ValoresFiscais {
  cfop: string;
}

export interface CartaDeCorrecaoDaNota {
  data: string;
  sequencia: number;
  texto: string;
}

export interface LinhaContador extends ValoresFiscais {
  id: string;
  movimento: MovimentoFiscal;
  origem: OrigemFiscal;
  modelo: ModeloFiscal;
  /** AAAA-MM-DD. */
  data: string;
  numero: string;
  serie: string;
  chave: string;
  situacao: SituacaoFiscal;
  operacao: OperacaoFiscal;
  participante: string;
  documento: string;
  uf: string;
  /** CFOPs da escrituracao (entrada ja' convertida). */
  cfops: string[];
  /** So' na nota recebida: os CFOPs que vieram no XML. */
  cfopsDoXml: string[];
  porCfop: GrupoCfop[];
  cartas: CartaDeCorrecaoDaNota[];
  naturezaOperacao: string;
}

const somarGrupos = (grupos: Map<string, GrupoCfop>, cfop: string, v: ValoresFiscais): void => {
  grupos.set(cfop, acumular(grupos.get(cfop) ?? { cfop, ...valoresZerados() }, v));
};

const totaisDosGrupos = (grupos: GrupoCfop[]): ValoresFiscais => grupos.reduce((t, g) => acumular(t, g), valoresZerados());

/**
 * Faz o valor contabil dos CFOPs fechar com o total da nota (vNF), em centavos
 * exatos. A diferenca (frete/seguro/despesas/desconto que a nota antiga nao
 * guardou por item, FCP-ST, imposto de importacao, arredondamento) e' dividida
 * na proporcao do valor de cada CFOP; o resto de centavos vai para os maiores.
 * Sem total da nota, ou sem valor nos CFOPs, fica como esta'.
 */
export const fecharValorComONota = (grupos: GrupoCfop[], totalDaNota: number): GrupoCfop[] => {
  const soma = grupos.reduce((s, g) => s + g.valor, 0);
  const diferenca = totalDaNota - soma;
  if (!(totalDaNota > 0) || diferenca === 0 || grupos.length === 0) return grupos;
  if (soma <= 0) {
    // Sem base para dividir: tudo no primeiro CFOP (nota de um CFOP so', o caso comum).
    return grupos.map((g, i) => (i === 0 ? { ...g, valor: g.valor + diferenca } : g));
  }
  const partes = grupos.map((g) => (diferenca * g.valor) / soma);
  const inteiras = partes.map((p) => Math.trunc(p));
  let resto = diferenca - inteiras.reduce((s, p) => s + p, 0);
  const ordem = partes
    .map((p, i) => ({ i, fracao: Math.abs(p - Math.trunc(p)) }))
    .sort((a, b) => b.fracao - a.fracao || a.i - b.i);
  const passo = Math.sign(resto);
  for (let k = 0; resto !== 0 && k < ordem.length * 2; k += 1) {
    inteiras[ordem[k % ordem.length].i] += passo;
    resto -= passo;
  }
  return grupos.map((g, i) => ({ ...g, valor: g.valor + inteiras[i] }));
};

/** Nota emitida pela empresa (`notas_fiscais`), com os dados do cliente ja' lidos. */
export interface NotaEmitidaParaContador {
  id: string;
  tipo?: unknown;
  status?: unknown;
  number?: unknown;
  accessKey?: unknown;
  /** AAAA-MM-DD do dia da emissao (fuso da loja). */
  data: string;
  clienteNome?: unknown;
  valor?: unknown;
  finalidade?: unknown;
  itensFiscais?: unknown;
  cartasCorrecao?: unknown;
  /** Do cadastro do cliente (a nota nao guarda). */
  documentoDoCliente?: string;
  ufDoCliente?: string;
}

const modeloDaNota = (tipo: unknown): ModeloFiscal => {
  const t = texto(tipo);
  return t === 'NF-e' || t === 'NFC-e' ? t : 'NFS-e';
};

const cartasDaNota = (valor: unknown): CartaDeCorrecaoDaNota[] => (Array.isArray(valor) ? valor : [])
  .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
  .map((c) => ({ data: texto(c.enviadaEm).slice(0, 10), texto: texto(c.texto), sequencia: 0 }))
  .sort((a, b) => a.data.localeCompare(b.data))
  .map((c, i) => ({ ...c, sequencia: i + 1 }));

export const linhaDaNotaEmitida = (nota: NotaEmitidaParaContador): LinhaContador => {
  const modelo = modeloDaNota(nota.tipo);
  const grupos = new Map<string, GrupoCfop>();
  const itens = Array.isArray(nota.itensFiscais) ? nota.itensFiscais as Array<Record<string, unknown>> : [];
  for (const item of itens) {
    if (!item || typeof item !== 'object') continue;
    const cfop = normalizarCfop(item.cfop);
    const taxes = (item.taxes && typeof item.taxes === 'object' ? item.taxes : {}) as Record<string, Record<string, unknown> | undefined>;
    // O sistema emite sem frete/seguro/despesas, sem ICMS-ST destacado (so' o
    // retido anteriormente, que nao soma no total) e com IPI de aliquota zero
    // (notaFiscalItemDomain.ts). O total do item na nota e' vProd - vDesc + IPI.
    const ipi = centavos(taxes.ipi?.amount);
    somarGrupos(grupos, cfop, {
      valor: centavos(item.totalAmount) - centavos(item.discountAmount) + ipi,
      baseIcms: centavos(taxes.icms?.baseTax),
      icms: centavos(taxes.icms?.amount),
      baseSt: 0,
      st: 0,
      ipi,
      pis: centavos(taxes.pis?.amount),
      cofins: centavos(taxes.cofins?.amount),
    });
  }
  const porCfop = [...grupos.values()].sort((a, b) => a.cfop.localeCompare(b.cfop));
  const totais = totaisDosGrupos(porCfop);
  const cfops = porCfop.map((g) => g.cfop).filter(Boolean);
  // Valor da nota: a soma dos itens transmitidos (a Spedy fecha o total da nota
  // por eles, makeupTotal). Sem itens (NFS-e antiga), o valor gravado.
  const valorGravado = centavos(nota.valor);
  const finalidade = texto(nota.finalidade);
  const entrada = cfops.length > 0 && cfops.every(ehCfopDeEntrada);
  const operacao: OperacaoFiscal = modelo === 'NFS-e' ? 'servico'
    : finalidade === 'transferencia' ? 'transferencia_saida'
      : finalidade === 'devolucao' || entrada ? 'devolucao_venda_propria'
        : 'venda';
  const chave = soDigitos(nota.accessKey);
  return {
    id: nota.id,
    movimento: entrada ? 'entrada' : 'saida',
    origem: 'emitida',
    modelo,
    data: nota.data,
    // Rejeitada/na fila ainda nao tem numero (a Spedy grava 0 ou null): fica em branco.
    numero: numero(nota.number) > 0 ? String(Math.trunc(numero(nota.number))) : '',
    serie: serieDaChaveDeAcesso(chave) ?? '',
    chave,
    situacao: situacaoDaNotaEmitida(nota.status),
    operacao,
    participante: texto(nota.clienteNome) || 'Consumidor final',
    documento: soDigitos(nota.documentoDoCliente),
    uf: texto(nota.ufDoCliente).toUpperCase(),
    cfops,
    cfopsDoXml: [],
    porCfop,
    cartas: cartasDaNota(nota.cartasCorrecao),
    naturezaOperacao: '',
    ...totais,
    valor: porCfop.length > 0 && totais.valor > 0 ? totais.valor : valorGravado,
  };
};

/** Nota recebida (`notas_fiscais_entrada`), com a UF do fornecedor ja' lida. */
export interface NotaRecebidaParaContador {
  id: string;
  numeroNF?: unknown;
  serie?: unknown;
  modelo?: unknown;
  chaveAcesso?: unknown;
  naturezaOperacao?: unknown;
  dataEmissao?: unknown;
  fornecedorNome?: unknown;
  fornecedorCnpj?: unknown;
  valorTotal?: unknown;
  totais?: unknown;
  itens?: unknown;
  transferenciaId?: unknown;
  ufDoFornecedor?: string;
  /** Itens do XML guardado na entrada (`xmlGzipBase64`, lido por parseNfeXml):
   *  trazem frete, seguro, despesas e desconto de cada item. Sem XML, valem os
   *  itens gravados na entrada (sem esses quatro por item). */
  itensDoXml?: readonly ItemDoXmlParaContador[];
}

/** O que o relatorio usa de cada item do XML (subconjunto de ItemDaNota do nfeXmlDomain). */
export interface ItemDoXmlParaContador {
  cfop: string;
  valorProduto: number;
  frete: number;
  seguro: number;
  desconto: number;
  outrasDespesas: number;
  icms: { base: number; valor: number; baseSt: number; valorSt: number };
  ipi: { valor: number };
  pis: { valor: number };
  cofins: { valor: number };
}

const valoresDoItemDoXml = (item: ItemDoXmlParaContador): ValoresFiscais => {
  const ipi = centavos(item.ipi?.valor);
  const st = centavos(item.icms?.valorSt);
  return {
    valor: centavos(item.valorProduto) + centavos(item.frete) + centavos(item.seguro) + centavos(item.outrasDespesas)
      - centavos(item.desconto) + ipi + st,
    baseIcms: centavos(item.icms?.base),
    icms: centavos(item.icms?.valor),
    baseSt: centavos(item.icms?.baseSt),
    st,
    ipi,
    pis: centavos(item.pis?.valor),
    cofins: centavos(item.cofins?.valor),
  };
};

const valoresDoItemGravado = (item: Record<string, unknown>): ValoresFiscais => {
  const impostos = (item.impostos && typeof item.impostos === 'object' ? item.impostos : {}) as Record<string, Record<string, unknown> | undefined>;
  const ipi = centavos(impostos.ipi?.valor);
  const st = centavos(impostos.icms?.valorSt);
  return {
    // Frete/seguro/despesas/desconto do item nao foram gravados: entram depois,
    // no fechamento com o total da nota (fecharValorComONota).
    valor: Math.round(numero(item.quantidade) * numero(item.valorUnitario) * 100) + ipi + st,
    baseIcms: centavos(impostos.icms?.base),
    icms: centavos(impostos.icms?.valor),
    baseSt: centavos(impostos.icms?.baseSt),
    st,
    ipi,
    pis: centavos(impostos.pis?.valor),
    cofins: centavos(impostos.cofins?.valor),
  };
};

export const linhaDaNotaRecebida = (nota: NotaRecebidaParaContador): LinhaContador => {
  const grupos = new Map<string, GrupoCfop>();
  const doXml = new Set<string>();
  const itensXml = Array.isArray(nota.itensDoXml) && nota.itensDoXml.length > 0 ? nota.itensDoXml : null;
  const itensGravados = (Array.isArray(nota.itens) ? nota.itens as Array<Record<string, unknown>> : [])
    .filter((item) => item && typeof item === 'object');
  if (itensXml) {
    // O CFOP de entrada escolhido fica no item gravado (mesma ordem do XML).
    const mesmaOrdem = itensGravados.length === itensXml.length;
    itensXml.forEach((item, i) => {
      const original = normalizarCfop(item.cfop);
      if (original) doXml.add(original);
      somarGrupos(grupos, cfopEntradaDoItem(mesmaOrdem ? itensGravados[i].cfopEntrada : '', original), valoresDoItemDoXml(item));
    });
  } else {
    for (const item of itensGravados) {
      const original = normalizarCfop(item.cfop);
      if (original) doXml.add(original);
      somarGrupos(grupos, cfopEntradaDoItem(item.cfopEntrada, original), valoresDoItemGravado(item));
    }
  }
  const totaisXml = (nota.totais && typeof nota.totais === 'object' ? nota.totais : null) as Record<string, unknown> | null;
  const totalDaNota = totaisXml && numero(totaisXml.total) > 0 ? centavos(totaisXml.total) : centavos(nota.valorTotal);
  const porCfop = fecharValorComONota([...grupos.values()].sort((a, b) => a.cfop.localeCompare(b.cfop)), totalDaNota);
  const cfops = porCfop.map((g) => g.cfop).filter(Boolean);
  const somaItens = totaisDosGrupos(porCfop);
  const operacao: OperacaoFiscal = texto(nota.transferenciaId) ? 'transferencia_entrada'
    : cfops.length > 0 && cfops.every(ehCfopDeDevolucaoDeVenda) ? 'devolucao_venda_cliente'
      : 'compra';
  const chave = soDigitos(nota.chaveAcesso);
  return {
    id: nota.id,
    movimento: 'entrada',
    origem: 'recebida',
    modelo: texto(nota.modelo) === '65' ? 'NFC-e' : 'NF-e',
    data: texto(nota.dataEmissao).slice(0, 10),
    numero: texto(nota.numeroNF),
    serie: texto(nota.serie) || serieDaChaveDeAcesso(chave) || '',
    chave,
    situacao: 'autorizada',
    operacao,
    participante: texto(nota.fornecedorNome),
    documento: soDigitos(nota.fornecedorCnpj),
    uf: texto(nota.ufDoFornecedor).toUpperCase(),
    cfops,
    cfopsDoXml: [...doXml].sort(),
    porCfop,
    cartas: [],
    naturezaOperacao: texto(nota.naturezaOperacao),
    // Totais da nota: os do XML quando vieram (valor oficial), senao a soma dos itens.
    valor: totalDaNota || somaItens.valor,
    baseIcms: totaisXml ? centavos(totaisXml.baseIcms) : somaItens.baseIcms,
    icms: totaisXml ? centavos(totaisXml.icms) : somaItens.icms,
    baseSt: totaisXml ? centavos(totaisXml.baseSt) : somaItens.baseSt,
    st: totaisXml ? centavos(totaisXml.st) : somaItens.st,
    ipi: totaisXml ? centavos(totaisXml.ipi) : somaItens.ipi,
    pis: totaisXml ? centavos(totaisXml.pis) : somaItens.pis,
    cofins: totaisXml ? centavos(totaisXml.cofins) : somaItens.cofins,
  };
};

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export interface FiltrosContador {
  movimentos: MovimentoFiscal[];
  modelos: ModeloFiscal[];
  situacoes: SituacaoFiscal[];
  operacoes: OperacaoFiscal[];
  /** Vazio = todos. */
  cfops: string[];
  /** Vazio = todas. */
  uf: string;
  soComCartaDeCorrecao: boolean;
  busca: string;
}

export const FILTROS_PADRAO_CONTADOR: FiltrosContador = {
  movimentos: ['saida', 'entrada'],
  modelos: ['NF-e', 'NFC-e', 'NFS-e'],
  situacoes: ['autorizada', 'cancelada'],
  operacoes: [...OPERACOES_FISCAIS],
  cfops: [],
  uf: '',
  soComCartaDeCorrecao: false,
  busca: '',
};

export const aplicarFiltrosContador = (linhas: readonly LinhaContador[], f: FiltrosContador): LinhaContador[] => {
  const busca = f.busca.trim().toLowerCase();
  const buscaDigitos = busca.replace(/\D/g, '');
  const cfops = new Set(f.cfops.map(normalizarCfop).filter(Boolean));
  return linhas.filter((l) => (
    f.movimentos.includes(l.movimento)
    && f.modelos.includes(l.modelo)
    && f.situacoes.includes(l.situacao)
    && f.operacoes.includes(l.operacao)
    && (cfops.size === 0 || l.cfops.some((c) => cfops.has(c)))
    && (!f.uf || l.uf === f.uf)
    && (!f.soComCartaDeCorrecao || l.cartas.length > 0)
    && (!busca
      || l.participante.toLowerCase().includes(busca)
      || l.numero === busca
      || (buscaDigitos.length >= 4 && (l.chave.includes(buscaDigitos) || l.documento.includes(buscaDigitos))))
  )).sort((a, b) => a.data.localeCompare(b.data) || a.movimento.localeCompare(b.movimento) || numero(a.numero) - numero(b.numero));
};

/** CFOPs e UFs presentes no periodo, para as opcoes dos filtros. */
export const opcoesDosFiltros = (linhas: readonly LinhaContador[]): { cfops: string[]; ufs: string[] } => ({
  cfops: [...new Set(linhas.flatMap((l) => l.cfops))].sort(),
  ufs: [...new Set(linhas.map((l) => l.uf).filter(Boolean))].sort(),
});

// ---------------------------------------------------------------------------
// Resumos
// ---------------------------------------------------------------------------

export interface ResumoCfop extends ValoresFiscais {
  movimento: MovimentoFiscal;
  cfop: string;
  notas: number;
}

/** Por CFOP, so' notas autorizadas; com filtro de CFOP, so' os CFOPs escolhidos. */
export const resumoPorCfop = (linhas: readonly LinhaContador[], cfopsDoFiltro: readonly string[] = []): ResumoCfop[] => {
  const filtro = new Set(cfopsDoFiltro.map(normalizarCfop).filter(Boolean));
  const mapa = new Map<string, ResumoCfop & { ids: Set<string> }>();
  for (const l of linhas) {
    if (l.situacao !== 'autorizada') continue;
    for (const g of l.porCfop) {
      if (filtro.size > 0 && !filtro.has(g.cfop)) continue;
      const chave = `${l.movimento}|${g.cfop}`;
      const atual = mapa.get(chave) ?? { movimento: l.movimento, cfop: g.cfop, notas: 0, ...valoresZerados(), ids: new Set<string>() };
      atual.ids.add(l.id);
      acumular(atual, g);
      mapa.set(chave, atual);
    }
  }
  return [...mapa.values()]
    .map(({ ids, ...r }) => ({ ...r, notas: ids.size }))
    .sort((a, b) => (a.movimento === b.movimento ? a.cfop.localeCompare(b.cfop) : a.movimento === 'entrada' ? -1 : 1));
};

export interface ResumoOperacao extends ValoresFiscais {
  operacao: OperacaoFiscal;
  autorizadas: number;
  canceladas: number;
  outras: number;
}

export const resumoPorOperacao = (linhas: readonly LinhaContador[]): ResumoOperacao[] => {
  const mapa = new Map<OperacaoFiscal, ResumoOperacao>();
  for (const l of linhas) {
    const atual = mapa.get(l.operacao) ?? { operacao: l.operacao, autorizadas: 0, canceladas: 0, outras: 0, ...valoresZerados() };
    if (l.situacao === 'autorizada') {
      atual.autorizadas += 1;
      acumular(atual, l);
    } else if (l.situacao === 'cancelada') atual.canceladas += 1;
    else atual.outras += 1;
    mapa.set(l.operacao, atual);
  }
  return OPERACOES_FISCAIS.map((o) => mapa.get(o)).filter((r): r is ResumoOperacao => Boolean(r));
};

export interface TotaisContador {
  notas: number;
  saidasAutorizadas: number;
  entradasAutorizadas: number;
  canceladas: number;
  comCartaDeCorrecao: number;
}

export const totaisContador = (linhas: readonly LinhaContador[]): TotaisContador => ({
  notas: linhas.length,
  saidasAutorizadas: linhas.filter((l) => l.situacao === 'autorizada' && l.movimento === 'saida').reduce((s, l) => s + l.valor, 0),
  entradasAutorizadas: linhas.filter((l) => l.situacao === 'autorizada' && l.movimento === 'entrada').reduce((s, l) => s + l.valor, 0),
  canceladas: linhas.filter((l) => l.situacao === 'cancelada').length,
  comCartaDeCorrecao: linhas.filter((l) => l.cartas.length > 0).length,
});

// ---------------------------------------------------------------------------
// Documento (PDF / Excel)
// ---------------------------------------------------------------------------

export interface DocumentoRelatorioContador {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (dia: string): string => (/^\d{4}-\d{2}-\d{2}/.test(dia) ? dia.slice(0, 10).split('-').reverse().join('/') : '');
const formatarDocumento = (d: string): string => (
  d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
      : d
);

interface LinhaCarta {
  data: string;
  sequencia: number;
  texto: string;
  numero: string;
  modelo: string;
  chave: string;
  participante: string;
}

export const montarDocumentoContador = (
  linhas: readonly LinhaContador[],
  opcoes: { de: string; ate: string; filtros: FiltrosContador; empresa?: string },
): DocumentoRelatorioContador => {
  const totais = totaisContador(linhas);
  const porCfop = resumoPorCfop(linhas, opcoes.filtros.cfops);
  const porOperacao = resumoPorOperacao(linhas);
  const cartas: LinhaCarta[] = linhas.flatMap((l) => l.cartas.map((c) => ({
    ...c, numero: l.numero, modelo: l.modelo, chave: l.chave, participante: l.participante,
  })));

  const colunasValores = <T extends ValoresFiscais>(): ColunaRelatorio<T>[] => [
    { id: 'valor', titulo: 'Valor contábil', tipo: 'moeda', largura: 26, valor: (r) => r.valor },
    { id: 'baseIcms', titulo: 'Base ICMS', tipo: 'moeda', largura: 24, valor: (r) => r.baseIcms },
    { id: 'icms', titulo: 'ICMS', tipo: 'moeda', largura: 22, valor: (r) => r.icms },
    { id: 'baseSt', titulo: 'Base ICMS-ST', tipo: 'moeda', largura: 24, padrao: false, valor: (r) => r.baseSt },
    { id: 'st', titulo: 'ICMS-ST', tipo: 'moeda', largura: 22, valor: (r) => r.st },
    { id: 'ipi', titulo: 'IPI', tipo: 'moeda', largura: 20, valor: (r) => r.ipi },
    { id: 'pis', titulo: 'PIS', tipo: 'moeda', largura: 20, valor: (r) => r.pis },
    { id: 'cofins', titulo: 'COFINS', tipo: 'moeda', largura: 22, valor: (r) => r.cofins },
  ];
  // Na lista de notas aparecem tambem canceladas/rejeitadas (com o valor que
  // tinham), mas o total do rodape soma so' as autorizadas, como os resumos.
  const soAutorizadas = (c: ColunaRelatorio<LinhaContador>): ColunaRelatorio<LinhaContador> => ({
    ...c,
    totalCalculado: (ls: LinhaContador[]) => ls.filter((l) => l.situacao === 'autorizada').reduce((s, l) => s + Number(c.valor(l) || 0), 0),
  });

  const secoes: SecaoRelatorio[] = [
    {
      id: 'cfop',
      titulo: 'Resumo por CFOP (notas autorizadas)',
      colunas: [
        { id: 'movimento', titulo: 'Movimento', tipo: 'texto', largura: 20, valor: (r: ResumoCfop) => ROTULO_MOVIMENTO[r.movimento] },
        { id: 'cfop', titulo: 'CFOP', tipo: 'texto', largura: 16, valor: (r: ResumoCfop) => formatarCfop(r.cfop) },
        { id: 'notas', titulo: 'Notas', tipo: 'inteiro', largura: 14, valor: (r: ResumoCfop) => r.notas },
        ...colunasValores<ResumoCfop>(),
      ],
      linhas: porCfop,
      unidade: ['CFOP', 'CFOPs'],
      mensagemVazia: 'Nenhuma nota autorizada com estes filtros.',
    } as SecaoRelatorio,
    {
      id: 'operacao',
      titulo: 'Resumo por operação',
      colunas: [
        { id: 'operacao', titulo: 'Operação', tipo: 'texto', largura: 56, valor: (r: ResumoOperacao) => ROTULO_OPERACAO[r.operacao] },
        { id: 'autorizadas', titulo: 'Autorizadas', tipo: 'inteiro', largura: 18, valor: (r: ResumoOperacao) => r.autorizadas },
        { id: 'canceladas', titulo: 'Canceladas', tipo: 'inteiro', largura: 18, valor: (r: ResumoOperacao) => r.canceladas },
        { id: 'outras', titulo: 'Rejeitadas/em processamento', tipo: 'inteiro', largura: 24, padrao: false, valor: (r: ResumoOperacao) => r.outras },
        ...colunasValores<ResumoOperacao>(),
      ],
      linhas: porOperacao,
      unidade: ['operação', 'operações'],
      mensagemVazia: 'Nenhuma nota com estes filtros.',
    } as SecaoRelatorio,
    {
      id: 'notas',
      titulo: 'Notas do período',
      colunas: [
        { id: 'data', titulo: 'Emissão', tipo: 'texto', largura: 20, valor: (l: LinhaContador) => dataBr(l.data) },
        { id: 'movimento', titulo: 'Mov.', tipo: 'texto', largura: 16, valor: (l: LinhaContador) => ROTULO_MOVIMENTO[l.movimento] },
        { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 26, padrao: false, valor: (l: LinhaContador) => ROTULO_ORIGEM[l.origem] },
        { id: 'modelo', titulo: 'Modelo', tipo: 'texto', largura: 16, valor: (l: LinhaContador) => l.modelo },
        { id: 'numero', titulo: 'Número', tipo: 'texto', largura: 16, valor: (l: LinhaContador) => l.numero },
        { id: 'serie', titulo: 'Série', tipo: 'texto', largura: 12, valor: (l: LinhaContador) => l.serie },
        { id: 'chave', titulo: 'Chave de acesso', tipo: 'texto', largura: 60, padrao: false, valor: (l: LinhaContador) => l.chave },
        { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 22, valor: (l: LinhaContador) => ROTULO_SITUACAO[l.situacao] },
        { id: 'operacao', titulo: 'Operação', tipo: 'texto', largura: 40, valor: (l: LinhaContador) => ROTULO_OPERACAO[l.operacao] },
        { id: 'natureza', titulo: 'Natureza da operação (XML)', tipo: 'texto', largura: 40, padrao: false, valor: (l: LinhaContador) => l.naturezaOperacao },
        { id: 'participante', titulo: 'Cliente / fornecedor', tipo: 'texto', largura: 48, valor: (l: LinhaContador) => l.participante },
        { id: 'documento', titulo: 'CPF/CNPJ', tipo: 'texto', largura: 32, valor: (l: LinhaContador) => formatarDocumento(l.documento) },
        { id: 'uf', titulo: 'UF', tipo: 'texto', largura: 10, valor: (l: LinhaContador) => l.uf },
        { id: 'cfops', titulo: 'CFOP', tipo: 'texto', largura: 22, valor: (l: LinhaContador) => l.cfops.map(formatarCfop).join(', ') },
        { id: 'cfopsXml', titulo: 'CFOP do XML (fornecedor)', tipo: 'texto', largura: 24, padrao: false, valor: (l: LinhaContador) => l.cfopsDoXml.map(formatarCfop).join(', ') },
        ...colunasValores<LinhaContador>().map((c) => soAutorizadas(c.id === 'valor' ? { ...c, titulo: 'Valor da nota' } : c)),
        { id: 'cce', titulo: 'CC-e', tipo: 'inteiro', largura: 12, valor: (l: LinhaContador) => l.cartas.length, total: 'nenhum' },
      ],
      linhas: [...linhas],
      unidade: ['nota', 'notas'],
      mensagemVazia: 'Nenhuma nota com estes filtros.',
    } as SecaoRelatorio,
    {
      id: 'cartas',
      titulo: 'Cartas de correção',
      opcional: true,
      padrao: cartas.length > 0,
      colunas: [
        { id: 'data', titulo: 'Enviada em', tipo: 'texto', largura: 22, valor: (c: LinhaCarta) => dataBr(c.data) },
        { id: 'nota', titulo: 'Nota', tipo: 'texto', largura: 24, valor: (c: LinhaCarta) => `${c.modelo} ${c.numero}` },
        { id: 'sequencia', titulo: 'Seq.', tipo: 'inteiro', largura: 10, valor: (c: LinhaCarta) => c.sequencia, total: 'nenhum' },
        { id: 'participante', titulo: 'Cliente', tipo: 'texto', largura: 40, valor: (c: LinhaCarta) => c.participante },
        { id: 'chave', titulo: 'Chave de acesso', tipo: 'texto', largura: 60, padrao: false, valor: (c: LinhaCarta) => c.chave },
        { id: 'texto', titulo: 'Correção', tipo: 'texto', largura: 90, valor: (c: LinhaCarta) => c.texto },
      ],
      linhas: cartas,
      unidade: ['carta', 'cartas'],
      mensagemVazia: 'Nenhuma carta de correção nas notas filtradas.',
    } as SecaoRelatorio,
  ];

  const f = opcoes.filtros;
  const filtrosTexto = [
    f.movimentos.length < 2 ? `Movimento: ${f.movimentos.map((m) => ROTULO_MOVIMENTO[m]).join(', ')}` : '',
    f.modelos.length < MODELOS_FISCAIS.length ? `Modelo: ${f.modelos.join(', ')}` : '',
    f.situacoes.length < SITUACOES_FISCAIS.length ? `Situação: ${f.situacoes.map((s) => ROTULO_SITUACAO[s]).join(', ')}` : '',
    f.operacoes.length < OPERACOES_FISCAIS.length ? `Operação: ${f.operacoes.map((o) => ROTULO_OPERACAO[o]).join('; ')}` : '',
    f.cfops.length ? `CFOP: ${f.cfops.map(normalizarCfop).map(formatarCfop).join(', ')}` : '',
    f.uf ? `UF: ${f.uf}` : '',
    f.soComCartaDeCorrecao ? 'Só notas com carta de correção' : '',
    f.busca.trim() ? `Busca: "${f.busca.trim()}"` : '',
    'Valores somam só notas autorizadas. Valor contábil = produtos + frete + seguro + outras despesas + IPI + ICMS-ST − desconto (fecha com o total da nota).',
    'Notas da empresa pela data da transmissão à SEFAZ; notas recebidas pela data de emissão do XML. CFOP de nota recebida convertido para o de entrada pela tabela de CFOP (ex.: 5.102 → 1.102; 5.405 → 1.403).',
  ].filter(Boolean);

  return {
    titulo: 'Relatório do contador',
    periodo: `${dataBr(opcoes.de)} a ${dataBr(opcoes.ate)}`,
    filtros: filtrosTexto,
    indicadores: [
      { rotulo: 'Notas', valor: totais.notas.toLocaleString('pt-BR') },
      { rotulo: 'Saídas autorizadas', valor: reais(totais.saidasAutorizadas) },
      { rotulo: 'Entradas autorizadas', valor: reais(totais.entradasAutorizadas) },
      { rotulo: 'Canceladas', valor: totais.canceladas.toLocaleString('pt-BR') },
      { rotulo: 'Com carta de correção', valor: totais.comCartaDeCorrecao.toLocaleString('pt-BR') },
    ],
    secoes,
  };
};
