import { getServiceTotal } from './osServicePricing';

export type RegimeTributario = 'simples_nacional' | 'lucro_presumido' | 'lucro_real';

export const REGIME_TRIBUTARIO_OPTIONS: Array<{ value: RegimeTributario; label: string }> = [
  { value: 'simples_nacional', label: 'Simples Nacional' },
  { value: 'lucro_presumido', label: 'Lucro Presumido' },
  { value: 'lucro_real', label: 'Lucro Real' },
];

export const DEFAULT_REGIME_TRIBUTARIO: RegimeTributario = 'simples_nacional';

/** Simples Nacional tributa por CSOSN; Lucro Presumido/Real usam CST real
 * + aliquotas efetivas de ICMS/PIS/COFINS. Consumido pelas fatias
 * seguintes do modulo fiscal (cadastro de produto e emissao de NF-e). */
export const usesCsosn = (regime: RegimeTributario): boolean => regime === 'simples_nacional';

/** CSOSN (Simples Nacional) -- distinto do CST de ICMS (ICMS_CST_OPTIONS,
 * Lucro Presumido/Real). Centralizado aqui (antes vivia so como const
 * privada em EstoqueForm.tsx) pra Entrada de NF-e (F22) reusar a mesma
 * lista sem duplicar. */
export const CSOSN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '101', label: '101 - Tributada pelo Simples Nacional com crédito' },
  { value: '102', label: '102 - Tributada pelo Simples Nacional sem crédito' },
  { value: '103', label: '103 - Isenção por faixa de receita bruta' },
  { value: '201', label: '201 - Simples Nacional com ST e crédito' },
  { value: '202', label: '202 - Simples Nacional com ST sem crédito' },
  { value: '400', label: '400 - Não tributada pelo Simples Nacional' },
  { value: '500', label: '500 - ICMS cobrado anteriormente por ST' },
  { value: '900', label: '900 - Outros' },
];

/** CST de ICMS (tabela real, usada por Lucro Presumido/Real) -- distinta
 * do CSOSN (exclusivo do Simples Nacional). Mesmo formato de
 * csosnOptions/cstOptions em EstoqueForm.tsx. */
export const ICMS_CST_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '00', label: '00 - Tributada integralmente' },
  { value: '10', label: '10 - Tributada com cobrança de ICMS por ST' },
  { value: '20', label: '20 - Com redução de base de cálculo' },
  { value: '30', label: '30 - Isenta ou não tributada, com cobrança de ICMS por ST' },
  { value: '40', label: '40 - Isenta' },
  { value: '41', label: '41 - Não tributada' },
  { value: '50', label: '50 - Suspensão' },
  { value: '51', label: '51 - Diferimento' },
  { value: '60', label: '60 - ICMS cobrado anteriormente por ST' },
  { value: '70', label: '70 - Com redução de base de cálculo e cobrança de ICMS por ST' },
  { value: '90', label: '90 - Outras' },
];

/** Item lido do XML de uma NF-e de entrada, o suficiente pra tentar casar
 * com um produto ja cadastrado. */
export interface XmlItemForMatch {
  codigo: string;
  descricao: string;
  ncm: string;
  ean?: string;
}

/** Produto do estoque, campos usados pelo matching. */
export interface EstoqueItemForMatch {
  id: string;
  codigo: string;
  nome: string;
  codigoBarras?: string;
  ncm?: string;
  /** Mapa fornecedorId -> cProd que esse fornecedor usa pra este produto,
   * aprendido a cada importacao de XML confirmada (ver EntradaNFE.tsx). */
  codigosFornecedor?: Record<string, string>;
}

export type ProdutoMatchLayer = 'ean' | 'codigo_fornecedor' | 'ncm_nome';

export interface ProdutoMatchResult<T extends EstoqueItemForMatch> {
  produto: T | null;
  layer: ProdutoMatchLayer | null;
}

