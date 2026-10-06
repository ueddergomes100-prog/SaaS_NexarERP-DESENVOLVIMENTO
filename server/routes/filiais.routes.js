const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { rotuloFilial } = require('../domain/filialDomain');
const { ErroFilial, listarFiliais, ativarFilial, criarFilial, editarFilial, lerCadastroDaFilial, estoqueNasFiliais, saldoDoClienteNoGrupo, resumoDoGrupo } = require('../services/filiais');

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
    });
    return res.status(201).json(resultado);
  } catch (erro) {
    return responderErro(res, erro, 'cadastrar a filial');
  }
});

// Rotas fixas ANTES de '/:tenantId' (senao 'estoque' vira um tenantId).
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
    registrarLog(req.user, {
      modulo: 'filiais',
      acao: 'edicao',
      descricao: `Filial ${rotuloFilial(filial)}: ${mudancas.join(', ') || 'sem mudanças'}`,
    });
    return res.json({ ok: true, filial });
  } catch (erro) {
    return responderErro(res, erro, 'alterar a filial');
  }
});

module.exports = router;
