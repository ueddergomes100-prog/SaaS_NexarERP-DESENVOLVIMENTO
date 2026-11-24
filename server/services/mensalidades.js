const { admin, db } = require('../config/firebase');
const D = require('../domain/mensalidadeDomain');
const { lerGrupo, lerPercentualFilial, mensalidadeComFiliais } = require('../domain/filialDomain');
const { registrarLog } = require('./auditoria');
// Pelo objeto do modulo (nao desestruturado): os testes trocam o envio por um falso.
const emailResend = require('./emailResend');

/*
 * MENSALIDADES DAS EMPRESAS CLIENTES (24/11/2026). Regra e decisoes do dono em
 * src/utils/mensalidadeDomain.ts.
 *
 *  - mensalidades/{matriz}_{AAAA-MM}: a cobranca do mes. So' o servidor grava
 *    (rules: write false); so' o admin da plataforma le.
 *  - usuarios/{matriz}.planoCobranca: ligada, dia de vencimento, excecao de
 *    prazos e "liberado ate". plataforma/cobranca: prazos padrao e contato.
 *  - PROJECAO: o resumo da mensalidade aberta mais antiga vai para TODO perfil
 *    do grupo (matriz + filiais) em `cobrancaEmpresa`, e o instante do bloqueio
 *    em `cobrancaBloqueioEm`. E' isso que as rules e o authenticate conferem;
 *    a tela le do proprio perfil (sem leitura a mais). Recalculada a cada
 *    acao do SuperAdmin e todo dia na rotina (pega usuario novo).
 */

class ErroMensalidade extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COLECAO = 'mensalidades';
const VALOR_PADRAO = 149.9; // mesmo padrao do SuperAdmin e do cadastro (onboarding)
const PAPEIS_DA_PLATAFORMA = ['NexarAdmin', 'SuperAdmin'];

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const apagar = () => admin.firestore.FieldValue.delete();
const textoLimpo = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Instante (ms) de Timestamp do Firestore, Date ou nada. */
const paraMs = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
};

