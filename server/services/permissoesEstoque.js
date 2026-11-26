/*
 * PERMISSAO POR ACAO EM ESTOQUE E CADASTROS (item 15 da Embala Minas, 25/11/2026).
 *
 * Mesmo padrao do Financeiro e de Vendas (permissoesFinanceiro.js,
 * permissoesVendas.js): cada acao pede a SUA permissao, conferida pelas
 * EFETIVAS (permissoesNovasDomain.ts, pacote 'estoque-1' -- quem ja' usa a tela
 * tem as novas ate' as permissoes dele serem salvas de novo; o nivel gerente
 * traz o Modo Avancado e a transferencia sem nota). Dono e plataforma seguem
 * liberados; o administrador, pelas efetivas (troca do administrador, 25/11/2026).
 *
 * Aqui so' o que ja' passa pelo servidor: inativar/reativar e excluir
 * cadastro (cadastroIntegridade.js), fechar e cancelar balanco, receber,
 * recusar/cancelar e emitir de novo a nota da transferencia, e finalizar,
 * reabrir e cancelar OS. O resto grava pelo navegador e so' a tela confere
 * ate' as rules (fase final).
 *
 * Funcoes puras (sem Firestore), para testar sozinhas.
 */
const { podePelasEfetivas, montarMensagemSemPermissao } = require('./permissoesFinanceiro');
const {
  PERMISSAO_ESTOQUE: PE,
  PERMISSAO_FILIAIS: PFL,
  PERMISSAO_CADASTROS: PC,
  PERMISSAO_OS: POS,
} = require('../domain/permissoesNovasDomain');

const podeNoEstoque = podePelasEfetivas;

/** O que cada permissao deixa fazer, na frase "Voce nao tem permissao para ...", e o que fazer sem ela. */
const ACOES = {
  [PE.produtoInativar]: { acao: 'inativar ou reativar produtos (inativar zera o saldo)' },
  [PE.produtoExcluir]: { acao: 'excluir produtos', dica: 'Sem ela, inative o produto.' },
  [PE.balancoFechar]: { acao: 'fechar balanço (aplica as diferenças no estoque)' },
  [PE.balancoCancelar]: { acao: 'cancelar balanço' },
  [PFL.transferirSemNota]: { acao: 'transferir estoque sem nota fiscal', dica: 'Sem ela, use a transferência com nota.' },
  [PFL.transferenciaReceber]: { acao: 'receber transferência entre filiais' },
  [PFL.transferenciaCancelar]: { acao: 'recusar ou cancelar transferência entre filiais' },
  [PC.clientesInativar]: { acao: 'inativar, reativar ou excluir clientes' },
  [PC.fornecedoresInativar]: { acao: 'inativar, reativar ou excluir fornecedores' },
  [PC.servicosInativar]: { acao: 'inativar ou reativar serviços' },
  [PC.categoriasInativar]: { acao: 'inativar ou reativar categorias' },
  [PC.marcasInativar]: { acao: 'inativar ou reativar marcas' },
  [PC.unidadesMedidaInativar]: { acao: 'inativar ou reativar unidades de medida' },
  [PC.gradesInativar]: { acao: 'inativar ou reativar grades' },
  [PC.veiculosInativar]: { acao: 'inativar ou reativar veículos' },
  [PC.materiaPrimaInativar]: { acao: 'inativar, reativar ou excluir matérias-primas (inativar zera o saldo)' },
  [POS.finalizar]: { acao: 'finalizar OS' },
  [POS.reabrir]: { acao: 'reabrir OS finalizada' },
  [POS.cancelar]: { acao: 'cancelar OS' },
  'fiscal.emitir': { acao: 'emitir nota fiscal' },
};

const mensagemSemPermissao = montarMensagemSemPermissao(ACOES);

/** Das permissoes pedidas, as que o usuario nao tem (efetivas). [] = pode. */
const permissoesQueFaltam = (user, ids) => [...new Set(ids)].filter((id) => !podeNoEstoque(user, id));

/** Confere e joga o erro do servico (`Erro(status, mensagem)`) com 403 e a frase em portugues. */
const exigir = (user, ids, Erro, antes = '') => {
  const faltam = permissoesQueFaltam(user, ids);
  if (faltam.length) throw new Erro(403, `${antes}${mensagemSemPermissao(faltam)}`);
};

/**
 * Inativar/reativar e excluir cadastro (cadastroIntegridade.js): a permissao
 * de cada colecao. Bancos e bandeiras de cartao seguem com a da tela (fora do
 * levantamento). `null` = colecao sem permissao propria (usa a da tela).
 */
const PERMISSAO_DE_SITUACAO = {
  estoque: PE.produtoInativar,
  clientes: PC.clientesInativar,
  fornecedores: PC.fornecedoresInativar,
  materias_primas: PC.materiaPrimaInativar,
  categorias: PC.categoriasInativar,
  marcas: PC.marcasInativar,
  servicos: PC.servicosInativar,
  veiculos: PC.veiculosInativar,
  unidades_medida: PC.unidadesMedidaInativar,
  grades: PC.gradesInativar,
};
const PERMISSAO_DE_EXCLUIR = {
  estoque: PE.produtoExcluir,
  clientes: PC.clientesInativar,
  fornecedores: PC.fornecedoresInativar,
  materias_primas: PC.materiaPrimaInativar,
};

const permissaoDaSituacao = (colecao) => PERMISSAO_DE_SITUACAO[colecao] || null;
const permissaoDeExcluir = (colecao) => PERMISSAO_DE_EXCLUIR[colecao] || null;

module.exports = {
  ACOES,
  podeNoEstoque,
  permissoesQueFaltam,
  mensagemSemPermissao,
  exigir,
  permissaoDaSituacao,
  permissaoDeExcluir,
};
