/*
 * LISTA DE SEPARACAO (05/11/2026, pedido do dono no cliente).
 *
 * O funcionario separa TODOS os itens de uma vez, somados, sem importar de
 * qual pedido sao; depois divide os produtos por pedido para a rota. O relatorio
 * tem as duas partes: a soma dos itens e os itens de cada pedido, os dois com
 * uma coluna para marcar a caneta. O padrao sai so' com item e quantidade; o resto
 * (separado, codigo, pedidos, itens de cada pedido) liga nas caixinhas do relatorio. Sai pelo Romaneio (os pedidos da rota) e pela
 * Fila de Expedicao (os pedidos marcados ou os que faltam conferir).
 *
 * A quantidade fica na unidade em que foi vendida: 2 SC e' 2 sacos, nao 40 KG
 * (mesma regra da minuta). Por isso o mesmo produto vendido em saco e em KG sai
 * em duas linhas: o separador pega coisas diferentes na prateleira.
 *
 * Regra pura: sem tela, sem Firestore.
 */
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

export interface ItemParaSeparar {
  id?: unknown;
  nome?: unknown;
  codigo?: unknown;
  quantidade?: unknown;
  unidadeMedidaSigla?: unknown;
  embalagemId?: unknown;
}

export interface PedidoParaSeparar {
  id: string;
  /** "Pedido #0035", "Troca #12". */
  rotulo: string;
  clienteNome?: string;
  itens?: unknown;
}

export interface ItemSomado {
  chave: string;
  codigo: string;
  nome: string;
  unidade: string;
  quantidade: number;
  /** Em quantos pedidos o item aparece. */
  pedidos: number;
}

interface LinhaDoPedido {
  pedidoId: string;
  pedidoRotulo: string;
  codigo: string;
  nome: string;
  unidade: string;
  quantidade: number;
}

const texto = (valor: unknown): string => (valor === null || valor === undefined ? '' : String(valor).trim());

const quantidadeDe = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Soma sem o ruido de ponto flutuante (0,1 + 0,2 de KG). */
const somar = (a: number, b: number): number => Math.round((a + b) * 10000) / 10000;

const emOrdemDeNome = <T extends { nome: string; unidade: string }>(lista: T[]): T[] => (
  [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }) || a.unidade.localeCompare(b.unidade, 'pt-BR'))
);

/** Item sem quantidade nao tem o que separar. Produto sem unidade cadastrada sai como UN (CLAUDE.md, regra 4). */
const itensValidos = (pedido: PedidoParaSeparar): Array<{ chave: string; codigo: string; nome: string; unidade: string; quantidade: number }> => (
  (Array.isArray(pedido.itens) ? pedido.itens as ItemParaSeparar[] : []).flatMap((item) => {
    const quantidade = quantidadeDe(item?.quantidade);
    const nome = texto(item?.nome);
    if (quantidade <= 0 || !nome) return [];
    const unidade = texto(item.unidadeMedidaSigla) || 'UN';
    // Item avulso nao tem id: junta pelo nome.
    const base = texto(item.id);
    const produto = base && base !== 'avulso' ? base : `nome:${nome.toUpperCase()}`;
    return [{ chave: `${produto}|${texto(item.embalagemId)}|${unidade}`, codigo: texto(item.codigo), nome, unidade, quantidade }];
  })
);

/** Soma os itens dos pedidos, em ordem de nome. */
export const somarItensParaSeparar = (pedidos: ReadonlyArray<PedidoParaSeparar>): ItemSomado[] => {
  const mapa = new Map<string, ItemSomado>();
  pedidos.forEach((pedido) => {
    const contadoNestePedido = new Set<string>();
    itensValidos(pedido).forEach((item) => {
      const atual = mapa.get(item.chave) || { chave: item.chave, codigo: item.codigo, nome: item.nome, unidade: item.unidade, quantidade: 0, pedidos: 0 };
      atual.quantidade = somar(atual.quantidade, item.quantidade);
      if (!contadoNestePedido.has(item.chave)) {
        contadoNestePedido.add(item.chave);
        atual.pedidos += 1;
      }
      mapa.set(item.chave, atual);
    });
  });
  return emOrdemDeNome(Array.from(mapa.values()));
};

/** Quadradinho para marcar a caneta (a fonte do PDF nao tem o simbolo de caixa). */
const CAIXA_DE_MARCAR = '[      ]';

