/**
 * "Valor" na lista de Ordens de Serviço (Configurações → Ordem de Serviço).
 *
 * O que motivou: a lista mostrava numero, cliente, veiculo, placa e status --
 * pra saber quanto vale cada OS so abrindo uma por uma. Numa oficina com 40 OS
 * em aberto, descobrir quanto tem em aberto era um trabalho manual.
 *
 * Por que e' configuravel: nem toda empresa quer valor a mostra numa tela que
 * fica aberta no balcao, com cliente do outro lado. Nao ha dado novo exposto
 * (quem abre a OS ja ve o total), mas ha diferenca entre "consigo consultar" e
 * "esta na tela o tempo todo" -- e essa escolha e' da empresa.
 *
 * LIGADO por padrao: a dor de abrir uma por uma existe pra todo mundo hoje, e
 * quem nao quiser desliga num clique.
 */
export const DEFAULT_MOSTRAR_VALOR_LISTA_OS = true;

/**
 * So `false` explicito desliga. Empresa que nunca abriu a configuracao nao tem
 * o campo gravado, e `undefined` tem que cair no padrao -- nao em "desligado".
 */
export const parseMostrarValorListaOS = (valor: unknown): boolean => (
  valor === false ? false : DEFAULT_MOSTRAR_VALOR_LISTA_OS
);

/**
 * Valor da OS pra lista, em reais.
 *
 * Le `valorTotalCentavos` primeiro: e' o campo em centavos, sem erro de ponto
 * flutuante. `valorTotal` e' o mesmo numero em reais, mantido pra OS gravada
 * antes dos centavos existirem. Os dois ja vem com o desconto abatido -- e'
 * o total que o cliente paga.
 */
export const resolverValorListaOS = (os: unknown): number => {
  const dados = (os || {}) as { valorTotalCentavos?: unknown; valorTotal?: unknown };

  const centavos = Number(dados.valorTotalCentavos);
  if (Number.isFinite(centavos) && centavos > 0) return centavos / 100;

  const reais = Number(dados.valorTotal);
  if (Number.isFinite(reais) && reais > 0) return reais;

  return 0;
};

/**
 * Texto do valor. OS sem nada lancado ainda (orcamento recem-aberto) mostra
 * um traco, nao "R$ 0,00" -- zero afirma que a OS nao vale nada, o traco diz
 * que ainda nao ha o que somar.
 */
export const formatarValorListaOS = (os: unknown): string => {
  const valor = resolverValorListaOS(os);
  if (valor <= 0) return '—';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
