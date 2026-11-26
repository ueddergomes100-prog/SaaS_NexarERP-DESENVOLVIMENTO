const express = require('express');
const { authenticate } = require('../middleware/auth');
const { redefinirSenhaAcesso, ErroSenhaAcesso } = require('../services/usuarioSenha');
const { ErroLimite, liberarCodigoParaCadastro, criarLogin, alterarAcessoApp, vincularMotorista, editarFicha, alterarSituacao, salvarPermissoes, criarVendedorBalcao } = require('../services/limitesDoPlano');
const { podeGerirFuncionario, temAPermissao } = require('../middleware/gestaoEquipe');
const { encerrarSessoes } = require('../services/sessoes');
const { PERMISSAO_ADMINISTRACAO: PA } = require('../domain/permissoesNovasDomain');
const { mensagemSemPermissao } = require('../services/permissoesAdministracao');
const { registrarLog } = require('../services/auditoria');
const { NIVEL_ACESSO_LABELS, parseNivelAcesso } = require('../domain/visibilidadeVendasDomain');
const { mudancasDePermissoes: mudancasEfetivas } = require('../domain/permissoesNovasDomain');
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

/** Permissoes que entraram e sairam (efetivas, sem os marcadores internos do app e dos pacotes). */
const mudancasDePermissoes = (antes, depois, nivelAntes, opcoes) => mudancasEfetivas(Array.isArray(antes) ? antes : [], Array.isArray(depois) ? depois : [], nivelAntes, opcoes);

const simNao = (v) => (v === true ? 'Sim' : 'Não');
const percentual = (v) => (typeof v === 'number' ? `${String(v).replace('.', ',')}%` : 'padrão do sistema');
const CAMPOS_DE_COMISSAO = [
  { campo: 'recebeComissaoServicos', rotulo: 'Recebe comissão de serviços', formatar: simNao },
  { campo: 'comissaoPercentualServicos', rotulo: 'Comissão de serviços (%)', formatar: percentual },
  { campo: 'recebeComissaoPecas', rotulo: 'Recebe comissão de produtos', formatar: simNao },
  { campo: 'comissaoPercentualPecas', rotulo: 'Comissão de produtos (%)', formatar: percentual },
];

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

