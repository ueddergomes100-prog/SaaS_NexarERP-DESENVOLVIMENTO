import {
  caminho,
  descendente,
  filho,
  filhos,
  lerXml,
  numeroDe,
  textoDe,
  type NoXml,
} from './xmlSimplesDomain';

/*
 * LEITURA COMPLETA DA NF-e DE ENTRADA (2026-09-24).
 *
 * Pedido do dono: "precisamos importar tudo corretamente da nota, ainda mais
 * campos de impostos". A leitura antiga pegava so' codigo, descricao, NCM,
 * quantidade e valor; ficavam de fora chave, serie, natureza da operacao,
 * desconto/seguro/despesas, IPI, ICMS-ST, PIS/COFINS, lote e validade,
 * dados de transporte e pagamento. Sem eles o custo da entrada saia errado e
 * nao havia como imprimir o DANFE nem conferir o total.
 *
 * Regra pura: recebe o texto do XML, devolve dados. Sem tela, sem Firestore.
 */

export interface EnderecoNota {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone: string;
}

export interface ParteDaNota {
  /** CNPJ (14) ou CPF (11), so' digitos. */
  documento: string;
  nome: string;
  fantasia: string;
  inscricaoEstadual: string;
  /** Codigo de regime tributario do emitente (1 = Simples Nacional, 2 = excesso, 3 = normal). */
  regime: string;
  endereco: EnderecoNota;
}

export interface IcmsDoItem {
  origem: string;
  /** CST (regime normal) ou CSOSN (Simples Nacional), como veio na nota. */
  situacao: string;
  base: number;
  reducaoBase: number;
  aliquota: number;
  valor: number;
  baseSt: number;
  aliquotaSt: number;
  valorSt: number;
  mvaSt: number;
  valorDesonerado: number;
  /** Credito de ICMS do Simples Nacional que o fornecedor informa (CSOSN 101/201). */
  valorCreditoSn: number;
}

export interface TributoDoItem {
  situacao: string;
  base: number;
  aliquota: number;
  valor: number;
}

export interface LoteDoItem {
  numero: string;
  fabricacao: string;
  validade: string;
  quantidade: number;
}

export interface ItemDaNota {
  numero: number;
  codigo: string;
  ean: string;
  descricao: string;
  ncm: string;
  cest: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorProduto: number;
  frete: number;
  seguro: number;
  desconto: number;
  outrasDespesas: number;
  unidadeTributavel: string;
  quantidadeTributavel: number;
  pedido: string;
  informacaoAdicional: string;
  icms: IcmsDoItem;
  ipi: TributoDoItem;
  pis: TributoDoItem;
  cofins: TributoDoItem;
  lotes: LoteDoItem[];
}

export interface TotaisDaNota {
  baseIcms: number;
  icms: number;
  icmsDesonerado: number;
  baseSt: number;
  st: number;
  fcpSt: number;
  produtos: number;
  frete: number;
  seguro: number;
  desconto: number;
  impostoImportacao: number;
  ipi: number;
  ipiDevolvido: number;
  pis: number;
  cofins: number;
  outrasDespesas: number;
  total: number;
}

export interface DuplicataDaNota {
  numero: string;
  vencimento: string;
  valor: number;
}

export interface PagamentoDaNota {
  /** Codigo tPag da SEFAZ (01 dinheiro, 03 cartao credito, 15 boleto, 99 outros...). */
  forma: string;
  descricao: string;
  valor: number;
}

export interface VolumeDaNota {
  quantidade: number;
  especie: string;
  marca: string;
  numeracao: string;
  pesoLiquido: number;
  pesoBruto: number;
}

export interface TransporteDaNota {
  /** 0 emitente, 1 destinatario, 2 terceiros, 3/4 proprio, 9 sem frete. */
  modalidadeFrete: string;
  transportadoraDocumento: string;
  transportadoraNome: string;
  transportadoraIe: string;
  transportadoraEndereco: string;
  transportadoraMunicipio: string;
  transportadoraUf: string;
  placa: string;
  volumes: VolumeDaNota[];
}

