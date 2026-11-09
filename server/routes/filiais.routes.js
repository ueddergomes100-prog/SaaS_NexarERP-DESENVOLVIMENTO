const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { rotuloFilial } = require('../domain/filialDomain');
const { ErroFilial, listarFiliais, ativarFilial, criarFilial, editarFilial, lerCadastroDaFilial, estoqueNasFiliais, saldoDoClienteNoGrupo, resumoDoGrupo, entrarNaFilialPadrao, definirFilialPadrao } = require('../services/filiais');
const { ErroConfiguracoesGerais, salvarConfiguracoesGerais } = require('../services/configuracoesGerais');
const { db } = require('../config/firebase');
const { diferencasEntre } = require('../domain/historicoAlteracoesDomain');

// ---------------------------------------------------------------------------
// HISTORICO DE ALTERACOES (09/11/2026): Configuracoes Gerais com antes e depois.
// ---------------------------------------------------------------------------
const simNao = (v) => (v === true ? 'Sim' : 'Não');
const listaDeCategorias = (v) => {
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (typeof v === 'string') return v.split('\n').map((c) => c.trim()).filter(Boolean).join(', ');
  return '';
};
const CAMPOS_GERAIS_NO_HISTORICO = [
  { campo: 'planoContasReceitas', rotulo: 'Categorias de receita', formatar: listaDeCategorias },
  { campo: 'planoContasDespesas', rotulo: 'Categorias de despesa', formatar: listaDeCategorias },
  { campo: 'validarCadastroProduto', rotulo: 'Validar cadastro de produto', formatar: simNao },
  { campo: 'modoValidacaoCliente', rotulo: 'Validação do cadastro de cliente' },
  { campo: 'trabalhaComLimiteCredito', rotulo: 'Trabalha com limite de crédito', formatar: simNao },
  { campo: 'transferenciaSemNota', rotulo: 'Transferência entre filiais sem nota', formatar: simNao },
  { campo: 'transferenciaNfeTributacao', rotulo: 'Tributação da NF-e de transferência' },
  { campo: 'usaGradeDeProdutos', rotulo: 'Loja utiliza grade de produtos', formatar: simNao },
  { campo: 'cashback', rotulo: 'Cashback' },
];

/** Configuracao como estava antes de gravar (so' para o historico; falha nao trava nada). */
const lerConfiguracaoParaHistorico = async (tenantId) => {
  try {
    if (!db || !tenantId) return null;
    const snap = await db.collection('configuracoes').doc(String(tenantId)).get();
    return snap.exists ? snap.data() : {};
  } catch (erro) {
    console.error('[Filiais] historico: nao leu a configuracao:', erro.message);
    return null;
  }
};

/**
 * FILIAIS -- ver services/filiais.js e docs/PLANO_FILIAIS.md.
 *   GET  /api/filiais            filiais em que o usuario pode entrar
 *   POST /api/filiais/ativar     entrar em outra filial
 *   POST /api/filiais            cadastrar filial (dono/administrador)
 *   GET  /api/filiais/:tenantId  cadastro completo da filial (para editar)
 *   PUT  /api/filiais/:tenantId  mudar o cadastro (menos CNPJ) ou a situacao
 *   POST /api/filiais/estoque     estoque dos produtos em cada filial (fase 2)
 *   GET  /api/filiais/clientes/:id/saldo  saldo em aberto do cliente no grupo
 *   GET  /api/filiais/resumo?inicio&fim    vendas, a receber e estoque por filial (fase 5)
 *   POST /api/filiais/configuracoes-gerais  regras que valem para todas as filiais (15/10/2026)
 *   POST /api/filiais/entrar-na-padrao      no login: abre a filial padrao do usuario (15/10/2026)
 *   PUT  /api/filiais/usuarios/:uid/filial-padrao  filial padrao de um usuario (dono/administrador)
 */
const router = express.Router();
router.use(authenticate);