/** Reconhecimento de produto na importacao de XML, em camadas: EAN
 * (mais confiavel) -> codigo que o fornecedor usa pra esse item, salvo de
 * uma importacao anterior dele -> NCM+nome (exige os dois, nao so um,
 * como ultimo recurso). Pura e testavel sem Firestore. Generico em T pra
 * o chamador poder passar um tipo de estoque com campos extras (ex:
 * quantidade) sem perder esses campos no resultado. */
export const matchProdutoFromXmlItem = <T extends EstoqueItemForMatch>(
  item: XmlItemForMatch,
  estoqueAtual: T[],
  fornecedorId: string,
): ProdutoMatchResult<T> => {
  const ean = (item.ean || '').trim();
  if (ean) {
    const porEan = estoqueAtual.find((p) => (p.codigoBarras || '').trim() === ean);
    if (porEan) return { produto: porEan, layer: 'ean' };
  }

  const codigo = (item.codigo || '').trim().toLowerCase();
  if (codigo && fornecedorId) {
    const porCodigoFornecedor = estoqueAtual.find(
      (p) => (p.codigosFornecedor?.[fornecedorId] || '').trim().toLowerCase() === codigo,
    );
    if (porCodigoFornecedor) return { produto: porCodigoFornecedor, layer: 'codigo_fornecedor' };
  }

  const ncm = (item.ncm || '').trim();
  const nome = (item.descricao || '').trim().toLowerCase();
  if (ncm && nome) {
    const porNcmNome = estoqueAtual.find(
      (p) => (p.ncm || '').trim() === ncm && p.nome.trim().toLowerCase() === nome,
    );
    if (porNcmNome) return { produto: porNcmNome, layer: 'ncm_nome' };
  }

  return { produto: null, layer: null };
};

/** Materia-prima do cadastro (`materias_primas`), campos usados pelo
 * matching na Entrada de NF-e (Fatia 2 do F22). O cadastro de
 * materia-prima e deliberadamente mais simples que o de estoque (sem
 * codigoBarras/NCM/codigosFornecedor por fornecedor -- ver Modulo 4
 * Fatia 0), entao o reconhecimento tem so 2 camadas, nao 3. */
export interface MateriaPrimaItemForMatch {
  id: string;
  codigo: string;
  nome: string;
}

/** Reconhecimento de materia-prima na importacao de XML: codigo exato
 * (o que o XML traz em cProd, comparado contra o campo texto-livre
 * `codigo` do cadastro) -> nome exato como ultimo recurso. Pura e
 * testavel sem Firestore, mesmo espirito de matchProdutoFromXmlItem. */
export const matchMateriaPrimaFromXmlItem = <T extends MateriaPrimaItemForMatch>(
  item: XmlItemForMatch,
  materiasPrimasAtuais: T[],
): T | null => {
  const codigo = (item.codigo || '').trim().toLowerCase();
  if (codigo) {
    const porCodigo = materiasPrimasAtuais.find((m) => (m.codigo || '').trim().toLowerCase() === codigo);
    if (porCodigo) return porCodigo;
  }

  const nome = (item.descricao || '').trim().toLowerCase();
  if (nome) {
    const porNome = materiasPrimasAtuais.find((m) => (m.nome || '').trim().toLowerCase() === nome);
    if (porNome) return porNome;
  }

  return null;
};

/** Dados fiscais de um produto/item de venda usados pra montar o bloco
 * `taxes` enviado a Spedy. `csosn` guarda o CSOSN (Simples Nacional) ou o
 * CST de ICMS (outros regimes) -- mesmo campo unico usado no cadastro de
 * produto (EstoqueForm.tsx) desde a Fatia B. */
