/**
 * NF-e DE EXPORTACAO (27/10/2026, primeira exportacao de um cliente).
 *
 * O que muda numa nota para o exterior:
 *  - DESTINATARIO: cliente do exterior nao tem CPF/CNPJ nem IE. Vai o documento
 *    estrangeiro [idEstrangeiro] (passaporte, tax id da empresa) e o endereco
 *    com o PAIS (ISO 3166 de 3 letras, que a Spedy converte para o codigo do
 *    BACEN) e o municipio padrao da NF-e para o exterior: codigo 9999999,
 *    "EXTERIOR", UF "EX". A cidade de verdade vai no complemento.
 *  - ITENS: CFOP de exportacao (7.101 / 7.102); a unidade tributavel vira KG
 *    (fiscalDomain.resolveInvoiceUnitFields, ja existente).
 *  - GRUPO DE EXPORTACAO [exporta]: UF e local de embarque / despacho.
 *
 * Travas (cadastro errado nao sai calado, regra 1 do CLAUDE.md):
 *  - CFOP de exportacao com cliente do Brasil -> bloqueia;
 *  - cliente do exterior com item sem CFOP de exportacao -> bloqueia;
 *  - sem UF ou local de embarque -> bloqueia.
 *
 * O CST/CSOSN de ICMS, PIS e COFINS do item na exportacao (imunidade) e' do
 * contador -- a tela da nota lembra disso, nao escolhe sozinha.
 */

