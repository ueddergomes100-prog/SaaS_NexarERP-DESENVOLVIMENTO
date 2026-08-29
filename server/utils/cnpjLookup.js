// Validacao de checksum e consulta de CNPJ na Receita Federal (via BrasilAPI
// ou Serpro, conforme CNPJ_PROVIDER) -- extraido de onboarding.routes.js pra
// ser reaproveitado tambem pela consulta de CPF/CNPJ de Clientes/Fornecedores
// (documentos.routes.js). Onboarding usa pra validar o CNPJ da empresa que
// esta se cadastrando; documentos.routes.js usa pra "validar" um CNPJ que JA
// esta cadastrado (Clientes/Fornecedores) -- por isso o check de "CNPJ ja
// existe no SaaS" fica em onboarding.routes.js, nao aqui.

const onlyDigits = (value = '') => String(value).replace(/\D/g, '');

const isValidCnpj = (cnpj) => {
  const clean = onlyDigits(cnpj);
  if (clean.length !== 14 || /^(\d)\1+$/.test(clean)) return false;

  const calcDigit = (base, weights) => {
    const sum = weights.reduce((acc, weight, index) => acc + Number(base[index]) * weight, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const digit1 = calcDigit(clean.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digit2 = calcDigit(clean.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digit1 === Number(clean[12]) && digit2 === Number(clean[13]);
};

const parseBrasilApiCnpj = (data, cnpj) => {
  const statusCode = String(data.situacao_cadastral || '').trim();
  const statusDescription = String(data.descricao_situacao_cadastral || '').trim().toUpperCase();
  const isActive = statusCode === '2' || statusDescription === 'ATIVA';

  return {
    cnpj,
    razaoSocial: data.razao_social || '',
    nomeFantasia: data.nome_fantasia || '',
    situacao: statusDescription || statusCode || 'NAO_INFORMADA',
    ativo: isActive,
    abertura: data.data_inicio_atividade || '',
    municipio: data.municipio || '',
    uf: data.uf || '',
    cep: onlyDigits(data.cep || ''),
    logradouro: data.logradouro || '',
    numero: data.numero || '',
    bairro: data.bairro || '',
    telefone: [data.ddd_telefone_1, data.ddd_telefone_2].filter(Boolean).join(' / '),
    email: data.email || '',
    provider: 'brasilapi'
  };
};

/** Consulta o cadastro do CNPJ na Receita Federal. Lanca erro com
 * `error.status` (404 = CNPJ nao encontrado, 502 = provedor fora do ar,
 * 500 = provedor Serpro nao configurado) -- nunca inventa dado quando a
 * consulta falha. */
const fetchCnpjData = async (cnpjInput) => {
  const cnpj = onlyDigits(cnpjInput);
  const provider = (process.env.CNPJ_PROVIDER || 'brasilapi').toLowerCase();

  if (provider === 'serpro') {
    const baseUrl = process.env.SERPRO_CNPJ_BASE_URL;
    const bearerToken = process.env.SERPRO_CNPJ_BEARER_TOKEN;

    if (!baseUrl || !bearerToken) {
      const error = new Error('Consulta CNPJ Serpro nao configurada no backend.');
      error.status = 500;
      throw error;
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${cnpj}`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || 'CNPJ nao encontrado na Receita Federal.');
      error.status = response.status === 404 ? 404 : 502;
      throw error;
    }

    const situacao = String(data.situacaoCadastral || data.situacao || '').toUpperCase();
    return {
      cnpj,
      razaoSocial: data.nomeEmpresarial || data.razaoSocial || '',
      nomeFantasia: data.nomeFantasia || '',
      situacao,
      ativo: situacao === 'ATIVA' || situacao === '2',
      abertura: data.dataAbertura || data.dataInicioAtividade || '',
      municipio: data.municipio || data.endereco?.municipio || '',
      uf: data.uf || data.endereco?.uf || '',
      cep: onlyDigits(data.cep || data.endereco?.cep || ''),
      logradouro: data.logradouro || data.endereco?.logradouro || '',
      numero: data.numero || data.endereco?.numero || '',
      bairro: data.bairro || data.endereco?.bairro || '',
      telefone: data.telefone || '',
      email: data.email || '',
      provider: 'serpro'
    };
  }

  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'User-Agent': 'HennderERP-Onboarding/1.0 (+https://hennder-erp.local)'
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || 'CNPJ nao encontrado.');
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }

  return parseBrasilApiCnpj(data, cnpj);
};

module.exports = {
  onlyDigits,
  isValidCnpj,
  fetchCnpjData
};
