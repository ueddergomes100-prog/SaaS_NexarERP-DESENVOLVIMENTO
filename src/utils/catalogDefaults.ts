/**
 * Filtra uma lista de itens padrao (seed) para conter somente os que ainda
 * nao existem na coleção do tenant, comparando por uma chave (ex: sigla,
 * nome), sem diferenciar maiusculas/minusculas nem espacos nas pontas.
 * Usado para "Carregar Padroes" em catalogos (unidades de medida,
 * bandeiras de cartao, etc.) sem duplicar registros.
 *
 * "existing" so precisa ter a propriedade da chave de dedupe -- aceita
 * tanto objetos literais quanto interfaces concretas (ex: o tipo salvo
 * no Firestore), sem exigir assinatura de indice.
 */
export function pickMissingDefaults<T extends object, K extends keyof T & string>(
  defaults: T[],
  existing: Array<Record<K, unknown>>,
  dedupeKey: K,
): T[] {
  const existingKeys = new Set(
    existing.map((item) => normalizeDedupeValue(item[dedupeKey])),
  );

  return defaults.filter((item) => !existingKeys.has(normalizeDedupeValue(item[dedupeKey])));
}

const normalizeDedupeValue = (value: unknown): string => (
  String(value ?? '').trim().toUpperCase()
);
