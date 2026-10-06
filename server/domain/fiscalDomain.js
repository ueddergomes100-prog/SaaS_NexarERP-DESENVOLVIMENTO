"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveInvoiceUnitFields = exports.resolveInvoiceDestination = exports.isExportCfop = exports.EXPORT_CFOPS = exports.buildServiceInvoicePayload = exports.sumServiceInvoiceAmount = exports.buildServiceInvoiceDescription = exports.matchMateriaPrimaFromXmlItem = exports.nomesTemPalavraEmComum = exports.matchProdutoFromXmlItem = exports.ICMS_CST_OPTIONS = exports.CSOSN_OPTIONS = exports.usesCsosn = exports.parseControlaFiscal = exports.DEFAULT_CONTROLA_FISCAL = exports.DEFAULT_REGIME_TRIBUTARIO = exports.REGIME_TRIBUTARIO_OPTIONS = exports.normalizarTextoDeItem = void 0;
const osServicePricing_1 = require("./osServicePricing");
/** Maiusculas, sem acento, so' letras/numeros e espacos simples -- para comparar descricoes de item. */
const normalizarTextoDeItem = (texto) => String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
exports.normalizarTextoDeItem = normalizarTextoDeItem;
exports.REGIME_TRIBUTARIO_OPTIONS = [
    { value: 'simples_nacional', label: 'Simples Nacional' },
    { value: 'lucro_presumido', label: 'Lucro Presumido' },
    { value: 'lucro_real', label: 'Lucro Real' },
];
exports.DEFAULT_REGIME_TRIBUTARIO = 'simples_nacional';
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
exports.DEFAULT_CONTROLA_FISCAL = true;
/**
 * So `false` explicito desliga. Empresa que nunca abriu a configuracao nao
 * tem o campo gravado, e `undefined` tem que continuar com o fiscal ligado --
 * sumir com o menu de nota de quem ja emite seria bem pior que o contrario.
 */
const parseControlaFiscal = (raw) => raw !== false;
exports.parseControlaFiscal = parseControlaFiscal;
/** Simples Nacional tributa por CSOSN; Lucro Presumido/Real usam CST real
 * + aliquotas efetivas de ICMS/PIS/COFINS. Consumido pelas fatias
 * seguintes do modulo fiscal (cadastro de produto e emissao de NF-e). */
const usesCsosn = (regime) => regime === 'simples_nacional';
exports.usesCsosn = usesCsosn;
/** CSOSN (Simples Nacional) -- distinto do CST de ICMS (ICMS_CST_OPTIONS,
 * Lucro Presumido/Real). Centralizado aqui (antes vivia so como const
 * privada em EstoqueForm.tsx) pra Entrada de NF-e (F22) reusar a mesma
 * lista sem duplicar. */
