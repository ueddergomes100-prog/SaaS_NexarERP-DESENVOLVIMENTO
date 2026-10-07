"use strict";
/*
 * ITEM DA NOTA FISCAL (NF-e e NFC-e) -- montagem UNICA, usada por todas as
 * telas que emitem nota (Nota Fiscal, fim da venda, cupom pelo pedido e app
 * do vendedor).
 *
 * Por que existe (2026-09-30): cada tela montava o item do seu jeito e a nota
 * saia pobre. Comparando a NF-e da Sol Life com a do ERP antigo (mesmo
 * produto, mesma empresa):
 *   - unidade sempre "UN", mesmo produto vendido em KG ou em caixa;
 *   - codigo de barras nunca ia (DANFE com "SEM GTIN" em produto que tem EAN);
 *   - CEST e codigo de beneficio fiscal nunca iam;
 *   - PIS/COFINS com CST 07 ("isenta") fixo, no Simples -- o certo e' o do
 *     cadastro (o ERP antigo usava 99);
 *   - IPI sem o codigo de enquadramento (cEnq, obrigatorio no grupo);
 *   - valor aproximado dos tributos (Lei 12.741) nunca calculado;
 *   - CFOP 5xxx mandado em venda para outro estado;
 *   - NCM "de autopeca" (87082999) e CSOSN 400 inventados quando o cadastro
 *     nao tinha -- nota com dado falso em vez de aviso;
 *   - CST 00 com aliquota 0: nota "tributada integralmente" sem ICMS nenhum.
 *
 * Regra do sistema (CLAUDE.md): cadastro incompleto BLOQUEIA com mensagem que
 * diz o produto e o que corrigir, quando seguir sem o dado daria nota errada.
 * So' ha' padrao silencioso onde ele e' documentado e nao muda imposto:
 * unidade (UN, regra 4 do CLAUDE.md), "SEM GTIN", cEnq 999 e PIS/COFINS 99 no
 * Simples Nacional (o Simples recolhe PIS/COFINS no DAS; 99 = "outras
 * operacoes", o mesmo que o ERP antigo da Sol Life mandava).
 *
 * Formato dos campos: schema da Spedy (SefazInvoiceItemDto e grupos de
 * imposto), conferido em https://docs.spedy.com.br/openapi/v1.json em
 * 2026-09-30.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.produtoFiscalDoCadastro = exports.totaisImpostosDosItens = exports.montarItemNotaFiscal = exports.temSubstituicaoTributaria = exports.somarTributos = exports.textoTributosAproximados = exports.percentuaisTributos = exports.montarPagamentosNota = exports.meioPagamentoNota = exports.destinatarioEConsumidorFinal = exports.cfopParaDestino = exports.resolverGtin = exports.TEXTO_OPTANTE_SIMPLES_NACIONAL = exports.PIS_COFINS_CST_PADRAO_SIMPLES = exports.ENQUADRAMENTO_IPI_PADRAO = exports.IPI_CST_SAIDA_OPTIONS = exports.PIS_COFINS_CST_SAIDA_OPTIONS = void 0;
const importacaoFiscalDomain_1 = require("./importacaoFiscalDomain");
const fiscalDomain_1 = require("./fiscalDomain");
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const num = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};
// ---------------------------------------------------------------------------
// Tabelas de codigo (saida)
// ---------------------------------------------------------------------------
/** CST de PIS/COFINS de SAIDA (tabela da RFB). */
exports.PIS_COFINS_CST_SAIDA_OPTIONS = [
    { value: '01', label: '01 - Tributável com alíquota básica' },
    { value: '02', label: '02 - Tributável com alíquota diferenciada' },
    { value: '04', label: '04 - Tributável monofásica (revenda a alíquota zero)' },
    { value: '05', label: '05 - Tributável por substituição tributária' },
    { value: '06', label: '06 - Tributável a alíquota zero' },
    { value: '07', label: '07 - Isenta da contribuição' },
    { value: '08', label: '08 - Sem incidência da contribuição' },
    { value: '09', label: '09 - Com suspensão da contribuição' },
    { value: '49', label: '49 - Outras operações de saída' },
    { value: '99', label: '99 - Outras operações' },
];
/** CST de IPI de SAIDA. */
exports.IPI_CST_SAIDA_OPTIONS = [
    { value: '50', label: '50 - Saída tributada' },
    { value: '51', label: '51 - Saída tributável com alíquota zero' },
    { value: '52', label: '52 - Saída isenta' },
    { value: '53', label: '53 - Saída não tributada' },
    { value: '54', label: '54 - Saída imune' },
    { value: '55', label: '55 - Saída com suspensão' },
    { value: '99', label: '99 - Outras saídas' },
];
/** Enquadramento padrao do IPI quando o cadastro nao informa (tabela da RFB: "999 - Tributacao normal IPI; Outros"). */
exports.ENQUADRAMENTO_IPI_PADRAO = '999';
/** PIS/COFINS no Simples Nacional sem CST no cadastro: 99 (outras operacoes), ver cabecalho. */
exports.PIS_COFINS_CST_PADRAO_SIMPLES = '99';
/** Frase obrigatoria nas informacoes complementares da nota de empresa do Simples (Res. CGSN 140/2018, art. 59). */
exports.TEXTO_OPTANTE_SIMPLES_NACIONAL = 'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NÃO GERA DIREITO A CRÉDITO FISCAL DE IPI.';
// ---------------------------------------------------------------------------
// Pecas puras
// ---------------------------------------------------------------------------
/** GTIN valido do cadastro ou "SEM GTIN" (valor que a SEFAZ exige quando o produto nao tem codigo de barras). */
const resolverGtin = (codigoBarras) => {
    const digitos = soDigitos(codigoBarras);
    return digitos && (0, importacaoFiscalDomain_1.gtinValido)(digitos) ? digitos : 'SEM GTIN';
};
exports.resolverGtin = resolverGtin;
/**
 * CFOP para o destino da venda. O cadastro guarda o CFOP da venda dentro do
 * estado (5xxx); venda para outro estado usa o 6xxx equivalente -- e o
 * contrario tambem (produto cadastrado com 6102 vendido dentro do estado).
 * 5405 (ST ja' retida) tem par 6404, mas produto com ST so' chega aqui numa
 * venda interestadual com o "CFOP interestadual" do cadastro -- sem ele a
 * montagem do item barra (a ST depende do estado de destino). Exportacao
 * (7xxx) e CFOP que nao e' de venda 5/6 nao mudam.
 */