export interface ProdutoFiscalData {
  origem?: string;
  csosn?: string;
  aliquotaIcms?: number;
  reducaoBaseIcms?: number;
  cstPis?: string;
  aliquotaPis?: number;
  cstCofins?: string;
  aliquotaCofins?: number;
  cstIpi?: string;
  aliquotaIpi?: number;
  cstIbs?: string;
  aliquotaIbs?: number;
  cstCbs?: string;
  aliquotaCbs?: number;
}

interface SpedyIcmsTax {
  origin: number;
  csosn?: number;
  cst?: number;
  baseTaxModality?: number;
  baseTax?: number;
  baseTaxReduction?: number;
  rate?: number;
  amount?: number;
}

interface SpedyPisCofinsTax {
  cst: number;
  baseTax?: number;
  rate?: number;
  amount?: number;
}

interface SpedyIpiTax {
  cst: number;
  baseTax?: number;
  rate?: number;
  amount?: number;
}

/** MVP deliberadamente parcial do schema real da Spedy pra IBS/CBS
 * (`SefazInvoiceItemIbsCbsDto`), que tem mais de 30 campos -- IBS estadual
 * e municipal separados, tributacao monofasica, credito presumido, campos
 * de transicao que mudam de valor a cada ano ate 2033. Nosso cadastro de
 * produto so coleta 1 CST e 1 aliquota por tributo (nao separa IBS
 * estadual de municipal), entao so mandamos o que da pra montar sem
 * inventar numero: `cst`/`baseTax` pro IBS (sem os campos de rate/amount
 * separados por UF/municipio, que exigiriam um dado que nao coletamos) e
 * o bloco completo de CBS (federal, sem split, nossos campos batem 1:1
 * com o schema). Decisao confirmada com o usuario: MVP com os campos que
 * ja existem, documentado como parcial -- nao e a implementacao completa
 * da Reforma Tributaria. */
interface SpedyIbsCbsTax {
  cst: number;
  baseTax?: number;
  cbsRate?: number;
  cbsAmount?: number;
}

export interface SpedyTaxesPayload {
  icms: SpedyIcmsTax;
  pis: SpedyPisCofinsTax;
  cofins: SpedyPisCofinsTax;
  ipi?: SpedyIpiTax;
  ibsCbs?: SpedyIbsCbsTax;
}

/** Modalidade de Base de Calculo do ICMS [modBC] da tabela do SEFAZ --
 * 3 = "Valor da operacao", o caso comum de venda sem pauta/preco
 * tabelado. Nao implementamos ICMS-ST nesta fatia (fica pra quando for
 * pedido). */
const ICMS_BASE_TAX_MODALITY_VALOR_OPERACAO = 3;

/** Monta o bloco `taxes` no formato exato que a API da Spedy espera
 * (schema `SefazInvoiceItemIcmsDto`/`PisDto`/`CofinsDto`/`IpiDto`,
 * confirmado em 2026-08 lendo https://docs.spedy.com.br/openapi/v1.json
 * -- csosn e cst vivem no MESMO objeto `icms`, mutuamente exclusivos por
 * regime). Simples Nacional mantem o payload minimo que ja funcionava
 * (so csosn/origem no ICMS, so cst no PIS/COFINS, sem base/aliquota --
 * dispensado pela Spedy nesse regime). Lucro Presumido/Real usam CST real
 * de ICMS/PIS/COFINS com base de calculo e aliquota efetivas, vindas do
 * cadastro do produto. IPI so entra no payload quando o produto tem CST
 * de IPI configurado (campo opcional, nem todo produto tem). */
