/*
 * DEVOLUCAO DE COMPRA AO FORNECEDOR (pendencia fiscal, 21/10/2026).
 *
 * Decisoes do dono (21/10/2026, caixinhas):
 *  - igual a devolucao de venda: primeiro REGISTRA a devolucao (estoque sai,
 *    financeiro ajustado), depois emite a NF-e de devolucao a partir dela (e
 *    reemite se for rejeitada);
 *  - financeiro: abate das parcelas EM ABERTO da nota de entrada; o que ja'
 *    tinha sido pago vira uma conta a RECEBER do fornecedor;
 *  - endereco do fornecedor (com o codigo IBGE da cidade) vem do XML da nota;
 *    sem ele, do cadastro do fornecedor;
 *  - tributacao: REPETE a da nota do fornecedor, proporcional a quantidade
 *    devolvida -- ICMS e ICMS-ST com a mesma base/aliquota (empresa do Simples
 *    sai com CSOSN 900; regime normal, com o mesmo CST), IPI da entrada volta
 *    como "IPI devolvido" (vIPIDevol), PIS/COFINS CST 49. O contador confirma.
 *
 * A NF-e: saida (tpNF=1), finalidade devolucao (finNFe=4), CFOP 5.2xx/6.2xx
 * (5.4xx/6.4xx com ST), cada item referenciando o item da nota do fornecedor
 * (sourceDocument = chave + numero do item), sem pagamento.
 *
 * Regra pura (tela e servidor): sem Firestore, sem rede.
 */
import { cfopEntradaSugerido, cfopPorCodigo } from './cfopDomain';
import type { ItemDaNota, ParteDaNota } from './nfeXmlDomain';

export const STATUS_DEVOLUCAO_COMPRA = 'registrada';
export const MOTIVO_MINIMO_DEVOLUCAO = 10;
export const FINALIDADE_NOTA_DEVOLUCAO_COMPRA = 'devolucao_compra';

/** Colecao do estoque de cada tipo de item da entrada. 'registro' nao movimentou estoque. */
export const COLECAO_DO_TIPO: Record<string, string> = {
  revenda: 'estoque',
  materia_prima: 'materias_primas',
  insumo: 'insumos',
};

const arred = (v: number, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((Number(v) + Number.EPSILON) * f) / f;
};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

// ---------------------------------------------------------------------------
// CFOP
// ---------------------------------------------------------------------------

/** CFOP de entrada (compra) -> CFOP da devolucao (tabela de CFOP). */
const DEVOLUCAO_DO_CFOP_DE_COMPRA: Record<string, string> = {
  1101: '5201', 2101: '6201', // compra para industrializacao
  1102: '5202', 2102: '6202', // compra para comercializacao
  1401: '5410', 2401: '6410', // industrializacao, com ST
  1403: '5411', 2403: '6411', // comercializacao, com ST
};

/**
 * CFOP da devolucao de um item: pelo CFOP de entrada gravado ou, sem ele, pelo
 * equivalente do CFOP do fornecedor. null = compra que o sistema ainda nao
 * devolve (uso e consumo, ativo, bonificacao...).
 */
export const cfopDaDevolucaoDeCompra = (cfopEntrada: unknown, cfopFornecedor: unknown): string | null => {
  const entrada = digitos(cfopEntrada) || cfopEntradaSugerido(cfopFornecedor);
  const devolucao = DEVOLUCAO_DO_CFOP_DE_COMPRA[entrada];
  return devolucao && cfopPorCodigo(devolucao) ? devolucao : null;
};

// ---------------------------------------------------------------------------
// O que a tela manda
// ---------------------------------------------------------------------------

