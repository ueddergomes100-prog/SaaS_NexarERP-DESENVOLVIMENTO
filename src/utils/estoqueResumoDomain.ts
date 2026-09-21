/**
 * OS TRES CARTOES DO TOPO DA TELA DE ESTOQUE.
 *
 * "Itens Cadastrados", "Estoque Baixo" e "Itens Esgotados" ocupam a primeira
 * dobra inteira da tela de Estoque. Pra quem usa aquela tela pra CONSULTAR
 * produto -- que e a maioria das vezes -- eles empurram a busca e a lista pra
 * baixo sem serem lidos.
 *
 * Nem toda empresa pensa assim: quem acompanha reposicao olha "Estoque Baixo"
 * varias vezes por dia. Por isso e escolha da empresa, nao decisao nossa.
 *
 * DESLIGADO por padrao (decisao do usuario, 2026-09-19): quase nenhuma empresa
 * usa, e os cartoes empurram a lista pra baixo. Isso tambem vale pra quem ja
 * usava o sistema e nunca mexeu na opcao -- os cartoes somem pra essas
 * empresas. Quem quiser o numero de volta liga em Configuracoes.
 *
 * Nao muda dado nenhum -- "Estoque Baixo" continua sendo contado do mesmo
 * jeito, so nao aparece. Quem desligar e quiser o numero de volta e um clique
 * em Configuracoes.
 */
export const DEFAULT_MOSTRAR_RESUMO_ESTOQUE = false;

/**
 * So `true` explicito mostra. Empresa que nunca abriu a configuracao nao tem
 * o campo gravado, e `undefined` cai no padrao (escondido).
 */
export const parseMostrarResumoEstoque = (valor: unknown): boolean => (
  valor === true ? true : DEFAULT_MOSTRAR_RESUMO_ESTOQUE
);
