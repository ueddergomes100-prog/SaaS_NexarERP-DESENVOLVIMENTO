/**
 * ESCONDER OS VALORES DA TELA -- O "OLHINHO" (21/11/2026).
 *
 * Pedido do dono (print do Contas a Receber): poder esconder "Recebido Hoje",
 * "Total a Receber" e todo lugar que mostra resultado e valor -- cliente
 * olhando a tela do caixa, monitor virado para a loja.
 *
 * Decisoes do dono (caixa de perguntas, 21/11/2026):
 *  - UM olho vale para o sistema todo: fechou em qualquer tela, esconde em
 *    todas; a escolha fica guardada por usuario neste navegador.
 *  - Esconde so' os TOTAIS e RESULTADOS (cartoes de resumo, saldos, graficos
 *    do Dashboard, totais de relatorio na tela). As linhas das listas (cada
 *    titulo, cada pedido) continuam visiveis para trabalhar.
 *
 * O olho nao e' seguranca: quem tem a permissao continua podendo ver (basta
 * abrir o olho). Quem nao pode ver valores continua barrado pela permissao.
 */

export const MASCARA_MOEDA = 'R$ •••••';
export const MASCARA_NUMERO = '•••';

/** Chave do navegador onde fica a escolha, por usuario. */
export const chaveDosValoresOcultos = (usuarioId: string | null | undefined): string =>
  `hennder_valores_ocultos_${String(usuarioId || 'anonimo')}`;

/** Chave antiga, do olho que so' existia no Dashboard (vale ate' o usuario escolher de novo). */
export const CHAVE_ANTIGA_DASHBOARD = 'nexus_hide_dashboard';

/** Le a escolha salva: a do usuario; sem ela, a do olho antigo do Dashboard. */
export const lerValoresOcultos = (
  ler: (chave: string) => string | null,
  usuarioId: string | null | undefined,
): boolean => {
  const salvo = ler(chaveDosValoresOcultos(usuarioId));
  if (salvo === 'true' || salvo === 'false') return salvo === 'true';
  return ler(CHAVE_ANTIGA_DASHBOARD) === 'true';
};

/** O texto que vai na tela: o valor, ou a mascara quando o olho esta' fechado. */
export const valorNaTela = (ocultos: boolean, texto: string, mascara: string = MASCARA_MOEDA): string => (
  ocultos ? mascara : texto
);

export const tituloDoOlho = (ocultos: boolean): string => (
  ocultos ? 'Mostrar os valores (vale para todas as telas)' : 'Esconder os valores (vale para todas as telas)'
);
