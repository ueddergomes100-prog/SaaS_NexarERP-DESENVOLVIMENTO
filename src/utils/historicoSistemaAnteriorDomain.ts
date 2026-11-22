/**
 * HISTORICO DE COMPRAS DO SISTEMA ANTERIOR (22/11/2026, migracao Embala Minas).
 *
 * Decisao do dono: os ultimos pedidos de cada cliente no sistema antigo vem
 * para o Hennder SO' PARA CONSULTA -- aparecem na ficha do cliente e no app
 * Vendas. Nao sao Pedidos de Venda: nao mexem em estoque, caixa, financeiro,
 * comissao nem relatorio de vendas. Ficam numa colecao propria,
 * `historico_sistema_anterior`, um documento por pedido antigo.
 *
 * A planilha tem UMA LINHA POR ITEM; as linhas do mesmo pedido (mesmo cliente
 * + mesmo numero) viram um documento. O cliente e' achado pelo CPF/CNPJ ou,
 * sem ele, pelo nome unico (resolverVinculoParte, o mesmo das contas).
 *
 * O id do documento e' fixo por tenant + cliente + pedido: importar a mesma
 * planilha de novo pula o que ja' entrou, em vez de duplicar.
 *
 * Regra pura: sem tela, sem Firestore.
 */
import { parseNumeroOuMonetario } from './importacaoEstoqueDomain';
import { interpretarDataConta, normalizarDocumentoParte } from './importacaoContasDomain';

export const COLECAO_HISTORICO_ANTERIOR = 'historico_sistema_anterior';

export type CampoColunaHistorico =
  | 'documento' | 'cliente' | 'pedido' | 'data' | 'totalPedido'
  | 'codigoProduto' | 'produto' | 'quantidade' | 'unidade' | 'valorUnitario' | 'valorTotal';

export type MapeamentoColunasHistorico = Record<CampoColunaHistorico, number | null>;

const SINONIMOS: Record<CampoColunaHistorico, string[]> = {
  documento: ['cpf', 'cnpj'],
  cliente: ['cliente', 'razao social', 'nome'],
  pedido: ['pedido', 'documento', 'numero', 'venda'],
  data: ['data', 'emissao'],
  totalPedido: ['total do pedido', 'total pedido', 'valor do pedido', 'total da venda'],
  codigoProduto: ['codigo do produto', 'cod. produto', 'cod produto', 'codigo produto', 'referencia'],
  produto: ['produto', 'descricao', 'item'],
  quantidade: ['quantidade', 'qtd', 'qtde'],
  unidade: ['unidade', 'und', 'un.'],
  valorUnitario: ['valor unitario', 'vr unitario', 'preco unitario', 'unitario', 'preco'],
  valorTotal: ['valor total', 'total do item', 'vr total', 'subtotal', 'total'],
};

/** Ordem de resolucao: o mais especifico primeiro, e cada coluna so' serve a um campo. */
const ORDEM: CampoColunaHistorico[] = [
  'documento', 'totalPedido', 'codigoProduto', 'valorUnitario', 'valorTotal', 'quantidade', 'unidade', 'data', 'pedido', 'produto', 'cliente',
];

