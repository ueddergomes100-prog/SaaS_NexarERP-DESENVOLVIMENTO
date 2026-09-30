import { getServiceTotal } from './osServicePricing';

/** Maiusculas, sem acento, so' letras/numeros e espacos simples -- para comparar descricoes de item. */
export const normalizarTextoDeItem = (texto: unknown): string => String(texto ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim();

export type RegimeTributario = 'simples_nacional' | 'lucro_presumido' | 'lucro_real';

export const REGIME_TRIBUTARIO_OPTIONS: Array<{ value: RegimeTributario; label: string }> = [
  { value: 'simples_nacional', label: 'Simples Nacional' },
  { value: 'lucro_presumido', label: 'Lucro Presumido' },
  { value: 'lucro_real', label: 'Lucro Real' },
];

export const DEFAULT_REGIME_TRIBUTARIO: RegimeTributario = 'simples_nacional';

/**
 * A EMPRESA CONTROLA FISCAL?
 *
 * Decisao de produto (2026-08-31). Nem todo cliente do sistema emite
 * documento fiscal: ha quem venda no balcao com recibo simples e resolva a
 * parte fiscal fora daqui. Pra esses, cada botao de "Emitir Cupom Fiscal" e
 * cada menu de nota e' ruido -- pior, e' um botao que so tem como dar errado
 * se alguem clicar por engano.
 *
 * Desligado, some da tela: o menu Fiscal inteiro (notas, entrada de XML e
 * historico), o botao de emitir NFC-e no fim da venda e o de imprimir cupom
 * na lista de pedidos. O resto do sistema nao muda em nada.
 *
 * NAO e um valor do regime tributario, e uma chave separada de proposito.
 * Regime tributario e um fato contabil da empresa (ela CONTINUA sendo Simples
 * Nacional mesmo sem emitir nota por aqui), e ele alimenta o calculo de
 * imposto do cadastro de produto. Misturar "nao emito nota" na mesma lista
 * faria o produto perder a referencia de CSOSN/CST por uma decisao que nao e
 * sobre tributacao.
 */
export const DEFAULT_CONTROLA_FISCAL = true;

/**
 * So `false` explicito desliga. Empresa que nunca abriu a configuracao nao
 * tem o campo gravado, e `undefined` tem que continuar com o fiscal ligado --
 * sumir com o menu de nota de quem ja emite seria bem pior que o contrario.
 */
export const parseControlaFiscal = (raw: unknown): boolean => raw !== false;

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
  // Nome comparado sem acento, caixa e pontuacao ("Óleo  Motor" = "OLEO MOTOR"):
  // a descricao da nota e a do cadastro raramente saem iguais ao caractere.
  const nome = normalizarTextoDeItem(item.descricao);
  if (ncm && nome) {
    const porNcmNome = estoqueAtual.find(
      (p) => (p.ncm || '').trim() === ncm && normalizarTextoDeItem(p.nome) === nome,
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
  /** Mesmo aprendizado do estoque: fornecedorId -> cProd que ele usa (2026-09-24). */
  codigosFornecedor?: Record<string, string>;
}

/**
 * O nome do cadastro tem alguma palavra (3+ letras) em comum com a descricao da nota? Serve de trava para o
 * reconhecimento pelo CODIGO DO CADASTRO: o codigo que o fornecedor usa (cProd) pode ser igual, por acaso, ao
 * codigo interno de outra mercadoria ("222" = BALA DE GENGIBRE na nota, "222" = FLOCOS DE MILHO no cadastro).
 * Sem esta trava a nota somava o estoque na mercadoria errada, sem ninguem perceber.
 */
export const nomesTemPalavraEmComum = (a: string, b: string): boolean => {
  const palavrasDe = (texto: string) => new Set(normalizarTextoDeItem(texto).split(' ').filter((p) => p.length >= 3 && !/^\d+$/.test(p)));
  const conjuntoB = palavrasDe(b);
  return [...palavrasDe(a)].some((p) => conjuntoB.has(p));
};

/** Reconhecimento de materia-prima na importacao de XML: codigo exato
 * (o que o XML traz em cProd, comparado contra o campo texto-livre
 * `codigo` do cadastro) -> nome exato como ultimo recurso. Pura e
 * testavel sem Firestore, mesmo espirito de matchProdutoFromXmlItem. */
export const matchMateriaPrimaFromXmlItem = <T extends MateriaPrimaItemForMatch>(
  item: XmlItemForMatch,
  materiasPrimasAtuais: T[],
  fornecedorId = '',
): T | null => {
  const codigo = (item.codigo || '').trim().toLowerCase();
  if (codigo && fornecedorId) {
    const porCodigoFornecedor = materiasPrimasAtuais.find(
      (m) => (m.codigosFornecedor?.[fornecedorId] || '').trim().toLowerCase() === codigo,
    );
    if (porCodigoFornecedor) return porCodigoFornecedor;
  }
  if (codigo) {
    // So' liga pelo codigo interno se o nome tambem for compativel; codigo igual com nome sem nada a ver
    // e' coincidencia -- fica para a pessoa vincular (a tela sugere) em vez de somar na mercadoria errada.
    const porCodigo = materiasPrimasAtuais.find((m) => (m.codigo || '').trim().toLowerCase() === codigo && nomesTemPalavraEmComum(item.descricao, m.nome));
    if (porCodigo) return porCodigo;
  }

  const nome = normalizarTextoDeItem(item.descricao);
  if (nome) {
    const porNome = materiasPrimasAtuais.find((m) => normalizarTextoDeItem(m.nome) === nome);
    if (porNome) return porNome;
  }

  return null;
};

/** Montagem do item fiscal (impostos, GTIN, CFOP do destino...): ver
 * notaFiscalItemDomain.ts, a montagem unica de todas as telas desde 2026-09-30. */

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
    /** Sem codigo IBGE da cidade do tomador, vai sem endereco (ver buildServiceInvoicePayload). */
    address?: {
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
      // Endereco do tomador so' com o codigo IBGE da cidade. Sem ele, a nota
      // vai sem endereco (opcional na NFS-e) em vez de campos vazios -- e nunca
      // mais com o endereco de exemplo de Sao Paulo que o formulario da Nota
      // Fiscal carregava ate 2026-09-30.
      ...(cliente.codigoIbge ? {
        address: {
          street: cliente.endereco || '',
          number: cliente.numero || '',
          district: cliente.bairro || '',
          postalCode: (cliente.cep || '').replace(/\D/g, ''),
          city: {
            code: cliente.codigoIbge,
            name: cliente.cidade || '',
            state: cliente.estado || '',
          },
        },
      } : {}),
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