/** Redefine a senha de ACESSO (login) de um funcionario. Dono/administrador, ou "Admin: Equipe -- trocar a senha" sobre funcionario comum. */
router.post('/redefinir-senha', podeGerirFuncionario(PA.equipeSenha), async (req, res) => {
  try {
    const resultado = await redefinirSenhaAcesso({
      tenantId: req.user.tenantId,
      usuarioId: req.body?.usuarioId,
      novaSenha: req.body?.novaSenha,
    });
    // Bloco B (25/11/2026): senha trocada derruba quem ja' tinha entrado (menos quem trocou a propria).
    if (resultado.usuarioId !== req.user.uid) await encerrarSessoes([resultado.usuarioId], 'senha de acesso trocada');
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
// Criar login (item 15, fase Administracao, 25/11/2026): "Admin: Equipe --
// criar login" (o gerente com Equipe e Acessos ja' vem com ela). O login nasce
// Funcionario comum, sem permissao (services/limitesDoPlano.js).
const podeCriarLogin = (req, res, next) => {
  const u = req.user;
  if (u && (u.isPlatformAdmin || u.dono || temAPermissao(u, PA.equipeCriar))) return next();
  return res.status(403).json({ error: mensagemSemPermissao([PA.equipeCriar]) });
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
router.post('/vincular-motorista', podeGerirFuncionario(PA.equipeEditar), async (req, res) => {
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

/**
 * POST /api/usuarios/codigo-livre -- { usuarioId?, codigoVendedor } (26/11/2026).
 * Antes de a tela de Vendedores gravar o codigo: recusa codigo de outro
 * cadastro ATIVO e tira o codigo dos inativos (limitesDoPlano.liberarCodigoParaCadastro).
 */
router.post('/codigo-livre', async (req, res) => {
  try {
    const r = await liberarCodigoParaCadastro({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    if (r.liberadosDe.length > 0) {
      registrarLog(req.user, {
        modulo: 'cadastros',
        acao: 'edicao',
        descricao: `Código de vendedor ${r.codigo} tirado do cadastro inativo de ${r.liberadosDe.join(', ')} para ser usado em outro cadastro.`,
        registroId: String(req.body?.usuarioId || ''),
        documentoTipo: 'usuario',
        documentoNumero: `Código ${r.codigo}`,
      });
    }
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'conferir o código do vendedor');
  }
});

/** POST /api/usuarios/ficha -- { usuarioId, nome, codigoVendedor?, motorista? } (26/10/2026). */
router.post('/ficha', podeGerirFuncionario(PA.equipeEditar), async (req, res) => {
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
router.post('/permissoes', podeGerirFuncionario(PA.equipePermissoes), async (req, res) => {
  try {
    // "Antes" do historico: lido aqui, antes de gravar (so' serve ao historico).
    const antes = await lerUsuarioParaHistorico(req.body?.usuarioId);
    const r = await salvarPermissoes({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {}, gerente: req.gerenteDaEquipe === true, administrador: req.administradorDaEquipe === true });
    // Historico de alteracoes (09/11/2026): as permissoes que entraram e sairam e o nivel de acesso.
    void (async () => {
      const depois = await lerUsuarioParaHistorico(r.usuarioId);
      // Sem o "antes" (leitura falhou), nao da' para dizer o que entrou: registra so' que mudou.
      // Papel do cadastro: administrador que o dono ainda nao tinha salvo tinha todas.
      const { entraram, sairam } = antes && depois ? mudancasDePermissoes(antes.permissoes, depois.permissoes, antes.nivelAcesso, { semFiliais: r.semFiliais, papel: r.papel }) : { entraram: [], sairam: [] };
      const alteracoes = [
        ...entraram.map((p) => ({ campo: `Permissão: ${rotuloDaPermissao(p)}`, valorAnterior: 'Não', valorNovo: 'Sim' })),
        ...sairam.map((p) => ({ campo: `Permissão: ${rotuloDaPermissao(p)}`, valorAnterior: 'Sim', valorNovo: 'Não' })),
        // Regras de comissao (troca do administrador, 25/11/2026: agora tambem pelo servidor).
        ...(antes && depois ? CAMPOS_DE_COMISSAO
          .filter(({ campo }) => (antes[campo] ?? null) !== (depois[campo] ?? null))
          .map(({ campo, rotulo, formatar }) => ({ campo: rotulo, valorAnterior: formatar(antes[campo]), valorNovo: formatar(depois[campo]) })) : []),
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

/**
 * POST /api/usuarios/vendedor -- cadastro de vendedor de balcao, sem login (bloco B
 * de seguranca, 25/11/2026): o id nasce aqui, nunca no navegador. Ver
 * criarVendedorBalcao em services/limitesDoPlano.js (quem pode e o que grava).
 */
router.post('/vendedor', async (req, res) => {
  try {
    const r = await criarVendedorBalcao({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'cadastros',
      acao: 'criacao',
      descricao: `Vendedor ${r.nome}${r.codigo ? ` (código ${r.codigo})` : ''} cadastrado.`,
      registroId: r.usuarioId,
      documentoTipo: 'vendedor',
      documentoNumero: `Vendedor ${r.nome}${r.codigo ? ` (código ${r.codigo})` : ''}`,
    });
    return res.status(201).json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'cadastrar o vendedor');
  }
});

/** POST /api/usuarios/situacao -- { usuarioId, ativo } (26/10/2026). */
router.post('/situacao', podeGerirFuncionario(PA.equipeInativar), async (req, res) => {
  try {
    const r = await alterarSituacao({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    // Bloco B (25/11/2026): inativado sai na hora do servidor e em ate' 1 hora do banco (as rules ja' recusam o perfil inativo).
    if (!r.ativo) await encerrarSessoes([r.usuarioId], 'usuário inativado');
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

/** POST /api/usuarios/acesso-app -- { usuarioId, ligar }. "Admin: Equipe -- liberar o aplicativo" (item 15). */
router.post('/acesso-app', podeGerirFuncionario(PA.equipeApp), async (req, res) => {
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