const cfopParaDestino = (cfop, interestadual) => {
    const c = soDigitos(cfop);
    if (c.length !== 4)
        return c;
    if (interestadual) {
        if (c === '5405')
            return '6404';
        return c.startsWith('5') ? `6${c.slice(1)}` : c;
    }
    if (c === '6404')
        return '5405';
    return c.startsWith('6') ? `5${c.slice(1)}` : c;
};
exports.cfopParaDestino = cfopParaDestino;
/**
 * Destinatario e' consumidor final [indFinal]? Com inscricao estadual, e'
 * contribuinte comprando para revender/industrializar -- nao e' consumidor
 * final. CPF, ou CNPJ sem IE, e' consumidor final.
 */
const destinatarioEConsumidorFinal = (a) => {
    const doc = soDigitos(a.documento);
    if (doc.length !== 14)
        return true;
    const ie = String(a.inscricaoEstadual ?? '').trim().toUpperCase();
    return !ie || ie === 'ISENTO';
};
exports.destinatarioEConsumidorFinal = destinatarioEConsumidorFinal;
/** Forma de pagamento do sistema -> meio de pagamento da nota [tPag]. */
const meioPagamentoNota = (forma) => {
    const f = String(forma || '');
    if (f === 'Dinheiro')
        return 'money';
    if (f === 'Pix')
        return 'pix';
    if (f.includes('Crédito'))
        return 'creditCard';
    if (f.includes('Débito'))
        return 'debitCard';
    if (f === 'Boleto')
        return 'billetBanking';
    if (f === 'Cheque')
        return 'check';
    if (f === 'Transferência')
        return 'bankTransfer';
    if (f === 'Pagamento a Prazo')
        return 'storeCredit';
    return 'other';
};
exports.meioPagamentoNota = meioPagamentoNota;
/**
 * Pagamentos da nota [pag] a partir dos pagamentos da venda, agrupados por
 * meio. A soma tem que bater com o valor da nota; nao batendo (pedido antigo,
 * pagamento alterado), vai um pagamento "outros" com o valor da nota -- o
 * mesmo que o sistema sempre mandou -- em vez de uma nota rejeitada.
 */
