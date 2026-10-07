/**
 * DOCUMENTOS DE COBRANCA (Configuracoes por filial, fase D -- 2026-10-07):
 * recibo de pagamento, promissoria, carne de parcelas e duplicata. Plano em
 * docs/PLANO_CONFIGURACOES_POR_FILIAL.md.
 *
 * Tudo configuravel por filial em `configuracoes.emissaoDocumentos`: para
 * cada documento, Perguntar / Sempre / Nunca e o numero de vias. Padrao:
 * NUNCA (nada muda para quem nao configurar). A impressao continua
 * disponivel pelo botao, independente da regra.
 *
 * Puro: monta os dados de cada documento (valor por extenso, numeracao
 * N/total, partes) a partir do pedido, das parcelas (transacoes) e dos
 * cadastros. O PDF e' desenhado em documentosCobrancaPdf.ts.
 */

export type ModoEmissao = 'nunca' | 'perguntar' | 'sempre';
export type DocumentoDeCobranca = 'recibo' | 'promissoria' | 'carne' | 'duplicata';
export type MomentoDeEmissao = 'venda_a_prazo' | 'recebimento';

export interface RegraEmissao {
  modo: ModoEmissao;
  vias: number;
}

export type EmissaoDocumentos = Record<DocumentoDeCobranca, RegraEmissao>;

export const VIAS_MAXIMAS = 3;

export const EMISSAO_DOCUMENTOS_PADRAO: EmissaoDocumentos = {
  recibo: { modo: 'nunca', vias: 1 },
  promissoria: { modo: 'nunca', vias: 1 },
  carne: { modo: 'nunca', vias: 1 },
  duplicata: { modo: 'nunca', vias: 1 },
};

export const DOCUMENTOS_DE_COBRANCA: Array<{ chave: DocumentoDeCobranca; rotulo: string; quando: string; momento: MomentoDeEmissao }> = [
  { chave: 'recibo', rotulo: 'Recibo de pagamento', quando: 'Ao receber uma parcela ou título em Contas a Receber.', momento: 'recebimento' },
  { chave: 'promissoria', rotulo: 'Promissória', quando: 'Ao finalizar uma venda a prazo: uma por parcela, para o cliente assinar.', momento: 'venda_a_prazo' },
  { chave: 'carne', rotulo: 'Carnê de parcelas', quando: 'Ao finalizar uma venda a prazo: todas as parcelas, com canhoto destacável.', momento: 'venda_a_prazo' },
  { chave: 'duplicata', rotulo: 'Duplicata mercantil', quando: 'Ao finalizar uma venda a prazo para empresa (cliente com CNPJ): uma por parcela.', momento: 'venda_a_prazo' },
];

export const MODOS_DE_EMISSAO: Array<{ valor: ModoEmissao; rotulo: string }> = [
  { valor: 'nunca', rotulo: 'Não emitir' },
  { valor: 'perguntar', rotulo: 'Perguntar na hora' },
  { valor: 'sempre', rotulo: 'Emitir sempre' },
];

const modoValido = (valor: unknown): ModoEmissao => (valor === 'sempre' || valor === 'perguntar' ? valor : 'nunca');
const viasValidas = (valor: unknown): number => {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n >= 1 && n <= VIAS_MAXIMAS ? n : 1;
};

export const parseEmissaoDocumentos = (raw: unknown): EmissaoDocumentos => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const regra = (chave: DocumentoDeCobranca): RegraEmissao => {
    const v = (r[chave] && typeof r[chave] === 'object' ? r[chave] : {}) as Record<string, unknown>;
    return { modo: modoValido(v.modo), vias: viasValidas(v.vias) };
  };
  return { recibo: regra('recibo'), promissoria: regra('promissoria'), carne: regra('carne'), duplicata: regra('duplicata') };
};

