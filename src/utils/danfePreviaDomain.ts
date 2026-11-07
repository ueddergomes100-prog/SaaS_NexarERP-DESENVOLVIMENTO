/*
 * PREVIA DO DANFE ANTES DE TRANSMITIR (07/11/2026, pedido do dono).
 *
 * A Spedy nao valida nem desenha o DANFE sem emitir: "Criar NF-e" ja' enfileira
 * para a SEFAZ, e o PDF so' existe "apos a autorizacao" (conferido na
 * documentacao em 07/11/2026). Entao a previa e' feita aqui: a nota passa por
 * TODA a montagem que a emissao faz (cadastro do cliente, NCM, CFOP, CEST,
 * impostos, transporte, pagamentos) e o payload pronto vira o mesmo desenho de
 * DANFE que o sistema ja' usa para o XML recebido (danfePdf.ts), com a marca
 * "PREVIA" e sem chave nem protocolo. O que a SEFAZ confere por conta propria
 * (certificado, numeracao, IE do destinatario no cadastro dela) so' aparece na
 * transmissao de verdade -- a previa avisa isso no rodape.
 *
 * Regra pura: traduz o payload da Spedy para NotaParseada.
 */
import type { IcmsDoItem, ItemDaNota, NotaParseada, PagamentoDaNota, ParteDaNota, TotaisDaNota, TransporteDaNota, TributoDoItem } from './nfeXmlDomain';

export interface EmitenteDaPrevia {
  cnpj?: unknown;
  razaoSocial?: unknown;
  nomeOficina?: unknown;
  inscricaoEstadual?: unknown;
  regimeTributario?: unknown;
  rua?: unknown;
  numero?: unknown;
  bairro?: unknown;
  cep?: unknown;
  telefone?: unknown;
  nfseCidadeNome?: unknown;
  nfseCidadeCodigo?: unknown;
  nfseCidadeEstado?: unknown;
}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const digitos = (v: unknown): string => texto(v).replace(/\D/g, '');

/** Meio de pagamento da Spedy -> codigo tPag da SEFAZ (o DANFE mostra pelo codigo). */
const TPAG_DO_MEIO: Record<string, string> = {
  money: '01', check: '02', creditCard: '03', debitCard: '04', storeCredit: '05', billetBanking: '15', bankTransfer: '16', pix: '17', noPayment: '90', other: '99',
};

export const TEXTO_RODAPE_PREVIA = 'PRÉVIA DO DANFE — a nota ainda não foi transmitida e não tem valor fiscal. Número, chave e protocolo saem só na autorização da SEFAZ.';
export const MARCA_DAGUA_PREVIA = 'PRÉVIA — SEM VALOR FISCAL';

const tributo = (g: Obj): TributoDoItem => ({
  situacao: texto(g.cst),
  base: numero(g.baseTax),
  aliquota: numero(g.rate),
  valor: numero(g.amount),
});

const icmsDoItem = (g: Obj): IcmsDoItem => ({
  origem: texto(g.origin),
  situacao: texto(g.csosn || g.cst),
  base: numero(g.baseTax),
  reducaoBase: numero(g.baseTaxReduction),
  aliquota: numero(g.rate),
  valor: numero(g.amount),
  baseSt: numero(g.baseTaxST),
  aliquotaSt: numero(g.rateST),
  valorSt: numero(g.amountST),
  mvaSt: numero(g.mvaST),
  valorDesonerado: numero(g.exemptAmount),
  valorCreditoSn: numero(g.snCreditAmount),
});

const itemDaPrevia = (it: Obj, indice: number): ItemDaNota => {
  const taxes = obj(it.taxes);
  return {
    numero: indice + 1,
    codigo: texto(it.code),
    ean: texto(it.gtinCode) === 'SEM GTIN' ? '' : texto(it.gtinCode),
    descricao: texto(it.description),
    ncm: texto(it.ncm),
    cest: texto(it.cest),
    cfop: texto(it.cfop),
    unidade: texto(it.unit),
    quantidade: numero(it.quantity),
    valorUnitario: numero(it.unitAmount),
    valorProduto: numero(it.totalAmount),
    frete: numero(it.freightAmount),
    seguro: numero(it.insuranceAmount),
    desconto: numero(it.discountAmount),
    outrasDespesas: numero(it.othersAmount),
    unidadeTributavel: texto(it.unitTax || it.unit),
    quantidadeTributavel: numero(it.quantityTax || it.quantity),
    pedido: '',
    informacaoAdicional: texto(it.additionalInformation),
    icms: icmsDoItem(obj(taxes.icms)),
    ipi: tributo(obj(taxes.ipi)),
    pis: tributo(obj(taxes.pis)),
    cofins: tributo(obj(taxes.cofins)),
    lotes: [],
  };
};