export const buildTaxesPayload = (
  produto: ProdutoFiscalData,
  regime: RegimeTributario,
  itemValue: number,
): SpedyTaxesPayload => {
  const origin = Number(produto.origem || '0');

  const icms: SpedyIcmsTax = usesCsosn(regime)
    ? { origin, csosn: Number(produto.csosn || '400') }
    : (() => {
        const baseTaxReduction = Number(produto.reducaoBaseIcms || 0);
        const baseTax = itemValue * (1 - baseTaxReduction / 100);
        const rate = Number(produto.aliquotaIcms || 0);
        return {
          origin,
          cst: Number(produto.csosn || '0'),
          baseTaxModality: ICMS_BASE_TAX_MODALITY_VALOR_OPERACAO,
          baseTax,
          baseTaxReduction,
          rate,
          amount: baseTax * (rate / 100),
        };
      })();

  const pis: SpedyPisCofinsTax = usesCsosn(regime)
    ? { cst: 7 }
    : (() => {
        const rate = Number(produto.aliquotaPis || 0);
        return { cst: Number(produto.cstPis || '1'), baseTax: itemValue, rate, amount: itemValue * (rate / 100) };
      })();

  const cofins: SpedyPisCofinsTax = usesCsosn(regime)
    ? { cst: 7 }
    : (() => {
        const rate = Number(produto.aliquotaCofins || 0);
        return { cst: Number(produto.cstCofins || '1'), baseTax: itemValue, rate, amount: itemValue * (rate / 100) };
      })();

  const payload: SpedyTaxesPayload = { icms, pis, cofins };

  if (produto.cstIpi) {
    const rate = Number(produto.aliquotaIpi || 0);
    payload.ipi = { cst: Number(produto.cstIpi), baseTax: itemValue, rate, amount: itemValue * (rate / 100) };
  }

  if (produto.cstIbs || produto.cstCbs) {
    const cbsRate = Number(produto.aliquotaCbs || 0);
    payload.ibsCbs = {
      cst: Number(produto.cstIbs || produto.cstCbs),
      baseTax: itemValue,
      cbsRate,
      cbsAmount: itemValue * (cbsRate / 100),
    };
  }

  return payload;
};

/** Item de servico de uma OS (`os.servicos[]`) usado pra montar a NFS-e.
 * Nunca inclui pecas (`os.pecas[]`) -- exclusao estrutural, nao so
 * convencao: quem chama simplesmente nao tem como passar pecas aqui. */
export interface OsServicoParaFatura {
  nome: string;
  preco?: number;
  quantidade?: number;
  tempoHoras?: number | string | null;
  detalhamento?: string;
}

/** Dados do cliente/destinatario usados no bloco `receiver` da Spedy --
 * mesmo formato de endereco ja usado em NFE.tsx pra NF-e (rua/numero/
 * bairro/cep/cidade/estado/codigoIbge), aqui com nomes de campo
 * genericos porque tanto `clientes` quanto o `ClienteOption` de NFE.tsx
 * podem alimentar isso. */
export interface ClienteParaFatura {
  nome: string;
  documento?: string;
  email?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  estado?: string;
  codigoIbge?: string;
}

/** Config fiscal de NFS-e por tenant (Configuracoes > Dados da Empresa).
 * `habilitada` decide se a secao aparece habilitada pro usuario editar --
 * nem todo tenant do Hennder emite nota de servico. Cidade/codigos vem da
 * busca ao vivo contra `GET /v1/service-invoices/cities` da Spedy (ver
 * spedyService.searchServiceInvoiceCities), nao sao fixos no codigo --
 * o SaaS atende tenants de qualquer cidade do Brasil. */
export interface NfseConfig {
  habilitada: boolean;
  cidadeCodigo?: string;
  cidadeNome?: string;
  cidadeEstado?: string;
  inscricaoMunicipal?: string;
  codigoServicoMunicipal?: string;
  codigoServicoFederal?: string;
  aliquotaIssPadrao?: number;
}

export interface SpedyServiceInvoicePayload {
  integrationId: string;
  effectiveDate: string;
  sendEmailToCustomer: boolean;
  description: string;
  federalServiceCode?: string;
  cityServiceCode?: string;
  taxationType: 'taxationInMunicipality';
  location?: { code: string; name: string; state: string };
  receiver: {
    name: string;
    federalTaxNumber: string;
    email?: string;
    address: {
      street: string;
      number: string;
      district: string;
      postalCode: string;
      city: { code: string; name: string; state: string };
    };
  };
  total: {
    invoiceAmount: number;
    issRate: number;
    issAmount: number;
    issWithheld: boolean;
  };
}

