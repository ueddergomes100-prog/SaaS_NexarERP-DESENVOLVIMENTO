/**
 * E-MAIL DA NOTA FISCAL AO CLIENTE (2026-09-25).
 *
 * A Spedy nao deixa escolher o remetente, entao o proprio sistema envia: PDF e XML da nota
 * autorizada anexados, saindo do e-mail da EMPRESA (Configuracoes > perfil da empresa) pelo SMTP
 * que a empresa cadastrou (Configuracoes > E-mail das notas). O destinatario e' o e-mail do
 * cadastro do cliente. Aqui ficam so' as regras puras (sem rede, sem Firestore), para teste.
 */

const EMAIL_VALIDO = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const emailValido = (valor) => EMAIL_VALIDO.test(String(valor || '').trim());

/** Configuracao SMTP guardada em configuracoes_privadas (a senha nunca vai para a tela). */
const erroDaConfiguracaoSmtp = (cfg) => {
  const c = cfg || {};
  if (!String(c.smtpHost || '').trim()) return 'Falta o servidor SMTP (host). Preencha em Configurações › E-mail das notas.';
  const porta = Number(c.smtpPorta);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return 'A porta do SMTP é inválida (ex.: 465 ou 587).';
  if (!String(c.smtpUsuario || '').trim()) return 'Falta o usuário do e-mail (normalmente o próprio endereço). Preencha em Configurações › E-mail das notas.';
  if (!String(c.smtpSenha || '')) return 'Falta a senha do e-mail. Preencha em Configurações › E-mail das notas.';
  return null;
};

/** Opcoes do nodemailer a partir da configuracao. 465 = SSL direto; 587/25 = STARTTLS. */
const opcoesDoTransporte = (cfg) => {
  const porta = Number(cfg.smtpPorta);
  const seguro = cfg.smtpSeguro === undefined ? porta === 465 : Boolean(cfg.smtpSeguro);
  return {
    host: String(cfg.smtpHost).trim(),
    port: porta,
    secure: seguro,
    auth: { user: String(cfg.smtpUsuario).trim(), pass: String(cfg.smtpSenha) },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };
};

/** Erro cru do SMTP -> mensagem em portugues dizendo o que fazer (nunca vaza texto de biblioteca). */
const traduzirErroSmtp = (erro) => {
  const codigo = String(erro?.code || '');
  const resposta = Number(erro?.responseCode || 0);
  const texto = String(erro?.response || erro?.message || '');
  if (codigo === 'EAUTH' || resposta === 535 || resposta === 534 || /auth|password|credenciais|credentials/i.test(texto) && resposta >= 500) {
    return 'O servidor de e-mail recusou o usuário ou a senha. Confira em Configurações › E-mail das notas (no Gmail e no Outlook é preciso uma "senha de aplicativo", não a senha normal).';
  }
  if (['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS'].includes(codigo)) {
    return 'Não consegui conectar no servidor de e-mail. Confira o servidor (host), a porta e a opção de conexão segura em Configurações › E-mail das notas.';
  }
  if (codigo === 'EENVELOPE' || resposta === 550 || resposta === 553 || resposta === 551) {
    return 'O e-mail do cliente foi recusado (endereço inexistente ou inválido). Corrija o e-mail no cadastro do cliente e reenvie.';
  }
  if (resposta === 552 || /size|tamanho|too large/i.test(texto)) {
    return 'O e-mail ficou grande demais para o servidor de envio (anexos). Baixe o PDF e o XML da nota e envie manualmente.';
  }
  if (resposta >= 400) {
    return 'O servidor de e-mail não aceitou o envio agora. Tente de novo em alguns minutos; se continuar, confira a configuração em Configurações › E-mail das notas.';
  }
  return 'Não foi possível enviar o e-mail. Confira a configuração em Configurações › E-mail das notas e tente de novo.';
};

const ROTULO_TIPO = { 'NF-e': 'NF-e', 'NFC-e': 'NFC-e', 'NFS-e': 'NFS-e' };

const escaparHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Assunto e corpo (texto e HTML). Os anexos entram na rota. */
const montarMensagem = ({ empresaNome, empresaEmail, tipo, numero, chave, clienteNome }) => {
  const rotulo = ROTULO_TIPO[tipo] || 'Nota fiscal';
  const numeroTxt = numero ? ` nº ${numero}` : '';
  const assunto = `${rotulo}${numeroTxt} — ${empresaNome}`;
  const saudacao = clienteNome ? `Olá, ${clienteNome}!` : 'Olá!';
  const linhas = [
    saudacao,
    '',
    `Segue em anexo a ${rotulo}${numeroTxt} emitida por ${empresaNome}: o PDF (DANFE) e o arquivo XML.`,
    ...(chave ? ['', `Chave de acesso: ${chave}`] : []),
    '',
    `Guarde o XML: ele é o documento fiscal válido. Em caso de dúvida, responda este e-mail (${empresaEmail}).`,
    '',
    empresaNome,
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">`
    + `<p>${escaparHtml(saudacao)}</p>`
    + `<p>Segue em anexo a <strong>${escaparHtml(rotulo)}${escaparHtml(numeroTxt)}</strong> emitida por <strong>${escaparHtml(empresaNome)}</strong>: o PDF (DANFE) e o arquivo XML.</p>`
    + (chave ? `<p style="font-size:12px;color:#555">Chave de acesso: ${escaparHtml(chave)}</p>` : '')
    + `<p>Guarde o XML: ele é o documento fiscal válido. Em caso de dúvida, responda este e-mail (${escaparHtml(empresaEmail)}).</p>`
    + `<p>${escaparHtml(empresaNome)}</p></div>`;
  return { assunto, texto: linhas.join('\n'), html };
};

/** Nome dos anexos, sem caracteres que o servidor de e-mail estranhe. */
const nomeDoAnexo = (tipo, numero, chave, extensao) => {
  const base = `${String(tipo || 'nota').replace(/[^A-Za-z0-9]/g, '')}${numero ? `-${numero}` : ''}${chave ? `-${String(chave).slice(-8)}` : ''}`;
  return `${base}.${extensao}`;
};

module.exports = {
  emailValido,
  erroDaConfiguracaoSmtp,
  opcoesDoTransporte,
  traduzirErroSmtp,
  montarMensagem,
  nomeDoAnexo,
};
