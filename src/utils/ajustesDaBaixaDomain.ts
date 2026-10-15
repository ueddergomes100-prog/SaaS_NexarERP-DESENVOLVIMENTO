/**
 * JUROS, MULTA E DESCONTO NA BAIXA (Contas a Receber e a Pagar, individual e
 * em lote) -- pedido do cliente de 15/10/2026. Regra pura: a tela e o servidor
 * (server/domain, gerado) usam a mesma.
 *
 * Decisoes do dono (15/10/2026):
 *  - tres campos separados, sempre visiveis: Juros, Multa e Desconto. Titulo
 *    vencido com as % da filial (Configuracoes da filial > Parametros de
 *    venda) ja' vem com juros e multa calculados (da' para mudar);
 *  - o titulo fica quitado pelo VALOR CHEIO (a venda/nota nao muda). Juros e
 *    multa viram um lancamento proprio "Juros e multa"; o desconto, outro
 *    ("Desconto concedido" no Receber, "Desconto obtido" no Pagar). O banco
 *    recebe/paga o liquido. O estorno da baixa desfaz os tres juntos;
 *  - desconto so' com a permissao propria PERMISSAO_DESCONTO_NA_BAIXA (dono e
 *    administrador ja' tem).
 */

export const PERMISSAO_DESCONTO_NA_BAIXA = 'financeiro.desconto_baixa';
export const ROTULO_PERMISSAO_DESCONTO_NA_BAIXA = 'Financeiro: dar desconto na baixa (Contas a Receber e a Pagar)';

export interface AjustesDaBaixa {
  jurosCentavos: number;
  multaCentavos: number;
  descontoCentavos: number;
}

export const SEM_AJUSTES: AjustesDaBaixa = { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 };

export type TipoDaBaixa = 'entrada' | 'saida';

/** Categorias dos lancamentos que a baixa cria (Fluxo de Caixa / DRE). */
export const CATEGORIA_DO_ACRESCIMO: Record<TipoDaBaixa, string> = {
  entrada: 'Juros e multa recebidos',
  saida: 'Juros e multa pagos',
};
export const CATEGORIA_DO_DESCONTO: Record<TipoDaBaixa, string> = {
  entrada: 'Descontos concedidos',
  saida: 'Descontos obtidos',
};

/** "12,50" / "1.234,56" / "12.5" -> centavos. Vazio = 0. Texto que nao e' valor = null. */
export const centavosDoCampo = (texto: unknown): number | null => {
  const limpo = String(texto ?? '').trim().replace(/^R\$\s*/i, '');
  if (!limpo) return 0;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^\d+(\.\d{0,2})?$/.test(normalizado)) return null;
  return Math.round(Number(normalizado) * 100);
};

/** 1250 -> "12,50"; zero vira vazio (campo em branco). */
export const textoDoCampo = (centavos: number): string => (centavos > 0 ? (centavos / 100).toFixed(2).replace('.', ',') : '');

const inteiro = (valor: unknown): number => Math.max(0, Math.round(Number(valor) || 0));

export const acrescimoDosAjustes = (a: AjustesDaBaixa): number => inteiro(a.jurosCentavos) + inteiro(a.multaCentavos);

/** O que sai/entra de fato no banco ou no caixa: valor + juros + multa - desconto. */
export const valorPagoDaBaixa = (valorCentavos: number, a: AjustesDaBaixa): number => (
  inteiro(valorCentavos) + acrescimoDosAjustes(a) - inteiro(a.descontoCentavos)
);

/**
 * O que impede a baixa com esses ajustes, ou null. Frases para o usuario
 * final: dizem o que houve e o que fazer.
 */
export const erroDosAjustes = (
  valorCentavos: number,
  a: AjustesDaBaixa,
  opcoes: { podeDescontar: boolean },
): string | null => {
  const campos: Array<[string, unknown]> = [['Juros', a.jurosCentavos], ['Multa', a.multaCentavos], ['Desconto', a.descontoCentavos]];
  const invalido = campos.find(([, v]) => !Number.isInteger(v) || (v as number) < 0);
  if (invalido) return `${invalido[0]}: informe um valor em reais maior ou igual a zero (ex.: 12,50).`;
  const valor = inteiro(valorCentavos);
  if (a.descontoCentavos > 0 && !opcoes.podeDescontar) {
    return `Para dar desconto na baixa, é preciso a permissão "${ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}". Peça ao administrador, ou deixe o desconto em branco.`;
  }
  if (a.descontoCentavos > 0 && a.descontoCentavos >= valor) {
    return 'O desconto não pode ser igual ou maior que o valor da conta. Para não cobrar a conta inteira, cancele a conta em vez de dar baixa.';
  }
  // Juros e multa acima de 2x o titulo (+ R$ 1.000) e' erro de digitacao.
  if (acrescimoDosAjustes(a) > valor * 2 + 100000) {
    return 'Os juros e a multa estão muito acima do valor da conta. Confira o que foi digitado (em reais, com vírgula).';
  }
  return null;
};

const reais = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

/** "juros R$ 2,00 + multa R$ 5,00 - desconto R$ 1,00" (vazio = sem ajuste). Para log e descricao. */
export const descricaoDosAjustes = (a: AjustesDaBaixa): string => [
  a.jurosCentavos > 0 ? `juros ${reais(a.jurosCentavos)}` : '',
  a.multaCentavos > 0 ? `multa ${reais(a.multaCentavos)}` : '',
].filter(Boolean).join(' + ') + (a.descontoCentavos > 0 ? `${a.jurosCentavos + a.multaCentavos > 0 ? ' − ' : ''}desconto ${reais(a.descontoCentavos)}` : '');

/**
 * Pedido que chega no servidor: os tres campos (centavos inteiros >= 0). O
 * campo antigo `acrescimoCentavos` (tela de antes de 15/10/2026, so' Receber)
 * ainda e' aceito e vale como juros. Devolve `{ erro }` ou `{ ajustes }`.
 */
export const ajustesDoPedido = (corpo: Record<string, unknown> | null | undefined): { erro?: string; ajustes: AjustesDaBaixa } => {
  const ler = (campo: string): number | null => {
    const v = corpo?.[campo];
    if (v === undefined || v === null || v === 0) return 0;
    return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
  };
  const juros = ler('jurosCentavos');
  const multa = ler('multaCentavos');
  const desconto = ler('descontoCentavos');
  const legado = ler('acrescimoCentavos');
  if (juros === null || multa === null || desconto === null || legado === null) {
    return { erro: 'Juros, multa e desconto: informe valores em reais maiores ou iguais a zero.', ajustes: SEM_AJUSTES };
  }
  return { ajustes: { jurosCentavos: juros + (juros === 0 && multa === 0 ? legado : 0), multaCentavos: multa, descontoCentavos: desconto } };
};

/** So' os campos com valor, para mandar ao servidor sem chave `undefined`/zero. */
export const camposDosAjustes = (a: AjustesDaBaixa): Partial<AjustesDaBaixa> => ({
  ...(a.jurosCentavos > 0 ? { jurosCentavos: a.jurosCentavos } : {}),
  ...(a.multaCentavos > 0 ? { multaCentavos: a.multaCentavos } : {}),
  ...(a.descontoCentavos > 0 ? { descontoCentavos: a.descontoCentavos } : {}),
});

export const temAjuste = (a: AjustesDaBaixa): boolean => a.jurosCentavos > 0 || a.multaCentavos > 0 || a.descontoCentavos > 0;
