/**
 * ESTORNO DA DEVOLUCAO POR QUANTIDADE (21/11/2026, pedido do dono).
 *
 * Caso real (Jomarly, pedido #0012): o cliente devolveu 4 clipes, mas o certo
 * eram 3. Antes o estorno desfazia a devolucao inteira (e depois tinha de
 * lancar outra de 3). Agora, ao clicar em Estornar, escolhe-se quanto de cada
 * item volta a sair -- aqui, 1 clipe: o estoque tira 1, o credito do cliente
 * cai R$ 27 e a devolucao passa a ser de 3 clipes.
 *
 * Valor de cada item estornado: proporcional ao que aquele item valeu na
 * devolucao (subtotal, ja' com o desconto proporcional). Estornar a
 * quantidade inteira do item usa o subtotal inteiro (sem sobra de centavo).
 *
 * Produto com lote: a devolucao guarda os lotes sem dizer de qual item e'
 * cada um, entao devolucao com lote so' estorna inteira (quem chama confere
 * `lotesDevolvidos`).
 */

export interface ItemDaDevolucao {
  id: string;
  nome: string;
  quantidadeDevolvida: number;
  subtotal: number;
  descontoProporcional?: number;
  fatorConversao?: number;
  [campo: string]: unknown;
}

export interface ItemEstornado {
  id: string;
  nome: string;
  quantidade: number;
  fatorConversao?: number;
  valorCentavos: number;
}

export interface PlanoDoEstorno {
  estornados: ItemEstornado[];
  /** Como a devolucao fica (so' os itens que ainda tem quantidade). */
  restantes: ItemDaDevolucao[];
  valorCentavos: number;
  /** Estornou tudo: a devolucao fica "estornada". */
  total: boolean;
}

const tresCasas = (n: number): number => Math.round(n * 1000) / 1000;
const centavos = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const planoDoEstornoDaDevolucao = (
  itens: ItemDaDevolucao[],
  quantidades: unknown[],
): PlanoDoEstorno | { erro: string } => {
  const estornados: ItemEstornado[] = [];
  const restantes: ItemDaDevolucao[] = [];
  let valorCentavos = 0;

  for (let i = 0; i < itens.length; i += 1) {
    const item = itens[i];
    const devolvida = Number(item.quantidadeDevolvida) || 0;
    const texto = String(quantidades[i] ?? '').trim().replace(',', '.');
    const pedida = texto === '' ? 0 : Number(texto);
    if (!Number.isFinite(pedida) || pedida < 0) {
      return { erro: `Quantidade inválida em ${item.nome}. Informe um número de 0 até ${devolvida.toLocaleString('pt-BR')}.` };
    }
    const q = tresCasas(pedida);
    if (q > devolvida + 1e-9) {
      return { erro: `${item.nome}: dá para estornar no máximo ${devolvida.toLocaleString('pt-BR')} (o que foi devolvido).` };
    }
    const subtotalCentavos = centavos(item.subtotal);
    if (q <= 0) {
      restantes.push(item);
      continue;
    }
    const inteiro = Math.abs(q - devolvida) < 1e-9;
    const valorItem = inteiro ? subtotalCentavos : Math.round((subtotalCentavos * q) / devolvida);
    valorCentavos += valorItem;
    estornados.push({
      id: item.id,
      nome: item.nome,
      quantidade: q,
      ...(item.fatorConversao ? { fatorConversao: item.fatorConversao } : {}),
      valorCentavos: valorItem,
    });
    if (!inteiro) {
      const fica = tresCasas(devolvida - q);
      const desconto = Number(item.descontoProporcional);
      restantes.push({
        ...item,
        quantidadeDevolvida: fica,
        subtotal: (subtotalCentavos - valorItem) / 100,
        ...(Number.isFinite(desconto) ? { descontoProporcional: (desconto * fica) / devolvida } : {}),
      });
    }
  }

  if (estornados.length === 0) return { erro: 'Informe quanto estornar de pelo menos um item.' };
  return { estornados, restantes, valorCentavos, total: restantes.length === 0 };
};

/**
 * Como fica o credito da devolucao depois de estornar `valorEstornoCentavos`,
 * dos quais `doProprioCentavos` sairam do saldo dele (o resto saiu do credito
 * que voltou ao cliente num cancelamento -- coberturaDoEstornoDoCredito).
 */
export const creditoDaDevolucaoAposEstorno = (args: {
  valorOriginalCentavos: number;
  saldoCentavos: number;
  valorEstornoCentavos: number;
  doProprioCentavos: number;
}): { valorOriginalCentavos: number; saldoCentavos: number; status: 'cancelado' | 'esgotado' | 'disponivel' | 'usado_parcial' } => {
  const valorOriginalCentavos = Math.max(0, args.valorOriginalCentavos - args.valorEstornoCentavos);
  const saldoCentavos = Math.max(0, args.saldoCentavos - args.doProprioCentavos);
  if (valorOriginalCentavos <= 0) return { valorOriginalCentavos: 0, saldoCentavos: 0, status: 'cancelado' };
  if (saldoCentavos <= 0) return { valorOriginalCentavos, saldoCentavos: 0, status: 'esgotado' };
  return { valorOriginalCentavos, saldoCentavos, status: saldoCentavos >= valorOriginalCentavos ? 'disponivel' : 'usado_parcial' };
};
