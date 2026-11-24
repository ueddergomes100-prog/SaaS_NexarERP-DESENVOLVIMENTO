const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

/**
 * E-MAIL DA PLATAFORMA pelo Resend (24/11/2026, cobranca das mensalidades).
 *
 * Mesmo provedor e remetente do codigo de cadastro (RESEND_API_KEY e
 * EMAIL_FROM, ver routes/onboarding.routes.js). O texto cru do Resend (em
 * ingles) fica so' no console do servidor; para a tela vai a mensagem em
 * portugues com `status` (502/503).
 */
class ErroEmail extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const escaparHtml = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Texto simples virando HTML: escapa, quebra linha e transforma https:// em link. */
const textoParaHtml = (texto) => escaparHtml(texto)
  .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
  .split('\n')
  .map((linha) => `<p style="margin:0 0 10px;">${linha}</p>`)
  .join('');

const enviarEmailPeloResend = async ({ para, assunto, texto }) => {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    throw new ErroEmail(503, 'O envio de e-mail não está configurado no servidor (RESEND_API_KEY e EMAIL_FROM). Envie a cobrança pelo WhatsApp ou configure o e-mail na hospedagem.');
  }
  const html = `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">${textoParaHtml(texto)}</div>`;
  const resposta = await fetchComTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: para, subject: assunto, html, text: texto }),
  }, PERFIS.email);
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    console.error(`[E-mail] Resend recusou o envio: HTTP ${resposta.status} ${dados.name || ''} ${dados.message || ''}`.trim());
    throw new ErroEmail(502, 'O serviço de e-mail recusou o envio. Confira o e-mail da empresa e tente de novo; se continuar, envie pelo WhatsApp.');
  }
  return { envioId: typeof dados.id === 'string' ? dados.id : null };
};

module.exports = { ErroEmail, enviarEmailPeloResend, escaparHtml, textoParaHtml };
