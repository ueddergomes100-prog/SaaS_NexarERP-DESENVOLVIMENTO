"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rotuloDaFormaDePagamento = exports.parseNfeXml = void 0;
const xmlSimplesDomain_1 = require("./xmlSimplesDomain");
const digitos = (valor) => valor.replace(/\D/g, '');
const soData = (valor) => valor.split('T')[0] ?? '';
const lerEndereco = (no) => ({
    logradouro: (0, xmlSimplesDomain_1.textoDe)(no, 'xLgr'),
    numero: (0, xmlSimplesDomain_1.textoDe)(no, 'nro'),
    complemento: (0, xmlSimplesDomain_1.textoDe)(no, 'xCpl'),
    bairro: (0, xmlSimplesDomain_1.textoDe)(no, 'xBairro'),
    municipio: (0, xmlSimplesDomain_1.textoDe)(no, 'xMun'),
    codigoMunicipio: digitos((0, xmlSimplesDomain_1.textoDe)(no, 'cMun')),
    uf: (0, xmlSimplesDomain_1.textoDe)(no, 'UF'),
    cep: digitos((0, xmlSimplesDomain_1.textoDe)(no, 'CEP')),
    telefone: digitos((0, xmlSimplesDomain_1.textoDe)(no, 'fone')),
});
const lerParte = (no, tagEndereco) => ({
    documento: digitos((0, xmlSimplesDomain_1.textoDe)(no, 'CNPJ') || (0, xmlSimplesDomain_1.textoDe)(no, 'CPF')),
    nome: (0, xmlSimplesDomain_1.textoDe)(no, 'xNome'),
    fantasia: (0, xmlSimplesDomain_1.textoDe)(no, 'xFant'),
    inscricaoEstadual: (0, xmlSimplesDomain_1.textoDe)(no, 'IE'),
    regime: (0, xmlSimplesDomain_1.textoDe)(no, 'CRT'),
    endereco: lerEndereco((0, xmlSimplesDomain_1.filho)(no, tagEndereco)),
});
/** O ICMS vem embrulhado numa tag que muda com a situacao (ICMS00, ICMS10, ICMSSN101...). */
const lerIcms = (imposto) => {
    const grupo = (0, xmlSimplesDomain_1.filho)(imposto, 'ICMS')?.filhos[0];
    return {
        origem: (0, xmlSimplesDomain_1.textoDe)(grupo, 'orig'),
        situacao: (0, xmlSimplesDomain_1.textoDe)(grupo, 'CST') || (0, xmlSimplesDomain_1.textoDe)(grupo, 'CSOSN'),
        base: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'vBC'),
        reducaoBase: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'pRedBC'),
        aliquota: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'pICMS'),
        valor: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'vICMS'),
        baseSt: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'vBCST'),
        aliquotaSt: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'pICMSST'),
        valorSt: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'vICMSST'),
        mvaSt: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'pMVAST'),
        valorDesonerado: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'vICMSDeson'),
        valorCreditoSn: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'vCredICMSSN'),
    };
};
/** IPI, PIS e COFINS tem o mesmo desenho: um grupo (Trib/Aliq/NT/Outr) com CST, base, aliquota e valor. */
const lerTributo = (imposto, tag) => {
    const no = (0, xmlSimplesDomain_1.filho)(imposto, tag);
    const grupo = no?.filhos.find((f) => f.nome !== 'cEnq' && f.nome !== 'clEnq' && f.nome !== 'CNPJProd' && f.nome !== 'cSelo' && f.nome !== 'qSelo');
    const sufixo = tag === 'IPI' ? 'IPI' : tag === 'PIS' ? 'PIS' : 'COFINS';
    return {
        situacao: (0, xmlSimplesDomain_1.textoDe)(grupo, 'CST'),
        base: (0, xmlSimplesDomain_1.numeroDe)(grupo, 'vBC'),
        aliquota: (0, xmlSimplesDomain_1.numeroDe)(grupo, `p${sufixo}`),
        valor: (0, xmlSimplesDomain_1.numeroDe)(grupo, `v${sufixo}`),
    };
};
const lerItem = (det) => {
    const prod = (0, xmlSimplesDomain_1.filho)(det, 'prod');
    const imposto = (0, xmlSimplesDomain_1.filho)(det, 'imposto');
    const eanBruto = (0, xmlSimplesDomain_1.textoDe)(prod, 'cEAN');
    // "SEM GTIN" nao e' codigo de barras: nao serve para reconhecer o produto.
    const ean = /^\d{8,14}$/.test(eanBruto) ? eanBruto : '';
    return {
        numero: Number(det.atributos.nItem) || 0,
        codigo: (0, xmlSimplesDomain_1.textoDe)(prod, 'cProd'),
        ean,
        descricao: (0, xmlSimplesDomain_1.textoDe)(prod, 'xProd'),
        ncm: digitos((0, xmlSimplesDomain_1.textoDe)(prod, 'NCM')),
        cest: digitos((0, xmlSimplesDomain_1.textoDe)(prod, 'CEST')),
        cfop: (0, xmlSimplesDomain_1.textoDe)(prod, 'CFOP'),
        unidade: (0, xmlSimplesDomain_1.textoDe)(prod, 'uCom') || 'UN',
        quantidade: (0, xmlSimplesDomain_1.numeroDe)(prod, 'qCom'),
        valorUnitario: (0, xmlSimplesDomain_1.numeroDe)(prod, 'vUnCom'),
        valorProduto: (0, xmlSimplesDomain_1.numeroDe)(prod, 'vProd'),
        frete: (0, xmlSimplesDomain_1.numeroDe)(prod, 'vFrete'),
        seguro: (0, xmlSimplesDomain_1.numeroDe)(prod, 'vSeg'),
        desconto: (0, xmlSimplesDomain_1.numeroDe)(prod, 'vDesc'),
        outrasDespesas: (0, xmlSimplesDomain_1.numeroDe)(prod, 'vOutro'),
        unidadeTributavel: (0, xmlSimplesDomain_1.textoDe)(prod, 'uTrib'),
        quantidadeTributavel: (0, xmlSimplesDomain_1.numeroDe)(prod, 'qTrib'),
        pedido: (0, xmlSimplesDomain_1.textoDe)(prod, 'xPed'),
        informacaoAdicional: (0, xmlSimplesDomain_1.textoDe)(det, 'infAdProd'),
        icms: lerIcms(imposto),
        ipi: lerTributo(imposto, 'IPI'),
        pis: lerTributo(imposto, 'PIS'),
        cofins: lerTributo(imposto, 'COFINS'),
        lotes: (0, xmlSimplesDomain_1.filhos)(prod, 'rastro').map((r) => ({
            numero: (0, xmlSimplesDomain_1.textoDe)(r, 'nLote'),
            fabricacao: (0, xmlSimplesDomain_1.textoDe)(r, 'dFab'),
            validade: (0, xmlSimplesDomain_1.textoDe)(r, 'dVal'),
            quantidade: (0, xmlSimplesDomain_1.numeroDe)(r, 'qLote'),
        })).filter((l) => l.numero),
    };
};
const lerTotais = (icmsTot) => ({
    baseIcms: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vBC'),
    icms: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vICMS'),
    icmsDesonerado: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vICMSDeson'),
    baseSt: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vBCST'),
    st: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vST'),
    fcpSt: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vFCPST'),
    produtos: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vProd'),
    frete: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vFrete'),
    seguro: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vSeg'),
    desconto: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vDesc'),
    impostoImportacao: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vII'),
    ipi: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vIPI'),
    ipiDevolvido: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vIPIDevol'),
    pis: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vPIS'),
    cofins: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vCOFINS'),
    outrasDespesas: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vOutro'),
    total: (0, xmlSimplesDomain_1.numeroDe)(icmsTot, 'vNF'),
});
const lerTransporte = (transp) => {
    const transporta = (0, xmlSimplesDomain_1.filho)(transp, 'transporta');
    return {
        modalidadeFrete: (0, xmlSimplesDomain_1.textoDe)(transp, 'modFrete'),
        transportadoraDocumento: digitos((0, xmlSimplesDomain_1.textoDe)(transporta, 'CNPJ') || (0, xmlSimplesDomain_1.textoDe)(transporta, 'CPF')),
        transportadoraNome: (0, xmlSimplesDomain_1.textoDe)(transporta, 'xNome'),
        transportadoraIe: (0, xmlSimplesDomain_1.textoDe)(transporta, 'IE'),
        transportadoraEndereco: (0, xmlSimplesDomain_1.textoDe)(transporta, 'xEnder'),
        transportadoraMunicipio: (0, xmlSimplesDomain_1.textoDe)(transporta, 'xMun'),
        transportadoraUf: (0, xmlSimplesDomain_1.textoDe)(transporta, 'UF'),
        placa: (0, xmlSimplesDomain_1.textoDe)(transp, 'veicTransp', 'placa'),
        volumes: (0, xmlSimplesDomain_1.filhos)(transp, 'vol').map((v) => ({
            quantidade: (0, xmlSimplesDomain_1.numeroDe)(v, 'qVol'),
            especie: (0, xmlSimplesDomain_1.textoDe)(v, 'esp'),
            marca: (0, xmlSimplesDomain_1.textoDe)(v, 'marca'),
            numeracao: (0, xmlSimplesDomain_1.textoDe)(v, 'nVol'),
            pesoLiquido: (0, xmlSimplesDomain_1.numeroDe)(v, 'pesoL'),
            pesoBruto: (0, xmlSimplesDomain_1.numeroDe)(v, 'pesoB'),
        })),
    };
};
/**
 * Le o XML de uma NF-e (com ou sem o envelope `nfeProc`). Erros em portugues,
 * dizendo o que fazer: resumo sem itens, CT-e e arquivo que nao e' nota.
 */