export interface NotaParseada {
  chave: string;
  modelo: string;
  serie: string;
  numero: string;
  naturezaOperacao: string;
  /** AAAA-MM-DD. */
  dataEmissao: string;
  dataSaida: string;
  /** 0 entrada, 1 saida (do ponto de vista do emitente). */
  tipoOperacao: string;
  finalidade: string;
  protocolo: string;
  dataAutorizacao: string;
  emitente: ParteDaNota;
  destinatario: ParteDaNota;
  totais: TotaisDaNota;
  transporte: TransporteDaNota;
  faturaNumero: string;
  faturaValor: number;
  duplicatas: DuplicataDaNota[];
  pagamentos: PagamentoDaNota[];
  informacoesComplementares: string;
  itens: ItemDaNota[];
}

const digitos = (valor: string): string => valor.replace(/\D/g, '');
const soData = (valor: string): string => valor.split('T')[0] ?? '';

const lerEndereco = (no: NoXml | undefined): EnderecoNota => ({
  logradouro: textoDe(no, 'xLgr'),
  numero: textoDe(no, 'nro'),
  complemento: textoDe(no, 'xCpl'),
  bairro: textoDe(no, 'xBairro'),
  municipio: textoDe(no, 'xMun'),
  uf: textoDe(no, 'UF'),
  cep: digitos(textoDe(no, 'CEP')),
  telefone: digitos(textoDe(no, 'fone')),
});

const lerParte = (no: NoXml | undefined, tagEndereco: string): ParteDaNota => ({
  documento: digitos(textoDe(no, 'CNPJ') || textoDe(no, 'CPF')),
  nome: textoDe(no, 'xNome'),
  fantasia: textoDe(no, 'xFant'),
  inscricaoEstadual: textoDe(no, 'IE'),
  regime: textoDe(no, 'CRT'),
  endereco: lerEndereco(filho(no, tagEndereco)),
});

/** O ICMS vem embrulhado numa tag que muda com a situacao (ICMS00, ICMS10, ICMSSN101...). */
const lerIcms = (imposto: NoXml | undefined): IcmsDoItem => {
  const grupo = filho(imposto, 'ICMS')?.filhos[0];
  return {
    origem: textoDe(grupo, 'orig'),
    situacao: textoDe(grupo, 'CST') || textoDe(grupo, 'CSOSN'),
    base: numeroDe(grupo, 'vBC'),
    reducaoBase: numeroDe(grupo, 'pRedBC'),
    aliquota: numeroDe(grupo, 'pICMS'),
    valor: numeroDe(grupo, 'vICMS'),
    baseSt: numeroDe(grupo, 'vBCST'),
    aliquotaSt: numeroDe(grupo, 'pICMSST'),
    valorSt: numeroDe(grupo, 'vICMSST'),
    mvaSt: numeroDe(grupo, 'pMVAST'),
    valorDesonerado: numeroDe(grupo, 'vICMSDeson'),
    valorCreditoSn: numeroDe(grupo, 'vCredICMSSN'),
  };
};

/** IPI, PIS e COFINS tem o mesmo desenho: um grupo (Trib/Aliq/NT/Outr) com CST, base, aliquota e valor. */
const lerTributo = (imposto: NoXml | undefined, tag: 'IPI' | 'PIS' | 'COFINS'): TributoDoItem => {
  const no = filho(imposto, tag);
  const grupo = no?.filhos.find((f) => f.nome !== 'cEnq' && f.nome !== 'clEnq' && f.nome !== 'CNPJProd' && f.nome !== 'cSelo' && f.nome !== 'qSelo');
  const sufixo = tag === 'IPI' ? 'IPI' : tag === 'PIS' ? 'PIS' : 'COFINS';
  return {
    situacao: textoDe(grupo, 'CST'),
    base: numeroDe(grupo, 'vBC'),
    aliquota: numeroDe(grupo, `p${sufixo}`),
    valor: numeroDe(grupo, `v${sufixo}`),
  };
};

