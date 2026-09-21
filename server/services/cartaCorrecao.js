/**
 * CARTA DE CORRECAO ELETRONICA (CC-e) DA NF-e (2026-09-21).
 *
 * Regras vindas da Spedy (docs.spedy.com.br, "Cancelamento, correcao e
 * inutilizacao" + OpenAPI v1) e da SEFAZ:
 *  - so' NF-e (modelo 55) AUTORIZADA; NFC-e e NFS-e nao tem carta de correcao;
 *  - texto de 15 a 1000 caracteres;
 *  - corrige so' dado acessorio: NAO corrige valores, impostos, dados do
 *    destinatario (nome, CPF/CNPJ, endereco), datas nem o CFOP que muda a
 *    natureza da operacao -- pra isso e' cancelar e reemitir (ou devolver);
 *  - a SEFAZ aceita ate 20 cartas por nota.
 *
 * Estas regras rodam AQUI (servidor) de proposito: a tela tambem confere, mas
 * quem abrir o DevTools nao pode pular o limite nem mandar texto invalido.
 * A versao da tela e' src/utils/cartaCorrecaoDomain.ts -- manter as duas iguais.
 */

const MIN_CARACTERES = 15;
const MAX_CARACTERES = 1000;
const MAX_CARTAS_POR_NOTA = 20;

/** Tira quebras de linha e espacos repetidos/nas pontas -- a SEFAZ nao aceita. */
const normalizarTexto = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();

/** @returns {{ ok: true, texto: string } | { ok: false, erro: string }} */
const validarCarta = (texto) => {
  const limpo = normalizarTexto(texto);
  if (limpo.length < MIN_CARACTERES) {
    return {
      ok: false,
      erro: `A carta de correção precisa ter pelo menos ${MIN_CARACTERES} caracteres (a sua tem ${limpo.length}). Explique o que está errado na nota e qual é o dado correto.`,
    };
  }
  if (limpo.length > MAX_CARACTERES) {
    return {
      ok: false,
      erro: `A carta de correção pode ter no máximo ${MAX_CARACTERES} caracteres (a sua tem ${limpo.length}). Resuma o texto.`,
    };
  }
  return { ok: true, texto: limpo };
};

/**
 * A nota local pode receber mais uma carta? Devolve a mensagem de bloqueio, ou
 * null quando pode.
 * @param {{ tipo?: string, status?: string, cartasCorrecao?: unknown[] }} nota
 */
const motivoQueImpedeCarta = (nota) => {
  if (!nota) return 'Nota fiscal não encontrada neste sistema.';
  if (nota.tipo !== 'NF-e') {
    return 'Carta de correção existe só para NF-e. NFC-e e NFS-e não têm esse recurso: se houver erro, cancele a nota (dentro do prazo) e emita outra.';
  }
  if (nota.status !== 'authorized') {
    return 'Só uma NF-e autorizada pode receber carta de correção. Espere a autorização, ou corrija os dados e retransmita a nota rejeitada.';
  }
  const enviadas = Array.isArray(nota.cartasCorrecao) ? nota.cartasCorrecao.length : 0;
  if (enviadas >= MAX_CARTAS_POR_NOTA) {
    return `Esta nota já recebeu ${MAX_CARTAS_POR_NOTA} cartas de correção, que é o limite da SEFAZ. Para novos ajustes, cancele a nota (se ainda estiver no prazo) ou emita uma nota de devolução.`;
  }
  return null;
};

module.exports = {
  MIN_CARACTERES,
  MAX_CARACTERES,
  MAX_CARTAS_POR_NOTA,
  normalizarTexto,
  validarCarta,
  motivoQueImpedeCarta,
};