/** O que emitir num momento: separa o que sai sempre do que pergunta. */
export const documentosParaMomento = (config: EmissaoDocumentos, momento: MomentoDeEmissao): { sempre: DocumentoDeCobranca[]; perguntar: DocumentoDeCobranca[] } => {
  const sempre: DocumentoDeCobranca[] = [];
  const perguntar: DocumentoDeCobranca[] = [];
  for (const d of DOCUMENTOS_DE_COBRANCA) {
    if (d.momento !== momento) continue;
    const modo = config[d.chave].modo;
    if (modo === 'sempre') sempre.push(d.chave);
    else if (modo === 'perguntar') perguntar.push(d.chave);
  }
  return { sempre, perguntar };
};

export const rotuloDoDocumento = (chave: DocumentoDeCobranca): string => DOCUMENTOS_DE_COBRANCA.find((d) => d.chave === chave)?.rotulo ?? chave;

// ---------------------------------------------------------------------------
// Valor por extenso (pt-BR)
// ---------------------------------------------------------------------------

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

const ateNovecentosENoventaENove = (n: number): string => {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r > 0) {
    if (r < 20) partes.push(UNIDADES[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
};

/** Numero inteiro por extenso, ate 999.999.999 (regra do "e" antes do ultimo grupo pequeno ou redondo). */
export const inteiroPorExtenso = (valor: number): string => {
  const n = Math.floor(Math.abs(Number(valor) || 0));
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const grupos: string[] = [];
  if (milhoes) grupos.push(milhoes === 1 ? 'um milhão' : `${ateNovecentosENoventaENove(milhoes)} milhões`);
  if (milhares) grupos.push(milhares === 1 ? 'mil' : `${ateNovecentosENoventaENove(milhares)} mil`);
  if (resto) grupos.push(ateNovecentosENoventaENove(resto));
  if (grupos.length === 1) return grupos[0];
  const ultimo = resto || milhares * 1000;
  const usaE = resto === 0 || resto < 100 || resto % 100 === 0;
  void ultimo;
  return usaE ? `${grupos.slice(0, -1).join(' ')} e ${grupos[grupos.length - 1]}` : grupos.join(' ');
};

/** "mil duzentos e trinta e quatro reais e cinquenta e seis centavos". */
export const valorPorExtenso = (centavos: number): string => {
  const total = Math.max(0, Math.round(Number(centavos) || 0));
  const reais = Math.floor(total / 100);
  const cents = total % 100;
  const partes: string[] = [];
  if (reais > 0) partes.push(`${inteiroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`);
  if (cents > 0) partes.push(`${inteiroPorExtenso(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`);
  if (partes.length === 0) return 'zero reais';
  return partes.join(' e ');
};

// ---------------------------------------------------------------------------
// Partes e formatacao
// ---------------------------------------------------------------------------

export interface ParteDocumento {
  nome: string;
  /** CPF/CNPJ formatado, ou '' quando nao ha. */
  documento: string;
  endereco: string;
  cidadeUf: string;
  telefone?: string;
}

export interface ParcelaDocumento {
  numero: number;
  total: number;
  /** AAAA-MM-DD */
  vencimento: string;
  valorCentavos: number;
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export const formatarDocumentoPessoa = (valor: unknown): string => {
  const d = soDigitos(valor);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return texto(valor);
};

export const ehCnpj = (valor: unknown): boolean => soDigitos(valor).length === 14;

export const formatarDataBr = (iso: unknown): string => {
  const t = texto(iso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
};

export const reaisFormatado = (centavos: number): string => (Math.round(Number(centavos) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const juntarEndereco = (rua: unknown, numero: unknown, bairro: unknown): string => {
  const partes = [texto(rua) + (texto(numero) ? `, ${texto(numero)}` : ''), texto(bairro)].filter(Boolean);
  return partes.join(' - ');
};

const juntarCidadeUf = (cidade: unknown, uf: unknown, cep: unknown): string => {
  const c = texto(cidade);
  const u = texto(uf).toUpperCase();
  const base = c && u ? `${c}/${u}` : c || u;
  const cepDigitos = soDigitos(cep);
  return cepDigitos.length === 8 ? `${base}${base ? ' - ' : ''}CEP ${cepDigitos.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : base;
};

/** A empresa (filial) a partir do documento de configuracao. */
export const emitenteDaConfiguracao = (config: unknown): ParteDocumento => {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  return {
    nome: (texto(c.razaoSocial) || texto(c.nomeOficina)).toUpperCase(),
    documento: formatarDocumentoPessoa(c.cnpj),
    endereco: juntarEndereco(c.rua || c.endereco, c.numero, c.bairro),
    cidadeUf: juntarCidadeUf(c.nfseCidadeNome || c.cidade, c.nfseCidadeEstado || c.uf, c.cep),
    telefone: texto(c.telefone),
  };
};

/** O cliente a partir do cadastro (clientes). */
export const parteDoCliente = (cliente: unknown, nomeFallback = ''): ParteDocumento => {
  const c = (cliente && typeof cliente === 'object' ? cliente : {}) as Record<string, unknown>;
  return {
    nome: (texto(c.nome) || texto(nomeFallback)).toUpperCase(),
    documento: formatarDocumentoPessoa(c.documento || c.cpfCnpj || c.cnpj || c.cpf),
    endereco: juntarEndereco(c.endereco || c.rua, c.numero, c.bairro),
    cidadeUf: juntarCidadeUf(c.cidade, c.estado || c.uf, c.cep),
    telefone: texto(c.telefone || c.celular),
  };
};

/** Parcelas da venda a partir do que a impressao do pedido ja' calcula (parcelasParaImpressao). */
export const parcelasDoPedido = (parcelas: Array<{ numero?: number; dataVencimento?: string; valor?: number; valorCentavos?: number }>): ParcelaDocumento[] => {
  const lista = (parcelas || []).filter((p) => (Number(p.valorCentavos ?? Math.round(Number(p.valor || 0) * 100)) || 0) > 0);
  return lista.map((p, i) => ({
    numero: Number(p.numero) || i + 1,
    total: lista.length,
    vencimento: texto(p.dataVencimento).slice(0, 10),
    valorCentavos: Number(p.valorCentavos ?? Math.round(Number(p.valor || 0) * 100)) || 0,
  }));
};

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

export interface VendaParaDocumentos {
  numeroPedido: string;
  /** AAAA-MM-DD */
  dataVenda: string;
  totalCentavos: number;
}

export interface PromissoriaDocumento {
  numero: string;
  vencimento: string;
  valorCentavos: number;
  valorExtenso: string;
  /** Quem deve (o cliente). */
  emitente: ParteDocumento;
  /** A quem se paga (a empresa). */
  beneficiario: ParteDocumento;
  praca: string;
  dataEmissao: string;
  referencia: string;
  mensagem: string;
}

export const montarPromissorias = (a: { venda: VendaParaDocumentos; parcelas: ParcelaDocumento[]; empresa: ParteDocumento; cliente: ParteDocumento; mensagem?: string }): PromissoriaDocumento[] => (
  a.parcelas.map((p) => ({
    numero: `${String(p.numero).padStart(2, '0')}/${String(p.total).padStart(2, '0')}`,
    vencimento: p.vencimento,
    valorCentavos: p.valorCentavos,
    valorExtenso: valorPorExtenso(p.valorCentavos),
    emitente: a.cliente,
    beneficiario: a.empresa,
    praca: a.empresa.cidadeUf.split(' - CEP')[0],
    dataEmissao: a.venda.dataVenda,
    referencia: `Pedido de venda nº ${a.venda.numeroPedido}`,
    mensagem: texto(a.mensagem),
  }))
);

export interface CarneDocumento {
  venda: VendaParaDocumentos;
  empresa: ParteDocumento;
  cliente: ParteDocumento;
  parcelas: ParcelaDocumento[];
  mensagem: string;
}

export const montarCarne = (a: { venda: VendaParaDocumentos; parcelas: ParcelaDocumento[]; empresa: ParteDocumento; cliente: ParteDocumento; mensagem?: string }): CarneDocumento => ({
  venda: a.venda, empresa: a.empresa, cliente: a.cliente, parcelas: a.parcelas, mensagem: texto(a.mensagem),
});

export interface DuplicataDocumento {
  /** Numero da duplicata: pedido/parcela (0079/01). */
  numero: string;
  /** Numero da fatura (o pedido). */
  fatura: string;
  valorFaturaCentavos: number;
  valorCentavos: number;
  valorExtenso: string;
  vencimento: string;
  dataEmissao: string;
  /** Quem deve (empresa compradora, CNPJ). */
  sacado: ParteDocumento;
  /** Quem emite (a filial). */
  sacador: ParteDocumento;
  praca: string;
}

export const montarDuplicatas = (a: { venda: VendaParaDocumentos; parcelas: ParcelaDocumento[]; empresa: ParteDocumento; cliente: ParteDocumento }): { ok: true; duplicatas: DuplicataDocumento[] } | { ok: false; erro: string } => {
  if (!ehCnpj(a.cliente.documento)) {
    return { ok: false, erro: `Duplicata mercantil só para cliente com CNPJ. ${a.cliente.nome || 'Este cliente'} está com ${a.cliente.documento ? 'CPF' : 'o documento em branco'} no cadastro; para pessoa física use a promissória ou o carnê.` };
  }
  return {
    ok: true,
    duplicatas: a.parcelas.map((p) => ({
      numero: `${a.venda.numeroPedido}/${String(p.numero).padStart(2, '0')}`,
      fatura: a.venda.numeroPedido,
      valorFaturaCentavos: a.venda.totalCentavos,
      valorCentavos: p.valorCentavos,
      valorExtenso: valorPorExtenso(p.valorCentavos),
      vencimento: p.vencimento,
      dataEmissao: a.venda.dataVenda,
      sacado: a.cliente,
      sacador: a.empresa,
      praca: a.empresa.cidadeUf.split(' - CEP')[0],
    })),
  };
};

export interface ReciboDocumento {
  numero: string;
  valorCentavos: number;
  valorExtenso: string;
  pagador: ParteDocumento;
  emitente: ParteDocumento;
  referente: string;
  formaPagamento: string;
  /** AAAA-MM-DD */
  data: string;
  acrescimoCentavos: number;
  mensagem: string;
}

export const montarRecibo = (a: {
  titulo: { id?: string; descricao?: string; valorCentavos?: number; valor?: number; formaPagamento?: string; dataPagamento?: string; numeroPedido?: string };
  acrescimoCentavos?: number;
  empresa: ParteDocumento;
  cliente: ParteDocumento;
  mensagem?: string;
}): ReciboDocumento => {
  const principal = Number(a.titulo.valorCentavos ?? Math.round(Number(a.titulo.valor || 0) * 100)) || 0;
  const acrescimo = Math.max(0, Math.round(Number(a.acrescimoCentavos) || 0));
  const total = principal + acrescimo;
  return {
    numero: texto(a.titulo.id).slice(-6).toUpperCase(),
    valorCentavos: total,
    valorExtenso: valorPorExtenso(total),
    pagador: a.cliente,
    emitente: a.empresa,
    referente: texto(a.titulo.descricao) || 'Pagamento',
    formaPagamento: texto(a.titulo.formaPagamento),
    data: texto(a.titulo.dataPagamento).slice(0, 10),
    acrescimoCentavos: acrescimo,
    mensagem: texto(a.mensagem),
  };
};

// ---------------------------------------------------------------------------
// Datas por extenso (para "Vitória/ES, 7 de outubro de 2026")
// ---------------------------------------------------------------------------

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "7 de outubro de 2026" (a data crua se nao for AAAA-MM-DD). */
export const dataPorExtenso = (iso: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(iso));
  if (!m) return texto(iso);
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
};

/** "Vitória/ES, 7 de outubro de 2026" -- a praca pode faltar. */
export const localEData = (praca: string, iso: unknown): string => [texto(praca), dataPorExtenso(iso)].filter(Boolean).join(', ');