const lerItem = (det: NoXml): ItemDaNota => {
  const prod = filho(det, 'prod');
  const imposto = filho(det, 'imposto');
  const eanBruto = textoDe(prod, 'cEAN');
  // "SEM GTIN" nao e' codigo de barras: nao serve para reconhecer o produto.
  const ean = /^\d{8,14}$/.test(eanBruto) ? eanBruto : '';
  return {
    numero: Number(det.atributos.nItem) || 0,
    codigo: textoDe(prod, 'cProd'),
    ean,
    descricao: textoDe(prod, 'xProd'),
    ncm: digitos(textoDe(prod, 'NCM')),
    cest: digitos(textoDe(prod, 'CEST')),
    cfop: textoDe(prod, 'CFOP'),
    unidade: textoDe(prod, 'uCom') || 'UN',
    quantidade: numeroDe(prod, 'qCom'),
    valorUnitario: numeroDe(prod, 'vUnCom'),
    valorProduto: numeroDe(prod, 'vProd'),
    frete: numeroDe(prod, 'vFrete'),
    seguro: numeroDe(prod, 'vSeg'),
    desconto: numeroDe(prod, 'vDesc'),
    outrasDespesas: numeroDe(prod, 'vOutro'),
    unidadeTributavel: textoDe(prod, 'uTrib'),
    quantidadeTributavel: numeroDe(prod, 'qTrib'),
    pedido: textoDe(prod, 'xPed'),
    informacaoAdicional: textoDe(det, 'infAdProd'),
    icms: lerIcms(imposto),
    ipi: lerTributo(imposto, 'IPI'),
    pis: lerTributo(imposto, 'PIS'),
    cofins: lerTributo(imposto, 'COFINS'),
    lotes: filhos(prod, 'rastro').map((r) => ({
      numero: textoDe(r, 'nLote'),
      fabricacao: textoDe(r, 'dFab'),
      validade: textoDe(r, 'dVal'),
      quantidade: numeroDe(r, 'qLote'),
    })).filter((l) => l.numero),
  };
};

const lerTotais = (icmsTot: NoXml | undefined): TotaisDaNota => ({
  baseIcms: numeroDe(icmsTot, 'vBC'),
  icms: numeroDe(icmsTot, 'vICMS'),
  icmsDesonerado: numeroDe(icmsTot, 'vICMSDeson'),
  baseSt: numeroDe(icmsTot, 'vBCST'),
  st: numeroDe(icmsTot, 'vST'),
  fcpSt: numeroDe(icmsTot, 'vFCPST'),
  produtos: numeroDe(icmsTot, 'vProd'),
  frete: numeroDe(icmsTot, 'vFrete'),
  seguro: numeroDe(icmsTot, 'vSeg'),
  desconto: numeroDe(icmsTot, 'vDesc'),
  impostoImportacao: numeroDe(icmsTot, 'vII'),
  ipi: numeroDe(icmsTot, 'vIPI'),
  ipiDevolvido: numeroDe(icmsTot, 'vIPIDevol'),
  pis: numeroDe(icmsTot, 'vPIS'),
  cofins: numeroDe(icmsTot, 'vCOFINS'),
  outrasDespesas: numeroDe(icmsTot, 'vOutro'),
  total: numeroDe(icmsTot, 'vNF'),
});

const lerTransporte = (transp: NoXml | undefined): TransporteDaNota => {
  const transporta = filho(transp, 'transporta');
  return {
    modalidadeFrete: textoDe(transp, 'modFrete'),
    transportadoraDocumento: digitos(textoDe(transporta, 'CNPJ') || textoDe(transporta, 'CPF')),
    transportadoraNome: textoDe(transporta, 'xNome'),
    transportadoraIe: textoDe(transporta, 'IE'),
    transportadoraEndereco: textoDe(transporta, 'xEnder'),
    transportadoraMunicipio: textoDe(transporta, 'xMun'),
    transportadoraUf: textoDe(transporta, 'UF'),
    placa: textoDe(transp, 'veicTransp', 'placa'),
    volumes: filhos(transp, 'vol').map((v) => ({
      quantidade: numeroDe(v, 'qVol'),
      especie: textoDe(v, 'esp'),
      marca: textoDe(v, 'marca'),
      numeracao: textoDe(v, 'nVol'),
      pesoLiquido: numeroDe(v, 'pesoL'),
      pesoBruto: numeroDe(v, 'pesoB'),
    })),
  };
};

/**
 * Le o XML de uma NF-e (com ou sem o envelope `nfeProc`). Erros em portugues,
 * dizendo o que fazer: resumo sem itens, CT-e e arquivo que nao e' nota.
 */