const normalizar = (v: string): string => String(v || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export const inferirMapeamentoHistorico = (cabecalho: string[]): MapeamentoColunasHistorico => {
  const cols = cabecalho.map(normalizar);
  const usadas = new Set<number>();
  const mapa = {} as MapeamentoColunasHistorico;
  for (const campo of ORDEM) {
    let achou = -1;
    for (const sin of SINONIMOS[campo]) {
      achou = cols.findIndex((c, i) => !usadas.has(i) && (c === sin || c.includes(sin)));
      if (achou >= 0) break;
    }
    mapa[campo] = achou >= 0 ? achou : null;
    if (achou >= 0) usadas.add(achou);
  }
  return mapa;
};

export const CAMPOS_OBRIGATORIOS_HISTORICO: CampoColunaHistorico[] = ['pedido', 'data', 'produto', 'quantidade'];

export interface ItemHistoricoAnterior {
  codigo: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
}

export interface PedidoHistoricoLido {
  /** Chave do grupo na planilha: cliente (documento ou nome) + pedido. */
  chave: string;
  documentoCliente: string;
  nomeCliente: string;
  pedido: string;
  /** aaaa-mm-dd */
  data: string;
  total: number;
  itens: ItemHistoricoAnterior[];
  /** Motivo em portugues quando o pedido nao pode entrar ('' = ok). */
  problema: string;
}

const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;
const numero = (v: string | undefined): number => {
  const n = parseNumeroOuMonetario(v ?? '');
  return n === null || !Number.isFinite(n) ? 0 : n;
};

/** Agrupa as linhas de item em pedidos. Linha sem pedido/produto e' ignorada. */
export const lerPedidosHistorico = (linhas: string[][], mapa: MapeamentoColunasHistorico): PedidoHistoricoLido[] => {
  const cel = (linha: string[], campo: CampoColunaHistorico): string => {
    const i = mapa[campo];
    return i === null ? '' : String(linha[i] ?? '').trim();
  };
  const grupos = new Map<string, PedidoHistoricoLido>();
  for (const linha of linhas) {
    const pedido = cel(linha, 'pedido');
    const descricao = cel(linha, 'produto').toUpperCase();
    if (!pedido || !descricao) continue;
    const documentoCliente = normalizarDocumentoParte(cel(linha, 'documento'));
    const nomeCliente = cel(linha, 'cliente').toUpperCase();
    const chave = `${documentoCliente ? `doc:${documentoCliente}` : `nome:${normalizar(nomeCliente)}`}|${pedido}`;
    let g = grupos.get(chave);
    if (!g) {
      const data = interpretarDataConta(cel(linha, 'data'));
      g = {
        chave, documentoCliente, nomeCliente, pedido,
        data: data.status === 'OK' ? data.data : '',
        total: 0, itens: [],
        problema: data.status === 'OK' ? '' : `Pedido ${pedido}: data "${cel(linha, 'data')}" não reconhecida (use dd/mm/aaaa).`,
      };
      if (!documentoCliente && !nomeCliente) g.problema = `Pedido ${pedido}: sem cliente (nem CPF/CNPJ nem nome).`;
      grupos.set(chave, g);
    }
    const quantidade = numero(cel(linha, 'quantidade'));
    const valorUnitario = numero(cel(linha, 'valorUnitario'));
    // Coluna ausente ou celula vazia: quantidade x unitario.
    const totalLinha = cel(linha, 'valorTotal') ? numero(cel(linha, 'valorTotal')) : arred(quantidade * valorUnitario);
    g.itens.push({
      codigo: cel(linha, 'codigoProduto'),
      descricao,
      quantidade: arred(quantidade, 3),
      unidade: cel(linha, 'unidade').toUpperCase(),
      valorUnitario: arred(valorUnitario, 4),
      valorTotal: arred(totalLinha),
    });
    const totalPedido = mapa.totalPedido !== null ? numero(cel(linha, 'totalPedido')) : 0;
    if (totalPedido > 0) g.total = arred(totalPedido);
  }
  for (const g of grupos.values()) {
    if (!(g.total > 0)) g.total = arred(g.itens.reduce((t, i) => t + i.valorTotal, 0));
  }
  return [...grupos.values()];
};

/** Semente do id fixo (o componente tira o hash). O tenant entra porque o id e' global na colecao. */
export const sementeIdHistorico = (tenantId: string, clienteId: string, pedido: string): string => (
  `historico-anterior|${tenantId}|${clienteId}|${pedido.trim()}`
);

export interface PedidoHistoricoAnterior {
  tenantId: string;
  clienteId: string;
  clienteNome: string;
  pedido: string;
  data: string;
  total: number;
  itens: ItemHistoricoAnterior[];
  origemImportacao: 'migracao_historico';
}

/** Documento final -- sem chave undefined (o Firestore recusa). */
export const montarPedidoHistorico = (
  lido: PedidoHistoricoLido,
  cliente: { id: string; nome: string },
  tenantId: string,
  extras: Record<string, unknown>,
): PedidoHistoricoAnterior & Record<string, unknown> => ({
  tenantId,
  clienteId: cliente.id,
  clienteNome: cliente.nome,
  pedido: lido.pedido,
  data: lido.data,
  total: lido.total,
  itens: lido.itens.map((i) => ({ ...i })),
  origemImportacao: 'migracao_historico',
  ...extras,
});

/** Os ultimos N pedidos (mais recente primeiro), para a ficha e o app. */
export const ultimosPedidosAnteriores = <T extends { data?: unknown; pedido?: unknown }>(lista: T[], n = 5): T[] => (
  [...lista]
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || String(b.pedido || '').localeCompare(String(a.pedido || '')))
    .slice(0, n)
);
