const express = require('express');
const nodemailer = require('nodemailer');
const { authenticate } = require('../middleware/auth');
const { admin, db } = require('../config/firebase');
const { canUseFiscal, resolveTenantId, loadSpedyConfig } = require('../services/spedyAcesso');
const {
  emailValido,
  erroDaConfiguracaoSmtp,
  opcoesDoTransporte,
  traduzirErroSmtp,
  montarMensagem,
  nomeDoAnexo,
} = require('../services/emailNota');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

const router = express.Router();
router.use(authenticate);

/**
 * E-MAIL DA NOTA AO CLIENTE (PDF + XML) -- ver services/emailNota.js.
 *
 * Remetente = e-mail da empresa (Configuracoes > perfil da empresa), enviado pelo SMTP que a propria
 * empresa cadastrou (a senha fica so' em configuracoes_privadas e nunca volta para a tela).
 * Destinatario = e-mail do CADASTRO do cliente. A tela manda so' QUAL nota; o resto e' lido aqui.
 */

const TIPO_PARA_CAMINHO = {
  'NF-e': 'product-invoices',
  'NFC-e': 'consumer-invoices',
  'NFS-e': 'service-invoices',
};

class ErroEmail extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const responder = (res, erro, operacao) => {
  if (erro instanceof ErroEmail) return res.status(erro.status).json({ error: erro.message });
  console.error(`[E-mail da nota] ${operacao}:`, erro);
  return res.status(erro.status || 500).json({ error: erro.message || 'Não foi possível enviar o e-mail. Tente de novo em instantes.' });
};

/** Configuracao da empresa: remetente (perfil) + SMTP (privado). */
const carregarConfiguracao = async (tenantId) => {
  const [publica, privada] = await Promise.all([
    db.collection('configuracoes').doc(tenantId).get(),
    db.collection('configuracoes_privadas').doc(tenantId).get(),
  ]);
  const pub = publica.exists ? publica.data() : {};
  const priv = privada.exists ? privada.data() : {};
  const empresaEmail = String(pub.email || '').trim();
  const empresaNome = String(pub.nomeOficina || pub.nomeFantasia || pub.razaoSocial || 'Empresa').trim();
  if (!emailValido(empresaEmail)) {
    throw new ErroEmail(400, 'O e-mail da empresa não está preenchido (ele é o remetente). Preencha em Configurações › Dados da Empresa.');
  }
  const erroSmtp = erroDaConfiguracaoSmtp(priv);
  if (erroSmtp) throw new ErroEmail(400, erroSmtp);
  return { empresaEmail, empresaNome, smtp: priv };
};

const criarTransporte = (smtp) => nodemailer.createTransport(opcoesDoTransporte(smtp));

/** E-mail do cadastro do cliente; cai para o que foi digitado na nota se o cadastro estiver vazio. */
const destinatarioDaNota = async (tenantId, nota) => {
  let cliente = null;
  if (nota.clienteId) {
    const snap = await db.collection('clientes').doc(String(nota.clienteId)).get();
    if (snap.exists && snap.data().tenantId === tenantId) cliente = snap.data();
  }
  const doCadastro = String(cliente?.email || '').trim();
  const digitado = String(nota.emailDestinatario || '').trim();
  const email = emailValido(doCadastro) ? doCadastro : (emailValido(digitado) ? digitado : '');
  return { email, nome: String(cliente?.nome || nota.clienteNome || '').trim(), doCadastro };
};

const baixarArquivo = async ({ apiKey, baseUrl }, caminho, spedyId, extensao) => {
  const resposta = await fetchComTimeout(`${baseUrl}/${caminho}/${spedyId}/${extensao}`, { method: 'GET', headers: { 'X-Api-Key': apiKey } }, PERFIS.spedyArquivo);
  if (!resposta.ok) {
    throw new ErroEmail(502, `Não consegui baixar o ${extensao.toUpperCase()} da nota na Spedy. Tente de novo em instantes.`);
  }
  return Buffer.from(await resposta.arrayBuffer());
};

