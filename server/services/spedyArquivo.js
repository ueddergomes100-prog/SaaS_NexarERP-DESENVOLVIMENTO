/*
 * DOWNLOAD DE PDF/XML NA SPEDY RESPEITANDO O LIMITE DE CONSULTAS (13/10/2026).
 *
 * A Spedy aceita 60 requisicoes por minuto (e 5 por segundo) por empresa e
 * responde 429 acima disso, com `x-rate-limit-reset` dizendo quando libera
 * (https://api.spedy.com.br/llms.txt, "Rate Limit"). O lote de NF-e passava
 * disso (emissao + consultas + e-mail de cada nota) e, logo depois, "Imprimir
 * as emitidas" e o e-mail das notas recebiam 429 em tudo: o dono viu "Nenhum
 * PDF das notas autorizadas pode ser baixado" e o e-mail nao saia.
 *
 * Aqui o download espera a Spedy liberar e tenta de novo (ate' 3 vezes, no
 * maximo ~15 s de espera por vez) antes de desistir.
 */
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

const ESPERA_MINIMA_MS = 1000;
const ESPERA_MAXIMA_MS = 15000;

const esperarPadrao = (ms) => new Promise((resolver) => { setTimeout(resolver, ms); });

/** Quanto esperar antes de tentar de novo: ate' a hora do reset, dentro de 1 s e 15 s. */
const esperaAteLiberar = (resposta, tentativa, agoraMs = Date.now()) => {
  const reset = resposta && resposta.headers && typeof resposta.headers.get === 'function'
    ? resposta.headers.get('x-rate-limit-reset')
    : null;
  const alvo = reset ? Date.parse(reset) : Number.NaN;
  const ms = Number.isFinite(alvo) ? alvo - agoraMs + 300 : 5000 * (tentativa + 1);
  return Math.min(ESPERA_MAXIMA_MS, Math.max(ESPERA_MINIMA_MS, ms));
};

const MENSAGEM_LIMITE_SPEDY = 'A Spedy recebeu consultas demais desta empresa no último minuto (o limite é 60 por minuto). Aguarde um minuto e tente de novo.';

/**
 * GET {baseUrl}/{caminho}/{id}/{extensao} na Spedy. Devolve a ultima resposta
 * (quem chama confere `ok`); so' repete quando a resposta e' 429.
 */
const baixarArquivoDaSpedy = async ({ apiKey, baseUrl }, caminho, id, extensao, opcoes = {}) => {
  const { tentativas = 3, esperar = esperarPadrao, buscar = fetchComTimeout } = opcoes;
  for (let tentativa = 0; ; tentativa += 1) {
    const resposta = await buscar(`${baseUrl}/${caminho}/${id}/${extensao}`, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    }, PERFIS.spedyArquivo);
    if (resposta.status !== 429 || tentativa >= tentativas - 1) return resposta;
    await esperar(esperaAteLiberar(resposta, tentativa));
  }
};

module.exports = { baixarArquivoDaSpedy, esperaAteLiberar, MENSAGEM_LIMITE_SPEDY };