const parteDoEmitente = (e: EmitenteDaPrevia): ParteDaNota => ({
  documento: digitos(e.cnpj),
  nome: texto(e.razaoSocial) || texto(e.nomeOficina),
  fantasia: texto(e.nomeOficina),
  inscricaoEstadual: texto(e.inscricaoEstadual),
  regime: texto(e.regimeTributario) === 'simples_nacional' ? '1' : '3',
  endereco: {
    logradouro: texto(e.rua),
    numero: texto(e.numero),
    complemento: '',
    bairro: texto(e.bairro),
    municipio: texto(e.nfseCidadeNome),
    codigoMunicipio: digitos(e.nfseCidadeCodigo),
    uf: texto(e.nfseCidadeEstado).toUpperCase(),
    cep: digitos(e.cep),
    telefone: digitos(e.telefone),
  },
});

const parteDoDestinatario = (r: Obj): ParteDaNota => {
  const endereco = obj(r.address);
  const cidade = obj(endereco.city);
  return {
    documento: digitos(r.federalTaxNumber) || texto(r.federalTaxNumber),
    nome: texto(r.name),
    fantasia: '',
    inscricaoEstadual: texto(r.stateTaxNumber),
    regime: '',
    endereco: {
      logradouro: texto(endereco.street),
      numero: texto(endereco.number),
      complemento: texto(endereco.additionalInformation),
      bairro: texto(endereco.district),
      municipio: texto(cidade.name),
      codigoMunicipio: digitos(cidade.code),
      uf: texto(cidade.state).toUpperCase(),
      cep: digitos(endereco.postalCode),
      telefone: '',
    },
  };
};

const transporteDaPrevia = (t: Obj): TransporteDaNota => {
  const carrier = obj(t.carrier);
  const endereco = obj(carrier.address);
  const cidade = obj(endereco.city);
  const volume = obj(t.volume);
  return {
    modalidadeFrete: texto(t.freightModality) || '9',
    transportadoraDocumento: digitos(carrier.federalTaxNumber),
    transportadoraNome: texto(carrier.name),
    transportadoraIe: texto(carrier.stateTaxNumber),
    transportadoraEndereco: [texto(endereco.street), texto(endereco.number)].filter(Boolean).join(', '),
    transportadoraMunicipio: texto(cidade.name),
    transportadoraUf: texto(cidade.state).toUpperCase(),
    placa: texto(obj(t.vehicle).plate).toUpperCase(),
    volumes: Object.keys(volume).length > 0
      ? [{ quantidade: numero(volume.volumeQuantity ?? volume.quantity), especie: texto(volume.species), marca: texto(volume.brand), numeracao: texto(volume.volumeNumeration ?? volume.numeration), pesoLiquido: numero(volume.netWeight), pesoBruto: numero(volume.grossWeight) }]
      : [],
  };
};

const totaisDaPrevia = (total: Obj, itens: ItemDaNota[]): TotaisDaNota => ({
  baseIcms: numero(total.icmsBaseTax),
  icms: numero(total.icmsAmount),
  icmsDesonerado: 0,
  baseSt: itens.reduce((s, i) => s + i.icms.baseSt, 0),
  st: itens.reduce((s, i) => s + i.icms.valorSt, 0),
  fcpSt: 0,
  produtos: numero(total.productAmount),
  frete: numero(total.freightAmount),
  seguro: numero(total.insuranceAmount),
  desconto: numero(total.discountAmount),
  impostoImportacao: 0,
  ipi: itens.reduce((s, i) => s + i.ipi.valor, 0),
  ipiDevolvido: 0,
  pis: numero(total.pisAmount),
  cofins: numero(total.cofinsAmount),
  outrasDespesas: numero(total.othersAmount),
  total: numero(total.invoiceAmount),
});

const pagamentosDaPrevia = (pagamentos: Obj[]): PagamentoDaNota[] => pagamentos.map((p) => ({
  forma: TPAG_DO_MEIO[texto(p.method)] || '99',
  descricao: '',
  valor: numero(p.amount),
}));

/**
 * A nota como o DANFE desenha, a partir do payload pronto para a Spedy.
 * `serie` e' a da configuracao; numero fica vazio (a Spedy numera ao emitir).
 */
export const notaDaPrevia = (args: { payload: Obj; emitente: EmitenteDaPrevia; serie?: string; hoje: string }): NotaParseada => {
  const payload = args.payload;
  const itens = lista(payload.items).map(itemDaPrevia);
  const billing = obj(payload.billing);
  return {
    chave: '',
    modelo: '55',
    serie: texto(args.serie),
    numero: '',
    naturezaOperacao: texto(payload.operationNature),
    dataEmissao: args.hoje,
    dataSaida: args.hoje,
    tipoOperacao: '1',
    finalidade: '1',
    protocolo: '',
    dataAutorizacao: '',
    emitente: parteDoEmitente(args.emitente),
    destinatario: parteDoDestinatario(obj(payload.receiver)),
    totais: totaisDaPrevia(obj(payload.total), itens),
    transporte: transporteDaPrevia(obj(payload.transport)),
    faturaNumero: texto(billing.number),
    faturaValor: numero(billing.netAmount),
    duplicatas: lista(payload.duplicates).map((d) => ({ numero: texto(d.number), vencimento: texto(d.dueDate).split('T')[0] || '', valor: numero(d.amount) })),
    pagamentos: pagamentosDaPrevia(lista(payload.payments)),
    informacoesComplementares: texto(payload.additionalInformation),
    itens,
  };
};