/** Envia o e-mail da nota. Body: { forcar?: boolean } -- sem forcar, nota ja enviada nao envia de novo. */
router.post('/nota/:notaId/enviar', async (req, res) => {
  const tenantId = resolveTenantId(req);
  const notaRef = db.collection('notas_fiscais').doc(String(req.params.notaId));
  const registrar = (dados) => notaRef.update({ emailEnvio: dados }).catch((e) => console.error('[E-mail da nota] não gravou o resultado:', e.message));
  try {
    if (!canUseFiscal(req.user, 'emit')) throw new ErroEmail(403, 'Acesso negado ao módulo fiscal.');
    const notaSnap = await notaRef.get();
    if (!notaSnap.exists || notaSnap.data().tenantId !== tenantId) throw new ErroEmail(404, 'Nota não encontrada.');
    const nota = notaSnap.data();
    const caminho = TIPO_PARA_CAMINHO[nota.tipo];
    if (!caminho || !nota.spedyId) throw new ErroEmail(400, 'Esta nota não pode ser enviada por e-mail (tipo ou identificação inválidos).');
    if (nota.status !== 'authorized') throw new ErroEmail(409, 'A nota ainda não foi autorizada. O e-mail só pode ser enviado depois da autorização.');

    const destino = await destinatarioDaNota(tenantId, nota);
    if (!destino.email) {
      throw new ErroEmail(422, `${destino.nome ? `O cliente ${destino.nome}` : 'O cliente'} não tem e-mail cadastrado. Cadastre o e-mail em Clientes e use "Reenviar e-mail".`);
    }
    if (nota.emailEnvio?.status === 'enviado' && !req.body?.forcar) {
      return res.json({ ok: true, jaEnviado: true, para: nota.emailEnvio.para || destino.email });
    }

    const { empresaEmail, empresaNome, smtp } = await carregarConfiguracao(tenantId);
    const acesso = await loadSpedyConfig(tenantId);
    const [pdf, xml] = await Promise.all([
      baixarArquivo(acesso, caminho, nota.spedyId, 'pdf'),
      baixarArquivo(acesso, caminho, nota.spedyId, 'xml'),
    ]);

    const msg = montarMensagem({ empresaNome, empresaEmail, tipo: nota.tipo, numero: nota.number, chave: nota.accessKey, clienteNome: destino.nome });
    try {
      await criarTransporte(smtp).sendMail({
        from: { name: empresaNome, address: empresaEmail },
        replyTo: empresaEmail,
        to: destino.email,
        subject: msg.assunto,
        text: msg.texto,
        html: msg.html,
        attachments: [
          { filename: nomeDoAnexo(nota.tipo, nota.number, nota.accessKey, 'pdf'), content: pdf, contentType: 'application/pdf' },
          { filename: nomeDoAnexo(nota.tipo, nota.number, nota.accessKey, 'xml'), content: xml, contentType: 'application/xml' },
        ],
      });
    } catch (erroSmtp) {
      const mensagem = traduzirErroSmtp(erroSmtp);
      console.error('[E-mail da nota] SMTP:', erroSmtp.code || '', erroSmtp.responseCode || '', erroSmtp.message);
      await registrar({ status: 'erro', erro: mensagem, para: destino.email, em: admin.firestore.FieldValue.serverTimestamp(), por: req.user.uid });
      throw new ErroEmail(502, mensagem);
    }

    await registrar({ status: 'enviado', para: destino.email, em: admin.firestore.FieldValue.serverTimestamp(), por: req.user.uid });
    return res.json({ ok: true, para: destino.email });
  } catch (erro) {
    return responder(res, erro, 'enviar');
  }
});

/**
 * Teste da configuracao: manda um e-mail curto DO e-mail da empresa PARA ele mesmo, usando o SMTP salvo.
 * Assim a empresa descobre na hora se host/porta/usuario/senha estao certos, antes de uma nota de verdade.
 */
router.post('/teste', async (req, res) => {
  try {
    const usuario = req.user || {};
    if (!(usuario.isPlatformAdmin || usuario.isTenantManager)) {
      throw new ErroEmail(403, 'Só o administrador da empresa pode testar o envio de e-mail.');
    }
    const tenantId = resolveTenantId(req);
    const { empresaEmail, empresaNome, smtp } = await carregarConfiguracao(tenantId);
    try {
      await criarTransporte(smtp).sendMail({
        from: { name: empresaNome, address: empresaEmail },
        to: empresaEmail,
        subject: `Teste de e-mail das notas — ${empresaNome}`,
        text: `Este é um teste do envio de notas fiscais por e-mail. Se você recebeu esta mensagem, a configuração está correta.\n\n${empresaNome}`,
      });
    } catch (erroSmtp) {
      console.error('[E-mail da nota] teste SMTP:', erroSmtp.code || '', erroSmtp.responseCode || '', erroSmtp.message);
      throw new ErroEmail(502, traduzirErroSmtp(erroSmtp));
    }
    return res.json({ ok: true, para: empresaEmail });
  } catch (erro) {
    return responder(res, erro, 'teste');
  }
});

module.exports = router;
