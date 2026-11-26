/*
 * PERMISSAO POR ACAO NA ADMINISTRACAO (item 15 da Embala Minas, 25/11/2026).
 *
 * Mesmo padrao do Financeiro, de Vendas e do Estoque (permissoesFinanceiro.js,
 * permissoesVendas.js, permissoesEstoque.js): cada acao pede a SUA permissao,
 * conferida pelas EFETIVAS (permissoesNovasDomain.ts, pacote 'administracao-1'
 * -- o nivel gerente traz o que ele ja' fazia: abrir Equipe, liberar e retirar
 * permissoes, liberar trava; com a Equipe marcada, criar login, ficha, senha e
 * inativar). Dono e plataforma seguem liberados; o administrador passa pelas
 * efetivas (troca do administrador, 25/11/2026).
 *
 * Aqui so' o que passa pelo servidor: backup (gerar e baixar), computadores
 * do caixa, numeracao dos documentos, liberar trava, Equipe e Acessos,
 * Configuracoes Gerais, Spedy (dados da empresa e numeracao fiscal) e filiais.
 * O que a tela da filial grava direto no banco so' a tela confere ate' as
 * rules (fase final).
 *
 * Funcoes puras (sem Firestore), para testar sozinhas.
 */
const { podePelasEfetivas, montarMensagemSemPermissao } = require('./permissoesFinanceiro');
const {
  PERMISSAO_ADMINISTRACAO: PA,
  PERMISSAO_CONFIG_AREAS: PCA,
  PERMISSAO_FILIAIS_GESTAO: PFG,
  PERMISSAO_TROCA_ADMINISTRADOR: PTA,
  permissoesEfetivas,
} = require('../domain/permissoesNovasDomain');

const podeNaAdministracao = podePelasEfetivas;

/** O que cada permissao deixa fazer, na frase "Voce nao tem permissao para ...", e o que fazer sem ela. */
const ACOES = {
  [PA.configGerais]: { acao: 'alterar as configurações gerais (valem para todas as filiais)' },
  [PA.dadosEmpresa]: { acao: 'alterar os dados da empresa (razão social, CNPJ, endereço e logo)' },
  [PA.numeracao]: { acao: 'ver e adiantar a numeração dos documentos' },
  [PA.equipe]: { acao: 'abrir Equipe e Acessos' },
  [PA.equipeCriar]: { acao: 'criar login de funcionário' },
  [PA.equipeEditar]: { acao: 'alterar a ficha do funcionário' },
  [PA.equipeSenha]: { acao: 'trocar a senha de acesso ou a senha de vendedor' },
  [PA.equipeInativar]: { acao: 'inativar ou reativar usuário' },
  [PA.equipePermissoes]: { acao: 'liberar ou retirar permissões' },
  [PA.equipeNivel]: { acao: 'mudar o nível de acesso' },
  [PA.equipeApp]: { acao: 'liberar ou desligar o aplicativo mobile' },
  [PA.equipeFilialPadrao]: { acao: 'definir a filial padrão dos usuários' },
  [PA.backupGerar]: { acao: 'gerar backup e mexer no agendamento' },
  [PA.backupBaixar]: { acao: 'baixar o backup da empresa' },
  [PA.liberarTrava]: { acao: 'liberar documento aberto por outra pessoa', dica: 'Sem ela, peça para quem está com o documento aberto fechá-lo.' },
  [PCA.caixaComputadores]: { acao: 'ativar, ver ou desativar computadores do caixa' },
  [PCA.planoContas]: { acao: 'alterar o plano de contas' },
  [PCA.cashbackConfigurar]: { acao: 'alterar as regras do cashback' },
  [PCA.fiscalNumeracao]: { acao: 'alterar série, numeração, ambiente e CSC das notas' },
  [PFG.gerenciar]: { acao: 'ver todas as filiais do grupo' },
  [PFG.cadastrar]: { acao: 'cadastrar filiais' },
  [PFG.alterar]: { acao: 'alterar ou inativar filiais' },
  [PFG.resumo]: { acao: 'ver o resumo das filiais' },
  // Troca do administrador (25/11/2026): o que so' o papel fazia.
  [PTA.tabelasAtivar]: { acao: 'ativar ou desativar CFOP nas Tabelas Fiscais' },
  [PTA.comissaoUsuario]: { acao: 'alterar as regras de comissão dos usuários' },
  [PTA.vendedoresLiberadores]: { acao: 'liberar desconto ou o aplicativo no cadastro do vendedor' },
};

const mensagemSemPermissao = montarMensagemSemPermissao(ACOES);

/** Das permissoes pedidas, as que o usuario nao tem (efetivas). [] = pode. */
const permissoesQueFaltam = (user, ids) => [...new Set(ids)].filter((id) => !podeNaAdministracao(user, id));

/**
 * Middleware: dono/administrador e plataforma passam; o resto, com a
 * permissao propria (efetiva). Com `qualquer`, basta uma das pedidas.
 */
const exigirPermissao = (ids, { qualquer = false } = {}) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Usuário não autenticado. Entre de novo no sistema.' });
  const faltam = permissoesQueFaltam(req.user, ids);
  const pode = qualquer ? faltam.length < ids.length : faltam.length === 0;
  if (pode) return next();
  return res.status(403).json({ error: mensagemSemPermissao(qualquer ? [ids[0]] : faltam) });
};

/**
 * Usuario lido do banco (ou req.user): tem a permissao contando o nivel, os
 * pacotes e o papel (administrador sem o pacote salvo tem todas)? Para os servicos que leem o cadastro na transacao
 * (filiais.js, configuracoesGerais.js), onde o papel ja' foi conferido antes.
 */
const temNoCadastro = (usuario, permissao, opcoes = {}) => Boolean(usuario)
  && permissoesEfetivas(usuario.permissoes, usuario.nivelAcesso, { ...opcoes, papel: usuario.role }).includes(permissao);

/** Ordem dos niveis: quem nao e' administrador so' da' ate' o nivel que ele mesmo tem. */
const ORDEM_DO_NIVEL = { funcionario: 0, supervisor: 1, gerente: 2 };
const nivelCabe = (pedido, doAutor) => (ORDEM_DO_NIVEL[pedido] ?? 0) <= (ORDEM_DO_NIVEL[doAutor] ?? 0);

module.exports = {
  ACOES,
  podeNaAdministracao,
  permissoesQueFaltam,
  mensagemSemPermissao,
  exigirPermissao,
  temNoCadastro,
  nivelCabe,
};