const parseNfeXml = (texto) => {
    const raiz = (0, xmlSimplesDomain_1.lerXml)(texto);
    if (raiz.nome === 'resNFe') {
        throw new Error('Este arquivo é só o resumo da nota (sem os itens). Baixe o XML completo da nota no portal da SEFAZ ou peça ao fornecedor.');
    }
    if (raiz.nome === 'cteProc' || raiz.nome === 'CTe') {
        throw new Error('Este arquivo é um conhecimento de transporte (CT-e), não uma nota de mercadoria. O frete se lança no bloco "Frete / Conhecimento de Transporte" da nota de mercadoria.');
    }
    const infNFe = raiz.nome === 'infNFe' ? raiz : (0, xmlSimplesDomain_1.descendente)(raiz, 'infNFe');
    if (!infNFe) {
        throw new Error('Nenhuma NF-e foi encontrada neste arquivo. Confira se é o XML da nota (não o PDF).');
    }
    const detalhes = (0, xmlSimplesDomain_1.filhos)(infNFe, 'det');
    if (detalhes.length === 0) {
        throw new Error('Nenhum produto identificado no corpo da nota XML.');
    }
    const ide = (0, xmlSimplesDomain_1.filho)(infNFe, 'ide');
    const protocolo = (0, xmlSimplesDomain_1.descendente)(raiz, 'infProt');
    const chaveDoId = digitos(infNFe.atributos.Id ?? '');
    const chave = chaveDoId.length === 44 ? chaveDoId : digitos((0, xmlSimplesDomain_1.textoDe)(protocolo, 'chNFe'));
    const dataEmissaoBruta = (0, xmlSimplesDomain_1.textoDe)(ide, 'dhEmi') || (0, xmlSimplesDomain_1.textoDe)(ide, 'dEmi');
    const cobranca = (0, xmlSimplesDomain_1.filho)(infNFe, 'cobr');
    const pagamento = (0, xmlSimplesDomain_1.filho)(infNFe, 'pag');
    return {
        chave: chave.length === 44 ? chave : '',
        modelo: (0, xmlSimplesDomain_1.textoDe)(ide, 'mod'),
        serie: (0, xmlSimplesDomain_1.textoDe)(ide, 'serie'),
        numero: (0, xmlSimplesDomain_1.textoDe)(ide, 'nNF'),
        naturezaOperacao: (0, xmlSimplesDomain_1.textoDe)(ide, 'natOp'),
        dataEmissao: soData(dataEmissaoBruta),
        dataSaida: soData((0, xmlSimplesDomain_1.textoDe)(ide, 'dhSaiEnt') || (0, xmlSimplesDomain_1.textoDe)(ide, 'dSaiEnt')),
        tipoOperacao: (0, xmlSimplesDomain_1.textoDe)(ide, 'tpNF'),
        finalidade: (0, xmlSimplesDomain_1.textoDe)(ide, 'finNFe'),
        protocolo: (0, xmlSimplesDomain_1.textoDe)(protocolo, 'nProt'),
        dataAutorizacao: (0, xmlSimplesDomain_1.textoDe)(protocolo, 'dhRecbto'),
        emitente: lerParte((0, xmlSimplesDomain_1.filho)(infNFe, 'emit'), 'enderEmit'),
        destinatario: lerParte((0, xmlSimplesDomain_1.filho)(infNFe, 'dest'), 'enderDest'),
        totais: lerTotais((0, xmlSimplesDomain_1.caminho)(infNFe, 'total', 'ICMSTot')),
        transporte: lerTransporte((0, xmlSimplesDomain_1.filho)(infNFe, 'transp')),
        faturaNumero: (0, xmlSimplesDomain_1.textoDe)(cobranca, 'fat', 'nFat'),
        faturaValor: (0, xmlSimplesDomain_1.numeroDe)(cobranca, 'fat', 'vLiq') || (0, xmlSimplesDomain_1.numeroDe)(cobranca, 'fat', 'vOrig'),
        duplicatas: (0, xmlSimplesDomain_1.filhos)(cobranca, 'dup').map((d, indice) => ({
            numero: (0, xmlSimplesDomain_1.textoDe)(d, 'nDup') || String(indice + 1),
            vencimento: (0, xmlSimplesDomain_1.textoDe)(d, 'dVenc'),
            valor: (0, xmlSimplesDomain_1.numeroDe)(d, 'vDup'),
        })),
        pagamentos: (0, xmlSimplesDomain_1.filhos)(pagamento, 'detPag').map((p) => ({
            forma: (0, xmlSimplesDomain_1.textoDe)(p, 'tPag'),
            descricao: (0, xmlSimplesDomain_1.textoDe)(p, 'xPag'),
            valor: (0, xmlSimplesDomain_1.numeroDe)(p, 'vPag'),
        })),
        informacoesComplementares: (0, xmlSimplesDomain_1.textoDe)(infNFe, 'infAdic', 'infCpl'),
        itens: detalhes.map(lerItem),
    };
};
exports.parseNfeXml = parseNfeXml;
/** Nome curto da forma de pagamento (tPag) para a tela. */
const rotuloDaFormaDePagamento = (codigo) => ({
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
exports.rotuloDaFormaDePagamento = rotuloDaFormaDePagamento;
