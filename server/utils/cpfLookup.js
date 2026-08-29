// Validacao de checksum e consulta de CPF via apicpf.com (contratado
// 2026-08-29, chave em APICPF_API_KEY). Diferente do CNPJ (Receita
// Federal, publico e gratuito via BrasilAPI/Serpro), consulta de CPF NAO
// tem fonte publica gratuita no Brasil -- e' um provedor pago, e o
// retorno so traz nome/genero/data de nascimento, sem endereco nem
// situacao cadastral.

const onlyDigits = (value = '') => String(value).replace(/\D/g, '');

const isValidCpf = (cpf) => {
  const clean = onlyDigits(cpf);
  if (clean.length !== 11 || /^(\d)\1+$/.test(clean)) return false;

  const calcDigit = (base, factorStart) => {
    let sum = 0;
    let factor = factorStart;
    for (const digit of base) {
      sum += Number(digit) * factor;
      factor -= 1;
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const digit1 = calcDigit(clean.slice(0, 9), 10);
  const digit2 = calcDigit(clean.slice(0, 10), 11);
  return digit1 === Number(clean[9]) && digit2 === Number(clean[10]);
};

/** Consulta nome/genero/data de nascimento do CPF via apicpf.com. Lanca
 * erro com `error.status` (404 = nao encontrado, 401/403 = chave invalida
 * ou expirada, 429 = limite de consultas excedido, 500 = provedor nao
 * configurado) -- nunca inventa dado quando a consulta falha. */
const fetchCpfData = async (cpfInput) => {
  const cpf = onlyDigits(cpfInput);
  const apiKey = process.env.APICPF_API_KEY;

  if (!apiKey) {
    const error = new Error('Consulta de CPF nao configurada no backend.');
    error.status = 500;
    throw error;
  }

  const response = await fetch(`https://apicpf.com/api/consulta?cpf=${cpf}`, {
    headers: {
      'X-API-KEY': apiKey,
      Accept: 'application/json'
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const mensagens = {
      400: 'CPF invalido.',
      401: 'Chave de API de consulta de CPF invalida.',
      403: 'Chave de API de consulta de CPF expirada.',
      404: 'CPF nao encontrado.',
      429: 'Limite de consultas de CPF excedido -- tente novamente em instantes.'
    };
    const error = new Error(mensagens[response.status] || 'Nao foi possivel consultar este CPF agora.');
    error.status = response.status;
    throw error;
  }

  const data = body.data || {};
  return {
    cpf,
    nome: data.nome || '',
    genero: data.genero || '',
    dataNascimento: data.data_nascimento || ''
  };
};

module.exports = {
  onlyDigits,
  isValidCpf,
  fetchCpfData
};
