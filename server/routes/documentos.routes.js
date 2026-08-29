// Consulta de CPF/CNPJ pra preencher e validar o cadastro de
// Cliente/Fornecedor a partir de uma fonte oficial/paga, na tela de
// cadastro (autopreenche) e na "lupa" da listagem (confere um registro ja
// existente). Diferente de onboarding.routes.js, aqui o documento estar
// cadastrado no sistema e o resultado ESPERADO, nao um erro -- por isso
// nao reaproveita validateCnpjForOnboarding (que bloqueia CNPJ ja
// cadastrado), so o checksum e a consulta em si.
//
// CNPJ: Receita Federal, publico e gratuito (BrasilAPI/Serpro conforme
// CNPJ_PROVIDER) -- ver server/utils/cnpjLookup.js.
// CPF: nao existe consulta publica gratuita de CPF no Brasil (protegido
// por privacidade) -- usa o provedor pago apicpf.com (APICPF_API_KEY),
// contratado pelo dono do produto 2026-08-29. So devolve nome/genero/data
// de nascimento, sem endereco nem situacao cadastral.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { isValidCnpj, fetchCnpjData } = require('../utils/cnpjLookup');
const { isValidCpf, fetchCpfData } = require('../utils/cpfLookup');

const router = express.Router();

router.use(authenticate);

router.post('/consultar-cnpj', async (req, res) => {
  const cnpj = String(req.body?.cnpj || '').replace(/\D/g, '');

  if (!isValidCnpj(cnpj)) {
    return res.status(400).json({ error: 'CNPJ inválido -- confira os dígitos digitados.' });
  }

  try {
    const dados = await fetchCnpjData(cnpj);
    return res.json({ cnpj, encontrado: true, ...dados });
  } catch (error) {
    if (error.status === 404) {
      return res.json({ cnpj, encontrado: false });
    }
    console.error('[Documentos] Erro ao consultar CNPJ:', error.message);
    return res.status(error.status || 502).json({
      error: 'Não foi possível consultar este CNPJ na Receita Federal agora. Tente novamente em instantes.'
    });
  }
});

router.post('/consultar-cpf', async (req, res) => {
  const cpf = String(req.body?.cpf || '').replace(/\D/g, '');

  if (!isValidCpf(cpf)) {
    return res.status(400).json({ error: 'CPF inválido -- confira os dígitos digitados.' });
  }

  try {
    const dados = await fetchCpfData(cpf);
    return res.json({ cpf, encontrado: true, ...dados });
  } catch (error) {
    if (error.status === 404) {
      return res.json({ cpf, encontrado: false });
    }
    console.error('[Documentos] Erro ao consultar CPF:', error.message);
    return res.status(error.status || 502).json({
      error: error.status && error.status < 500
        ? error.message
        : 'Não foi possível consultar este CPF agora. Tente novamente em instantes.'
    });
  }
});

module.exports = router;