/** Descricao da NFS-e a partir dos servicos da OS -- concatena nome (+
 * detalhamento, quando preenchido) de cada servico. Pura, sem Firestore. */
export const buildServiceInvoiceDescription = (servicos: OsServicoParaFatura[]): string =>
  servicos
    .map((s) => (s.detalhamento ? `${s.nome} - ${s.detalhamento}` : s.nome))
    .filter(Boolean)
    .join('; ');

/** Soma o valor dos servicos da OS, reaproveitando a mesma logica de
 * preco x horas (`getServiceTotal`) que a propria OSForm.tsx usa pra
 * calcular `totalServicos` -- garante que o valor da nota bate com o que
 * a OS mostrou pro cliente, sem duplicar a regra de calculo. */
export const sumServiceInvoiceAmount = (servicos: OsServicoParaFatura[]): number =>
  servicos.reduce((total, s) => total + getServiceTotal(s), 0);

/** Monta o payload de NFS-e no formato da Spedy (`CreateServiceInvoiceDto`),
 * so com servicos da OS -- nunca pecas. `taxationType` fixo em
 * "tributado no municipio" e `issWithheld` fixo em `false` sao
 * simplificacoes deliberadas de MVP (mesmo espirito do MVP de IBS/CBS):
 * outros regimes (isencao, imunidade, suspensao judicial, ISS retido na
 * fonte) sao casos de contador, fora de escopo por ora. `location` vem da
 * cidade configurada pelo tenant -- necessario porque uma unica conta
 * Spedy atende tenants de cidades diferentes, nao da pra confiar num
 * default implicito de conta. */
export const buildServiceInvoicePayload = (
  servicos: OsServicoParaFatura[],
  cliente: ClienteParaFatura,
  config: NfseConfig,
  integrationId: string,
): SpedyServiceInvoicePayload => {
  const invoiceAmount = sumServiceInvoiceAmount(servicos);
  const issRate = Number(config.aliquotaIssPadrao || 0) / 100;

  return {
    integrationId,
    effectiveDate: new Date().toISOString(),
    sendEmailToCustomer: !!cliente.email,
    description: buildServiceInvoiceDescription(servicos),
    federalServiceCode: config.codigoServicoFederal || undefined,
    cityServiceCode: config.codigoServicoMunicipal || undefined,
    taxationType: 'taxationInMunicipality',
    location: config.cidadeCodigo
      ? { code: config.cidadeCodigo, name: config.cidadeNome || '', state: config.cidadeEstado || '' }
      : undefined,
    receiver: {
      name: cliente.nome,
      federalTaxNumber: (cliente.documento || '').replace(/\D/g, ''),
      email: cliente.email || undefined,
      address: {
        street: cliente.endereco || '',
        number: cliente.numero || '',
        district: cliente.bairro || '',
        postalCode: (cliente.cep || '').replace(/\D/g, ''),
        city: {
          code: cliente.codigoIbge || '',
          name: cliente.cidade || '',
          state: cliente.estado || '',
        },
      },
    },
    total: {
      invoiceAmount,
      issRate,
      issAmount: invoiceAmount * issRate,
      issWithheld: false,
    },
  };
};

/** CFOPs de venda destinada ao mercado externo (exportacao) --
 * 7101 = producao propria do estabelecimento, 7102 = mercadoria
 * adquirida/recebida de terceiros. Aceita string ou number porque o
 * CFOP do produto circula como string (EstoqueForm.tsx) mas chega como
 * number nos dois pontos de montagem de payload (PedidoVendaForm.tsx,
 * NFE.tsx: `Number(pData.cfop)`). */
