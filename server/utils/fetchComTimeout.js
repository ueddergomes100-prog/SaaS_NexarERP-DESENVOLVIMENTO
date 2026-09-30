/**
 * `fetch` com tempo limite e erro em portugues.
 *
 * Ate 2026-09-30 nenhuma chamada externa do servidor (Spedy, Receita
 * Federal, apicpf, Resend) tinha timeout: o padrao do Node espera ate 5
 * minutos, o proxy da hospedagem corta antes, e a tela ficava presa em
 * "Transmitindo..." sem dizer o que aconteceu. Aqui a espera e' limitada e o
 * erro que sobe ja' vem com `status` HTTP e mensagem pro usuario final
 * (regra 2 do CLAUDE.md) -- as rotas so' repassam.
 */

/**
 * Perfis por tipo de chamada: tempo limite + nome do servico na mensagem.
 * Emissao de nota e' a mais longa: a Spedy valida o XML e pode esperar a
 * SEFAZ antes de responder.
 */
const PERFIS = {
  spedyLeitura: { timeoutMs: 30000, servico: 'A Spedy' },
  spedyEmissao: { timeoutMs: 90000, servico: 'A Spedy' },
  spedyArquivo: { timeoutMs: 60000, servico: 'A Spedy' },
  spedyCadastro: { timeoutMs: 60000, servico: 'A Spedy' },
  receitaFederal: { timeoutMs: 15000, servico: 'A Receita Federal' },
  consultaCpf: { timeoutMs: 15000, servico: 'O serviço de consulta de CPF' },
  email: { timeoutMs: 20000, servico: 'O serviço de e-mail' },
};

const TEMPO_LIMITE = Object.fromEntries(Object.entries(PERFIS).map(([nome, perfil]) => [nome, perfil.timeoutMs]));

class ErroTimeout extends Error {
  constructor(servico, timeoutMs) {
    const segundos = Math.max(1, Math.round(timeoutMs / 1000));
    super(`${servico} não respondeu em ${segundos} segundos. Tente de novo em instantes; se continuar, o serviço pode estar instável.`);
    this.name = 'ErroTimeout';
    this.status = 504;
    this.servico = servico;
    this.timeoutMs = timeoutMs;
  }
}

class ErroConexao extends Error {
  constructor(servico, causa) {
    super(`Não foi possível conectar a ${servico}. Tente de novo em instantes; se continuar, o serviço pode estar fora do ar.`);
    this.name = 'ErroConexao';
    this.status = 502;
    this.servico = servico;
    this.causa = causa;
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [opcoes] mesmas opcoes do fetch (method, headers, body...)
 * @param {{ timeoutMs?: number, servico?: string }} [controle] normalmente um dos PERFIS
 */
async function fetchComTimeout(url, opcoes = {}, controle = {}) {
  const timeoutMs = Number(controle.timeoutMs) > 0 ? Number(controle.timeoutMs) : PERFIS.spedyLeitura.timeoutMs;
  const servico = controle.servico || 'O serviço externo';
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);

  try {
    return await fetch(url, { ...opcoes, signal: controlador.signal });
  } catch (erro) {
    const nome = erro && erro.name;
    if (nome === 'AbortError' || nome === 'TimeoutError') {
      throw new ErroTimeout(servico, timeoutMs);
    }
    // undici: "fetch failed" (TypeError) com a causa em `cause` (ECONNREFUSED, ENOTFOUND...)
    if (erro instanceof TypeError || (erro && erro.cause)) {
      throw new ErroConexao(servico, erro.cause || erro);
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchComTimeout, PERFIS, TEMPO_LIMITE, ErroTimeout, ErroConexao };
