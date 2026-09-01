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
 * LIGADO por padrao: e o comportamento de hoje, e mudar a tela de quem ja usa
 * sem pedir seria pior que deixar um cartao a mais na frente de quem nao usa.
 *
 * Nao muda dado nenhum -- "Estoque Baixo" continua sendo contado do mesmo
 * jeito, so nao aparece. Quem desligar e quiser o numero de volta e um clique
 * em Configuracoes.
 */
export const DEFAULT_MOSTRAR_RESUMO_ESTOQUE = true;

/**
 * So `false` explicito esconde. Empresa que nunca abriu a configuracao nao
 * tem o campo gravado, e `undefined` tem que cair no padrao -- sumir com os
 * cartoes de quem nunca pediu isso seria mudanca a revelia.
 */
export const parseMostrarResumoEstoque = (valor: unknown): boolean => (
  valor === false ? false : DEFAULT_MOSTRAR_RESUMO_ESTOQUE
);
