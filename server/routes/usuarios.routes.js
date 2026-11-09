const express = require('express');
const { authenticate } = require('../middleware/auth');
const { redefinirSenhaAcesso, ErroSenhaAcesso } = require('../services/usuarioSenha');
const { ErroLimite, criarLogin, alterarAcessoApp, vincularMotorista, editarFicha, alterarSituacao, salvarPermissoes } = require('../services/limitesDoPlano');
const { podeGerirFuncionario } = require('../middleware/gestaoEquipe');
const { registrarLog } = require('../services/auditoria');
const { podeCriarLoginDeEquipe, NIVEL_ACESSO_LABELS, parseNivelAcesso } = require('../domain/visibilidadeVendasDomain');
const { permissoesEfetivas, MARCADOR_APP_DEFINIDO } = require('../domain/permissoesAppDomain');
const { db } = require('../config/firebase');

// ---------------------------------------------------------------------------
// HISTORICO DE ALTERACOES (09/11/2026)
// ---------------------------------------------------------------------------

/** Nome da area como aparece na tela de permissoes. */
const AREA_DA_PERMISSAO = {
  administrativo: 'Admin',
  app: 'Aplicativo mobile',
  cadastros: 'Cadastros',
  compras: 'Compras',
  crm: 'Agenda e Alertas',
  dashboard: 'Dashboard',
  estoque: 'Estoque',
  filiais: 'Filiais',
  financeiro: 'Financeiro',
  fiscal: 'Fiscal',
  integracoes: 'E-commerce',
  mecanica: 'Ordens de Serviço',
  operacoes: 'Operações',
  utilitarios: 'Utilitários',
  vendas: 'Vendas',
};

/**
 * Rotulo da permissao igual ao da tela (permissionCatalog compilado em
 * server/domain); sem ele no catalogo, "vendas.liberar_desconto" ->
 * "Vendas: liberar desconto", sem mostrar o id cru.
 */
const { permissionLabelMap } = require('../domain/permissionCatalog');

const rotuloDaPermissao = (id) => {
  if (permissionLabelMap[id]) return permissionLabelMap[id];
  const [area, ...resto] = String(id || '').split('.');
  const acao = resto.join('.').replace(/_/g, ' ').trim();
  const nomeDaArea = AREA_DA_PERMISSAO[area] || (area ? area.charAt(0).toUpperCase() + area.slice(1) : '');
  return acao ? `${nomeDaArea}: ${acao}` : nomeDaArea;
};

/** Permissoes que entraram e sairam (sem o marcador interno do app). */
const mudancasDePermissoes = (antes, depois) => {
  const efetivas = (lista) => new Set(permissoesEfetivas(Array.isArray(lista) ? lista : []).filter((p) => p !== MARCADOR_APP_DEFINIDO));
  const a = efetivas(antes);
  const d = efetivas(depois);
  return {
    entraram: [...d].filter((p) => !a.has(p)),
    sairam: [...a].filter((p) => !d.has(p)),
  };
};

/** Le' o cadastro para o historico; falha aqui nunca derruba a operacao. */
const lerUsuarioParaHistorico = async (usuarioId) => {
  try {
    if (!db || !usuarioId) return null;
    const snap = await db.collection('usuarios').doc(String(usuarioId)).get();
    return snap.exists ? snap.data() : null;
  } catch (erro) {
    console.error('[Usuarios] historico: nao leu o usuario:', erro.message);
    return null;
  }
};

const router = express.Router();

// Mesma trava das rotas de PIN (vendedorPin.routes.js): tudo autenticado, e
// o tenantId sai sempre do token de quem chamou, nunca do corpo.
router.use(authenticate);

