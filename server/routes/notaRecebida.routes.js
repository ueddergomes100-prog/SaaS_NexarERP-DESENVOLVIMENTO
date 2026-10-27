const express = require('express');
const { authenticate } = require('../middleware/auth');
const { canUseFiscal, resolveTenantId, loadSpedyConfig, idSpedyValido } = require('../services/spedyAcesso');
const {
  TIPOS_RECEBIDA,
  consultaDaLista,
  itemDaListaRecebida,
  mensagemDaSincronizacao,
  tipoRecebida,
  mensagemDeFalha,
  erroDeModeloDaChave,
  mensagemNaoEncontrada,
  resumoDaNota,
  situacaoDaNota,
  validarChaveAcesso,
} = require('../services/notaRecebida');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

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

// Busca na SEFAZ (via Spedy) pode demorar: usa o perfil mais longo de leitura.
const chamarSpedy = async (config, caminho, opcoes = {}) => {
  const resposta = await fetchComTimeout(`${config.baseUrl}${caminho}`, {
    ...opcoes,
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  }, PERFIS.spedyCadastro);
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
    const erroModelo = erroDeModeloDaChave(chave);
    if (erroModelo) return res.status(400).json({ error: erroModelo });

    const tenantId = resolveTenantId(req);
    const config = await loadSpedyConfig(tenantId);

    const resposta = await chamarSpedy(config, `/inbound-product-invoices?accessKey=${chave}`);
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      let parsed = corpo;
      try { parsed = JSON.parse(corpo); } catch { /* texto puro */ }
      if (resposta.status === 404) return res.status(404).json({ error: mensagemNaoEncontrada(chave), situacao: 'nao_encontrada' });
      return res.status(502).json({ error: mensagemDeFalha(resposta.status, parsed) });
    }

    const dados = await resposta.json();
    const nota = Array.isArray(dados?.data) ? dados.data[0] : (Array.isArray(dados) ? dados[0] : dados?.data);
    if (!nota) return res.status(404).json({ error: mensagemNaoEncontrada(chave), situacao: 'nao_encontrada' });

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
    if (!idSpedyValido(id)) return res.status(400).json({ error: 'Identificação da nota inválida. Busque a nota pela chave de novo antes de registrar a ciência.' });

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

// ---------------------------------------------------------------------------
// NOTAS RECEBIDAS: LISTA + IMPORTAR COM UM CLIQUE (27/10/2026)
// ---------------------------------------------------------------------------

const lerCorpo = async (resposta) => {
  const texto = await resposta.text().catch(() => '');
  try { return JSON.parse(texto); } catch { return texto; }
};

/** GET /api/entrada-nfe/recebidas?tipo=nfe|nfse&de=AAAA-MM-DD&ate=AAAA-MM-DD&cursor= */
router.get('/recebidas', async (req, res) => {
  try {
    if (!podeDarEntrada(req.user)) return res.status(403).json({ error: 'Você não tem permissão para dar entrada de notas.' });
    const tipo = tipoRecebida(req.query.tipo);
    if (!tipo) return res.status(400).json({ error: 'Tipo de nota inválido.' });
    const consulta = consultaDaLista({ de: req.query.de, ate: req.query.ate, cursor: req.query.cursor });
    if (!consulta.ok) return res.status(400).json({ error: consulta.erro });

    const config = await loadSpedyConfig(resolveTenantId(req));
    const resposta = await chamarSpedy(config, `/${TIPOS_RECEBIDA[tipo]}?${consulta.query}`);
    if (!resposta.ok) return res.status(502).json({ error: mensagemDeFalha(resposta.status, await lerCorpo(resposta)) });
    const dados = await resposta.json();
    const itens = Array.isArray(dados?.items) ? dados.items : [];
    return res.json({
      notas: itens.map((n) => itemDaListaRecebida(n, tipo)),
      proximaPagina: dados?.hasNext && dados?.nextCursor ? String(dados.nextCursor) : null,
    });
  } catch (erro) {
    console.error('[Nota recebida] listar:', erro);
    return res.status(erro.status || 500).json({ error: erro.message || 'Não foi possível buscar as notas recebidas agora. Tente novamente em instantes.' });
  }
});

