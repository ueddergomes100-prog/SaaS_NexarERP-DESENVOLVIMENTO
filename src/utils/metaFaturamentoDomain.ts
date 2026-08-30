// Meta de faturamento mensal (Configuracoes -> Financeiro).
//
// Antes o Dashboard mostrava um anel rotulado "Meta mensal" que na verdade
// era receita / (receita + orcamentos em aberto) -- nao existia meta
// cadastrada em lugar nenhum, e o numero dava 100% pra qualquer
// faturamento sem orcamento pendente. Agora a meta e' um valor de verdade,
// informado pela empresa; quando ela nao informa, o Dashboard volta a
// mostrar o indicador honesto de pipeline em vez de inventar uma meta.

/** Meta nao informada / invalida = 0 (sem meta). Nunca inventa um valor. */
export const parseMetaFaturamentoMensal = (raw: unknown): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

export const temMetaFaturamento = (meta: unknown): boolean => (
  parseMetaFaturamentoMensal(meta) > 0
);

/**
 * Percentual da meta ja atingido no mes. Passa de 100 quando a empresa
 * bate a meta -- quem consome decide se limita a barra em 100%, mas o
 * numero exibido tem que poder dizer "118%", senao superar a meta fica
 * indistinguivel de bater exatamente.
 *
 * Sem meta cadastrada devolve null: e' "nao ha o que medir", diferente de
 * 0% ("meta existe e nada foi faturado").
 */
export const calcularProgressoMeta = (
  faturamentoMes: number,
  metaMensal: unknown,
): number | null => {
  const meta = parseMetaFaturamentoMensal(metaMensal);
  if (meta <= 0) return null;
  const faturado = Number(faturamentoMes);
  if (!Number.isFinite(faturado) || faturado <= 0) return 0;
  return Math.round((faturado / meta) * 100);
};

/** Quanto ainda falta pra bater a meta (0 quando ja bateu ou nao ha meta). */
export const faltaParaMeta = (faturamentoMes: number, metaMensal: unknown): number => {
  const meta = parseMetaFaturamentoMensal(metaMensal);
  if (meta <= 0) return 0;
  const faturado = Number.isFinite(Number(faturamentoMes)) ? Number(faturamentoMes) : 0;
  return Math.max(0, meta - faturado);
};
