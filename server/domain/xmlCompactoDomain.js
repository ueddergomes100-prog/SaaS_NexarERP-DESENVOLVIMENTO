"use strict";
/*
 * XML DA NOTA GUARDADO COMPACTO (2026-09-24).
 *
 * A nota de entrada passa a guardar o XML original -- e' o documento fiscal, o
 * contador e a fiscalizacao pedem, e e' dele que sai o DANFE depois. XML de
 * NF-e e' texto repetitivo: comprimido (gzip) e em base64 ele ocupa cerca de
 * 1/6, o que mantem a lista do historico leve. Limite abaixo dos 1 MB de um
 * documento do Firestore, com folga para o resto da nota.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.descompactarXml = exports.compactarXml = exports.LIMITE_DO_XML_COMPACTO = void 0;
exports.LIMITE_DO_XML_COMPACTO = 600_000;
const paraBase64 = (bytes) => {
    let binario = '';
    const passo = 0x8000;
    for (let inicio = 0; inicio < bytes.length; inicio += passo) {
        binario += String.fromCharCode(...bytes.subarray(inicio, inicio + passo));
    }
    return btoa(binario);
};
const deBase64 = (texto) => {
    const binario = atob(texto);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1)
        bytes[i] = binario.charCodeAt(i);
    return bytes;
};
const lerTudo = async (fluxo) => new Uint8Array(await new Response(fluxo).arrayBuffer());
/** gzip + base64. Devolve null quando o navegador nao comprime ou o resultado passa do limite. */
const compactarXml = async (xml) => {
    if (typeof CompressionStream === 'undefined')
        return null;
    try {
        const entrada = new Blob([xml]).stream().pipeThrough(new CompressionStream('gzip'));
        const texto = paraBase64(await lerTudo(entrada));
        return texto.length <= exports.LIMITE_DO_XML_COMPACTO ? texto : null;
    }
    catch {
        return null;
    }
};
exports.compactarXml = compactarXml;
/** Desfaz `compactarXml`. Lanca erro em portugues se o conteudo estiver corrompido. */
const descompactarXml = async (base64) => {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('Este navegador não consegue abrir o XML guardado. Atualize o navegador.');
    }
    try {
        const bytes = deBase64(base64);
        const entrada = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new TextDecoder().decode(await lerTudo(entrada));
    }
    catch {
        throw new Error('O XML guardado desta nota está corrompido e não pôde ser aberto.');
    }
};
exports.descompactarXml = descompactarXml;
