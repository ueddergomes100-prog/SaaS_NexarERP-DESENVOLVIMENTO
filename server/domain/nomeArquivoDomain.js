"use strict";
/**
 * NOME DO ARQUIVO de documento baixado (2026-09-30, pedido do dono): o PDF ja'
 * sai com o tipo, o numero e o destinatario -- "NFE 40 - JL SUPERMERCADOS
 * LTDA.pdf" -- para o cliente nao ter que renomear um por um.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.nomeArquivoDocumento = exports.numeroDaNota = void 0;
/**
 * Numero da nota como o cliente le: "93", nunca "000093" (pedido de 15/10/2026 --
 * a sequencia 93, 94, 95). Vale para a tela, as mensagens e o nome do arquivo.
 * O DANFE em PDF (da Spedy) continua no padrao oficial 000.000.093.
 * Texto que nao e' so' digito (nosso numero de boleto "2037-6") fica como veio.
 */
const numeroDaNota = (numero) => {
    if (numero === null || numero === undefined)
        return '';
    const texto = String(numero).trim();
    if (!/^\d+$/.test(texto))
        return texto;
    return texto.replace(/^0+(?=\d)/, '');
};
exports.numeroDaNota = numeroDaNota;
/** Caracteres que o Windows nao aceita em nome de arquivo. */
const PROIBIDOS = /[\\/:*?"<>|]/g;
/** Caractere de controle (quebra de linha, tab...) vira espaco. */
const semControle = (texto) => Array.from(texto).map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('');
const nomeArquivoDocumento = (a) => {
    const limpar = (texto) => semControle(texto).replace(PROIBIDOS, ' ').replace(/\s+/g, ' ').trim();
    const numero = (0, exports.numeroDaNota)(a.numero);
    const partes = [limpar(`${a.tipo} ${limpar(numero)}`), limpar(String(a.destinatario ?? ''))].filter(Boolean);
    // Nome muito comprido quebra em alguns programas (limite pratico do Windows).
    const base = partes.join(' - ').slice(0, 120).trim().replace(/[ .]+$/, '');
    return `${base || a.tipo}.${a.extensao || 'pdf'}`;
};
exports.nomeArquivoDocumento = nomeArquivoDocumento;