const responderErro = (res, erro, acao) => {
  if (erro instanceof ErroFilial) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Filiais] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao}. Nada foi alterado. Tente de novo em instantes.` });
};

router.get('/', async (req, res) => {
  try {
    return res.json(await listarFiliais({ user: req.user }));
  } catch (erro) {
    return responderErro(res, erro, 'carregar as filiais');
  }
});

router.post('/ativar', async (req, res) => {
  try {
    const { filial } = await ativarFilial({ user: req.user, destino: req.body?.tenantId });
    registrarLog({ ...req.user, tenantId: filial.tenantId }, {
      modulo: 'filiais',
      acao: 'acesso',
      descricao: `Entrou na filial ${rotuloFilial(filial)}`,
      registroId: filial.tenantId,
      documentoTipo: 'filial',
      documentoNumero: `Filial ${rotuloFilial(filial)}`,
    });
    return res.json({ ok: true, filial });
  } catch (erro) {
    return responderErro(res, erro, 'trocar de filial');
  }
});

router.post('/', async (req, res) => {
  try {
    const resultado = await criarFilial({ user: req.user, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'filiais',
      acao: 'criacao',
      descricao: `Cadastrou a filial ${rotuloFilial(resultado.filial)}`,
      registroId: resultado.tenantId || (resultado.filial && resultado.filial.tenantId),
      documentoTipo: 'filial',
      documentoNumero: `Filial ${rotuloFilial(resultado.filial)}`,
    });
    return res.status(201).json(resultado);
  } catch (erro) {
    return responderErro(res, erro, 'cadastrar a filial');
  }
});

// Rotas fixas ANTES de '/:tenantId' (senao 'estoque' vira um tenantId).
// Filial padrao (15/10/2026): cada login comeca na filial padrao do usuario.
router.post('/entrar-na-padrao', async (req, res) => {
  try {
    return res.json(await entrarNaFilialPadrao({ user: req.user }));
  } catch (erro) {
    return responderErro(res, erro, 'abrir a filial padrão');
  }
});

router.put('/usuarios/:uid/filial-padrao', async (req, res) => {
  try {
    const r = await definirFilialPadrao({ user: req.user, usuarioId: req.params.uid, destino: req.body?.tenantId });
    registrarLog(req.user, {
      modulo: 'usuarios',
      acao: 'edicao',
      descricao: `Filial padrão de ${r.usuarioNome}: ${rotuloFilial(r.filial)}`,
      registroId: String(req.params.uid),
      documentosRelacionados: r.filial && r.filial.tenantId ? [r.filial.tenantId] : [],
      documentoTipo: 'usuario',
      documentoNumero: `Usuário ${r.usuarioNome}`,
      alteracoes: [{ campo: 'Filial padrão', valorAnterior: null, valorNovo: rotuloFilial(r.filial) }],
    });
    return res.json({ ok: true, filial: r.filial });
  } catch (erro) {
    return responderErro(res, erro, 'gravar a filial padrão');
  }
});

// Configuracoes Gerais (15/10/2026): o mesmo valor gravado em todas as filiais.
router.post('/configuracoes-gerais', async (req, res) => {
  try {
    const antes = await lerConfiguracaoParaHistorico(req.user.tenantId);
    const r = await salvarConfiguracoesGerais({ user: req.user, corpo: req.body || {} });
    const valores = (r && r.valores) || {};
    const alteracoes = antes
      ? diferencasEntre(antes, valores, CAMPOS_GERAIS_NO_HISTORICO.filter((c) => Object.prototype.hasOwnProperty.call(valores, c.campo)))
      : [];
    // Sem o "antes" (leitura falhou) registra que salvou; com ele, so' quando algo mudou.
    if (!antes || alteracoes.length > 0) {
      registrarLog(req.user, {
        modulo: 'configuracoes',
        acao: 'edicao',
        descricao: (r.grupo
          ? `Configurações gerais alteradas, gravadas nas ${r.filiais} filiais de ${r.grupo}`
          : 'Configurações gerais alteradas')
          + (alteracoes.length ? `: ${alteracoes.map((a) => a.campo).join(', ')}.` : '.'),
        registroId: req.user.tenantId,
        documentoTipo: 'configuracao',
        documentoNumero: 'Configurações gerais',
        alteracoes,
      });
    }
    return res.json(r);
  } catch (erro) {
    if (erro instanceof ErroConfiguracoesGerais) return res.status(erro.status).json({ error: erro.message });
    return responderErro(res, erro, 'salvar as configurações gerais');
  }
});

router.post('/estoque', async (req, res) => {
  try {
    return res.json(await estoqueNasFiliais({ user: req.user, chaves: req.body?.chaves }));
  } catch (erro) {
    return responderErro(res, erro, 'consultar o estoque das filiais');
  }
});

router.get('/resumo', async (req, res) => {
  try {
    return res.json(await resumoDoGrupo({ user: req.user, inicio: req.query.inicio, fim: req.query.fim }));
  } catch (erro) {
    return responderErro(res, erro, 'montar o resumo das filiais');
  }
});

router.get('/clientes/:id/saldo', async (req, res) => {
  try {
    return res.json(await saldoDoClienteNoGrupo({ user: req.user, clienteId: req.params.id }));
  } catch (erro) {
    return responderErro(res, erro, 'somar o saldo do cliente nas filiais');
  }
});

router.get('/:tenantId', async (req, res) => {
  try {
    return res.json(await lerCadastroDaFilial({ user: req.user, tenantId: req.params.tenantId }));
  } catch (erro) {
    return responderErro(res, erro, 'carregar o cadastro da filial');
  }
});

router.put('/:tenantId', async (req, res) => {
  try {
    const { filial, antes } = await editarFilial({ user: req.user, tenantId: req.params.tenantId, corpo: req.body || {} });
    const mudancas = [];
    if (antes.nome !== filial.nome) mudancas.push(`nome ${antes.nome} → ${filial.nome}`);
    if (antes.codigo !== filial.codigo) mudancas.push(`código ${antes.codigo} → ${filial.codigo}`);
    if (antes.ativa !== filial.ativa) mudancas.push(filial.ativa ? 'reativada' : 'inativada');
    if (antes.cidade !== filial.cidade || antes.uf !== filial.uf) mudancas.push(`cidade ${filial.cidade}/${filial.uf}`);
    const situacaoMudou = antes.ativa !== filial.ativa;
    registrarLog(req.user, {
      modulo: 'filiais',
      acao: situacaoMudou ? (filial.ativa ? 'reativacao' : 'inativacao') : 'edicao',
      descricao: `Filial ${rotuloFilial(filial)}: ${mudancas.join(', ') || 'sem mudanças'}`,
      registroId: String(req.params.tenantId),
      documentoTipo: 'filial',
      documentoNumero: `Filial ${rotuloFilial(filial)}`,
      alteracoes: diferencasEntre(
        { ...antes, ativa: antes.ativa === false ? 'Inativa' : 'Ativa' },
        { ...filial, ativa: filial.ativa === false ? 'Inativa' : 'Ativa' },
        [
          { campo: 'nome', rotulo: 'Nome' },
          { campo: 'codigo', rotulo: 'Código' },
          { campo: 'ativa', rotulo: 'Situação' },
          { campo: 'cidade', rotulo: 'Cidade' },
          { campo: 'uf', rotulo: 'UF' },
        ],
      ),
    });
    return res.json({ ok: true, filial });
  } catch (erro) {
    return responderErro(res, erro, 'alterar a filial');
  }
});

module.exports = router;