/** POST /api/entrada-nfe/recebidas/sincronizar { tipo } -- antecipa a busca automatica da Spedy. */
router.post('/recebidas/sincronizar', async (req, res) => {
  try {
    if (!podeDarEntrada(req.user)) return res.status(403).json({ error: 'Você não tem permissão para dar entrada de notas.' });
    const tipo = tipoRecebida(req.body?.tipo);
    if (!tipo) return res.status(400).json({ error: 'Tipo de nota inválido.' });
    const config = await loadSpedyConfig(resolveTenantId(req));
    const resposta = await chamarSpedy(config, `/${TIPOS_RECEBIDA[tipo]}/sync`, { method: 'POST', body: '{}' });
    if (resposta.status === 429) return res.status(429).json({ error: mensagemDaSincronizacao(await lerCorpo(resposta)) });
    if (!resposta.ok) return res.status(502).json({ error: mensagemDeFalha(resposta.status, await lerCorpo(resposta)) });
    return res.json({ ok: true, aviso: 'Busca pedida. As notas novas costumam aparecer em alguns minutos.' });
  } catch (erro) {
    console.error('[Nota recebida] sincronizar:', erro);
    return res.status(erro.status || 500).json({ error: erro.message || 'Não foi possível pedir a busca agora. Tente novamente em instantes.' });
  }
});

/**
 * POST /api/entrada-nfe/recebidas/importar { tipo, id } -> { situacao: 'pronta', xml } ou 'aguardando'.
 *
 * O clique em "Importar" e' o pedido do usuario: na NF-e ainda sem XML
 * completo, registra a CIENCIA DA OPERACAO (manifestacao reversivel, a tela
 * avisa antes) e baixa o XML. Na NFS-e nao manifesta: a manifestacao dela e'
 * definitiva (confirmacao/rejeicao) e fica com a pessoa, fora do sistema.
 */
router.post('/recebidas/importar', async (req, res) => {
  try {
    if (!podeDarEntrada(req.user)) return res.status(403).json({ error: 'Você não tem permissão para dar entrada de notas.' });
    const tipo = tipoRecebida(req.body?.tipo);
    if (!tipo) return res.status(400).json({ error: 'Tipo de nota inválido.' });
    const id = String(req.body?.id || '').trim();
    if (!idSpedyValido(id)) return res.status(400).json({ error: 'Identificação da nota inválida. Recarregue a lista de notas recebidas.' });

    const config = await loadSpedyConfig(resolveTenantId(req));
    const base = `/${TIPOS_RECEBIDA[tipo]}/${id}`;
    const respostaNota = await chamarSpedy(config, base);
    if (respostaNota.status === 404) return res.status(404).json({ error: 'Esta nota não está mais na lista de notas recebidas. Recarregue a lista.' });
    if (!respostaNota.ok) return res.status(502).json({ error: mensagemDeFalha(respostaNota.status, await lerCorpo(respostaNota)) });
    const item = itemDaListaRecebida(await respostaNota.json(), tipo);

    if (item.situacao === 'cancelada') return res.status(409).json({ error: `A nota ${item.numero} de ${item.emitenteNome} foi cancelada. Não é possível dar entrada nela.` });
    if (item.situacao === 'indisponivel') {
      return res.status(409).json({ error: 'O XML completo desta NFS-e ainda não está disponível no Ambiente Nacional. Tente de novo mais tarde, ou peça o XML ao prestador e use "Importar o XML da NFS-e".' });
    }
    if (item.situacao === 'ciencia') {
      const manifesto = await chamarSpedy(config, `${base}/manifest`, { method: 'POST', body: JSON.stringify({ status: 'acknowledged' }) });
      if (!manifesto.ok) return res.status(502).json({ error: mensagemDeFalha(manifesto.status, await lerCorpo(manifesto)) });
    }
    const respostaXml = await chamarSpedy(config, `${base}/xml`);
    if (!respostaXml.ok) {
      if (item.situacao === 'ciencia') {
        return res.status(202).json({ situacao: 'aguardando', aviso: 'A ciência foi registrada na SEFAZ. O XML completo costuma chegar em alguns segundos: clique em Importar de novo em instantes.' });
      }
      return res.status(502).json({ error: mensagemDeFalha(respostaXml.status, await lerCorpo(respostaXml)) });
    }
    return res.json({ situacao: 'pronta', xml: await respostaXml.text(), nota: item });
  } catch (erro) {
    console.error('[Nota recebida] importar:', erro);
    return res.status(erro.status || 500).json({ error: erro.message || 'Não foi possível importar a nota agora. Tente novamente em instantes.' });
  }
});

module.exports = router;