export interface PedidoDeDevolucaoCompra {
  notaEntradaId: string;
  itens: Array<{ indice: number; quantidade: number }>;
  motivo: string;
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

export const lerPedidoDeDevolucaoCompra = (corpo: unknown): { erro: string } | { pedido: PedidoDeDevolucaoCompra } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const notaEntradaId = String(c.notaEntradaId ?? '');
  if (!ID_VALIDO.test(notaEntradaId)) return { erro: 'Nota de entrada inválida. Atualize a lista e tente de novo.' };
  if (!Array.isArray(c.itens)) return { erro: 'Escolha os itens e as quantidades a devolver.' };
  const itens: PedidoDeDevolucaoCompra['itens'] = [];
  const vistos = new Set<number>();
  for (const bruto of c.itens) {
    const i = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const indice = Number(i.indice);
    const quantidade = Number(i.quantidade);
    if (!Number.isInteger(indice) || indice < 0 || vistos.has(indice)) return { erro: 'Item da devolução inválido. Atualize a tela e tente de novo.' };
    if (!Number.isFinite(quantidade) || quantidade < 0) return { erro: 'Quantidade a devolver inválida.' };
    vistos.add(indice);
    if (quantidade > 0) itens.push({ indice, quantidade });
  }
  if (itens.length === 0) return { erro: 'Informe a quantidade a devolver de pelo menos um item.' };
  const motivo = String(c.motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (motivo.length < MOTIVO_MINIMO_DEVOLUCAO) return { erro: `Escreva o motivo da devolução (pelo menos ${MOTIVO_MINIMO_DEVOLUCAO} caracteres), ex.: "Mercadoria com defeito".` };
  return { pedido: { notaEntradaId, itens, motivo } };
};

// ---------------------------------------------------------------------------
// Itens: quanto ainda da' para devolver e quanto vale
// ---------------------------------------------------------------------------

export interface ItemDaEntrada {
  itemId?: string;
  tipo?: string;
  codigoXml?: string;
  descricaoXml?: string;
  quantidade?: number;
  valorUnitario?: number;
  unidadeNota?: string;
  fator?: number;
  cfop?: string;
  cfopEntrada?: string;
  impostos?: { icms?: { valorSt?: number }; ipi?: { valor?: number } };
  lotes?: Array<{ loteId: string; lote: string; validade: string; quantidade: number }>;
}

export interface ItemDevolvido {
  indice: number;
  nome: string;
  itemId: string;
  tipo: string;
  quantidade: number;
  unidade: string;
  /** Quantidade na unidade do estoque (quantidade x fator). */
  quantidadeEstoque: number;
  valorUnitario: number;
  produtosCentavos: number;
  stCentavos: number;
  ipiCentavos: number;
  totalCentavos: number;
  cfop: string;
}

/** Quanto de cada item ainda pode ser devolvido (o original menos o ja devolvido). */
export const saldoParaDevolver = (item: ItemDaEntrada, jaDevolvido: number): number => (
  arred(Math.max(0, num(item.quantidade) - num(jaDevolvido)), 6)
);

/**
 * Confere e calcula os itens pedidos. Valor do item = quantidade x valor
 * unitario + ST e IPI proporcionais (o que a nota do fornecedor cobrou).
 */
export const planejarItensDaDevolucao = (args: {
  itens: ItemDaEntrada[];
  pedido: PedidoDeDevolucaoCompra['itens'];
  jaDevolvido: Record<string, number>;
}): { erro: string } | { itens: ItemDevolvido[]; totalCentavos: number } => {
  const saida: ItemDevolvido[] = [];
  for (const p of args.pedido) {
    const item = args.itens[p.indice];
    if (!item) return { erro: 'Um dos itens não existe mais nesta nota. Atualize a tela.' };
    const nome = String(item.descricaoXml || item.codigoXml || `Item ${p.indice + 1}`);
    if (item.tipo === 'registro' || !COLECAO_DO_TIPO[String(item.tipo || 'revenda')]) {
      return { erro: `${nome} entrou só como registro (não movimentou estoque): não se devolve por aqui.` };
    }
    const saldo = saldoParaDevolver(item, args.jaDevolvido[String(p.indice)] || 0);
    if (p.quantidade > saldo + 1e-9) {
      return { erro: saldo > 0
        ? `${nome}: dá para devolver no máximo ${saldo} (a nota trouxe ${num(item.quantidade)} e o resto já foi devolvido).`
        : `${nome} já foi devolvido por inteiro.` };
    }
    const cfop = cfopDaDevolucaoDeCompra(item.cfopEntrada, item.cfop);
    if (!cfop) {
      return { erro: `${nome} entrou com o CFOP ${item.cfopEntrada || item.cfop || 'sem CFOP'}, que não é de compra para revenda ou industrialização: a devolução deste tipo ainda não é emitida pelo sistema.` };
    }
    const razao = num(item.quantidade) > 0 ? p.quantidade / num(item.quantidade) : 0;
    const produtosCentavos = Math.round(num(item.valorUnitario) * 100 * p.quantidade);
    const stCentavos = Math.round(num(item.impostos?.icms?.valorSt) * 100 * razao);
    const ipiCentavos = Math.round(num(item.impostos?.ipi?.valor) * 100 * razao);
    saida.push({
      indice: p.indice,
      nome,
      itemId: String(item.itemId || ''),
      tipo: String(item.tipo || 'revenda'),
      quantidade: p.quantidade,
      unidade: String(item.unidadeNota || 'UN'),
      quantidadeEstoque: arred(p.quantidade * (num(item.fator) > 0 ? num(item.fator) : 1), 6),
      valorUnitario: num(item.valorUnitario),
      produtosCentavos,
      stCentavos,
      ipiCentavos,
      totalCentavos: produtosCentavos + stCentavos + ipiCentavos,
      cfop,
    });
  }
  const internos = saida.filter((i) => i.cfop.startsWith('5')).length;
  if (internos > 0 && internos < saida.length) {
    return { erro: 'Os itens têm CFOP de dentro e de fora do estado ao mesmo tempo. Devolva-os em duas devoluções separadas.' };
  }
  return { itens: saida, totalCentavos: saida.reduce((s, i) => s + i.totalCentavos, 0) };
};

/** De quais lotes sai cada quantidade (na ordem em que a entrada os criou). */
export const saidaDosLotes = (
  lotes: ItemDaEntrada['lotes'],
  quantidadeEstoque: number,
  saldoDoLote: Record<string, number>,
  nome: string,
): { erro: string } | { usos: Array<{ loteId: string; lote: string; quantidade: number }> } => {
  if (!Array.isArray(lotes) || lotes.length === 0) return { usos: [] };
  let falta = quantidadeEstoque;
  const usos: Array<{ loteId: string; lote: string; quantidade: number }> = [];
  for (const l of lotes) {
    if (falta <= 1e-9) break;
    const disponivel = Math.min(num(l.quantidade), Math.max(0, num(saldoDoLote[l.loteId])));
    const sai = arred(Math.min(disponivel, falta), 6);
    if (sai > 0) {
      usos.push({ loteId: l.loteId, lote: l.lote, quantidade: sai });
      falta = arred(falta - sai, 6);
    }
  }
  if (falta > 1e-9) return { erro: `${nome}: os lotes desta entrada só têm ${arred(quantidadeEstoque - falta, 6)} em estoque. Não dá para devolver mais do que sobrou dos lotes.` };
  return { usos };
};

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

export interface TituloDaEntrada {
  id: string;
  status?: string;
  valorCentavos?: number;
  valor?: number;
  dataVencimento?: string;
  data?: string;
  pagoParcialCentavos?: number;
  boleto?: unknown;
}

export interface PlanoFinanceiro {
  abatimentos: Array<{ id: string; antesCentavos: number; depoisCentavos: number; cancelar: boolean }>;
  aReceberCentavos: number;
}

const centavosDe = (t: TituloDaEntrada) => (Number.isFinite(Number(t.valorCentavos)) ? Math.round(Number(t.valorCentavos)) : Math.round(num(t.valor) * 100));

/**
 * Abate o valor devolvido das parcelas EM ABERTO (a ultima a vencer primeiro);
 * parcela zerada fica cancelada. Parcela paga, paga em parte ou com boleto nao
 * se mexe -- o que nao couber no em aberto vira conta a receber do fornecedor.
 */
export const planoFinanceiroDaDevolucao = (titulos: TituloDaEntrada[], valorCentavos: number): PlanoFinanceiro => {
  const abertos = titulos
    .filter((t) => t.status === 'Pendente' && !(num(t.pagoParcialCentavos) > 0) && !t.boleto && centavosDe(t) > 0)
    .sort((a, b) => String(b.dataVencimento || b.data || '').localeCompare(String(a.dataVencimento || a.data || '')));
  let falta = Math.max(0, Math.round(valorCentavos));
  const abatimentos: PlanoFinanceiro['abatimentos'] = [];
  for (const t of abertos) {
    if (falta <= 0) break;
    const antes = centavosDe(t);
    const abate = Math.min(antes, falta);
    abatimentos.push({ id: t.id, antesCentavos: antes, depoisCentavos: antes - abate, cancelar: antes - abate === 0 });
    falta -= abate;
  }
  return { abatimentos, aReceberCentavos: falta };
};

// ---------------------------------------------------------------------------
// NF-e (Spedy)
// ---------------------------------------------------------------------------

/** Item do XML que corresponde ao item gravado na entrada (mesma posicao; confere pelo codigo). */
export const itemDoXml = (itensXml: ItemDaNota[], indice: number, item: ItemDaEntrada): ItemDaNota | null => {
  const mesmo = itensXml[indice];
  const codigo = String(item.codigoXml || '');
  if (mesmo && (!codigo || mesmo.codigo === codigo)) return mesmo;
  return itensXml.find((x) => x.codigo === codigo && (!item.descricaoXml || x.descricao === item.descricaoXml)) || null;
};

/** ICMS do item da devolucao: o da nota do fornecedor, escalado. */
const icmsDaDevolucao = (x: ItemDaNota, razao: number, simples: boolean) => {
  const i = x.icms;
  const st = num(i.valorSt) > 0 ? {
    // modBCST: 4 = margem de valor agregado (MVA); sem MVA na nota, 6 = valor da operacao.
    baseTaxStModality: num(i.mvaSt) > 0 ? 4 : 6,
    baseTaxSt: arred(num(i.baseSt) * razao),
    stRate: num(i.aliquotaSt),
    stAmount: arred(num(i.valorSt) * razao),
    ...(num(i.mvaSt) > 0 ? { stMarginAmount: num(i.mvaSt) } : {}),
  } : {};
  const proprio = num(i.valor) > 0 ? {
    baseTaxModality: 3,
    baseTax: arred(num(i.base) * razao),
    ...(num(i.reducaoBase) > 0 ? { baseTaxReduction: num(i.reducaoBase) } : {}),
    rate: num(i.aliquota),
    amount: arred(num(i.valor) * razao),
  } : {};
  const origin = Number(i.origem || '0') || 0;
  if (simples) return { origin, csosn: 900, ...proprio, ...st };
  const cst = String(i.situacao || '').length === 2 ? Number(i.situacao) : (num(i.valor) > 0 || num(i.valorSt) > 0 ? 90 : 41);
  return { origin, cst, ...proprio, ...st };
};

export const montarItensDaNotaDeDevolucao = (args: {
  itens: ItemDevolvido[];
  itensEntrada: ItemDaEntrada[];
  itensXml: ItemDaNota[];
  chaveAcesso: string;
  simples: boolean;
}): { erro: string } | { itens: Array<Record<string, unknown>> } => {
  const saida: Array<Record<string, unknown>> = [];
  for (const d of args.itens) {
    const x = itemDoXml(args.itensXml, d.indice, args.itensEntrada[d.indice] || {});
    if (!x) return { erro: `${d.nome}: não achei este item no XML da nota do fornecedor. Importe o XML da nota de novo.` };
    const razao = num(x.quantidade) > 0 ? d.quantidade / num(x.quantidade) : 0;
    const totalAmount = arred(d.quantidade * num(x.valorUnitario));
    const desconto = arred(num(x.desconto) * razao);
    const ipiDevolvido = arred(num(x.ipi?.valor) * razao);
    saida.push({
      code: x.codigo || d.itemId || String(d.indice + 1),
      ...(digitos(x.ean).length >= 8 ? { gtinCode: digitos(x.ean) } : {}),
      description: x.descricao,
      ncm: digitos(x.ncm),
      ...(digitos(x.cest) ? { cest: digitos(x.cest) } : {}),
      cfop: Number(d.cfop),
      unit: x.unidade || d.unidade,
      quantity: d.quantidade,
      unitAmount: num(x.valorUnitario),
      totalAmount,
      ...(desconto > 0 ? { discountAmount: desconto } : {}),
      unitTax: x.unidadeTributavel || x.unidade || d.unidade,
      quantityTax: num(x.quantidadeTributavel) > 0 ? arred(num(x.quantidadeTributavel) * razao, 4) : d.quantidade,
      unitTaxAmount: num(x.quantidadeTributavel) > 0 ? arred(num(x.valorProduto) / num(x.quantidadeTributavel), 10) : num(x.valorUnitario),
      makeupTotal: true,
      ...(ipiDevolvido > 0 ? { returnedPercent: 100, ipiReturnedAmount: ipiDevolvido } : {}),
      sourceDocument: { accessKey: args.chaveAcesso, itemNumber: x.numero },
      taxes: {
        icms: icmsDaDevolucao(x, razao, args.simples),
        pis: { cst: 49 },
        cofins: { cst: 49 },
      },
    });
  }
  return { itens: saida };
};

export interface FornecedorCadastro {
  nome?: string;
  cnpj?: string;
  identidade?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  estado?: string;
  codigoIbge?: string;
  email?: string;
}

/**
 * Destinatario (o fornecedor): o emitente do XML da nota de entrada; o que
 * faltar la' (codigo IBGE, por exemplo) vem do cadastro do fornecedor.
 */
export const destinatarioDaDevolucao = (emitente: ParteDaNota | null, fornecedor: FornecedorCadastro | null): { erro: string } | { receiver: Record<string, unknown> } => {
  const e = emitente?.endereco;
  const nome = String(emitente?.nome || fornecedor?.nome || '').trim();
  const documento = digitos(emitente?.documento || fornecedor?.cnpj);
  const rua = String(e?.logradouro || fornecedor?.endereco || '').trim();
  const numero = String(e?.numero || fornecedor?.numero || '').trim() || 'S/N';
  const bairro = String(e?.bairro || fornecedor?.bairro || '').trim();
  const cep = digitos(e?.cep || fornecedor?.cep);
  const cidade = String(e?.municipio || fornecedor?.cidade || '').trim();
  const uf = String(e?.uf || fornecedor?.estado || '').trim().toUpperCase();
  const ibge = digitos(e?.codigoMunicipio || fornecedor?.codigoIbge);
  const faltando = [
    !nome && 'nome',
    !(documento.length === 14 || documento.length === 11) && 'CNPJ',
    !rua && 'endereço',
    !bairro && 'bairro',
    cep.length !== 8 && 'CEP',
    !cidade && 'cidade',
    uf.length !== 2 && 'estado',
    ibge.length !== 7 && 'código IBGE da cidade',
  ].filter(Boolean);
  if (faltando.length > 0) {
    return { erro: `Faltam dados do fornecedor ${nome || ''} para a nota de devolução: ${faltando.join(', ')}. Complete em Cadastros › Fornecedores.` };
  }
  const ie = digitos(emitente?.inscricaoEstadual || fornecedor?.identidade);
  const email = String(fornecedor?.email || '').trim();
  return {
    receiver: {
      name: nome,
      federalTaxNumber: documento,
      ...(ie.length >= 2 ? { stateTaxNumber: ie } : {}),
      ...(email ? { email } : {}),
      address: { street: rua, number: numero, district: bairro, postalCode: cep, city: { code: ibge, name: cidade, state: uf } },
    },
  };
};

const dataBr = (iso: unknown) => {
  const t = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.split('-').reverse().join('/') : '';
};

/** Corpo do POST /product-invoices da Spedy (NF-e de saida, finalidade devolucao). */
export const montarPayloadDaDevolucaoDeCompra = (args: {
  integrationId: string;
  receiver: Record<string, unknown>;
  itens: Array<Record<string, unknown>>;
  notaEntrada: { numeroNF?: string; serie?: string; dataEmissao?: string; chaveAcesso?: string };
  motivo: string;
}) => {
  const produtos = arred(args.itens.reduce((s, i) => s + num(i.totalAmount), 0));
  const desconto = arred(args.itens.reduce((s, i) => s + num(i.discountAmount), 0));
  const st = arred(args.itens.reduce((s, i) => s + num((i.taxes as { icms?: { stAmount?: number } })?.icms?.stAmount), 0));
  const ipi = arred(args.itens.reduce((s, i) => s + num(i.ipiReturnedAmount), 0));
  const n = args.notaEntrada;
  const data = dataBr(n.dataEmissao);
  return {
    integrationId: args.integrationId,
    isFinalCustomer: false,
    operationType: 'outgoing',
    purposeType: 'devolution',
    destination: String(args.itens[0]?.cfop || '').startsWith('6') ? 'interstate' : 'internal',
    presenceType: 'none',
    operationNature: 'Devolução de Compra',
    additionalInformation: `Devolução referente à NF-e Nº ${n.numeroNF || ''}${n.serie ? ` série ${n.serie}` : ''}${data ? ` de ${data}` : ''}. Chave de acesso: ${n.chaveAcesso || ''}. Motivo: ${args.motivo}`,
    sendEmailToCustomer: Boolean(args.receiver.email),
    receiver: args.receiver,
    items: args.itens,
    payments: [{ method: 'noPayment', amount: 0 }],
    total: {
      invoiceAmount: arred(produtos - desconto + st + ipi),
      productAmount: produtos,
      ...(desconto > 0 ? { discountAmount: desconto } : {}),
    },
  };
};

/** NF-e de devolucao em andamento ou autorizada (rejeitada/negada/cancelada da' para emitir de novo). */
export const notaVigenteDaDevolucaoDeCompra = (notaFiscal: { status?: unknown; reservadoEmMs?: unknown } | null | undefined, agoraMs: number): boolean => {
  if (!notaFiscal) return false;
  const status = String(notaFiscal.status || '');
  if (status === 'reservada') return agoraMs - num(notaFiscal.reservadoEmMs) < 5 * 60 * 1000;
  return !['rejected', 'denied', 'canceled', ''].includes(status);
};