export const EXPORT_CFOPS = [7101, 7102] as const;

export const isExportCfop = (cfop: string | number | undefined | null): boolean => {
  const parsed = Number(cfop);
  return (EXPORT_CFOPS as readonly number[]).includes(parsed);
};

/** `destination` no payload da Spedy: 'international' pra CFOP de
 * exportacao, senao mantem o valor ja calculado pelo chamador (hoje
 * sempre 'internal' em PedidoVendaForm.tsx, ou 'internal'/'interstate'
 * calculado por comparacao de estado em NFE.tsx). */
export const resolveInvoiceDestination = (
  cfop: string | number | undefined | null,
  fallbackDestination: string,
): string => (isExportCfop(cfop) ? 'international' : fallbackDestination);

export interface InvoiceUnitFieldsInput {
  cfop: string | number | undefined | null;
  unidadeComercial: string;
  quantidadeComercial: number;
  valorUnitarioComercial: number;
  /** Peso liquido POR UNIDADE comercial, em kg -- so obrigatorio quando
   * cfop e de exportacao (ver EstoqueForm.tsx, campo
   * pesoLiquidoUnitarioKg). */
  pesoLiquidoUnitarioKg?: number;
}

export interface InvoiceUnitFieldsResult {
  ok: boolean;
  /** Preenchido so quando ok === true. */
  fields?: {
    unit: string;
    quantity: number;
    unitAmount: number;
    unitTax: string;
    quantityTax: number;
    unitTaxAmount: number;
  };
  /** Preenchido so quando ok === false -- mensagem pronta pra exibir. */
  error?: string;
}

/** Resolve os campos de unidade comercial (uCom/qCom/vUnCom) e
 * tributavel (uTrib/qTrib/vUnTrib, nomeados unitTax/quantityTax/
 * unitTaxAmount no payload da Spedy) de um item de nota fiscal.
 *
 * Fora de CFOP de exportacao, tributavel = comercial (comportamento
 * historico do sistema, os dois pontos de emissao ja mandavam os
 * valores duplicados). Em CFOP de exportacao (7101/7102), a Nota
 * Tecnica 2016.001 exige declarar a quantidade na unidade tributavel
 * real do NCM -- aqui sempre convertida pra quilo (kg), unica unidade
 * tributavel de exportacao que este sistema suporta hoje. Sem peso
 * liquido configurado no produto, nao ha como converter -- devolve erro
 * em vez de mandar um qTrib inventado (subfaturamento/nota incorreta e
 * risco fiscal maior que bloquear a emissao). */
export const resolveInvoiceUnitFields = (input: InvoiceUnitFieldsInput): InvoiceUnitFieldsResult => {
  const { cfop, unidadeComercial, quantidadeComercial, valorUnitarioComercial, pesoLiquidoUnitarioKg } = input;

  if (!isExportCfop(cfop)) {
    return {
      ok: true,
      fields: {
        unit: unidadeComercial,
        quantity: quantidadeComercial,
        unitAmount: valorUnitarioComercial,
        unitTax: unidadeComercial,
        quantityTax: quantidadeComercial,
        unitTaxAmount: valorUnitarioComercial,
      },
    };
  }

  const peso = Number(pesoLiquidoUnitarioKg || 0);
  if (peso <= 0) {
    return {
      ok: false,
      error: 'Configure o peso líquido por unidade (kg) do produto antes de emitir nota com CFOP de exportação.',
    };
  }

  const quantityTax = peso * quantidadeComercial;
  const valorTotalComercial = valorUnitarioComercial * quantidadeComercial;

  return {
    ok: true,
    fields: {
      unit: unidadeComercial,
      quantity: quantidadeComercial,
      unitAmount: valorUnitarioComercial,
      unitTax: 'KG',
      quantityTax,
      unitTaxAmount: valorTotalComercial / quantityTax,
    },
  };
};