/** Pais ISO 3166-1 alfa-3 -> nome em portugues (o que aparece na tela). */
export const PAISES: ReadonlyArray<{ codigo: string; nome: string }> = [
  { codigo: 'ZAF', nome: 'África do Sul' },
  { codigo: 'DEU', nome: 'Alemanha' },
  { codigo: 'AGO', nome: 'Angola' },
  { codigo: 'SAU', nome: 'Arábia Saudita' },
  { codigo: 'DZA', nome: 'Argélia' },
  { codigo: 'ARG', nome: 'Argentina' },
  { codigo: 'AUS', nome: 'Austrália' },
  { codigo: 'AUT', nome: 'Áustria' },
  { codigo: 'BEL', nome: 'Bélgica' },
  { codigo: 'BOL', nome: 'Bolívia' },
  { codigo: 'CPV', nome: 'Cabo Verde' },
  { codigo: 'CAN', nome: 'Canadá' },
  { codigo: 'QAT', nome: 'Catar' },
  { codigo: 'CHL', nome: 'Chile' },
  { codigo: 'CHN', nome: 'China' },
  { codigo: 'COL', nome: 'Colômbia' },
  { codigo: 'KOR', nome: 'Coreia do Sul' },
  { codigo: 'CRI', nome: 'Costa Rica' },
  { codigo: 'CUB', nome: 'Cuba' },
  { codigo: 'DNK', nome: 'Dinamarca' },
  { codigo: 'EGY', nome: 'Egito' },
  { codigo: 'SLV', nome: 'El Salvador' },
  { codigo: 'ARE', nome: 'Emirados Árabes Unidos' },
  { codigo: 'ECU', nome: 'Equador' },
  { codigo: 'ESP', nome: 'Espanha' },
  { codigo: 'USA', nome: 'Estados Unidos' },
  { codigo: 'FIN', nome: 'Finlândia' },
  { codigo: 'FRA', nome: 'França' },
  { codigo: 'GHA', nome: 'Gana' },
  { codigo: 'GRC', nome: 'Grécia' },
  { codigo: 'GTM', nome: 'Guatemala' },
  { codigo: 'GUY', nome: 'Guiana' },
  { codigo: 'GUF', nome: 'Guiana Francesa' },
  { codigo: 'HTI', nome: 'Haiti' },
  { codigo: 'NLD', nome: 'Holanda (Países Baixos)' },
  { codigo: 'HND', nome: 'Honduras' },
  { codigo: 'HKG', nome: 'Hong Kong' },
  { codigo: 'HUN', nome: 'Hungria' },
  { codigo: 'IND', nome: 'Índia' },
  { codigo: 'IDN', nome: 'Indonésia' },
  { codigo: 'IRN', nome: 'Irã' },
  { codigo: 'IRL', nome: 'Irlanda' },
  { codigo: 'ISR', nome: 'Israel' },
  { codigo: 'ITA', nome: 'Itália' },
  { codigo: 'JPN', nome: 'Japão' },
  { codigo: 'LBN', nome: 'Líbano' },
  { codigo: 'LUX', nome: 'Luxemburgo' },
  { codigo: 'MYS', nome: 'Malásia' },
  { codigo: 'MAR', nome: 'Marrocos' },
  { codigo: 'MEX', nome: 'México' },
  { codigo: 'MOZ', nome: 'Moçambique' },
  { codigo: 'NIC', nome: 'Nicarágua' },
  { codigo: 'NGA', nome: 'Nigéria' },
  { codigo: 'NOR', nome: 'Noruega' },
  { codigo: 'NZL', nome: 'Nova Zelândia' },
  { codigo: 'PAN', nome: 'Panamá' },
  { codigo: 'PRY', nome: 'Paraguai' },
  { codigo: 'PER', nome: 'Peru' },
  { codigo: 'POL', nome: 'Polônia' },
  { codigo: 'PRT', nome: 'Portugal' },
  { codigo: 'KEN', nome: 'Quênia' },
  { codigo: 'GBR', nome: 'Reino Unido' },
  { codigo: 'DOM', nome: 'República Dominicana' },
  { codigo: 'CZE', nome: 'República Tcheca' },
  { codigo: 'ROU', nome: 'Romênia' },
  { codigo: 'RUS', nome: 'Rússia' },
  { codigo: 'SEN', nome: 'Senegal' },
  { codigo: 'SGP', nome: 'Singapura' },
  { codigo: 'SWE', nome: 'Suécia' },
  { codigo: 'CHE', nome: 'Suíça' },
  { codigo: 'SUR', nome: 'Suriname' },
  { codigo: 'THA', nome: 'Tailândia' },
  { codigo: 'TWN', nome: 'Taiwan' },
  { codigo: 'TTO', nome: 'Trinidad e Tobago' },
  { codigo: 'TUR', nome: 'Turquia' },
  { codigo: 'UKR', nome: 'Ucrânia' },
  { codigo: 'URY', nome: 'Uruguai' },
  { codigo: 'VEN', nome: 'Venezuela' },
  { codigo: 'VNM', nome: 'Vietnã' },
];

/** Municipio da NF-e para destinatario no exterior [cMun/xMun/UF]. */
export const MUNICIPIO_EXTERIOR = { code: 9999999, name: 'EXTERIOR', state: 'EX' } as const;

export const nomeDoPais = (codigo: string | null | undefined): string => {
  const c = String(codigo ?? '').trim().toUpperCase();
  return PAISES.find((p) => p.codigo === c)?.nome || c;
};

const ehCodigoDePais = (codigo: string): boolean => /^[A-Z]{3}$/.test(codigo) && codigo !== 'BRA';

/** Documento estrangeiro: letras, numeros e os separadores comuns; ate' 20 (limite do idEstrangeiro). */
export const normalizarDocumentoEstrangeiro = (v: unknown): string =>
  String(v ?? '').toUpperCase().replace(/[^A-Z0-9./-]/g, '').slice(0, 20);

/** O que o cadastro do cliente guarda para quem e' do exterior. */
export interface ClienteDoExterior {
  estrangeiro?: boolean;
  pais?: string;
  documentoEstrangeiro?: string;
}

/** Codigo ISO do pais quando o cliente e' do exterior; '' = Brasil. */
export const paisDoCliente = (c: ClienteDoExterior | null | undefined): string => {
  if (!c || c.estrangeiro !== true) return '';
  const pais = String(c.pais ?? '').trim().toUpperCase();
  return ehCodigoDePais(pais) ? pais : '';
};