export const parseNfeXml = (texto: string): NotaParseada => {
  const raiz = lerXml(texto);

  if (raiz.nome === 'resNFe') {
    throw new Error('Este arquivo é só o resumo da nota (sem os itens). Baixe o XML completo da nota no portal da SEFAZ ou peça ao fornecedor.');
  }
  if (raiz.nome === 'cteProc' || raiz.nome === 'CTe') {
    throw new Error('Este arquivo é um conhecimento de transporte (CT-e), não uma nota de mercadoria. O frete se lança no bloco "Frete / Conhecimento de Transporte" da nota de mercadoria.');
  }
  const infNFe = raiz.nome === 'infNFe' ? raiz : descendente(raiz, 'infNFe');
  if (!infNFe) {
    throw new Error('Nenhuma NF-e foi encontrada neste arquivo. Confira se é o XML da nota (não o PDF).');
  }

  const detalhes = filhos(infNFe, 'det');
  if (detalhes.length === 0) {
    throw new Error('Nenhum produto identificado no corpo da nota XML.');
  }

  const ide = filho(infNFe, 'ide');
  const protocolo = descendente(raiz, 'infProt');
  const chaveDoId = digitos(infNFe.atributos.Id ?? '');
  const chave = chaveDoId.length === 44 ? chaveDoId : digitos(textoDe(protocolo, 'chNFe'));
  const dataEmissaoBruta = textoDe(ide, 'dhEmi') || textoDe(ide, 'dEmi');
  const cobranca = filho(infNFe, 'cobr');
  const pagamento = filho(infNFe, 'pag');

  return {
    chave: chave.length === 44 ? chave : '',
    modelo: textoDe(ide, 'mod'),
    serie: textoDe(ide, 'serie'),
    numero: textoDe(ide, 'nNF'),
    naturezaOperacao: textoDe(ide, 'natOp'),
    dataEmissao: soData(dataEmissaoBruta),
    dataSaida: soData(textoDe(ide, 'dhSaiEnt') || textoDe(ide, 'dSaiEnt')),
    tipoOperacao: textoDe(ide, 'tpNF'),
    finalidade: textoDe(ide, 'finNFe'),
    protocolo: textoDe(protocolo, 'nProt'),
    dataAutorizacao: textoDe(protocolo, 'dhRecbto'),
    emitente: lerParte(filho(infNFe, 'emit'), 'enderEmit'),
    destinatario: lerParte(filho(infNFe, 'dest'), 'enderDest'),
    totais: lerTotais(caminho(infNFe, 'total', 'ICMSTot')),
    transporte: lerTransporte(filho(infNFe, 'transp')),
    faturaNumero: textoDe(cobranca, 'fat', 'nFat'),
    faturaValor: numeroDe(cobranca, 'fat', 'vLiq') || numeroDe(cobranca, 'fat', 'vOrig'),
    duplicatas: filhos(cobranca, 'dup').map((d, indice) => ({
      numero: textoDe(d, 'nDup') || String(indice + 1),
      vencimento: textoDe(d, 'dVenc'),
      valor: numeroDe(d, 'vDup'),
    })),
    pagamentos: filhos(pagamento, 'detPag').map((p) => ({
      forma: textoDe(p, 'tPag'),
      descricao: textoDe(p, 'xPag'),
      valor: numeroDe(p, 'vPag'),
    })),
    informacoesComplementares: textoDe(infNFe, 'infAdic', 'infCpl'),
    itens: detalhes.map(lerItem),
  };
};

/** Nome curto da forma de pagamento (tPag) para a tela. */
export const rotuloDaFormaDePagamento = (codigo: string): string => ({
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de crédito',
  '04': 'Cartão de débito',
  '05': 'Crédito loja',
  '10': 'Vale alimentação',
  '11': 'Vale refeição',
  '12': 'Vale presente',
  '13': 'Vale combustível',
  '14': 'Duplicata mercantil',
  '15': 'Boleto bancário',
  '16': 'Depósito bancário',
  '17': 'PIX',
  '18': 'Transferência bancária',
  '19': 'Programa de fidelidade',
  '90': 'Sem pagamento',
  '99': 'Outros',
}[codigo] ?? 'Outros');
