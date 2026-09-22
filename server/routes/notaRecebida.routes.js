const express = require('express');
const { authenticate } = require('../middleware/auth');
const { canUseFiscal, resolveTenantId, loadSpedyConfig } = require('../services/spedyAcesso');
const {
  mensagemDeFalha,
  mensagemNaoEncontrada,
  resumoDaNota,
  situacaoDaNota,
  validarChaveAcesso,
} = require('../services/notaRecebida');

const router = express.Router();
router.use(authenticate);

/**
 * BUSCAR NOTA DE ENTRADA PELA CHAVE DE ACESSO -- ver services/notaRecebida.js.
 *
 * A chave da Spedy nunca sai do servidor: a tela manda so' os 44 numeros e
 * recebe de volta o XML ou o proximo passo.
 */

const podeDarEntrada = (user) => {
  if (!user) return false;
  if (user.isPlatformAdmin || user.isTenantManager) return true;
  const permissoes = Array.isArray(user.permissoes) ? user.permissoes : [];
  return permissoes.includes('fiscal.entrada') || canUseFiscal(user);
};

const chamarSpedy = async (config, caminho, opcoes = {}) => {
  const resposta = await fetch(`${config.baseUrl}${caminho}`, {
    ...opcoes,
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  });
  return resposta;
};

/** GET /api/entrada-nfe/buscar?chave=... */
router.get('/buscar', async (req, res) => {
  try {
    if (!podeDarEntrada(req.user)) {
      return res.status(403).json({ error: 'Você não tem permissão para dar entrada de notas.' });
    }

    const { ok, chave, erro } = validarChaveAcesso(req.query.chave);
    if (!ok) return res.status(400).json({ error: erro });

    const tenantId = resolveTenantId(req);
    const config = await loadSpedyConfig(tenantId);

    const resposta = await chamarSpedy(config, `/inbound-product-invoices?accessKey=${chave}`);
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      let parsed = corpo;
      try { parsed = JSON.parse(corpo); } catch { /* texto puro */ }
      return res.status(resposta.status === 404 ? 404 : 502).json({ error: mensagemDeFalha(resposta.status, parsed) });
    }

    const dados = await resposta.json();
    const nota = Array.isArray(dados?.data) ? dados.data[0] : (Array.isArray(dados) ? dados[0] : dados?.data);
    if (!nota) return res.status(404).json({ error: mensagemNaoEncontrada(), situacao: 'nao_encontrada' });

    const { situacao, motivo } = situacaoDaNota(nota);
    const resumo = resumoDaNota(nota);

    if (situacao === 'cancelada') return res.status(409).json({ error: motivo, situacao, nota: resumo });
    if (situacao === 'manifestar') return res.json({ situacao, motivo, nota: resumo });

    // XML completo disponivel: baixa e devolve pro MESMO parser da tela.
    const respostaXml = await chamarSpedy(config, `/inbound-product-invoices/${resumo.id}/xml`);
    if (!respostaXml.ok) {
      const corpo = await respostaXml.text().catch(() => '');
      return res.status(502).json({ error: mensagemDeFalha(respostaXml.status, corpo) });
    }
    const xml = await respostaXml.text();
    return res.json({ situacao: 'pronta', nota: resumo, xml });
  } catch (erro) {
    console.error('[Nota recebida] buscar:', erro);
    return res.status(erro.status || 500).json({
      error: erro.message || 'Não foi possível consultar a nota agora. Tente novamente em instantes.',
    });
  }
});

/**
 * POST /api/entrada-nfe/manifestar { id }
 *
 * Registra a CIENCIA DA OPERACAO na SEFAZ e devolve o XML completo. E' ato
 * fiscal em nome da empresa: a tela so' chama depois de o usuario confirmar,
 * nunca sozinha. Ciencia e' a manifestacao reversivel -- as outras
 * (desconhecimento, operacao nao realizada) sao definitivas e ficam de fora
 * desta rota de proposito.
 */
router.post('/manifestar', async (req, res) => {
  try {
    if (!podeDarEntrada(req.user)) {
      return res.status(403).json({ error: 'Você não tem permissão para dar entrada de notas.' });
    }
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Nota não informada. Busque a nota pela chave antes de registrar a ciência.' });

    const tenantId = resolveTenantId(req);
    const config = await loadSpedyConfig(tenantId);

    const resposta = await chamarSpedy(config, `/inbound-product-invoices/${id}/manifest`, {
      method: 'POST',
      body: JSON.stringify({ status: 'acknowledged' }),
    });
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      let parsed = corpo;
      try { parsed = JSON.parse(corpo); } catch { /* texto puro */ }
      return res.status(502).json({ error: mensagemDeFalha(resposta.status, parsed) });
    }

    const respostaXml = await chamarSpedy(config, `/inbound-product-invoices/${id}/xml`);
    if (!respostaXml.ok) {
      return res.status(202).json({
        situacao: 'aguardando',
        aviso: 'A ciência foi registrada na SEFAZ. O XML completo costuma chegar em alguns segundos — '
          + 'busque a chave de novo em instantes.',
      });
    }
    const xml = await respostaXml.text();
    return res.json({ situacao: 'pronta', xml });
  } catch (erro) {
    console.error('[Nota recebida] manifestar:', erro);
    return res.status(erro.status || 500).json({
      error: erro.message || 'Não foi possível registrar a ciência agora. Tente novamente em instantes.',
    });
  }
});

module.exports = router;
