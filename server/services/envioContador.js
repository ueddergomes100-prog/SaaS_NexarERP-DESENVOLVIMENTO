/*
 * ENVIO DO RELATORIO AO CONTADOR (pedido do dono, 20/10/2026) -- fase 2 do
 * Relatorio do Contador. A tela monta o PDF do relatorio e o .zip com os XMLs
 * (emitidas pela Spedy, recebidas do XML guardado, cartas de correcao) e manda
 * para ca'; daqui sai o e-mail pelo SMTP da propria empresa (o mesmo do e-mail
 * das notas), do e-mail da empresa para o e-mail do contador. O e-mail do
 * contador fica guardado na configuracao (`emailContador`) para a proxima vez.
 */
const { db } = require('../config/firebase');
const { emailValido, erroDaConfiguracaoSmtp, traduzirErroSmtp } = require('./emailNota');
const { registrarLog } = require('./auditoria');

class ErroEnvioContador extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PERMISSAO = 'fiscal.relatorio_contador';
/** Soma dos anexos depois de decodificar (a maioria dos provedores recusa acima de ~20 MB). */
const LIMITE_ANEXOS_BYTES = 18 * 1024 * 1024;
const TIPOS = { pdf: 'application/pdf', zip: 'application/zip' };

const escaparHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nomeSeguro = (nome, extensao) => {
  const base = String(nome || '').replace(/[<>:"\\/|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return base.toLowerCase().endsWith(`.${extensao}`) ? base : `${base || 'relatorio-contador'}.${extensao}`;
};

/** Le e confere o pedido da tela. */
const lerPedido = (corpo) => {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const para = String(c.para || '').trim();
  if (!emailValido(para)) throw new ErroEnvioContador(400, 'Informe um e-mail válido do contador.');
  const periodo = String(c.periodo || '').trim().slice(0, 60);
  const anexosBrutos = Array.isArray(c.anexos) ? c.anexos.slice(0, 3) : [];
  const anexos = [];
  let total = 0;
  for (const a of anexosBrutos) {
    const tipo = a && TIPOS[a.tipo] ? a.tipo : null;
    if (!tipo || typeof a.base64 !== 'string' || !a.base64) continue;
    const conteudo = Buffer.from(a.base64, 'base64');
    total += conteudo.length;
    anexos.push({ filename: nomeSeguro(a.nome, tipo), content: conteudo, contentType: TIPOS[tipo] });
  }
  if (anexos.length === 0) throw new ErroEnvioContador(400, 'Nada para enviar: gere o relatório ou o pacote de XMLs antes.');
  if (total > LIMITE_ANEXOS_BYTES) {
    throw new ErroEnvioContador(413, 'Os anexos passaram de 18 MB, o limite do e-mail. Envie um período menor ou baixe o pacote e mande por outro meio.');
  }
  return { para, periodo, anexos };
};

const montarMensagem = ({ empresaNome, periodo, anexos }) => {
  const assunto = `Relatório fiscal${periodo ? ` ${periodo}` : ''} - ${empresaNome}`;
  const lista = anexos.map((a) => a.filename);
  const texto = [
    'Olá,',
    '',
    `Segue o relatório fiscal${periodo ? ` do período ${periodo}` : ''} da ${empresaNome}.`,
    `Anexos: ${lista.join(', ')}.`,
    '',
    'Enviado pelo Hennder ERP.',
  ].join('\n');
  const html = `<p>Olá,</p><p>Segue o relatório fiscal${periodo ? ` do período <strong>${escaparHtml(periodo)}</strong>` : ''} da <strong>${escaparHtml(empresaNome)}</strong>.</p>`
    + `<p>Anexos:</p><ul>${lista.map((n) => `<li>${escaparHtml(n)}</li>`).join('')}</ul><p style="color:#6b7280">Enviado pelo Hennder ERP.</p>`;
  return { assunto, texto, html };
};

/**
 * Envia. `criarTransporte(smtp)` vem de fora (nodemailer na rota; falso no teste).
 */
const enviarAoContador = async ({ user, tenantId, corpo, criarTransporte }) => {
  if (!(user.isPlatformAdmin || user.isTenantManager || (user.permissoes || []).includes(PERMISSAO))) {
    throw new ErroEnvioContador(403, 'Você não tem a permissão "Fiscal: Relatório do Contador". Peça ao administrador da empresa.');
  }
  const pedido = lerPedido(corpo);
  const [publica, privada] = await Promise.all([
    db.collection('configuracoes').doc(tenantId).get(),
    db.collection('configuracoes_privadas').doc(tenantId).get(),
  ]);
  const pub = publica.exists ? publica.data() : {};
  const priv = privada.exists ? privada.data() : {};
  const empresaEmail = String(pub.email || '').trim();
  const empresaNome = String(pub.nomeOficina || pub.nomeFantasia || pub.razaoSocial || 'Empresa').trim();
  if (!emailValido(empresaEmail)) {
    throw new ErroEnvioContador(400, 'O e-mail da empresa não está preenchido (ele é o remetente). Preencha em Configurações da Filial › Dados da Empresa › E-mail da empresa (use o mesmo e-mail do usuário do SMTP).');
  }
  const erroSmtp = erroDaConfiguracaoSmtp(priv);
  if (erroSmtp) throw new ErroEnvioContador(400, erroSmtp);

  const msg = montarMensagem({ empresaNome, periodo: pedido.periodo, anexos: pedido.anexos });
  try {
    await criarTransporte(priv).sendMail({
      from: { name: empresaNome, address: empresaEmail },
      replyTo: empresaEmail,
      to: pedido.para,
      subject: msg.assunto,
      text: msg.texto,
      html: msg.html,
      attachments: pedido.anexos,
    });
  } catch (erroSmtpEnvio) {
    console.error('[Envio ao contador] SMTP:', erroSmtpEnvio.code || '', erroSmtpEnvio.responseCode || '', erroSmtpEnvio.message);
    throw new ErroEnvioContador(502, traduzirErroSmtp(erroSmtpEnvio));
  }
  // Guarda o e-mail do contador para a proxima vez (so' depois de enviar).
  await db.collection('configuracoes').doc(tenantId).set({ emailContador: pedido.para, tenantId }, { merge: true })
    .catch((e) => console.error('[Envio ao contador] não guardou o e-mail do contador:', e.message));
  registrarLog({ ...user, tenantId }, {
    modulo: 'fiscal',
    acao: 'envio_contador',
    descricao: `Relatório do contador${pedido.periodo ? ` (${pedido.periodo})` : ''} enviado para ${pedido.para}: ${pedido.anexos.map((a) => a.filename).join(', ')}.`,
  });
  return { para: pedido.para, anexos: pedido.anexos.map((a) => a.filename) };
};

module.exports = { ErroEnvioContador, enviarAoContador, lerPedido, LIMITE_ANEXOS_BYTES };
