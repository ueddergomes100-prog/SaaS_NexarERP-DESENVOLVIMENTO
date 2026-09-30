/**
 * NOME DO ARQUIVO de documento baixado (2026-09-30, pedido do dono): o PDF ja'
 * sai com o tipo, o numero e o destinatario -- "NFE 000040 - JL SUPERMERCADOS
 * LTDA.pdf" -- para o cliente nao ter que renomear um por um.
 */

/** Caracteres que o Windows nao aceita em nome de arquivo. */
const PROIBIDOS = /[\\/:*?"<>|]/g;
/** Caractere de controle (quebra de linha, tab...) vira espaco. */
const semControle = (texto: string) => Array.from(texto).map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('');

export const nomeArquivoDocumento = (a: {
  /** "NFE", "NFCE", "BOLETO"... */
  tipo: string;
  numero?: string | number | null;
  destinatario?: string | null;
  extensao?: string;
}): string => {
  const limpar = (texto: string) => semControle(texto).replace(PROIBIDOS, ' ').replace(/\s+/g, ' ').trim();
  const numero = a.numero === null || a.numero === undefined || a.numero === ''
    ? ''
    : /^\d+$/.test(String(a.numero)) ? String(a.numero).padStart(6, '0') : String(a.numero);
  const partes = [limpar(`${a.tipo} ${limpar(numero)}`), limpar(String(a.destinatario ?? ''))].filter(Boolean);
  // Nome muito comprido quebra em alguns programas (limite pratico do Windows).
  const base = partes.join(' - ').slice(0, 120).trim().replace(/[ .]+$/, '');
  return `${base || a.tipo}.${a.extensao || 'pdf'}`;
};
