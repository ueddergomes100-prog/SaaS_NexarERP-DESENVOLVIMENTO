/*
 * QUEM GERE UM FUNCIONARIO DA EQUIPE (26/10/2026, pedido do dono).
 *
 * Dono/administrador: como sempre. Gerente (nivel 'gerente' com "Admin: Equipe
 * e Acessos"): edita a ficha, troca a senha de acesso, define o PIN, inativa e
 * reativa -- so' de funcionario COMUM: nunca outro gerente, administrador, o
 * dono ou a si mesmo (podeSerAlvoDePermissaoPorGerente, a mesma regra das
 * permissoes). O alvo vem de req.body.usuarioId e e' lido aqui, no banco.
 */
const { db } = require('../config/firebase');
const {
  parseNivelAcesso,
  podeCriarLoginDeEquipe,
  podeSerAlvoDePermissaoPorGerente,
} = require('../domain/visibilidadeVendasDomain');

const ehGestor = (user) => Boolean(user && (user.isPlatformAdmin || user.isTenantManager));

const ehGerenteDaEquipe = (user) => Boolean(user) && podeCriarLoginDeEquipe({
  role: user.role, isOwner: false, nivelAcesso: user.nivelAcesso, permissoes: user.permissoes,
});

/** O gerente pode mexer neste funcionario? (le o alvo no banco) */
const gerentePodeGerir = async (user, usuarioId) => {
  const id = String(usuarioId ?? '');
  if (!ehGerenteDaEquipe(user) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return false;
  const snap = await db.collection('usuarios').doc(id).get();
  const alvo = snap.exists ? snap.data() : null;
  return Boolean(alvo) && alvo.tenantId === user.tenantId && podeSerAlvoDePermissaoPorGerente({
    targetUserId: id,
    targetRole: alvo.role,
    targetNivelAcesso: parseNivelAcesso(alvo.nivelAcesso),
    actorUserId: user.uid,
  });
};

const MENSAGEM_GERENTE = 'O gerente só altera funcionário comum: nunca outro gerente, um administrador, o dono ou a si mesmo.';

/*
 * DONO E ADMINISTRADOR COMO ALVO (seguranca, bloco B, 25/11/2026, decisao do dono).
 * Antes qualquer administrador passava sem olhar quem era o alvo: trocava a senha,
 * o PIN e o codigo do DONO e entrava como ele pelo computador do caixa. Agora:
 *  - os dados do dono (senha, PIN, codigo, ficha) so' o proprio dono muda;
 *  - os de um administrador so' o dono muda (e o proprio administrador, na
 *    propria ficha -- inativar a si mesmo o servico recusa);
 *  - a equipe da plataforma segue podendo tudo (suporte).
 * Funcionario comum: como sempre.
 */
const PAPEIS_DE_GESTOR = ['Master', 'Admin'];
const MENSAGEM_ALVO_DONO = 'Só o próprio dono da empresa altera a senha, a senha de vendedor, o código e a situação dele.';
const MENSAGEM_ALVO_ADMIN = 'Só o dono da empresa altera um administrador (senha, senha de vendedor, código, permissões e situação).';

/** Motivo em portugues quando este gestor NAO pode mexer no alvo; '' quando pode (ou quando o servico e' quem decide). */
const motivoGestorNaoPodeNoAlvo = async (user, usuarioId) => {
  if (!user || user.isPlatformAdmin) return '';
  const id = String(usuarioId ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return '';
  const snap = await db.collection('usuarios').doc(id).get();
  const alvo = snap.exists ? snap.data() : null;
  if (!alvo) return '';
  // A propria ficha (codigo e senha de vendedor) cada um muda; inativar a si mesmo o servico recusa.
  if (id === user.uid) return '';
  if (alvo.tenantId === id) return MENSAGEM_ALVO_DONO;
  if (PAPEIS_DE_GESTOR.includes(alvo.role) && !user.dono) return MENSAGEM_ALVO_ADMIN;
  return '';
};

/** Middleware: dono/administrador, ou gerente sobre funcionario comum (marca req.gerenteDaEquipe). */
const podeGerirFuncionario = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Usuário não autenticado.' });
    if (ehGestor(req.user)) {
      const motivo = await motivoGestorNaoPodeNoAlvo(req.user, req.body?.usuarioId);
      if (motivo) return res.status(403).json({ error: motivo });
      return next();
    }
    if (await gerentePodeGerir(req.user, req.body?.usuarioId)) {
      req.gerenteDaEquipe = true;
      return next();
    }
    return res.status(403).json({
      error: ehGerenteDaEquipe(req.user)
        ? MENSAGEM_GERENTE
        : 'Só o dono, um administrador ou um gerente com "Admin: Equipe e Acessos" liberado altera funcionários.',
    });
  } catch (erro) {
    console.error('[Equipe] conferir quem gere:', erro);
    return res.status(500).json({ error: 'Não foi possível conferir sua permissão agora. Tente de novo em instantes.' });
  }
};

module.exports = { podeGerirFuncionario, gerentePodeGerir, ehGestor, ehGerenteDaEquipe, motivoGestorNaoPodeNoAlvo };
