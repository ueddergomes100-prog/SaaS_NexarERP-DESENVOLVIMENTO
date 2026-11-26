/**
 * TROCA DO ADMINISTRADOR (item 15 da Embala Minas, 25/11/2026).
 *
 * Decisao do dono: "o dono sempre pode; o resto so' com a permissao marcada".
 * O ADMINISTRADOR (papel Master/Admin que NAO e' o dono -- o dono e' quem tem
 * o uid da empresa) deixou de ser liberado pelo papel: vira, na pratica, um
 * funcionario com TODAS as permissoes ja' marcadas, e o dono desmarca o que
 * quiser.
 *
 * Sem janela de quebra: enquanto o cadastro do administrador NAO tem o
 * marcador `pacote.administrador-1` (dentro de `permissoes`, como os outros
 * pacotes -- permissoesNovasDomain.ts), ele tem todas as permissoes do
 * catalogo, menos as que restringem. Quando o dono salva as permissoes dele, o
 * marcador e' gravado e dai' em diante vale so' o que esta' marcado.
 *
 * Modulo sem dependencias de proposito: roles.ts, filialDomain.ts e
 * permissoesNovasDomain.ts usam isto sem import circular.
 */

/** Papeis de administrador da empresa (o dono tambem tem um deles; quem decide o dono e' o uid). */
export const PAPEIS_DE_ADMINISTRADOR: readonly string[] = ['Master', 'Admin'];

export const ehPapelDeAdministrador = (papel: unknown): boolean => (
  typeof papel === 'string' && PAPEIS_DE_ADMINISTRADOR.includes(papel)
);

/** Id do pacote do administrador: nunca muda (fica gravado no cadastro). */
export const PACOTE_ADMINISTRADOR = 'administrador-1';

/** Marcador gravado so' no cadastro de administrador, quando o dono salva as permissoes dele. */
export const MARCADOR_ADMINISTRADOR = 'pacote.administrador-1';

/**
 * Permissoes que TIRAM acesso em vez de dar ("Vendas: So' a Frente de Caixa"
 * manda o login direto para o caixa, sem o sistema). Nunca entram no "todas"
 * do administrador; o dono marca se quiser.
 */
export const PERMISSOES_QUE_RESTRINGEM: readonly string[] = ['vendas.so_caixa'];

/** Administrador cujo pacote o dono ainda nao salvou (= tem todas as permissoes do catalogo). */
export const administradorComTodas = (permissoes: unknown, papel: unknown): boolean => (
  ehPapelDeAdministrador(papel)
  && !(Array.isArray(permissoes) && permissoes.includes(MARCADOR_ADMINISTRADOR))
);

/**
 * O administrador tem esta permissao por ainda nao ter o pacote salvo? Para
 * quem olha o cadastro CRU (lido do banco), sem as efetivas.
 */
export const administradorTemSemPacote = (permissoes: unknown, papel: unknown, permissao: string): boolean => (
  administradorComTodas(permissoes, papel) && !PERMISSOES_QUE_RESTRINGEM.includes(permissao)
);