/** Redefine a senha de ACESSO (login) de um funcionario. Dono/administrador, ou gerente sobre funcionario comum (26/10/2026). */
router.post('/redefinir-senha', podeGerirFuncionario, async (req, res) => {
  try {
    const resultado = await redefinirSenhaAcesso({
      tenantId: req.user.tenantId,
      usuarioId: req.body?.usuarioId,
      novaSenha: req.body?.novaSenha,
    });
    // Historico de alteracoes (09/11/2026): quem redefiniu a senha de quem -- NUNCA a senha.
    void (async () => {
      const alvo = await lerUsuarioParaHistorico(resultado.usuarioId);
      const nome = String((alvo && (alvo.nome || alvo.email)) || 'usuário');
      await registrarLog(req.user, {
        modulo: 'usuarios',
        acao: 'edicao',
        descricao: `Senha de acesso de ${nome} redefinida.`,
        registroId: resultado.usuarioId,
        documentoTipo: 'usuario',
        documentoNumero: `Usuário ${nome}`,
        alteracoes: [{ campo: 'Senha de acesso', valorAnterior: null, valorNovo: 'redefinida' }],
      });
    })();
    return res.json({ ...resultado, ok: true });
  } catch (erro) {
    if (erro instanceof ErroSenhaAcesso) {
      return res.status(erro.status).json({ error: erro.message });
    }
    console.error('[Usuarios] redefinir-senha:', erro);
    return res.status(500).json({ error: 'Não foi possível redefinir a senha. Tente novamente.' });
  }
});

// Limites do plano (19/10/2026): criar login e ligar o app Vendas so' pelo
// servidor, que confere o limite contratado. Ver services/limitesDoPlano.js.
const soAdministrador = (req, res, next) => {
  if (req.user && (req.user.isPlatformAdmin || req.user.isTenantManager)) return next();
  return res.status(403).json({ error: 'Só o dono ou um administrador da empresa pode criar logins e liberar o aplicativo mobile.' });
};

// Criar login (26/10/2026): tambem o Gerente com Equipe e Acessos liberada. O
// login nasce Funcionario comum, sem permissao (services/limitesDoPlano.js).
const podeCriarLogin = (req, res, next) => {
  const u = req.user;
  if (u && (u.isPlatformAdmin || podeCriarLoginDeEquipe({ role: u.role, isOwner: false, nivelAcesso: u.nivelAcesso, permissoes: u.permissoes }))) return next();
  return res.status(403).json({ error: 'Só o dono, um administrador ou um gerente com "Admin: Equipe e Acessos" liberado pode criar logins.' });
};