exports.CSOSN_OPTIONS = [
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
exports.ICMS_CST_OPTIONS = [
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
/** Reconhecimento de produto na importacao de XML, em camadas: EAN
 * (mais confiavel) -> codigo que o fornecedor usa pra esse item, salvo de
 * uma importacao anterior dele -> NCM+nome (exige os dois, nao so um,
 * como ultimo recurso). Pura e testavel sem Firestore. Generico em T pra
 * o chamador poder passar um tipo de estoque com campos extras (ex:
 * quantidade) sem perder esses campos no resultado. */
const matchProdutoFromXmlItem = (item, estoqueAtual, fornecedorId) => {
    const ean = (item.ean || '').trim();
    if (ean) {
        const porEan = estoqueAtual.find((p) => (p.codigoBarras || '').trim() === ean);
        if (porEan)
            return { produto: porEan, layer: 'ean' };
    }
    const codigo = (item.codigo || '').trim().toLowerCase();
    if (codigo && fornecedorId) {
        const porCodigoFornecedor = estoqueAtual.find((p) => (p.codigosFornecedor?.[fornecedorId] || '').trim().toLowerCase() === codigo);
        if (porCodigoFornecedor)
            return { produto: porCodigoFornecedor, layer: 'codigo_fornecedor' };
    }
    const ncm = (item.ncm || '').trim();
    // Nome comparado sem acento, caixa e pontuacao ("Óleo  Motor" = "OLEO MOTOR"):
    // a descricao da nota e a do cadastro raramente saem iguais ao caractere.
    const nome = (0, exports.normalizarTextoDeItem)(item.descricao);
    if (ncm && nome) {
        const porNcmNome = estoqueAtual.find((p) => (p.ncm || '').trim() === ncm && (0, exports.normalizarTextoDeItem)(p.nome) === nome);
        if (porNcmNome)
            return { produto: porNcmNome, layer: 'ncm_nome' };
    }
    return { produto: null, layer: null };
};
exports.matchProdutoFromXmlItem = matchProdutoFromXmlItem;
/**
 * O nome do cadastro tem alguma palavra (3+ letras) em comum com a descricao da nota? Serve de trava para o
 * reconhecimento pelo CODIGO DO CADASTRO: o codigo que o fornecedor usa (cProd) pode ser igual, por acaso, ao
 * codigo interno de outra mercadoria ("222" = BALA DE GENGIBRE na nota, "222" = FLOCOS DE MILHO no cadastro).
 * Sem esta trava a nota somava o estoque na mercadoria errada, sem ninguem perceber.
 */
const nomesTemPalavraEmComum = (a, b) => {
    const palavrasDe = (texto) => new Set((0, exports.normalizarTextoDeItem)(texto).split(' ').filter((p) => p.length >= 3 && !/^\d+$/.test(p)));
    const conjuntoB = palavrasDe(b);
    return [...palavrasDe(a)].some((p) => conjuntoB.has(p));
};
exports.nomesTemPalavraEmComum = nomesTemPalavraEmComum;
/** Reconhecimento de materia-prima na importacao de XML: codigo exato
 * (o que o XML traz em cProd, comparado contra o campo texto-livre
 * `codigo` do cadastro) -> nome exato como ultimo recurso. Pura e
 * testavel sem Firestore, mesmo espirito de matchProdutoFromXmlItem. */
const matchMateriaPrimaFromXmlItem = (item, materiasPrimasAtuais, fornecedorId = '') => {
    const codigo = (item.codigo || '').trim().toLowerCase();
    if (codigo && fornecedorId) {
        const porCodigoFornecedor = materiasPrimasAtuais.find((m) => (m.codigosFornecedor?.[fornecedorId] || '').trim().toLowerCase() === codigo);
        if (porCodigoFornecedor)
            return porCodigoFornecedor;
    }
    if (codigo) {
        // So' liga pelo codigo interno se o nome tambem for compativel; codigo igual com nome sem nada a ver
        // e' coincidencia -- fica para a pessoa vincular (a tela sugere) em vez de somar na mercadoria errada.
        const porCodigo = materiasPrimasAtuais.find((m) => (m.codigo || '').trim().toLowerCase() === codigo && (0, exports.nomesTemPalavraEmComum)(item.descricao, m.nome));
        if (porCodigo)
            return porCodigo;
    }
    const nome = (0, exports.normalizarTextoDeItem)(item.descricao);
    if (nome) {
        const porNome = materiasPrimasAtuais.find((m) => (0, exports.normalizarTextoDeItem)(m.nome) === nome);
        if (porNome)
            return porNome;
    }
    return null;
};
exports.matchMateriaPrimaFromXmlItem = matchMateriaPrimaFromXmlItem;
/** Descricao da NFS-e a partir dos servicos da OS -- concatena nome (+
 * detalhamento, quando preenchido) de cada servico. Pura, sem Firestore. */
const buildServiceInvoiceDescription = (servicos) => servicos
    .map((s) => (s.detalhamento ? `${s.nome} - ${s.detalhamento}` : s.nome))
    .filter(Boolean)
    .join('; ');
exports.buildServiceInvoiceDescription = buildServiceInvoiceDescription;
/** Soma o valor dos servicos da OS, reaproveitando a mesma logica de
 * preco x horas (`getServiceTotal`) que a propria OSForm.tsx usa pra
 * calcular `totalServicos` -- garante que o valor da nota bate com o que
 * a OS mostrou pro cliente, sem duplicar a regra de calculo. */
const sumServiceInvoiceAmount = (servicos) => servicos.reduce((total, s) => total + (0, osServicePricing_1.getServiceTotal)(s), 0);
exports.sumServiceInvoiceAmount = sumServiceInvoiceAmount;
/** Monta o payload de NFS-e no formato da Spedy (`CreateServiceInvoiceDto`),
 * so com servicos da OS -- nunca pecas. `taxationType` fixo em
 * "tributado no municipio" e `issWithheld` fixo em `false` sao
 * simplificacoes deliberadas de MVP (mesmo espirito do MVP de IBS/CBS):
 * outros regimes (isencao, imunidade, suspensao judicial, ISS retido na
 * fonte) sao casos de contador, fora de escopo por ora. `location` vem da
 * cidade configurada pelo tenant -- necessario porque uma unica conta
 * Spedy atende tenants de cidades diferentes, nao da pra confiar num
 * default implicito de conta. */
const buildServiceInvoicePayload = (servicos, cliente, config, integrationId) => {
    const invoiceAmount = (0, exports.sumServiceInvoiceAmount)(servicos);
    const issRate = Number(config.aliquotaIssPadrao || 0) / 100;
    return {
        integrationId,
        effectiveDate: new Date().toISOString(),
        sendEmailToCustomer: !!cliente.email,
        description: (0, exports.buildServiceInvoiceDescription)(servicos),
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
exports.buildServiceInvoicePayload = buildServiceInvoicePayload;
/** CFOPs de venda destinada ao mercado externo (exportacao) --
 * 7101 = producao propria do estabelecimento, 7102 = mercadoria
 * adquirida/recebida de terceiros. Aceita string ou number porque o
 * CFOP do produto circula como string (EstoqueForm.tsx) mas chega como
 * number nos dois pontos de montagem de payload (PedidoVendaForm.tsx,
 * NFE.tsx: `Number(pData.cfop)`). */
exports.EXPORT_CFOPS = [7101, 7102];
const isExportCfop = (cfop) => {
    const parsed = Number(cfop);
    return exports.EXPORT_CFOPS.includes(parsed);
};
exports.isExportCfop = isExportCfop;
/** `destination` no payload da Spedy: 'international' pra CFOP de
 * exportacao, senao mantem o valor ja calculado pelo chamador (hoje
 * sempre 'internal' em PedidoVendaForm.tsx, ou 'internal'/'interstate'
 * calculado por comparacao de estado em NFE.tsx). */
const resolveInvoiceDestination = (cfop, fallbackDestination) => ((0, exports.isExportCfop)(cfop) ? 'international' : fallbackDestination);
exports.resolveInvoiceDestination = resolveInvoiceDestination;
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
const resolveInvoiceUnitFields = (input) => {
    const { cfop, unidadeComercial, quantidadeComercial, valorUnitarioComercial, pesoLiquidoUnitarioKg } = input;
    if (!(0, exports.isExportCfop)(cfop)) {
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
exports.resolveInvoiceUnitFields = resolveInvoiceUnitFields;