const montarPagamentosNota = (pagamentos, valorNota) => {
    const porMeio = new Map();
    pagamentos.forEach((p) => {
        const centavos = p.valorCentavos !== undefined ? Number(p.valorCentavos) : Math.round(Number(p.valor || 0) * 100);
        if (!(centavos > 0))
            return;
        const meio = (0, exports.meioPagamentoNota)(p.formaPagamento);
        porMeio.set(meio, (porMeio.get(meio) || 0) + centavos);
    });
    const somaCentavos = [...porMeio.values()].reduce((a, b) => a + b, 0);
    if (porMeio.size === 0 || somaCentavos !== Math.round(valorNota * 100)) {
        return [{ method: 'other', amount: arred(valorNota) }];
    }
    return [...porMeio.entries()].map(([method, centavos]) => ({ method, amount: centavos / 100 }));
};
exports.montarPagamentosNota = montarPagamentosNota;
/** Percentuais de tributos aproximados do produto (IBPT). Sem nada = 0. */
const percentuaisTributos = (p) => {
    const federal = num(p.percentualTributosFederal);
    const estadual = num(p.percentualTributosEstadual);
    const municipal = num(p.percentualTributosMunicipal);
    const separado = federal + estadual + municipal;
    return { federal, estadual, municipal, total: separado > 0 ? separado : num(p.percentualTributos) };
};
exports.percentuaisTributos = percentuaisTributos;
/** Texto da Lei 12.741 para as informacoes complementares. Vazio quando nao ha' tributo calculado. */
const textoTributosAproximados = (t, valorNota) => {
    if (!(t.total > 0))
        return '';
    const r = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const pct = valorNota > 0 ? ` (${((t.total / valorNota) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)` : '';
    if (t.federal + t.estadual + t.municipal > 0) {
        return `Valor aproximado dos tributos: ${r(t.federal)} federais, ${r(t.estadual)} estaduais e ${r(t.municipal)} municipais${pct}. Fonte: IBPT.`;
    }
    return `Valor aproximado dos tributos: ${r(t.total)}${pct}. Fonte: IBPT.`;
};
exports.textoTributosAproximados = textoTributosAproximados;
const somarTributos = (lista) => lista.reduce((a, t) => ({ federal: arred(a.federal + t.federal), estadual: arred(a.estadual + t.estadual), municipal: arred(a.municipal + t.municipal), total: arred(a.total + t.total) }), { federal: 0, estadual: 0, municipal: 0, total: 0 });
exports.somarTributos = somarTributos;
/** Produto com ICMS por substituicao tributaria (CFOP 54xx, CSOSN 201-203/500, CST 10/30/60/70). */
const temSubstituicaoTributaria = (p, regime) => {
    const cfop = soDigitos(p.cfop);
    const codigo = String(p.csosn ?? '').trim();
    if (/^[56]4/.test(cfop))
        return true;
    return (0, fiscalDomain_1.usesCsosn)(regime) ? ['201', '202', '203', '500'].includes(codigo) : ['10', '30', '60', '70'].includes(codigo);
};
exports.temSubstituicaoTributaria = temSubstituicaoTributaria;
/**
 * ICMS-ST retido anteriormente (CSOSN 500 / CST 60): vBCSTRet, pST,
 * vICMSSubstituto e vICMSSTRet. A SEFAZ-MG exige os quatro na venda a
 * contribuinte -- sem eles a NF-e 000040 da Sol Life voltou com a Rejeicao 938
 * (2026-09-30). O ERP antigo mandava os quatro ZERADOS e as notas saiam
 * autorizadas (conferido no XML autorizado da NF 30234); o valor real viria da
 * nota de compra com ST, que o cadastro nao guarda. Campos da Spedy:
 * baseStRetentionAmount, stpRate, substituteAmount, stRetentionAmount.
 */
