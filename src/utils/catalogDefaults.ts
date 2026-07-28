export interface DedupableItem {
  [key: string]: unknown;
}

/**
 * Filtra uma lista de itens padrao (seed) para conter somente os que ainda
 * nao existem na coleção do tenant, comparando por uma chave (ex: sigla,
 * nome), sem diferenciar maiusculas/minusculas nem espacos nas pontas.
 * Usado para "Carregar Padroes" em catalogos (unidades de medida,
 * bandeiras de cartao, etc.) sem duplicar registros.
 */
export function pickMissingDefaults<T extends DedupableItem>(
  defaults: T[],
  existing: DedupableItem[],
  dedupeKey: keyof T & string,
): T[] {
  const existingKeys = new Set(
    existing.map((item) => normalizeDedupeValue(item[dedupeKey])),
  );

  return defaults.filter((item) => !existingKeys.has(normalizeDedupeValue(item[dedupeKey])));
}

const normalizeDedupeValue = (value: unknown): string => (
  String(value ?? '').trim().toUpperCase()
);
