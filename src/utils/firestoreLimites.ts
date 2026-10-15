/**
 * LIMITES DE CONSULTA DO FIRESTORE que as regras de seguranca impoem.
 *
 * Consulta "documento EM [lista de ids]" (`where(documentId(), 'in', ids)`):
 * o Firestore avalia as regras para CADA id, e todas as avaliacoes somam no
 * limite de 1.000 expressoes por requisicao. Passando dele, a consulta volta
 * "Missing or insufficient permissions" -- parece falta de permissao, mas e'
 * tamanho. Medido no banco de teste em 15/10/2026 (usuario Funcionario):
 * 15 ids passa, 20 ids e' recusado. Foi o erro do Romaneio ao buscar um
 * periodo maior ("Voce nao tem permissao...").
 *
 * Consulta "campo EM [lista]" (sem ser o id, ex.: dataVenda) nao tem esse
 * problema: passou com 30 valores (o maximo do Firestore).
 */
export const LOTE_IN_POR_ID = 10;
export const LOTE_IN_POR_CAMPO = 30;

/** Divide a lista em lotes do tamanho dado (ultimo lote pode ser menor). */
export const emLotes = <T>(lista: T[], tamanho: number): T[][] => {
  const passo = Math.max(1, Math.floor(tamanho));
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += passo) lotes.push(lista.slice(i, i + passo));
  return lotes;
};