const ST_RETIDO_ANTERIORMENTE_ZERADO = { baseStRetentionAmount: 0, stpRate: 0, substituteAmount: 0, stRetentionAmount: 0 };
const icmsDoItem = (p, regime, base) => {
    const origin = Number(p.origem || '0');
    const codigo = String(p.csosn ?? '').trim();
    const corrigir = `Edite o produto "${p.nome}" em Estoque > aba Fiscal.`;
    if ((0, fiscalDomain_1.usesCsosn)(regime)) {
        if (!fiscalDomain_1.CSOSN_OPTIONS.some((o) => o.value === codigo)) {
            return {
                ok: false,
                erro: codigo
                    ? `O produto "${p.nome}" está com "${codigo}" no campo CSOSN, que não é um CSOSN do Simples Nacional (a empresa está no Simples). ${corrigir}`
                    : `O produto "${p.nome}" está sem CSOSN. ${corrigir}`,
            };
        }
        if (['201', '202', '203'].includes(codigo)) {
            return { ok: false, erro: `O produto "${p.nome}" usa CSOSN ${codigo} (substituição tributária calculada na própria nota), que o sistema ainda não calcula. Confirme o CSOSN com o contador (produto com ST já retida usa 500). ${corrigir}` };
        }
        if (codigo === '101') {
            const rate = num(p.aliquotaIcms);
            if (!(rate > 0)) {
                return { ok: false, erro: `O produto "${p.nome}" usa CSOSN 101 (com crédito), que exige a alíquota do crédito de ICMS. Informe-a em "Alíquota ICMS (%)". ${corrigir}` };
            }
            return { ok: true, icms: { origin, csosn: 101, snCreditRate: rate, snCreditAmount: arred(base * rate / 100) } };
        }
        if (codigo === '500')
            return { ok: true, icms: { origin, csosn: 500, ...ST_RETIDO_ANTERIORMENTE_ZERADO } };
        return { ok: true, icms: { origin, csosn: Number(codigo) } };
    }
    if (!fiscalDomain_1.ICMS_CST_OPTIONS.some((o) => o.value === codigo)) {
        return {
            ok: false,
            erro: codigo
                ? `O produto "${p.nome}" está com "${codigo}" no campo CST de ICMS, que não é um CST válido para o regime da empresa. ${corrigir}`
                : `O produto "${p.nome}" está sem CST de ICMS. ${corrigir}`,
        };
    }
    const cst = Number(codigo);
    if (['10', '30', '70'].includes(codigo)) {
        return { ok: false, erro: `O produto "${p.nome}" usa CST ${codigo} (ICMS por substituição tributária calculado na nota), que o sistema ainda não calcula. Confirme o CST com o contador (ST já retida usa 60). ${corrigir}` };
    }
    if (codigo === '60')
        return { ok: true, icms: { origin, cst, ...ST_RETIDO_ANTERIORMENTE_ZERADO } };
    if (['40', '41', '50'].includes(codigo))
        return { ok: true, icms: { origin, cst } };
    const rate = num(p.aliquotaIcms);
    const reducao = codigo === '20' ? num(p.reducaoBaseIcms) : 0;
    if (codigo === '00' && !(rate > 0)) {
        return { ok: false, erro: `O produto "${p.nome}" está com CST 00 (tributada integralmente) e alíquota de ICMS zerada — a nota sairia sem o ICMS destacado. Informe a alíquota de ICMS ou o CST correto (confirme com o contador). ${corrigir}` };
    }
    if (codigo === '20' && !(reducao > 0 && reducao < 100)) {
        return { ok: false, erro: `O produto "${p.nome}" está com CST 20 (redução de base) sem o percentual de redução. ${corrigir}` };
    }
    const baseTax = arred(base * (1 - reducao / 100));
    return {
        ok: true,
        icms: {
            origin,
            cst,
            baseTaxModality: 3,
            baseTax,
            ...(reducao > 0 ? { baseTaxReduction: reducao } : {}),
            rate,
            amount: arred(baseTax * rate / 100),
        },
    };
};
/** PIS ou COFINS por CST: 01/02 e 49-99 levam base/aliquota; 04-09 so' o CST; 03 (por quantidade) nao e' suportado. */
const pisCofinsDoItem = (nomeTributo, cstCadastro, aliquota, p, regime, base) => {
    let cst = String(cstCadastro ?? '').trim();
    if (!cst && (0, fiscalDomain_1.usesCsosn)(regime))
        cst = exports.PIS_COFINS_CST_PADRAO_SIMPLES;
    if (!cst)
        return { ok: false, erro: `O produto "${p.nome}" está sem CST de ${nomeTributo}. Edite o produto em Estoque > aba Fiscal.` };
    if (!exports.PIS_COFINS_CST_SAIDA_OPTIONS.some((o) => o.value === cst)) {
        return { ok: false, erro: `O produto "${p.nome}" está com CST de ${nomeTributo} "${cst}", que não é um CST de saída. Edite o produto em Estoque > aba Fiscal.` };
    }
    const n = Number(cst);
    if (n >= 4 && n <= 9)
        return { ok: true, grupo: { cst: n } };
    const rate = num(aliquota);
    return { ok: true, grupo: { cst: n, baseTax: arred(base), rate, amount: arred(base * rate / 100) } };
};
const ipiDoItem = (p, base) => {
    const cst = String(p.cstIpi ?? '').trim();
    if (!cst)
        return { ok: true, grupo: null };
    if (!exports.IPI_CST_SAIDA_OPTIONS.some((o) => o.value === cst)) {
        return { ok: false, erro: `O produto "${p.nome}" está com CST de IPI "${cst}", que não é um CST de saída do IPI (50 a 55 ou 99). Edite o produto em Estoque > aba Fiscal.` };
    }
    const classificationCode = soDigitos(p.enquadramentoIpi) || exports.ENQUADRAMENTO_IPI_PADRAO;
    if (['51', '52', '53', '54', '55'].includes(cst))
        return { ok: true, grupo: { cst: Number(cst), classificationCode } };
    const rate = num(p.aliquotaIpi);
    if (rate > 0) {
        // O IPI soma no total da nota (vNF), e o valor da venda nao tem IPI em cima:
        // a nota nao fecharia com o que o cliente pagou.
        return { ok: false, erro: `O produto "${p.nome}" tem IPI com alíquota ${rate}%, e o sistema ainda não soma IPI ao valor da venda. Confirme com o contador (revenda e empresa do Simples costumam usar CST 99 com alíquota zero).` };
    }
    return { ok: true, grupo: { cst: Number(cst), classificationCode, baseTax: arred(base), rate: 0, amount: 0 } };
};
/** IBS/CBS (Reforma Tributaria) -- so' vai com CST de 3 digitos; codigo antigo de 2 digitos gravado no campo e' ignorado. */
const ibsCbsDoItem = (p, base) => {
    const cst = soDigitos(p.cstIbs || p.cstCbs);
    if (cst.length !== 3)
        return null;
    const cbsRate = num(p.aliquotaCbs);
    return { cst: Number(cst), baseTax: arred(base), cbsRate, cbsAmount: arred(base * cbsRate / 100) };
};
// ---------------------------------------------------------------------------
// Item completo
// ---------------------------------------------------------------------------
const montarItemNotaFiscal = (a) => {
    const { produto: p, venda, contexto } = a;
    const avisos = [];
    const ncm = soDigitos(p.ncm);
    if (ncm.length !== 8) {
        return { ok: false, erro: ncm ? `O NCM do produto "${p.nome}" ("${p.ncm}") não tem 8 dígitos. Edite o produto em Estoque > aba Fiscal.` : `O produto "${p.nome}" está sem NCM. Edite o produto em Estoque > aba Fiscal e informe o NCM (8 dígitos).` };
    }
    const cfopOperacao = soDigitos(contexto.cfopDaOperacao);
    if (contexto.cfopDaOperacao !== undefined && cfopOperacao.length !== 4) {
        return { ok: false, erro: `O CFOP da operação ("${contexto.cfopDaOperacao}") não tem 4 dígitos.` };
    }
    const cfopCadastro = cfopOperacao || soDigitos(p.cfop);
    if (cfopCadastro.length !== 4) {
        return { ok: false, erro: `O produto "${p.nome}" está sem CFOP de saída. Edite o produto em Estoque > aba Fiscal.` };
    }
    let cfop = cfopOperacao || ((0, fiscalDomain_1.isExportCfop)(cfopCadastro) ? cfopCadastro : (0, exports.cfopParaDestino)(cfopCadastro, contexto.interestadual));
    let produtoFiscal = p;
    if (!cfopOperacao && contexto.interestadual && !(0, fiscalDomain_1.isExportCfop)(cfopCadastro)) {
        const cfopInter = soDigitos(p.cfopInterestadual);
        const csosnInter = String(p.csosnInterestadual ?? '').trim();
        if (cfopInter) {
            if (cfopInter.length !== 4 || !cfopInter.startsWith('6')) {
                return { ok: false, erro: `O CFOP interestadual do produto "${p.nome}" ("${p.cfopInterestadual}") não é um CFOP de venda para outro estado (6xxx). Edite o produto em Estoque > aba Fiscal.` };
            }
            cfop = cfopInter;
        }
        else if ((0, exports.temSubstituicaoTributaria)(p, contexto.regime)) {
            // ST depende do estado de destino (protocolo/convenio): o sistema nao escolhe.
            return { ok: false, erro: `O produto "${p.nome}" tem substituição tributária (CFOP ${cfopCadastro}) e esta venda é para outro estado. Informe o "CFOP interestadual" e o "CSOSN interestadual" do produto em Estoque > aba Fiscal (confirme com o contador; muitas empresas do Simples usam 6102 e CSOSN 102 quando o destino não tem ST para o produto).` };
        }
        if (csosnInter)
            produtoFiscal = { ...p, csosn: csosnInter };
    }
    const quantidade = num(venda.quantidade);
    const precoUnitario = num(venda.precoUnitario);
    const totalAmount = arred(quantidade * precoUnitario);
    const desconto = arred(num(venda.desconto));
    if (desconto > totalAmount) {
        return { ok: false, erro: `O desconto do item "${p.nome}" (R$ ${desconto.toFixed(2)}) é maior que o valor dele (R$ ${totalAmount.toFixed(2)}). Corrija o desconto na venda.` };
    }
    // Base dos impostos = valor do item menos o desconto (vProd - vDesc).
    const base = arred(totalAmount - desconto);
    const unidade = String(venda.unidadeSigla || '').trim().toUpperCase() || 'UN';
    if (!String(venda.unidadeSigla || '').trim()) {
        avisos.push(`"${p.nome}" está sem unidade de medida e foi como UN. Corrija o cadastro em Estoque.`);
    }
    const unitFields = (0, fiscalDomain_1.resolveInvoiceUnitFields)({
        cfop,
        unidadeComercial: unidade,
        quantidadeComercial: quantidade,
        valorUnitarioComercial: precoUnitario,
        pesoLiquidoUnitarioKg: p.pesoLiquidoUnitarioKg,
    });
    if (!unitFields.ok)
        return { ok: false, erro: `${p.nome}: ${unitFields.error}` };
    const icms = icmsDoItem(produtoFiscal, contexto.regime, base);
    if (!icms.ok)
        return icms;
    const pis = pisCofinsDoItem('PIS', p.cstPis, p.aliquotaPis, p, contexto.regime, base);
    if (!pis.ok)
        return pis;
    const cofins = pisCofinsDoItem('COFINS', p.cstCofins, p.aliquotaCofins, p, contexto.regime, base);
    if (!cofins.ok)
        return cofins;
    const ipi = ipiDoItem(p, base);
    if (!ipi.ok)
        return ipi;
    const ibsCbs = ibsCbsDoItem(p, base);
    const pct = (0, exports.percentuaisTributos)(p);
    const tributos = {
        federal: arred(base * pct.federal / 100),
        estadual: arred(base * pct.estadual / 100),
        municipal: arred(base * pct.municipal / 100),
        total: arred(base * pct.total / 100),
    };
    if (!(pct.total > 0)) {
        avisos.push(`"${p.nome}" está sem o percentual de tributos aproximados (IBPT); a nota sai sem esse valor.`);
    }
    const cest = soDigitos(p.cest);
    // Rejeicao 806 da SEFAZ ("Operacao com ICMS-ST sem informacao do CEST"): barra
    // antes de enviar. Vale a operacao DESTA nota (venda para fora com 6102/102
    // nao e' ST, mesmo o produto sendo ST dentro do estado).
    if (cest.length !== 7 && (0, exports.temSubstituicaoTributaria)({ ...produtoFiscal, cfop }, contexto.regime)) {
        return { ok: false, erro: `O produto "${p.nome}" tem substituição tributária (CFOP ${cfop}, ${(0, fiscalDomain_1.usesCsosn)(contexto.regime) ? 'CSOSN' : 'CST'} ${produtoFiscal.csosn}) e está sem CEST — a SEFAZ rejeita (Rejeição 806). Informe o CEST do item na aba Produtos da nota ou no cadastro do produto em Estoque.` };
    }
    const beneficio = String(p.beneficioFiscal ?? '').trim();
    const gtin = (0, exports.resolverGtin)(p.codigoBarras);
    const item = {
        code: a.codigoItem,
        gtinCode: gtin,
        description: p.nome,
        ncm,
        ...(cest.length === 7 ? { cest } : {}),
        cfop: Number(cfop),
        ...unitFields.fields,
        totalAmount,
        ...(desconto > 0 ? { discountAmount: desconto } : {}),
        makeupTotal: true,
        ...(beneficio ? { taxBenefitCode: beneficio } : {}),
        taxes: {
            ...(tributos.total > 0 ? { totalTax: tributos.total } : {}),
            icms: icms.icms,
            pis: pis.grupo,
            cofins: cofins.grupo,
            ...(ipi.grupo ? { ipi: ipi.grupo } : {}),
            ...(ibsCbs ? { ibsCbs } : {}),
        },
    };
    return { ok: true, item, tributos, avisos };
};
exports.montarItemNotaFiscal = montarItemNotaFiscal;
/** Totais de imposto da nota, somados dos itens ja' montados. */
const totaisImpostosDosItens = (itens) => {
    let icmsBaseTax = 0;
    let icmsAmount = 0;
    let pisAmount = 0;
    let cofinsAmount = 0;
    let totalTax = 0;
    itens.forEach((it) => {
        const t = (it.taxes || {});
        const icms = (t.icms || {});
        icmsBaseTax += num(icms.baseTax);
        icmsAmount += num(icms.amount);
        pisAmount += num((t.pis || {}).amount);
        cofinsAmount += num((t.cofins || {}).amount);
        totalTax += num(t.totalTax);
    });
    return {
        icmsBaseTax: arred(icmsBaseTax),
        icmsAmount: arred(icmsAmount),
        pisAmount: arred(pisAmount),
        cofinsAmount: arred(cofinsAmount),
        totalTax: arred(totalTax),
    };
};
exports.totaisImpostosDosItens = totaisImpostosDosItens;
/** Le os dados fiscais de um documento do Estoque (campos na raiz ou no bloco `fiscal`, cadastro antigo). */
const produtoFiscalDoCadastro = (data, opcoes = {}) => {
    const fiscal = (data.fiscal || {});
    const pega = (campo, campoFiscal = campo) => String(data[campo] ?? fiscal[campoFiscal] ?? '').trim();
    const embalagens = Array.isArray(data.embalagens) ? data.embalagens : [];
    const embalagem = opcoes.embalagemId ? embalagens.find((e) => e.id === opcoes.embalagemId) : undefined;
    const opt = (v) => (v === undefined || v === null || v === '' ? undefined : num(v));
    return {
        nome: String(data.nome || ''),
        codigo: String(data.codigo || ''),
        ncm: pega('ncm'),
        cest: pega('cest'),
        cfop: pega('cfop', 'cfopPadraoSaida'),
        origem: pega('origem') || '0',
        csosn: pega('csosn', 'csosnCst'),
        cfopInterestadual: pega('cfopInterestadual'),
        csosnInterestadual: pega('csosnInterestadual'),
        aliquotaIcms: num(data.aliquotaIcms ?? fiscal.aliquotaIcms),
        reducaoBaseIcms: num(data.reducaoBaseIcms ?? fiscal.reducaoBaseIcms),
        cstPis: pega('cstPis'),
        aliquotaPis: num(data.aliquotaPis ?? fiscal.aliquotaPis),
        cstCofins: pega('cstCofins'),
        aliquotaCofins: num(data.aliquotaCofins ?? fiscal.aliquotaCofins),
        cstIpi: pega('cstIpi'),
        aliquotaIpi: num(data.aliquotaIpi ?? fiscal.aliquotaIpi),
        enquadramentoIpi: pega('enquadramentoIpi'),
        cstIbs: pega('cstIbs'),
        aliquotaIbs: num(data.aliquotaIbs ?? fiscal.aliquotaIbs),
        cstCbs: pega('cstCbs'),
        aliquotaCbs: num(data.aliquotaCbs ?? fiscal.aliquotaCbs),
        // Vendido em embalagem: o GTIN e' o da embalagem (caixa tem codigo proprio); sem ele, o da unidade nao serve.
        codigoBarras: embalagem ? String(embalagem.codigoBarras || '') : String(data.codigoBarras || ''),
        beneficioFiscal: pega('beneficioFiscal'),
        percentualTributosFederal: opt(data.percentualTributosFederal),
        percentualTributosEstadual: opt(data.percentualTributosEstadual),
        percentualTributosMunicipal: opt(data.percentualTributosMunicipal),
        percentualTributos: opt(data.percentualTributos),
        pesoLiquidoUnitarioKg: num(data.pesoLiquidoUnitarioKg),
    };
};
exports.produtoFiscalDoCadastro = produtoFiscalDoCadastro;