/**
 * Conferencia do cadastro do cliente do exterior na hora de salvar. Devolve a
 * mensagem do que falta, ou null.
 */
export const erroDoCadastroExterior = (c: ClienteDoExterior & { endereco?: string; cidade?: string }): string | null => {
  if (c.estrangeiro !== true) return null;
  if (!ehCodigoDePais(String(c.pais ?? '').trim().toUpperCase())) return 'Escolha o país do cliente do exterior.';
  if (!normalizarDocumentoEstrangeiro(c.documentoEstrangeiro)) {
    return 'Informe o documento do cliente do exterior (passaporte ou o número de registro da empresa no país dela). Ele vai na nota fiscal no lugar do CPF/CNPJ.';
  }
  if (!String(c.endereco ?? '').trim() || !String(c.cidade ?? '').trim()) {
    return 'Informe o endereço e a cidade do cliente do exterior. Eles vão na nota fiscal de exportação.';
  }
  return null;
};

/** Destinatario [dest] da NF-e (receiver da Spedy). */
export interface FormDestinatario {
  clienteNome: string;
  documento: string;
  email?: string;
  rua: string;
  numero: string;
  bairro: string;
  cep: string;
  cidade: string;
  estado: string;
  codigoIbge: string;
  /** ISO-3 do pais; '' = Brasil. */
  pais?: string;
}

export const destinatarioDaNota = (f: FormDestinatario, stateTaxNumber?: string): Record<string, unknown> => {
  const pais = String(f.pais ?? '').trim().toUpperCase();
  if (ehCodigoDePais(pais)) {
    const cidade = String(f.cidade ?? '').trim();
    return {
      name: f.clienteNome,
      federalTaxNumber: normalizarDocumentoEstrangeiro(f.documento),
      ...(f.email ? { email: f.email } : {}),
      address: {
        street: f.rua,
        number: f.numero || 'S/N',
        district: f.bairro || 'EXTERIOR',
        ...(cidade ? { additionalInformation: cidade.slice(0, 150) } : {}),
        country: pais,
        city: { ...MUNICIPIO_EXTERIOR },
      },
    };
  }
  return {
    name: f.clienteNome,
    federalTaxNumber: f.documento.replace(/\D/g, ''),
    ...(stateTaxNumber ? { stateTaxNumber } : {}),
    email: f.email || undefined,
    address: {
      street: f.rua,
      number: f.numero,
      district: f.bairro,
      postalCode: f.cep.replace(/\D/g, ''),
      city: { code: f.codigoIbge, name: f.cidade, state: f.estado },
    },
  };
};

/**
 * Campos do endereco que faltam para emitir a NF-e (vazio = completo). Cliente
 * do exterior nao tem CEP nem codigo IBGE -- o municipio e' o "EXTERIOR".
 */
export const camposFaltandoNoEndereco = (f: FormDestinatario): string[] => {
  if (ehCodigoDePais(String(f.pais ?? '').trim().toUpperCase())) {
    return [
      !f.rua && 'Endereço',
      !f.cidade && 'Cidade',
    ].filter((x): x is string => Boolean(x));
  }
  return [
    !f.rua && 'Endereço', !f.numero && 'Número', !f.bairro && 'Bairro', !f.cep && 'CEP',
    !f.cidade && 'Cidade', !f.estado && 'Estado', !f.codigoIbge && 'Código IBGE da cidade',
  ].filter((x): x is string => Boolean(x));
};

const cfopDeExportacao = (cfop: unknown): boolean => /^7/.test(String(cfop ?? '').replace(/\D/g, ''));

/**
 * CFOP de exportacao equivalente ao de venda do cadastro do produto: x101
 * (producao propria) -> 7101, x102 (revenda) -> 7102 -- igual ao 5xxx -> 6xxx
 * da venda para outro estado. Outro CFOP fica como esta' (e a nota barra
 * pedindo o CFOP de exportacao na aba Produtos).
 */
