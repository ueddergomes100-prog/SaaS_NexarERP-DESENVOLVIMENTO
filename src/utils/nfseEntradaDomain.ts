/*
 * ENTRADA DE NFS-e (nota fiscal de SERVICO recebida -- servico tomado).
 * Pedido do dono, 27/10/2026: "precisamos habilitar o sistema para entrar com
 * nota fiscal de servico".
 *
 * A NFS-e nao tem item de estoque: o que importa e' o registro da nota (para o
 * contador), as retencoes (ISS retido, IR, PIS, COFINS, CSLL, INSS) e a conta a
 * pagar ao prestador, que e' o VALOR LIQUIDO (servico - desconto incondicionado
 * - retencoes). As retencoes a empresa recolhe por guia propria, nao paga ao
 * prestador.
 *
 * Fica na mesma colecao da entrada de NF-e (`notas_fiscais_entrada`), marcada
 * com `tipoDocumento: 'nfse'` e sem itens -- assim o historico, a exclusao (que
 * cancela os titulos) e as regras do banco valem sem mudanca. Quem le a colecao
 * esperando mercadoria (Precificacao, Etiquetas) pula a NFS-e.
 *
 * Le dois formatos de XML:
 *  - NFS-e Nacional (padrao do Ambiente Nacional, obrigatorio desde 2026):
 *    NFSe/infNFSe com a DPS dentro;
 *  - ABRASF (padrao municipal, versoes 1 e 2): CompNfse/Nfse/InfNfse.
 * Sem XML (prestador mandou so' o PDF), a nota e' digitada.
 *
 * Puro: sem tela, sem Firestore.
 */

import { descendente, lerXml, textoDe, type NoXml } from './xmlSimplesDomain';

export type PadraoNfse = 'nacional' | 'abrasf' | 'manual';

export interface RetencoesNfse {
  irrf: number;
  pis: number;
  cofins: number;
  csll: number;
  inss: number;
  /** "Outras retencoes" do ABRASF, ou retencao federal que o XML nacional nao separa. */
  outras: number;
}

export interface NfseEntrada {
  padrao: PadraoNfse;
  numero: string;
  /** Chave de acesso da NFS-e Nacional (50 digitos). Vazia no ABRASF e na digitada. */
  chaveAcesso: string;
  codigoVerificacao: string;
  /** AAAA-MM-DD */
  dataEmissao: string;
  /** AAAA-MM-DD (mes de competencia do servico). */
  competencia: string;
  prestadorDocumento: string;
  prestadorNome: string;
  prestadorInscricaoMunicipal: string;
  /** CPF/CNPJ do tomador que esta no XML (confere com a empresa). */
  tomadorDocumento: string;
  /** Municipio da prestacao: nome (nacional) ou codigo IBGE (ABRASF). */
  municipioPrestacao: string;
  /** Codigo do servico: tributacao nacional (cTribNac) ou item da lista da LC 116. */
  codigoServico: string;
  descricaoServico: string;
  valorServicos: number;
  descontoIncondicionado: number;
  deducoes: number;
  baseIss: number;
  /** Aliquota do ISS em % (5 = 5%). */
  aliquotaIss: number;
  valorIss: number;
  issRetido: boolean;
  retencoes: RetencoesNfse;
  /** Valor liquido a pagar ao prestador. */
  valorLiquido: number;
}

export const RETENCOES_ZERADAS: RetencoesNfse = { irrf: 0, pis: 0, cofins: 0, csll: 0, inss: 0, outras: 0 };

export const NFSE_EM_BRANCO: NfseEntrada = {
  padrao: 'manual',
  numero: '',
  chaveAcesso: '',
  codigoVerificacao: '',
  dataEmissao: '',
  competencia: '',
  prestadorDocumento: '',
  prestadorNome: '',
  prestadorInscricaoMunicipal: '',
  tomadorDocumento: '',
  municipioPrestacao: '',
  codigoServico: '',
  descricaoServico: '',
  valorServicos: 0,
  descontoIncondicionado: 0,
  deducoes: 0,
  baseIss: 0,
  aliquotaIss: 0,
  valorIss: 0,
  issRetido: false,
  retencoes: { ...RETENCOES_ZERADAS },
  valorLiquido: 0,
};

