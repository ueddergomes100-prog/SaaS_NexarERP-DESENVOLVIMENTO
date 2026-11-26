/*
 * QUEM GERE UM FUNCIONARIO DA EQUIPE (26/10/2026, pedido do dono).
 *
 * Dono e plataforma: como sempre (o dono e' o unico que mexe no cadastro de um
 * administrador). TROCA DO ADMINISTRADOR (25/11/2026): o administrador (papel
 * Master/Admin que nao e' o dono) passa pela permissao da acao, como qualquer
 * um -- ele tem todas enquanto o dono nao salvar as dele (pacote
 * 'administrador-1') -- e alcanca funcionario e gerente, nunca o dono nem
 * outro administrador; ele mesmo, so' na ficha e na senha. Item 15 (fase Administracao, 25/11/2026):
 * o resto, cada acao com a SUA permissao (Admin: Equipe -- criar login,
 * alterar a ficha, trocar a senha, inativar, liberar permissoes, nivel,
 * aplicativo), conferida pelas efetivas (permissoesNovasDomain.ts, pacote
 * 'administracao-1'): o gerente com "Admin: Equipe e Acessos", que ja' fazia
 * tudo isso, vem com elas marcadas. Sem ser dono/administrador, so' sobre
 * funcionario COMUM: nunca um gerente, administrador, o dono ou a si mesmo
 * (podeSerAlvoDePermissaoPorGerente, a mesma regra das permissoes). O alvo
 * vem de req.body.usuarioId e e' lido aqui, no banco.
 */
const { db } = require('../config/firebase');
const {
  parseNivelAcesso,
  podeSerAlvoDePermissaoPorGerente,
} = require('../domain/visibilidadeVendasDomain');
const { permissoesEfetivas, ehPapelDeAdministrador, PERMISSAO_ADMINISTRACAO: PA } = require('../domain/permissoesNovasDomain');
const { mensagemSemPermissao } = require('../services/permissoesAdministracao');

/** Liberado em tudo da Equipe: o dono e a plataforma. */
const ehGestor = (user) => Boolean(user && (user.isPlatformAdmin || user.dono));

/** Tem a permissao da acao (contando o nivel, os pacotes e o papel). */
const temAPermissao = (user, permissao) => Boolean(user)
  && permissoesEfetivas(user.permissoes, user.nivelAcesso, { papel: user.role }).includes(permissao);

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

/** O que o administrador faz no proprio cadastro (com a permissao): ficha (codigo) e senha. */
const NO_PROPRIO_CADASTRO = [PA.equipeEditar, PA.equipeSenha];

/**
 * Administrador (nao dono) com a permissao da acao: alvo da mesma empresa, que
 * nao e' o dono nem outro administrador; ele mesmo, so' ficha e senha. Le' o alvo no banco.
 */
const administradorPodeGerir = async (user, usuarioId, permissao) => {
  const id = String(usuarioId ?? '');
  if (!user || !user.isAdministrador || !temAPermissao(user, permissao) || !ID_VALIDO.test(id)) return false;
  const snap = await db.collection('usuarios').doc(id).get();
  const alvo = snap.exists ? snap.data() : null;
  if (!alvo || alvo.tenantId !== user.tenantId) return false;
  if (id === alvo.tenantId) return false;
  if (id === user.uid) return NO_PROPRIO_CADASTRO.includes(permissao);
  return !ehPapelDeAdministrador(alvo.role);
};

/** Compatibilidade: "gerente da equipe" = quem pode alterar a ficha de funcionario comum. */
const ehGerenteDaEquipe = (user) => temAPermissao(user, PA.equipeEditar);

/** Quem nao e' dono/administrador pode mexer neste funcionario com esta permissao? (le o alvo no banco) */
const gerentePodeGerir = async (user, usuarioId, permissao = PA.equipeEditar) => {
  const id = String(usuarioId ?? '');
  if (!temAPermissao(user, permissao) || !ID_VALIDO.test(id)) return false;
  const snap = await db.collection('usuarios').doc(id).get();
  const alvo = snap.exists ? snap.data() : null;
  return Boolean(alvo) && alvo.tenantId === user.tenantId && podeSerAlvoDePermissaoPorGerente({
    targetUserId: id,
    targetRole: alvo.role,
    targetNivelAcesso: parseNivelAcesso(alvo.nivelAcesso),
    actorUserId: user.uid,
  });
};

const MENSAGEM_GERENTE = 'Sem ser o dono ou um administrador, você só altera funcionário comum: nunca um gerente, um administrador, o dono ou a si mesmo.';
const MENSAGEM_ADMINISTRADOR = 'O cadastro do dono e o de outro administrador só o dono da empresa altera. Peça ao dono.';

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

/**
 * Middleware (fabrica): dono e plataforma; o administrador com a permissao da
 * acao (marca req.administradorDaEquipe); o resto com a permissao da acao
 * sobre funcionario comum (marca req.gerenteDaEquipe).
 */
const podeGerirFuncionario = (permissao) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Usuário não autenticado.' });
    if (ehGestor(req.user)) {
      // Bloco B: trava sobre o alvo dono/administrador (para o dono e a plataforma nao recusa nada).
      const motivo = await motivoGestorNaoPodeNoAlvo(req.user, req.body?.usuarioId);
      if (motivo) return res.status(403).json({ error: motivo });
      return next();
    }
    if (req.user.isAdministrador) {
      if (await administradorPodeGerir(req.user, req.body?.usuarioId, permissao)) {
        req.administradorDaEquipe = true;
        return next();
      }
      return res.status(403).json({ error: temAPermissao(req.user, permissao) ? MENSAGEM_ADMINISTRADOR : mensagemSemPermissao([permissao]) });
    }
    if (await gerentePodeGerir(req.user, req.body?.usuarioId, permissao)) {
      req.gerenteDaEquipe = true;
      return next();
    }
    return res.status(403).json({
      error: temAPermissao(req.user, permissao) ? MENSAGEM_GERENTE : mensagemSemPermissao([permissao]),
    });
  } catch (erro) {
    console.error('[Equipe] conferir quem gere:', erro);
    return res.status(500).json({ error: 'Não foi possível conferir sua permissão agora. Tente de novo em instantes.' });
  }
};

module.exports = { podeGerirFuncionario, gerentePodeGerir, administradorPodeGerir, ehGestor, ehGerenteDaEquipe, temAPermissao, MENSAGEM_GERENTE, MENSAGEM_ADMINISTRADOR, motivoGestorNaoPodeNoAlvo };