export interface DocumentoListaSeparacao {
  titulo: string;
  periodo?: string;
  filtros?: string[];
  indicadores?: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

/**
 * Documento da lista. `semItens`: o que esta na lista mas nao deu para ler os
 * itens (entrega futura da rota, pedido apagado): sai escrito no topo, para
 * ninguem achar que a lista esta completa.
 */
export const montarDocumentoListaSeparacao = (args: {
  titulo: string;
  periodo?: string;
  filtros?: string[];
  pedidos: ReadonlyArray<PedidoParaSeparar>;
  semItens?: ReadonlyArray<string>;
}): DocumentoListaSeparacao => {
  const somados = somarItensParaSeparar(args.pedidos);

  const colunasDaSoma: ColunaRelatorio<ItemSomado>[] = [
    { id: 'separado', titulo: 'Separado', tipo: 'texto', largura: 18, padrao: false, valor: () => CAIXA_DE_MARCAR },
    { id: 'codigo', titulo: 'Cód.', tipo: 'texto', largura: 16, padrao: false, valor: (l) => l.codigo },
    { id: 'produto', titulo: 'Produto', tipo: 'texto', largura: 100, valor: (l) => l.nome },
    { id: 'unidade', titulo: 'Un.', tipo: 'texto', largura: 12, valor: (l) => l.unidade },
    { id: 'quantidade', titulo: 'Qtd.', tipo: 'inteiro', largura: 18, total: 'nenhum', valor: (l) => l.quantidade },
    { id: 'pedidos', titulo: 'Pedidos', tipo: 'inteiro', largura: 16, padrao: false, total: 'nenhum', valor: (l) => l.pedidos },
  ];

  const colunasDoPedido: ColunaRelatorio<LinhaDoPedido>[] = [
    { id: 'separado', titulo: 'Separado', tipo: 'texto', largura: 18, valor: () => CAIXA_DE_MARCAR },
    { id: 'codigo', titulo: 'Cód.', tipo: 'texto', largura: 16, valor: (l) => l.codigo },
    { id: 'produto', titulo: 'Produto', tipo: 'texto', largura: 116, valor: (l) => l.nome },
    { id: 'unidade', titulo: 'Un.', tipo: 'texto', largura: 12, valor: (l) => l.unidade },
    { id: 'quantidade', titulo: 'Qtd.', tipo: 'inteiro', largura: 18, total: 'nenhum', valor: (l) => l.quantidade },
  ];

  // Os pedidos ficam na ordem recebida (na rota, a ordem de entrega).
  const linhasPorPedido: LinhaDoPedido[] = args.pedidos.flatMap((pedido) => {
    const rotulo = pedido.clienteNome ? `${pedido.rotulo} · ${pedido.clienteNome}` : pedido.rotulo;
    return emOrdemDeNome(itensValidos(pedido)).map((item) => ({
      pedidoId: pedido.id,
      pedidoRotulo: rotulo,
      codigo: item.codigo,
      nome: item.nome,
      unidade: item.unidade,
      quantidade: item.quantidade,
    }));
  });

  const avisos = (args.semItens || []).length > 0
    ? [`Sem os itens nesta lista (separe à parte): ${(args.semItens || []).join(', ')}`]
    : [];

  return {
    titulo: args.titulo,
    ...(args.periodo ? { periodo: args.periodo } : {}),
    filtros: [...(args.filtros || []), ...avisos],
    indicadores: [
      { rotulo: 'Pedidos', valor: String(args.pedidos.length) },
      { rotulo: 'Itens diferentes', valor: String(somados.length) },
    ],
    secoes: [
      {
        id: 'itens',
        titulo: 'Todos os itens (separar de uma vez)',
        colunas: colunasDaSoma,
        linhas: somados,
        unidade: ['item', 'itens'],
        rotuloTotal: 'Total',
        mensagemVazia: 'Nenhum item para separar.',
      },
      {
        id: 'porPedido',
        titulo: 'Itens de cada pedido',
        colunas: colunasDoPedido,
        linhas: linhasPorPedido,
        opcional: true,
        // Decisao do dono: o padrao e' so' item e quantidade; esta parte liga na caixinha.
        padrao: false,
        agruparPor: { chave: (l: LinhaDoPedido) => l.pedidoId, rotulo: (l: LinhaDoPedido) => l.pedidoRotulo },
        unidade: ['item', 'itens'],
        rotuloTotal: 'Total',
        mensagemVazia: 'Nenhum item para separar.',
      },
    ],
  };
};

/**
 * Fila de Expedicao: o que entra na lista. Marcou linhas, sao elas (ate conferido,
 * se a pessoa quiser reimprimir). Nada marcado: as da tela que faltam conferir.
 */
export const pedidosDaFilaParaSeparar = <T extends { chave: string; statusConferencia?: unknown }>(
  naTela: ReadonlyArray<T>,
  marcados: ReadonlySet<string>,
): T[] => {
  const escolhidos = naTela.filter((p) => marcados.has(p.chave));
  return escolhidos.length > 0 ? escolhidos : naTela.filter((p) => p.statusConferencia !== 'conferido');
};