const centavos = (v: number): number => Math.round((Number(v) || 0) * 100);
const reais = (c: number): number => c / 100;
const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Texto do primeiro descendente com algum destes nomes. */
const achar = (no: NoXml | undefined, ...nomes: string[]): string => {
  for (const nome of nomes) {
    const t = descendente(no, nome)?.texto ?? '';
    if (t) return t;
  }
  return '';
};
const numeroAchado = (no: NoXml | undefined, ...nomes: string[]): number => {
  const n = Number(achar(no, ...nomes).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
/** "2026-10-20T10:00:00-03:00" ou "2026-10" -> AAAA-MM-DD. */
const dataDoXml = (texto: string): string => {
  const t = texto.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  return '';
};

/** Soma das retencoes (sem o ISS). */
export const totalDasRetencoesFederais = (r: RetencoesNfse): number => reais(
  centavos(r.irrf) + centavos(r.pis) + centavos(r.cofins) + centavos(r.csll) + centavos(r.inss) + centavos(r.outras),
);

/** ISS retido pelo tomador (0 quando nao retido). */
export const issRetidoValor = (n: Pick<NfseEntrada, 'issRetido' | 'valorIss'>): number => (n.issRetido ? n.valorIss : 0);

/** Servico - desconto incondicionado - ISS retido - retencoes federais. */
export const calcularValorLiquido = (n: Pick<NfseEntrada, 'valorServicos' | 'descontoIncondicionado' | 'issRetido' | 'valorIss' | 'retencoes'>): number => reais(
  centavos(n.valorServicos) - centavos(n.descontoIncondicionado) - centavos(issRetidoValor(n)) - centavos(totalDasRetencoesFederais(n.retencoes)),
);

// ---------------------------------------------------------------------------
// Leitura do XML
// ---------------------------------------------------------------------------

const lerNacional = (infNfse: NoXml): NfseEntrada => {
  const dps = descendente(infNfse, 'infDPS');
  const emit = descendente(infNfse, 'emit');
  const prest = descendente(dps, 'prest');
  const toma = descendente(dps, 'toma');
  const valoresNfse = infNfse.filhos.find((f) => f.nome === 'valores');
  const valoresDps = dps?.filhos.find((f) => f.nome === 'valores');
  const tribMun = descendente(valoresDps, 'tribMun');
  const tribFed = descendente(valoresDps, 'tribFed');
  const piscofins = descendente(tribFed, 'piscofins');

  const valorServicos = numeroAchado(valoresDps, 'vServ');
  const valorIss = numeroAchado(valoresNfse, 'vISSQN') || numeroAchado(tribMun, 'vISSQN');
  // tpRetISSQN: 1 = nao retido; 2 = retido pelo tomador; 3 = retido pelo intermediario.
  const issRetido = ['2', '3'].includes(achar(tribMun, 'tpRetISSQN'));
  const irrf = numeroAchado(tribFed, 'vRetIRRF');
  const csll = numeroAchado(tribFed, 'vRetCSLL');
  const inss = numeroAchado(tribFed, 'vRetCP');
  const vPis = numeroAchado(piscofins, 'vPis');
  const vCofins = numeroAchado(piscofins, 'vCofins');
  // PIS/COFINS retidos: o codigo de retencao mudou entre versoes do leiaute, entao
  // vale o total retido que a propria NFS-e calcula (vTotalRet) menos o resto.
  const totalRetido = numeroAchado(valoresNfse, 'vTotalRet');
  let pis = 0; let cofins = 0; let outras = 0;
  if (totalRetido > 0) {
    const restoCentavos = centavos(totalRetido) - centavos(issRetido ? valorIss : 0) - centavos(irrf) - centavos(csll) - centavos(inss);
    if (restoCentavos > 0) {
      if (vPis + vCofins > 0 && Math.abs(centavos(vPis + vCofins) - restoCentavos) <= 1) {
        pis = vPis; cofins = vCofins;
      } else {
        outras = reais(restoCentavos);
      }
    }
  } else if (achar(piscofins, 'tpRetPisCofins') === '1') {
    pis = vPis; cofins = vCofins;
  }
  const retencoes: RetencoesNfse = { irrf, pis, cofins, csll, inss, outras };
  const nota: NfseEntrada = {
    padrao: 'nacional',
    numero: achar(infNfse, 'nNFSe').replace(/^0+(?=\d)/, ''),
    chaveAcesso: soDigitos(infNfse.atributos.Id),
    codigoVerificacao: '',
    dataEmissao: dataDoXml(achar(dps, 'dhEmi')) || dataDoXml(achar(infNfse, 'dhProc')),
    competencia: dataDoXml(achar(dps, 'dCompet')),
    prestadorDocumento: soDigitos(achar(emit, 'CNPJ', 'CPF') || achar(prest, 'CNPJ', 'CPF')),
    prestadorNome: achar(emit, 'xNome') || achar(prest, 'xNome'),
    prestadorInscricaoMunicipal: achar(emit, 'IM') || achar(prest, 'IM'),
    tomadorDocumento: soDigitos(achar(toma, 'CNPJ', 'CPF')),
    municipioPrestacao: achar(infNfse, 'xLocPrestacao') || achar(dps, 'cLocPrestacao'),
    codigoServico: achar(dps, 'cTribNac'),
    descricaoServico: achar(dps, 'xDescServ') || achar(infNfse, 'xTribNac'),
    valorServicos,
    descontoIncondicionado: numeroAchado(valoresDps, 'vDescIncond'),
    deducoes: numeroAchado(valoresDps, 'vDR'),
    baseIss: numeroAchado(valoresNfse, 'vBC'),
    aliquotaIss: numeroAchado(valoresNfse, 'pAliqAplic') || numeroAchado(tribMun, 'pAliq'),
    valorIss,
    issRetido,
    retencoes,
    valorLiquido: 0,
  };
  nota.valorLiquido = numeroAchado(valoresNfse, 'vLiq') || calcularValorLiquido(nota);
  return nota;
};

const lerAbrasf = (infNfse: NoXml): NfseEntrada => {
  const prestador = descendente(infNfse, 'PrestadorServico') || descendente(infNfse, 'Prestador');
  const tomador = descendente(infNfse, 'TomadorServico') || descendente(infNfse, 'Tomador');
  const valorServicos = numeroAchado(infNfse, 'ValorServicos');
  const baseIss = numeroAchado(infNfse, 'BaseCalculo');
  const valorIss = numeroAchado(infNfse, 'ValorIss');
  // ABRASF 1: aliquota em fracao (0.05); ABRASF 2: em % (5.00).
  let aliquotaIss = numeroAchado(infNfse, 'Aliquota');
  if (aliquotaIss > 0 && aliquotaIss < 1 && baseIss > 0 && Math.abs(baseIss * aliquotaIss - valorIss) < 0.02) aliquotaIss = Math.round(aliquotaIss * 10000) / 100;
  // IssRetido: 1 = sim, 2 = nao. ValorPis/Cofins/Inss/Ir/Csll no ABRASF sao as retencoes.
  const issRetido = achar(infNfse, 'IssRetido') === '1';
  const retencoes: RetencoesNfse = {
    irrf: numeroAchado(infNfse, 'ValorIr'),
    pis: numeroAchado(infNfse, 'ValorPis'),
    cofins: numeroAchado(infNfse, 'ValorCofins'),
    csll: numeroAchado(infNfse, 'ValorCsll'),
    inss: numeroAchado(infNfse, 'ValorInss'),
    outras: numeroAchado(infNfse, 'OutrasRetencoes'),
  };
  const nota: NfseEntrada = {
    padrao: 'abrasf',
    // Filho direto primeiro: "Numero" e "DataEmissao" tambem existem dentro do RPS e do endereco.
    numero: (textoDe(infNfse, 'Numero') || achar(infNfse, 'Numero')).replace(/^0+(?=\d)/, ''),
    chaveAcesso: '',
    codigoVerificacao: textoDe(infNfse, 'CodigoVerificacao') || achar(infNfse, 'CodigoVerificacao'),
    dataEmissao: dataDoXml(textoDe(infNfse, 'DataEmissao') || achar(infNfse, 'DataEmissao')),
    competencia: dataDoXml(textoDe(infNfse, 'Competencia') || achar(infNfse, 'Competencia')),
    prestadorDocumento: soDigitos(achar(prestador, 'Cnpj', 'Cpf')),
    prestadorNome: achar(prestador, 'RazaoSocial', 'NomeFantasia'),
    prestadorInscricaoMunicipal: achar(prestador, 'InscricaoMunicipal'),
    tomadorDocumento: soDigitos(achar(tomador, 'Cnpj', 'Cpf')),
    municipioPrestacao: achar(infNfse, 'MunicipioIncidencia', 'MunicipioPrestacaoServico', 'CodigoMunicipio'),
    codigoServico: achar(infNfse, 'ItemListaServico', 'CodigoTributacaoMunicipio'),
    descricaoServico: achar(infNfse, 'Discriminacao'),
    valorServicos,
    descontoIncondicionado: numeroAchado(infNfse, 'DescontoIncondicionado'),
    deducoes: numeroAchado(infNfse, 'ValorDeducoes'),
    baseIss,
    aliquotaIss,
    valorIss,
    issRetido,
    retencoes,
    valorLiquido: 0,
  };
  nota.valorLiquido = numeroAchado(infNfse, 'ValorLiquidoNfse') || calcularValorLiquido(nota);
  return nota;
};

export type LeituraNfse = { ok: true; nota: NfseEntrada } | { ok: false; erro: string };

/** Le o XML de uma NFS-e recebida (Nacional ou ABRASF). */
export const lerNfseXml = (xml: string): LeituraNfse => {
  let raiz: NoXml;
  try {
    raiz = lerXml(xml);
  } catch {
    return { ok: false, erro: 'O arquivo não é um XML válido. Baixe de novo o XML da NFS-e no portal da prefeitura ou no portal nacional (nfse.gov.br).' };
  }
  const nacional = raiz.nome === 'infNFSe' ? raiz : descendente(raiz, 'infNFSe');
  if (nacional) return { ok: true, nota: lerNacional(nacional) };
  const abrasf = raiz.nome === 'InfNfse' ? raiz : descendente(raiz, 'InfNfse');
  if (abrasf) return { ok: true, nota: lerAbrasf(abrasf) };
  if (raiz.nome === 'nfeProc' || raiz.nome === 'NFe' || descendente(raiz, 'infNFe')) {
    return { ok: false, erro: 'Este XML é de uma NF-e (nota de mercadoria). Lance em Fiscal › Entrada de XML.' };
  }
  if (raiz.nome === 'DPS' || descendente(raiz, 'infDPS')) {
    return { ok: false, erro: 'Este XML é a DPS (o pedido de emissão), não a NFS-e autorizada. Peça ao prestador o XML da NFS-e, ou baixe em nfse.gov.br.' };
  }
  return { ok: false, erro: 'Não reconheci este XML como NFS-e (nem do padrão nacional nem do ABRASF). Lance a nota digitando os dados.' };
};

// ---------------------------------------------------------------------------
// Conferencia antes de lancar
// ---------------------------------------------------------------------------

export interface ConferenciaNfse {
  /** Impede lancar. */
  erros: string[];
  /** Pede atencao, nao impede. */
  avisos: string[];
}

const formatarReais = (v: number): string => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const conferirNfse = (n: NfseEntrada, documentoDaEmpresa = ''): ConferenciaNfse => {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (!n.numero.trim()) erros.push('Informe o número da NFS-e.');
  if (!DATA_ISO.test(n.dataEmissao)) erros.push('Informe a data de emissão da NFS-e.');
  if (n.competencia && !DATA_ISO.test(n.competencia)) erros.push('A competência está inválida. Informe o mês do serviço.');
  const doc = soDigitos(n.prestadorDocumento);
  if (doc.length !== 11 && doc.length !== 14) erros.push('Informe o CNPJ (14 dígitos) ou CPF (11 dígitos) do prestador.');
  if (!n.prestadorNome.trim()) erros.push('Informe o nome do prestador.');
  if (!(n.valorServicos > 0)) erros.push('Informe o valor dos serviços.');
  const negativos = [n.descontoIncondicionado, n.deducoes, n.baseIss, n.aliquotaIss, n.valorIss, ...Object.values(n.retencoes)].some((v) => v < 0);
  if (negativos) erros.push('Nenhum valor da nota pode ser negativo.');
  if (n.aliquotaIss > 5.0001) avisos.push(`A alíquota do ISS está em ${formatarReais(n.aliquotaIss)}%; o máximo da lei é 5%. Confira.`);
  if (n.issRetido && !(n.valorIss > 0)) erros.push('O ISS está marcado como retido, mas o valor do ISS está zerado. Informe o valor ou desmarque a retenção.');
  const calculado = calcularValorLiquido(n);
  if (calculado < 0) erros.push('O desconto e as retenções passam do valor dos serviços. Confira os valores.');
  if (!(n.valorLiquido > 0) && calculado >= 0) erros.push('O valor líquido a pagar ao prestador ficou zerado. Confira os valores.');
  if (n.valorLiquido > 0 && Math.abs(centavos(n.valorLiquido) - centavos(calculado)) > 1) {
    avisos.push(`O valor líquido da nota (R$ ${formatarReais(n.valorLiquido)}) não bate com a conta serviço − desconto − retenções (R$ ${formatarReais(calculado)}). Vale o da nota; confira com o prestador.`);
  }
  const empresa = soDigitos(documentoDaEmpresa);
  const tomador = soDigitos(n.tomadorDocumento);
  if (empresa && tomador && empresa !== tomador) {
    avisos.push(`Esta NFS-e foi emitida para outro CPF/CNPJ (${tomador}), não para a empresa (${empresa}). Confira se é nota desta empresa.`);
  }
  return { erros, avisos };
};

/** Descricao do titulo a pagar da NFS-e. */
export const descricaoDoTituloDaNfse = (numero: string, prestador: string, parcela?: { indice: number; total: number }): string => (
  `SERVIÇO NFS-e ${numero} - ${prestador}${parcela && parcela.total > 1 ? ` (Parcela ${parcela.indice + 1}/${parcela.total})` : ''}`
);

/** Bloco `servico` gravado na nota de entrada (sem undefined). */
export const servicoParaGravar = (n: NfseEntrada) => ({
  padrao: n.padrao,
  codigoVerificacao: n.codigoVerificacao.trim(),
  competencia: n.competencia,
  prestadorInscricaoMunicipal: n.prestadorInscricaoMunicipal.trim(),
  tomadorDocumento: soDigitos(n.tomadorDocumento),
  municipioPrestacao: n.municipioPrestacao.trim(),
  codigoServico: n.codigoServico.trim(),
  descricao: n.descricaoServico.trim(),
  valorServicos: n.valorServicos,
  descontoIncondicionado: n.descontoIncondicionado,
  deducoes: n.deducoes,
  baseIss: n.baseIss,
  aliquotaIss: n.aliquotaIss,
  valorIss: n.valorIss,
  issRetido: n.issRetido,
  retencoes: { ...n.retencoes },
  valorLiquido: n.valorLiquido,
});

/** A nota de entrada e' uma NFS-e (servico tomado)? */
export const ehNfseDeEntrada = (dados: { tipoDocumento?: unknown } | null | undefined): boolean => dados?.tipoDocumento === 'nfse';