const responderErroLimite =(res, erro, oQue) => {
  if (erro instanceof ErroLimite) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Usuarios] ${oQue}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${oQue}. Nada foi gravado. Tente de novo em instantes.` });
};

/** POST /api/usuarios/criar -- { nome, usuario, senha, codigoVendedor? }. */
router.post('/criar', podeCriarLogin, async (req, res) => {
  try {
    const r = await criarLogin({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'usuarios',
      acao: 'criacao',
      descricao: `Login criado para ${r.nome} (usuário ${r.usuario}). Logins em uso: ${r.emUso} de ${r.limite}.`,
      registroId: r.uid,
      documentoTipo: 'usuario',
      documentoNumero: `Usuário ${r.nome}`,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'criar o login');
  }
});

/** POST /api/usuarios/vincular-motorista -- { usuarioId, motoristaId } (26/10/2026). */
router.post('/vincular-motorista', podeGerirFuncionario, async (req, res) => {
  try {
    const r = await vincularMotorista({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'usuarios',
      acao: 'edicao',
      descricao: `Usuário ${r.nome} vinculado ao motorista ${r.motoristaNome}${r.appLiberado ? '' : ' (aplicativo sem vaga no plano)'}.`,
      registroId: r.usuarioId,
      documentoTipo: 'usuario',
      documentoNumero: `Usuário ${r.nome}`,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'vincular o motorista');
  }
});

/** POST /api/usuarios/ficha -- { usuarioId, nome, codigoVendedor?, motorista? } (26/10/2026). */
router.post('/ficha', podeGerirFuncionario, async (req, res) => {
  try {
    const r = await editarFicha({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'usuarios',
      acao: 'edicao',
      descricao: `Ficha do funcionário ${r.nome} alterada${r.motorista && r.motorista.novo ? ' (cadastrado como motorista)' : ''}.`,
      registroId: r.usuarioId,
      documentoTipo: 'usuario',
      documentoNumero: `Usuário ${r.nome}`,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'salvar o funcionário');
  }
});

/** POST /api/usuarios/permissoes -- { usuarioId, permissoes, nivelAcesso? } (26/10/2026). */
router.post('/permissoes', podeGerirFuncionario, async (req, res) => {
  try {
    // "Antes" do historico: lido aqui, antes de gravar (so' serve ao historico).
    const antes = await lerUsuarioParaHistorico(req.body?.usuarioId);
    const r = await salvarPermissoes({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {}, gerente: req.gerenteDaEquipe === true });
    // Historico de alteracoes (09/11/2026): as permissoes que entraram e sairam e o nivel de acesso.
    void (async () => {
      const depois = await lerUsuarioParaHistorico(r.usuarioId);
      // Sem o "antes" (leitura falhou), nao da' para dizer o que entrou: registra so' que mudou.
      const { entraram, sairam } = antes && depois ? mudancasDePermissoes(antes.permissoes, depois.permissoes) : { entraram: [], sairam: [] };
      const alteracoes = [
        ...entraram.map((p) => ({ campo: `Permissão: ${rotuloDaPermissao(p)}`, valorAnterior: 'Não', valorNovo: 'Sim' })),
        ...sairam.map((p) => ({ campo: `Permissão: ${rotuloDaPermissao(p)}`, valorAnterior: 'Sim', valorNovo: 'Não' })),
      ];
      const nivelAntes = NIVEL_ACESSO_LABELS[parseNivelAcesso(antes && antes.nivelAcesso)];
      const nivelDepois = NIVEL_ACESSO_LABELS[parseNivelAcesso(depois && depois.nivelAcesso)];
      const nivelMudou = Boolean(antes && depois) && nivelAntes !== nivelDepois;
      if (nivelMudou) alteracoes.push({ campo: 'Nível de acesso', valorAnterior: nivelAntes, valorNovo: nivelDepois });
      if (alteracoes.length === 0 && antes && depois) return;
      const partes = [
        entraram.length ? `${entraram.length} permissão(ões) liberada(s)` : '',
        sairam.length ? `${sairam.length} retirada(s)` : '',
        nivelMudou ? `nível de acesso ${nivelAntes} → ${nivelDepois}` : '',
      ].filter(Boolean);
      await registrarLog(req.user, {
        modulo: 'usuarios',
        acao: 'edicao',
        descricao: `Permissões de ${r.nome || 'usuário'} alteradas${partes.length ? `: ${partes.join(', ')}` : ''}.`,
        registroId: r.usuarioId,
        documentoTipo: 'usuario',
        documentoNumero: `Usuário ${r.nome || ''}`.trim(),
        alteracoes,
      });
    })();
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'salvar as permissões');
  }
});

/** POST /api/usuarios/situacao -- { usuarioId, ativo } (26/10/2026). */
router.post('/situacao', podeGerirFuncionario, async (req, res) => {
  try {
    const r = await alterarSituacao({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'usuarios',
      acao: r.ativo ? 'reativacao' : 'inativacao',
      descricao: `Usuário ${r.nome} ${r.ativo ? 'reativado' : 'inativado'}.`,
      registroId: r.usuarioId,
      documentoTipo: 'usuario',
      documentoNumero: `Usuário ${r.nome}`,
      alteracoes: [{ campo: 'Situação', valorAnterior: r.ativo ? 'Inativo' : 'Ativo', valorNovo: r.ativo ? 'Ativo' : 'Inativo' }],
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'alterar a situação do usuário');
  }
});

/** POST /api/usuarios/acesso-app -- { usuarioId, ligar }. */
router.post('/acesso-app', soAdministrador, async (req, res) => {
  try {
    const r = await alterarAcessoApp({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'usuarios',
      acao: 'edicao',
      descricao: `Aplicativo mobile ${r.ligado ? 'liberado' : 'desligado'} para ${r.nome}.`,
      registroId: r.usuarioId,
      documentoTipo: 'usuario',
      documentoNumero: `Usuário ${r.nome}`,
      alteracoes: [{ campo: 'Usa o aplicativo mobile', valorAnterior: r.ligado ? 'Não' : 'Sim', valorNovo: r.ligado ? 'Sim' : 'Não' }],
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'alterar o acesso ao aplicativo');
  }
});

module.exports = router;