/** JSON com as chaves em ordem (o Firestore nao guarda a ordem dos campos de um mapa). */
const estavel = (v) => {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

const quem = (user) => textoLimpo(user?.nome || user?.email || user?.uid || 'rotina', 120);
const evento = (user, tipo, detalhe) => {
  const e = { em: new Date().toISOString(), tipo, por: quem(user) };
  if (detalhe) e.detalhe = textoLimpo(detalhe, 500);
  return e;
};

// O historico de alteracoes vai para a EMPRESA cobrada (nao para a do admin).
const registrar = (user, matrizId, dados) => registrarLog(
  { ...(user || { uid: 'rotina', nome: 'Rotina diária', role: 'SuperAdmin' }), tenantId: matrizId },
  { modulo: 'plataforma', critico: true, ...dados },
);

// ---------------------------------------------------------------- leituras

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const lerConfigGeral = async () => {
  const snap = await db.collection('plataforma').doc('cobranca').get();
  const dados = snap.exists ? snap.data() : {};
  const emailAvisos = textoLimpo(dados.emailAvisos, 120).toLowerCase();
  return {
    prazos: D.lerPrazos(dados.prazos),
    contato: D.lerContato(dados.contato),
    // Para onde vai o aviso de vespera do bloqueio (o dono da plataforma).
    emailAvisos: EMAIL_VALIDO.test(emailAvisos) ? emailAvisos : '',
  };
};

/** E-mail da empresa cobrada: o do dono; sem ele, o das configuracoes. */
const emailDaEmpresa = (dono, config) => {
  const para = textoLimpo(dono.email, 200) || textoLimpo(config.email, 200);
  return EMAIL_VALIDO.test(para) ? para : '';
};

/** Empresa (ou filial) -> matriz do grupo. O plano e a cobranca sao do grupo. */
const resolverMatriz = async (tenantId) => {
  const alvo = textoLimpo(tenantId, 200);
  if (!alvo) throw new ErroMensalidade(400, 'Escolha a empresa.');
  const config = await db.collection('configuracoes').doc(alvo).get();
  const grupoId = config.exists && typeof config.data().grupoId === 'string' ? config.data().grupoId : '';
  let grupo = null;
  if (grupoId) {
    const g = await db.collection('grupos').doc(grupoId).get();
    if (g.exists) grupo = lerGrupo(g.id, g.data());
  }
  const matrizId = grupo && grupo.matrizTenantId ? grupo.matrizTenantId : alvo;
  const dono = await db.collection('usuarios').doc(matrizId).get();
  if (!dono.exists) {
    throw new ErroMensalidade(404, 'O cadastro do dono desta empresa não foi encontrado. Recarregue o painel e tente de novo.');
  }
  return { matrizId, grupo, dono: dono.data() };
};

const lerMensalidadeOuFalhar = async (id) => {
  const ref = db.collection(COLECAO).doc(textoLimpo(id, 300) || '-');
  const snap = await ref.get();
  if (!snap.exists) throw new ErroMensalidade(404, 'Mensalidade não encontrada. Recarregue a tela.');
  return { ref, dados: snap.data(), mensalidade: D.lerMensalidade(snap.id, snap.data()) };
};

const abertasDaEmpresa = async (matrizId) => {
  const snap = await db.collection(COLECAO).where('tenantId', '==', matrizId).where('situacao', '==', 'aberta').get();
  return snap.docs.map((d) => D.lerMensalidade(d.id, d.data()));
};

// ---------------------------------------------------------------- projecao

/**
 * Recalcula o resumo e grava nos perfis do grupo (so' os que mudaram).
 * Nunca grava em perfil de admin da plataforma: o SuperAdmin nao e' bloqueado.
 */
const projetarCobranca = async (matrizId, opcoes = {}) => {
  const { grupo, dono } = opcoes.empresa || await resolverMatriz(matrizId);
  const config = opcoes.config || await lerConfigGeral();
  const plano = D.lerPlanoCobranca(dono.planoCobranca);
  const resumo = D.montarResumoDaCobranca({
    matrizId,
    abertas: await abertasDaEmpresa(matrizId),
    prazos: plano.prazos || config.prazos,
    liberadoAte: plano.liberadoAte,
    contato: config.contato,
  });
  const bloqueioMs = resumo ? D.inicioDoDiaEmBrasilia(resumo.bloqueioEm).getTime() : 0;

  const tenants = [...new Set([matrizId, ...(grupo ? grupo.filiais.map((f) => f.tenantId) : [])].filter(Boolean))];
  const perfis = [];
  for (let i = 0; i < tenants.length; i += 30) {
    const snap = await db.collection('usuarios').where('tenantId', 'in', tenants.slice(i, i + 30)).get();
    perfis.push(...snap.docs);
  }
  // O dono tem tenantId == uid, mas garante que ele entra mesmo se faltar o campo.
  if (!perfis.some((p) => p.id === matrizId)) {
    const d = await db.collection('usuarios').doc(matrizId).get();
    if (d.exists) perfis.push({ id: d.id, data: d.data, ref: db.collection('usuarios').doc(matrizId) });
  }

  const alvo = resumo ? estavel(resumo) : '';
  const mudar = perfis.filter((p) => {
    const dados = p.data() || {};
    if (PAPEIS_DA_PLATAFORMA.includes(dados.role)) return false;
    const atual = dados.cobrancaEmpresa ? estavel(dados.cobrancaEmpresa) : '';
    return atual !== alvo || paraMs(dados.cobrancaBloqueioEm) !== bloqueioMs;
  });
  for (let i = 0; i < mudar.length; i += 400) {
    const lote = db.batch();
    mudar.slice(i, i + 400).forEach((p) => {
      const ref = p.ref || db.collection('usuarios').doc(p.id);
      lote.update(ref, resumo
        ? { cobrancaEmpresa: resumo, cobrancaBloqueioEm: new Date(bloqueioMs) }
        : { cobrancaEmpresa: apagar(), cobrancaBloqueioEm: apagar() });
    });
    await lote.commit();
  }
  return { matrizId, resumo, perfis: perfis.length, alterados: mudar.length };
};

/** A empresa (ou filial) esta' bloqueada agora? Usado no login do caixa e do app. */
const empresaBloqueada = async (tenantId, agoraMs = Date.now()) => {
  try {
    const { dono } = await resolverMatriz(tenantId);
    const ms = paraMs(dono.cobrancaBloqueioEm);
    return Boolean(ms && agoraMs >= ms);
  } catch {
    return false; // sem cadastro do dono: quem decide e' o resto do login
  }
};

/**
 * Login novo criado pelo servidor ja' nasce com a cobranca da empresa (copia
 * do dono), sem esperar a rotina do dia seguinte. Sem cobranca: {}.
 */
const camposDaCobrancaParaNovoUsuario = async (tenantId) => {
  try {
    const { dono } = await resolverMatriz(tenantId);
    if (!dono.cobrancaEmpresa || !dono.cobrancaBloqueioEm) return {};
    return { cobrancaEmpresa: dono.cobrancaEmpresa, cobrancaBloqueioEm: dono.cobrancaBloqueioEm };
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------- acoes

const valorDaEmpresa = (dono, grupo) => {
  const base = Number(dono.valorMensalidade) > 0 ? Number(dono.valorMensalidade) : VALOR_PADRAO;
  return mensalidadeComFiliais(base, grupo, lerPercentualFilial(dono.percentualFilial)).total;
};

const gerarMensalidade = async ({ user, tenantId, competencia, hoje = D.hojeEmBrasilia() }) => {
  const empresa = await resolverMatriz(tenantId);
  const { matrizId, grupo, dono } = empresa;
  const plano = D.lerPlanoCobranca(dono.planoCobranca);
  if (!plano.diaVencimento) {
    throw new ErroMensalidade(400, 'Defina o dia de vencimento desta empresa (Cobrança da empresa) antes de gerar a mensalidade.');
  }
  const mes = D.competenciaValida(competencia) ? competencia : D.primeiraCompetencia(hoje, plano.diaVencimento);
  const id = D.idDaMensalidade(matrizId, mes);
  const ref = db.collection(COLECAO).doc(id);
  const valor = valorDaEmpresa(dono, grupo);
  const vencimento = D.vencimentoDaCompetencia(mes, plano.diaVencimento);
  await db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    if (atual.exists) {
      throw new ErroMensalidade(409, `A mensalidade de ${D.rotuloCompetencia(mes)} desta empresa já existe.`);
    }
    tx.set(ref, {
      tenantId: matrizId,
      empresaNome: textoLimpo(dono.nomeOficina, 200) || 'Sem nome',
      competencia: mes,
      vencimento,
      valor,
      situacao: 'aberta',
      boleto: {},
      criadaEm: agora(),
      criadaPor: user ? user.uid : 'rotina',
      atualizadaEm: agora(),
      eventos: [evento(user, 'criada', `${D.formatarMoeda(valor)}, vence ${D.formatarData(vencimento)}`)],
    });
  });
  registrar(user, matrizId, {
    acao: 'mensalidade_criada',
    descricao: `Mensalidade de ${D.rotuloCompetencia(mes)} criada: ${D.formatarMoeda(valor)}, vencimento ${D.formatarData(vencimento)}.`,
    registroId: id,
  });
  const projecao = await projetarCobranca(matrizId, { empresa });
  return { id, competencia: mes, vencimento, valor, projecao };
};

const anexarBoleto = async ({ user, id, boleto: digitado }) => {
  const { ref, mensalidade } = await lerMensalidadeOuFalhar(id);
  if (mensalidade.situacao !== 'aberta') throw new ErroMensalidade(409, 'Só dá para anexar boleto em mensalidade em aberto.');
  const validado = D.validarBoletoDigitado(digitado || {});
  if ('erro' in validado) throw new ErroMensalidade(400, validado.erro);
  const { boleto } = validado;
  if (boleto.pdfCaminho && !boleto.pdfCaminho.startsWith(`cobranca/${mensalidade.tenantId}/`)) {
    throw new ErroMensalidade(400, 'O PDF não é desta empresa. Anexe o arquivo de novo.');
  }
  const anexos = [boleto.pdfUrl && 'PDF', boleto.linhaDigitavel && 'linha digitável', boleto.link && 'link', boleto.pixCopiaECola && 'Pix'].filter(Boolean).join(', ');
  await ref.update({
    boleto,
    atualizadaEm: agora(),
    eventos: admin.firestore.FieldValue.arrayUnion(evento(user, 'boleto', anexos)),
  });
  registrar(user, mensalidade.tenantId, {
    acao: 'mensalidade_boleto',
    descricao: `Boleto da mensalidade de ${D.rotuloCompetencia(mensalidade.competencia)} anexado (${anexos}).`,
    registroId: mensalidade.id,
  });
  return projetarCobranca(mensalidade.tenantId);
};

const marcarPaga = async ({ user, id, pagoEm, hoje = D.hojeEmBrasilia() }) => {
  const { ref, mensalidade } = await lerMensalidadeOuFalhar(id);
  if (mensalidade.situacao !== 'aberta') throw new ErroMensalidade(409, 'Esta mensalidade não está em aberto.');
  const erro = D.validarDataDoPagamento(pagoEm, hoje);
  if (erro) throw new ErroMensalidade(400, erro);
  await ref.update({
    situacao: 'paga',
    pagoEm,
    pagamentoRegistradoPor: user.uid,
    pagamentoRegistradoEm: agora(),
    atualizadaEm: agora(),
    eventos: admin.firestore.FieldValue.arrayUnion(evento(user, 'paga', `pago em ${D.formatarData(pagoEm)}`)),
  });
  // Sem outra mensalidade em aberto, a liberacao por prazo deixa de existir.
  const restantes = await abertasDaEmpresa(mensalidade.tenantId);
  if (!restantes.length) {
    await db.collection('usuarios').doc(mensalidade.tenantId).update({ 'planoCobranca.liberadoAte': apagar() }).catch(() => {});
  }
  registrar(user, mensalidade.tenantId, {
    acao: 'mensalidade_paga',
    descricao: `Mensalidade de ${D.rotuloCompetencia(mensalidade.competencia)} (${D.formatarMoeda(mensalidade.valor)}) marcada como paga em ${D.formatarData(pagoEm)}.`,
    registroId: mensalidade.id,
  });
  return projetarCobranca(mensalidade.tenantId);
};

const desfazerPagamento = async ({ user, id, motivo }) => {
  const { ref, mensalidade } = await lerMensalidadeOuFalhar(id);
  if (mensalidade.situacao !== 'paga') throw new ErroMensalidade(409, 'Esta mensalidade não está paga.');
  const texto = textoLimpo(motivo, 300);
  if (!texto) throw new ErroMensalidade(400, 'Informe o motivo para desfazer o pagamento.');
  await ref.update({
    situacao: 'aberta',
    pagoEm: apagar(),
    atualizadaEm: agora(),
    eventos: admin.firestore.FieldValue.arrayUnion(evento(user, 'pagamento_desfeito', texto)),
  });
  registrar(user, mensalidade.tenantId, {
    acao: 'mensalidade_pagamento_desfeito',
    descricao: `Pagamento da mensalidade de ${D.rotuloCompetencia(mensalidade.competencia)} desfeito.`,
    motivo: texto,
    registroId: mensalidade.id,
  });
  return projetarCobranca(mensalidade.tenantId);
};

const cancelarMensalidade = async ({ user, id, motivo }) => {
  const { ref, mensalidade } = await lerMensalidadeOuFalhar(id);
  if (mensalidade.situacao !== 'aberta') throw new ErroMensalidade(409, 'Só dá para cancelar mensalidade em aberto.');
  const texto = textoLimpo(motivo, 300);
  if (!texto) throw new ErroMensalidade(400, 'Informe o motivo do cancelamento.');
  await ref.update({
    situacao: 'cancelada',
    atualizadaEm: agora(),
    eventos: admin.firestore.FieldValue.arrayUnion(evento(user, 'cancelada', texto)),
  });
  registrar(user, mensalidade.tenantId, {
    acao: 'mensalidade_cancelada',
    descricao: `Mensalidade de ${D.rotuloCompetencia(mensalidade.competencia)} cancelada.`,
    motivo: texto,
    registroId: mensalidade.id,
  });
  return projetarCobranca(mensalidade.tenantId);
};

/** Liga/desliga a cobranca da empresa, dia de vencimento e excecao de prazos. */
const salvarPlanoDaEmpresa = async ({ user, tenantId, ativa, diaVencimento, prazos, hoje = D.hojeEmBrasilia() }) => {
  const empresa = await resolverMatriz(tenantId);
  const { matrizId, dono } = empresa;
  const atual = D.lerPlanoCobranca(dono.planoCobranca);
  const dia = D.lerDiaVencimento(diaVencimento);
  if (ativa === true && !dia) throw new ErroMensalidade(400, 'Informe o dia de vencimento (de 1 a 31).');
  let excecao = null;
  if (prazos) {
    excecao = {
      diasLembreteAntes: Number(prazos.diasLembreteAntes),
      diasAvisoForte: Number(prazos.diasAvisoForte),
      diasBloqueio: Number(prazos.diasBloqueio),
    };
    const erro = D.validarPrazos(excecao);
    if (erro) throw new ErroMensalidade(400, erro);
  }
  const plano = {
    ativa: ativa === true,
    diaVencimento: dia || atual.diaVencimento || apagar(),
    // Ao ligar pela primeira vez (ou trocar o dia), a cobranca comeca no proximo vencimento.
    inicioCompetencia: dia && (!atual.inicioCompetencia || dia !== atual.diaVencimento)
      ? D.primeiraCompetencia(hoje, dia)
      : (atual.inicioCompetencia || apagar()),
    prazos: excecao || apagar(),
  };
  await db.collection('usuarios').doc(matrizId).set({ planoCobranca: plano, updatedAt: agora() }, { merge: true });
  registrar(user, matrizId, {
    acao: 'mensalidade_plano',
    descricao: `Cobrança da empresa ${plano.ativa ? 'ligada' : 'desligada'}${dia ? `, vencimento todo dia ${dia}` : ''}${excecao ? `, prazos próprios (lembrete ${excecao.diasLembreteAntes}, aviso ${excecao.diasAvisoForte}, bloqueio ${excecao.diasBloqueio})` : ', prazos padrão'}.`,
    registroId: matrizId,
  });
  const atualizado = await resolverMatriz(matrizId);
  return projetarCobranca(matrizId, { empresa: atualizado });
};

/** "Liberar ate dd/mm" sem pagamento (null = tirar a liberacao). */
const liberarAte = async ({ user, tenantId, ate, motivo, hoje = D.hojeEmBrasilia() }) => {
  const { matrizId } = await resolverMatriz(tenantId);
  if (ate) {
    const erro = D.validarLiberacao(ate, hoje);
    if (erro) throw new ErroMensalidade(400, erro);
  }
  const texto = textoLimpo(motivo, 300);
  if (ate && !texto) throw new ErroMensalidade(400, 'Informe o motivo da liberação (ex.: cliente prometeu pagar dia 28).');
  await db.collection('usuarios').doc(matrizId).set({ planoCobranca: { liberadoAte: ate || apagar() }, updatedAt: agora() }, { merge: true });
  registrar(user, matrizId, {
    acao: ate ? 'mensalidade_liberada' : 'mensalidade_liberacao_retirada',
    descricao: ate ? `Acesso liberado até ${D.formatarData(ate)} sem pagamento.` : 'Liberação sem pagamento retirada.',
    motivo: texto || undefined,
    registroId: matrizId,
  });
  return projetarCobranca(matrizId);
};

/** Prazos padrao e contato da plataforma (vale para quem nao tem excecao). */
const salvarConfigGeral = async ({ user, prazos, contato, emailAvisos }) => {
  const p = {
    diasLembreteAntes: Number(prazos?.diasLembreteAntes),
    diasAvisoForte: Number(prazos?.diasAvisoForte),
    diasBloqueio: Number(prazos?.diasBloqueio),
  };
  const erro = D.validarPrazos(p);
  if (erro) throw new ErroMensalidade(400, erro);
  const c = D.lerContato(contato);
  const avisos = textoLimpo(emailAvisos, 120).toLowerCase();
  if (avisos && !EMAIL_VALIDO.test(avisos)) throw new ErroMensalidade(400, 'O e-mail do aviso de véspera não parece válido. Confira e salve de novo.');
  await db.collection('plataforma').doc('cobranca').set({
    prazos: p, contato: c, emailAvisos: avisos, atualizadoEm: agora(), atualizadoPor: user.uid,
  });
  const resultado = await reprojetarTodas();
  return { prazos: p, contato: c, emailAvisos: avisos, ...resultado };
};

/** Carne anual: cria de uma vez os meses pedidos (pula os que ja existem e diz quais). */
const gerarAno = async ({ user, tenantId, primeiraCompetencia, quantidade = D.QUANTIDADE_MAXIMA_DO_CARNE, hoje = D.hojeEmBrasilia() }) => {
  const meses = D.competenciasDoCarne(primeiraCompetencia, quantidade);
  if (!meses.length) throw new ErroMensalidade(400, 'Escolha o primeiro mês do carnê.');
  const criadas = [];
  const puladas = [];
  for (const competencia of meses) {
    try {
      await gerarMensalidade({ user, tenantId, competencia, hoje });
      criadas.push(competencia);
    } catch (erro) {
      if (erro instanceof ErroMensalidade && erro.status === 409) puladas.push(competencia);
      else throw erro;
    }
  }
  return { criadas, puladas };
};

/** Cobranca por e-mail (Resend) e texto pronto para o WhatsApp. */
const enviarCobranca = async ({ user, id, porEmail, porWhatsapp }) => {
  const { ref, mensalidade } = await lerMensalidadeOuFalhar(id);
  if (mensalidade.situacao !== 'aberta') throw new ErroMensalidade(409, 'Esta mensalidade não está em aberto.');
  if (!D.temBoleto(mensalidade.boleto)) throw new ErroMensalidade(400, 'Anexe o boleto antes de enviar a cobrança.');
  if (!porEmail && !porWhatsapp) throw new ErroMensalidade(400, 'Escolha e-mail, WhatsApp ou os dois.');
  const { dono } = await resolverMatriz(mensalidade.tenantId);
  const configSnap = await db.collection('configuracoes').doc(mensalidade.tenantId).get();
  const config = configSnap.exists ? configSnap.data() : {};
  const empresa = textoLimpo(dono.nomeOficina, 200);
  const { assunto, texto } = D.textoDaCobranca({
    empresa,
    competencia: mensalidade.competencia,
    vencimento: mensalidade.vencimento,
    valor: mensalidade.valor,
    boleto: mensalidade.boleto,
  });
  const resultado = { emailPara: null, whatsapp: null };
  const canais = [];
  if (porEmail) {
    const para = emailDaEmpresa(dono, config);
    if (!para) {
      throw new ErroMensalidade(400, `A empresa ${empresa || ''} não tem e-mail no cadastro. Envie pelo WhatsApp.`.replace('  ', ' '));
    }
    await emailResend.enviarEmailPeloResend({ para, assunto, texto });
    resultado.emailPara = para;
    canais.push(`e-mail ${para}`);
  }
  if (porWhatsapp) {
    const telefone = String(config.whatsapp || config.telefone || dono.telefone || '').replace(/\D/g, '');
    if (telefone.length < 10) {
      throw new ErroMensalidade(400, 'A empresa não tem telefone no cadastro (Configurações). Envie por e-mail ou peça o número ao cliente.');
    }
    const comPais = telefone.startsWith('55') && telefone.length >= 12 ? telefone : `55${telefone}`;
    resultado.whatsapp = { telefone: comPais, texto };
    canais.push(`WhatsApp ${comPais}`);
  }
  await ref.update({
    ultimaCobrancaEm: agora(),
    atualizadaEm: agora(),
    eventos: admin.firestore.FieldValue.arrayUnion(evento(user, 'cobranca_enviada', canais.join(' e '))),
  });
  registrar(user, mensalidade.tenantId, {
    acao: 'mensalidade_cobranca_enviada',
    descricao: `Cobrança da mensalidade de ${D.rotuloCompetencia(mensalidade.competencia)} enviada (${canais.join(' e ')}).`,
    registroId: mensalidade.id,
  });
  return resultado;
};

// ---------------------------------------------------------------- rotina diaria

/** Empresas com cobranca ligada ou com mensalidade em aberto. */
const empresasComCobranca = async () => {
  const [ativas, abertas] = await Promise.all([
    db.collection('usuarios').where('planoCobranca.ativa', '==', true).get(),
    db.collection(COLECAO).where('situacao', '==', 'aberta').get(),
  ]);
  return {
    ativas: ativas.docs.map((d) => ({ id: d.id, dados: d.data() })),
    ids: [...new Set([...ativas.docs.map((d) => d.id), ...abertas.docs.map((d) => d.data().tenantId)].filter(Boolean))],
  };
};

const reprojetarTodas = async () => {
  const { ids } = await empresasComCobranca();
  const config = await lerConfigGeral();
  let alterados = 0;
  for (const id of ids) {
    try {
      alterados += (await projetarCobranca(id, { config })).alterados;
    } catch (erro) {
      console.error(`[Mensalidades] projeção de ${id} falhou:`, erro.message);
    }
  }
  return { empresas: ids.length, alterados };
};

const ROTULO_LEMBRETE = { antes: 'lembrete antes do vencimento', dia: 'vencimento', atraso: 'atraso', bloqueio: 'bloqueio' };

const emailConfigurado = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

/** Reserva o e-mail ANTES de mandar (duas rotinas juntas nao mandam duas vezes). */
const reservarLembrete = (ref, tipo) => db.runTransaction(async (tx) => {
  const snap = await tx.get(ref);
  const dados = snap.exists ? snap.data() : null;
  if (!dados || dados.situacao !== 'aberta' || (dados.lembretes && dados.lembretes[tipo])) return false;
  tx.update(ref, { [`lembretes.${tipo}`]: new Date().toISOString() });
  return true;
});
const desfazerReserva = (ref, tipo) => ref.update({ [`lembretes.${tipo}`]: apagar() }).catch(() => {});

/**
 * E-mails automaticos do dia (decisao do dono, 24/11): ao cliente, um de cada
 * etapa por mensalidade (antes, no dia, com 3 dias de atraso, no bloqueio); ao
 * dono da plataforma, a lista de quem bloqueia amanha. E-mail que nao saiu
 * desfaz a reserva (tenta de novo amanha). Falha aqui nunca derruba a rotina.
 */
const enviarLembretesDoDia = async (hoje, config) => {
  if (!emailConfigurado()) return { enviados: 0, falhas: 0, vespera: 0, semEmail: true };
  const abertas = await db.collection(COLECAO).where('situacao', '==', 'aberta').get();
  const empresas = new Map();
  const vespera = [];
  let enviados = 0;
  let falhas = 0;
  for (const doc of abertas.docs) {
    const m = D.lerMensalidade(doc.id, doc.data());
    if (!empresas.has(m.tenantId)) {
      try {
        const { dono } = await resolverMatriz(m.tenantId);
        const cfg = await db.collection('configuracoes').doc(m.tenantId).get();
        empresas.set(m.tenantId, { dono, config: cfg.exists ? cfg.data() : {} });
      } catch {
        empresas.set(m.tenantId, null);
      }
    }
    const empresa = empresas.get(m.tenantId);
    if (!empresa) continue;
    const plano = D.lerPlanoCobranca(empresa.dono.planoCobranca);
    const prazos = plano.prazos || config.prazos;
    const nome = textoLimpo(empresa.dono.nomeOficina, 200);
    if (D.ehVesperaDoBloqueio(m, prazos, plano.liberadoAte, hoje)) vespera.push({ ref: doc.ref, empresa: nome || m.tenantId, valor: m.valor, vencimento: m.vencimento });

    const tipo = D.lembreteDoDia(m, prazos, plano.liberadoAte, hoje);
    const para = tipo ? emailDaEmpresa(empresa.dono, empresa.config) : '';
    if (!tipo || !para || !(await reservarLembrete(doc.ref, tipo))) continue;
    try {
      const { assunto, texto } = D.textoDoLembrete(tipo, {
        empresa: nome,
        competencia: m.competencia,
        vencimento: m.vencimento,
        valor: m.valor,
        boleto: m.boleto,
        bloqueioEm: D.dataDoBloqueioDaMensalidade(m.vencimento, prazos, plano.liberadoAte),
      });
      await emailResend.enviarEmailPeloResend({ para, assunto, texto });
      enviados += 1;
      await doc.ref.update({ eventos: admin.firestore.FieldValue.arrayUnion(evento(null, 'lembrete', `${ROTULO_LEMBRETE[tipo]}, para ${para}`)) }).catch(() => {});
      registrar(null, m.tenantId, {
        acao: 'mensalidade_lembrete',
        descricao: `E-mail automático (${ROTULO_LEMBRETE[tipo]}) da mensalidade de ${D.rotuloCompetencia(m.competencia)} enviado para ${para}.`,
        registroId: m.id,
      });
    } catch (erro) {
      falhas += 1;
      await desfazerReserva(doc.ref, tipo);
      console.error(`[Mensalidades] e-mail automático (${tipo}) de ${m.id} falhou:`, erro.message);
    }
  }

  let avisadas = 0;
  if (config.emailAvisos && vespera.length) {
    const reservadas = [];
    for (const v of vespera) if (await reservarLembrete(v.ref, 'vespera')) reservadas.push(v);
    if (reservadas.length) {
      try {
        const { assunto, texto } = D.textoDaVespera(reservadas, D.somarDias(hoje, 1));
        await emailResend.enviarEmailPeloResend({ para: config.emailAvisos, assunto, texto });
        avisadas = reservadas.length;
      } catch (erro) {
        await Promise.all(reservadas.map((v) => desfazerReserva(v.ref, 'vespera')));
        console.error('[Mensalidades] aviso de véspera falhou:', erro.message);
      }
    }
  }
  return { enviados, falhas, vespera: avisadas };
};

/** Cria as mensalidades do mes que chegaram na antecedencia e recalcula tudo. Idempotente. */
const rotinaDiariaDaCobranca = async (hoje = D.hojeEmBrasilia()) => {
  const { ativas } = await empresasComCobranca();
  let criadas = 0;
  for (const empresa of ativas) {
    const plano = D.lerPlanoCobranca(empresa.dados.planoCobranca);
    const existentes = (await db.collection(COLECAO).where('tenantId', '==', empresa.id).get())
      .docs.map((d) => d.data().competencia);
    for (const competencia of D.competenciasParaGerar({ hoje, plano, existentes })) {
      try {
        await gerarMensalidade({ user: null, tenantId: empresa.id, competencia, hoje });
        criadas += 1;
      } catch (erro) {
        if (erro.status !== 409) console.error(`[Mensalidades] criar ${empresa.id} ${competencia} falhou:`, erro.message);
      }
    }
  }
  const projecao = await reprojetarTodas();
  let emails = null;
  try {
    emails = await enviarLembretesDoDia(hoje, await lerConfigGeral());
  } catch (erro) {
    console.error('[Mensalidades] e-mails automáticos falharam:', erro.message);
  }
  return { criadas, ...projecao, emails };
};

module.exports = {
  ErroMensalidade,
  anexarBoleto,
  camposDaCobrancaParaNovoUsuario,
  cancelarMensalidade,
  desfazerPagamento,
  empresaBloqueada,
  enviarCobranca,
  enviarLembretesDoDia,
  gerarAno,
  gerarMensalidade,
  liberarAte,
  marcarPaga,
  paraMs,
  projetarCobranca,
  reprojetarTodas,
  rotinaDiariaDaCobranca,
  salvarConfigGeral,
  salvarPlanoDaEmpresa,
};
