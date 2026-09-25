/**
 * O erro do Firestore e' de PERMISSAO (regra negou a leitura/escrita)? Nesse
 * caso, para quem nao tem o papel, e' o comportamento esperado -- nao deve
 * virar pop-up de erro. Erro de rede/indisponivel continua sendo erro.
 */
export const erroDeAcessoNegado = (erro: unknown): boolean => {
  const codigo = String((erro as { code?: unknown } | null)?.code ?? '');
  return codigo === 'permission-denied' || codigo === 'firestore/permission-denied';
};
