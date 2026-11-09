const express = require('express');
const { authenticate } = require('../middleware/auth');
const { limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');
const {
  ErroTabelasFiscais,
  definirCfopAtivo,
  registrarUso,
  cadastrarNcm,
  cadastrarCest,
  buscar,
} = require('../services/tabelasFiscais');
const { registrarLog } = require('../services/auditoria');
const { cfopPorCodigo, formatarCodigoCfop } = require('../domain/cfopDomain');

/**
 * TABELAS FISCAIS (20/10/2026): CFOP ativo/desativado na empresa e a base unica
 * de NCM/CEST. Ver services/tabelasFiscais.js.
 */
const router = express.Router();
router.use(authenticate);

const porUsuario = (req) => (req.user && req.user.uid) || req.ip;
// "Registrar uso" vem de todo produto salvo e de toda entrada de nota.
const limiteDoUso = limitadorPorChave('tabelas-fiscais-uso', porUsuario, {
  limite: 240,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Muitas atualizações da base de NCM/CEST em pouco tempo. Aguarde alguns minutos.',
});
const limiteDoCadastro = limitadorPorChave('tabelas-fiscais-cadastro', porUsuario, {
  limite: 120,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Muitos cadastros em pouco tempo. Aguarde alguns minutos.',
});

const responderErro = (res, erro, operacao) => {
  if (erro instanceof ErroTabelasFiscais) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Tabelas fiscais] ${operacao}:`, erro);
  return res.status(500).json({ error: 'Não foi possível salvar na tabela fiscal. Tente novamente em instantes.' });
};

/** Busca na base de NCM ou CEST (?tipo=ncm|cest&busca=...&ncm=...). Qualquer usuario da empresa le. */
router.get('/busca', async (req, res) => {
  try {
    const r = await buscar({ tipo: req.query.tipo, busca: req.query.busca, ncm: req.query.ncm });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'buscar');
  }
});

router.post('/cfop/ativo', limiteDoCadastro, async (req, res) => {
  try {
    const r = await definirCfopAtivo({ user: req.user, codigo: req.body?.codigo, ativo: req.body?.ativo });
    // Historico de alteracoes (09/11/2026): vale para a empresa inteira (todas as filiais).
    const cfop = cfopPorCodigo(r.codigo);
    const rotulo = `CFOP ${formatarCodigoCfop(String(r.codigo))}`;
    registrarLog(req.user, {
      modulo: 'configuracoes',
      acao: 'edicao',
      descricao: `${rotulo}${cfop && cfop.descricao ? ` (${cfop.descricao})` : ''} ${r.ativo ? 'ativado' : 'desativado'} na empresa${r.filiais > 1 ? ` (${r.filiais} filiais)` : ''}.`,
      registroId: req.user.tenantId,
      documentoTipo: 'configuracao',
      documentoNumero: rotulo,
      alteracoes: [{ campo: `${rotulo} ativo`, valorAnterior: r.ativo ? 'Não' : 'Sim', valorNovo: r.ativo ? 'Sim' : 'Não' }],
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'CFOP ativo');
  }
});

router.post('/uso', limiteDoUso, async (req, res) => {
  try {
    const r = await registrarUso({ itens: req.body?.itens });
    // Historico de alteracoes (09/11/2026): so' quando um codigo NOVO entrou na base
    // (repetir codigo ja' conhecido e' rotina de todo produto salvo: nao vira registro).
    if (r.novosNcm > 0 || r.novosCest > 0) {
      registrarLog(req.user, {
        modulo: 'fiscal',
        acao: 'criacao',
        descricao: `Base de NCM/CEST completada automaticamente pelo uso: ${[
          r.novosNcm ? `${r.novosNcm} NCM novo(s)` : '',
          r.novosCest ? `${r.novosCest} CEST novo(s)` : '',
        ].filter(Boolean).join(' e ')} (sem descrição).`,
        documentoTipo: 'tabela_fiscal',
        documentoNumero: 'Tabelas Fiscais',
      });
    }
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'registrar uso');
  }
});

router.post('/ncm', limiteDoCadastro, async (req, res) => {
  try {
    const r = await cadastrarNcm({ user: req.user, corpo: req.body });
    registrarLog(req.user, {
      modulo: 'fiscal',
      acao: r.novo ? 'criacao' : 'edicao',
      descricao: `NCM ${r.codigo} ${r.novo ? 'cadastrado' : 'descrito'} na base: ${r.descricao}.`,
      documentoTipo: 'tabela_fiscal',
      documentoNumero: `NCM ${r.codigo}`,
      ...(r.novo ? {} : { alteracoes: [{ campo: 'Descrição do NCM', valorAnterior: null, valorNovo: r.descricao }] }),
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'cadastrar NCM');
  }
});

router.post('/cest', limiteDoCadastro, async (req, res) => {
  try {
    const r = await cadastrarCest({ user: req.user, corpo: req.body });
    registrarLog(req.user, {
      modulo: 'fiscal',
      acao: r.novo ? 'criacao' : 'edicao',
      descricao: `CEST ${r.codigo} ${r.novo ? 'cadastrado' : 'descrito'} na base: ${r.descricao}.`,
      documentoTipo: 'tabela_fiscal',
      documentoNumero: `CEST ${r.codigo}`,
      ...(r.novo ? {} : { alteracoes: [{ campo: 'Descrição do CEST', valorAnterior: null, valorNovo: r.descricao }] }),
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'cadastrar CEST');
  }
});

module.exports = router;