export const cfopDeExportacaoSugerido = (cfop: unknown): string => {
  const c = String(cfop ?? '').replace(/\D/g, '');
  if (/^[56]101$/.test(c)) return '7101';
  if (/^[56]102$/.test(c)) return '7102';
  return String(cfop ?? '');
};

/**
 * Texto legal das informacoes complementares [infCpl] na exportacao -- o
 * mesmo que o ERP anterior do cliente ja' imprimia na venda a trading.
 * Itens ja' montados (cfop numerico e taxes.ipi.cst). Vazio = nao e' exportacao.
 */
export const textoLegalDaExportacao = (itens: ReadonlyArray<Record<string, unknown>>): string => {
  const cfops = itens.map((it) => String(it.cfop ?? '').replace(/\D/g, ''));
  const fimEspecifico = cfops.some((c) => /^[56]50[12]$/.test(c));
  const direta = cfops.some((c) => /^7/.test(c));
  if (!fimEspecifico && !direta) return '';
  const ipiSuspenso = itens.some((it) => Number(((it.taxes || {}) as { ipi?: { cst?: number } }).ipi?.cst) === 55);
  return [
    fimEspecifico ? 'Remessa com fim específico de exportação.' : '',
    `ICMS: não incidência conforme art. 3º, II${fimEspecifico ? ', e parágrafo único, II,' : ','} da Lei Complementar 87/1996.`,
    ipiSuspenso ? 'IPI suspenso conforme o Regulamento do IPI.' : '',
  ].filter(Boolean).join(' ');
};

export const UFS_EMBARQUE =['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const;

export type ResultadoExportacao =
  | { ok: true; exportacao: boolean; exportation?: { state: string; departureLocation: string } }
  | { ok: false; erro: string };

/**
 * Confere a nota de exportacao e monta o grupo [exporta]. Nota que nao e' de
 * exportacao (cliente do Brasil e nenhum CFOP 7xxx) devolve exportacao=false.
 */
export const montarExportacaoDaNota = (a: {
  clienteNome: string;
  /** ISO-3 do pais do cliente; '' = Brasil. */
  pais: string;
  cfops: ReadonlyArray<unknown>;
  ufEmbarque: string;
  localEmbarque: string;
}): ResultadoExportacao => {
  const doExterior = ehCodigoDePais(String(a.pais ?? '').trim().toUpperCase());
  const deExportacao = a.cfops.filter(cfopDeExportacao).length;
  const quem = a.clienteNome ? `"${a.clienteNome}"` : 'o cliente';
  if (!doExterior && deExportacao === 0) return { ok: true, exportacao: false };
  if (!doExterior) {
    return {
      ok: false,
      erro: `A nota tem item com CFOP de exportação (7.xxx), mas ${quem} é do Brasil. Para exportar, marque "Cliente do exterior" no cadastro do cliente (Cadastros → Clientes) e informe país e documento; se a venda é no Brasil, troque o CFOP do item na aba Produtos da nota.`,
    };
  }
  if (deExportacao !== a.cfops.length) {
    return {
      ok: false,
      erro: `${quem} é do exterior: todos os itens da nota precisam de CFOP de exportação (7.101 para produção própria, 7.102 para revenda). Troque o CFOP na aba Produtos da nota (confirme com o contador).`,
    };
  }
  const uf = String(a.ufEmbarque ?? '').trim().toUpperCase();
  const local = String(a.localEmbarque ?? '').trim();
  if (!(UFS_EMBARQUE as readonly string[]).includes(uf) || !local) {
    return {
      ok: false,
      erro: 'Nota de exportação: informe a UF e o local de embarque (porto, aeroporto ou fronteira por onde a mercadoria sai do país) no quadro "Exportação" da nota.',
    };
  }
  return { ok: true, exportacao: true, exportation: { state: uf.toLowerCase(), departureLocation: local.slice(0, 60) } };
};
