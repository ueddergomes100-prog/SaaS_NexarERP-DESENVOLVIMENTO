/*
 * CONDICIONAL -- o cliente leva mercadoria para provar em casa, devolve o que
 * nao quiser e o que fica vira venda. Pedido do dono em 2026-10-05.
 *
 * Regras de negocio (puras, sem Firestore). Usadas pela tela E pelo servidor:
 * este arquivo e' compilado para server/domain/ por
 * scripts/build-server-domain.mjs -- quem grava e' sempre o servidor
 * (server/routes/condicionais.routes.js), a tela so' le.
 *
 * Como o estoque anda (sem baixar duas vezes):
 *  - SAIDA: os itens ficam RESERVADOS (`quantidadeReservada`). A mercadoria
 *    continua sendo da loja, so' deixa de estar disponivel.
 *  - DEVOLUCAO: o que voltou tem a reserva liberada.
 *  - FECHAMENTO: o que ficou com o cliente vira uma PRE-VENDA ja' com a
 *    reserva (`estoqueReservado: true`). Dai' segue o fluxo normal da
 *    pre-venda (conferencia, se ligada, e Finalizar), que transforma a
 *    reserva em baixa uma unica vez.
 *  - CANCELAR: libera a reserva do que ainda estava com o cliente.
 *
 * So' funciona com "Trabalha com condicional" marcado em Configuracoes, e so'
 * para produto com "Permite condicional" marcado no cadastro.
 */
import { resolveUnidadeMedidaProduto, type UnidadeMedidaProduto } from './unidadeMedidaDomain';
import { STATUS_PRE_VENDA } from './preVendaDomain';

export const PERMISSAO_CONDICIONAL = 'vendas.condicional';

export const DEFAULT_TRABALHA_COM_CONDICIONAL = false;
export const parseTrabalhaComCondicional = (valor: unknown): boolean => valor === true;

/** Campo do cadastro do produto (aba Avançado). */
export const produtoPermiteCondicional = (produto: { permiteCondicional?: unknown } | null | undefined): boolean => (
  produto?.permiteCondicional === true
);

export type StatusCondicional = 'aberto' | 'finalizado' | 'devolvido' | 'cancelado';

export const ROTULO_STATUS_CONDICIONAL: Record<StatusCondicional, string> = {
  aberto: 'Com o cliente',
  finalizado: 'Virou pré-venda',
  devolvido: 'Tudo devolvido',
  cancelado: 'Cancelado',
};

export const PRAZO_PADRAO_DIAS = 3;
export const PRAZO_MAXIMO_DIAS = 60;
export const MAX_ITENS = 100;
export const OBSERVACAO_MAX = 500;
const PRECISAO = 6;

const arredondar = (valor: number, casas = PRECISAO) => {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
};

const numero = (valor: unknown) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

export interface ItemCondicional extends UnidadeMedidaProduto {
  id: string;
  nome: string;
  codigo: string;
  /** Quanto o cliente levou. */
  quantidade: number;
  /** Quanto ja' voltou (soma de todas as devolucoes). */
  quantidadeDevolvida: number;
  precoUnitario: number;
}

export interface PedidoDeItem {
  id: string;
  quantidade: number;
}

/** Quanto ainda esta com o cliente. */
export const quantidadePendente = (item: Pick<ItemCondicional, 'quantidade' | 'quantidadeDevolvida'>): number => (
  Math.max(0, arredondar(numero(item.quantidade) - numero(item.quantidadeDevolvida)))
);

export const normalizarObservacao = (texto: unknown): string => (
  String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, OBSERVACAO_MAX)
);

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const somarDias = (dataIso: string, dias: number): string => {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return data.toISOString().slice(0, 10);
};

export const prazoPadrao = (hoje: string): string => somarDias(hoje, PRAZO_PADRAO_DIAS);

/** Data combinada para o cliente devolver. '' quando esta certa. */
export const validarPrazoDevolucao = (prazo: unknown, hoje: string): string => {
  const texto = String(prazo ?? '').trim();
  const partes = DATA_ISO.exec(texto);
  if (!partes) return 'Informe até quando o cliente vai devolver ou decidir.';
  const [ano, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const real = new Date(Date.UTC(ano, mes - 1, dia));
  if (real.getUTCFullYear() !== ano || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== dia) {
    return 'A data de devolução não existe. Confira o dia e o mês.';
  }
  if (texto < hoje) return 'A data de devolução não pode ser no passado.';
  if (texto > somarDias(hoje, PRAZO_MAXIMO_DIAS)) {
    return `O prazo máximo de um condicional é de ${PRAZO_MAXIMO_DIAS} dias.`;
  }
  return '';
};

export const estaVencido = (condicional: { status?: string; prazoDevolucao?: string }, hoje: string): boolean => (
  condicional.status === 'aberto' && Boolean(condicional.prazoDevolucao) && String(condicional.prazoDevolucao) < hoje
);

/** Junta linhas repetidas do mesmo produto (somando a quantidade). */
export const somarPorProduto = (itens: ReadonlyArray<PedidoDeItem>): PedidoDeItem[] => {
  const mapa = new Map<string, number>();
  for (const item of itens) {
    mapa.set(item.id, arredondar((mapa.get(item.id) || 0) + numero(item.quantidade)));
  }
  return [...mapa.entries()].map(([id, quantidade]) => ({ id, quantidade }));
};

/** Confere a lista de itens que veio da tela (formato, quantidade). */
export const validarItensDoPedido = (itens: unknown): { erros: string[]; itens: PedidoDeItem[] } => {
  if (!Array.isArray(itens) || itens.length === 0) {
    return { erros: ['Adicione pelo menos um produto ao condicional.'], itens: [] };
  }
  if (itens.length > MAX_ITENS) {
    return { erros: [`Um condicional aceita até ${MAX_ITENS} itens.`], itens: [] };
  }
  const erros: string[] = [];
  const lidos: PedidoDeItem[] = [];
  for (const bruto of itens) {
    const id = String((bruto as PedidoDeItem)?.id || '').trim();
    const quantidade = Number((bruto as PedidoDeItem)?.quantidade);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) { erros.push('Há um produto inválido na lista. Remova-o e adicione de novo.'); continue; }
    if (!Number.isFinite(quantidade) || quantidade <= 0) { erros.push('Toda quantidade precisa ser maior que zero.'); continue; }
    lidos.push({ id, quantidade: arredondar(quantidade) });
  }
  return { erros, itens: somarPorProduto(lidos) };
};

export interface ProdutoParaCondicional {
  nome?: string;
  codigo?: string;
  precoVenda?: number;
  ativo?: boolean;
  statusAtivo?: boolean;
  permiteCondicional?: boolean;
  quantidade?: number;
  quantidadeReservada?: number;
  permitirEstoqueNegativo?: boolean;
  unidadeMedidaSigla?: unknown;
  unidadeMedidaFracionado?: unknown;
  unidadeMedidaCasasDecimais?: unknown;
}

const produtoAtivo = (produto: ProdutoParaCondicional) => produto.ativo !== false && produto.statusAtivo !== false;

/**
 * Monta os itens do condicional com os dados do CADASTRO (nome, codigo,
 * preco, unidade). Unidade ausente cai em UN (CLAUDE.md, regra 4) e volta em
 * `semUnidade` para a tela avisar.
 */
export const montarItensDoCondicional = (args: {
  itens: ReadonlyArray<PedidoDeItem>;
  produtosPorId: Record<string, ProdutoParaCondicional | undefined>;
}): { erros: string[]; itens: ItemCondicional[]; semUnidade: string[] } => {
  const erros: string[] = [];
  const itens: ItemCondicional[] = [];
  const semUnidade: string[] = [];
  for (const pedido of args.itens) {
    const produto = args.produtosPorId[pedido.id];
    if (!produto) { erros.push('Um dos produtos não foi encontrado no cadastro. Atualize a tela.'); continue; }
    const nome = String(produto.nome || 'Produto sem nome');
    if (!produtoAtivo(produto)) { erros.push(`"${nome}" está inativo e não pode sair em condicional.`); continue; }
    if (!produtoPermiteCondicional(produto)) {
      erros.push(`"${nome}" não está liberado para condicional. Marque "Permite condicional" no cadastro do produto em Estoque.`);
      continue;
    }
    const unidade = resolveUnidadeMedidaProduto(produto);
    if (!String(produto.unidadeMedidaSigla ?? '').trim()) semUnidade.push(nome);
    if (!unidade.unidadeMedidaFracionado && !Number.isInteger(pedido.quantidade)) {
      erros.push(`"${nome}" é contado em ${unidade.unidadeMedidaSigla}, que não aceita quantidade fracionada. Use um número inteiro.`);
      continue;
    }
    itens.push({
      id: pedido.id,
      nome,
      codigo: String(produto.codigo || ''),
      quantidade: pedido.quantidade,
      quantidadeDevolvida: 0,
      precoUnitario: Math.max(0, numero(produto.precoVenda)),
      ...unidade,
    });
  }
  return { erros, itens, semUnidade };
};

/**
 * SAIDA: confere o disponivel (quantidade - reservada) e diz quanto reservar.
 * A empresa (ou o produto) pode liberar sem estoque, como na venda.
 */
export const planoDeReserva = (args: {
  itens: ReadonlyArray<Pick<ItemCondicional, 'id' | 'nome' | 'quantidade'>>;
  produtosPorId: Record<string, ProdutoParaCondicional | undefined>;
  permiteSemEstoque: boolean;
}): { erros: string[]; reservas: { id: string; reservadaDepois: number }[] } => {
  const erros: string[] = [];
  const reservas: { id: string; reservadaDepois: number }[] = [];
  for (const item of args.itens) {
    const produto = args.produtosPorId[item.id];
    if (!produto) { erros.push(`O produto "${item.nome}" não foi encontrado no cadastro.`); continue; }
    const reservada = numero(produto.quantidadeReservada);
    const disponivel = arredondar(numero(produto.quantidade) - reservada);
    const liberado = args.permiteSemEstoque || produto.permitirEstoqueNegativo === true;
    if (!liberado && disponivel < item.quantidade) {
      erros.push(`Estoque insuficiente para "${item.nome}": o condicional leva ${item.quantidade}, disponível ${Math.max(0, disponivel)}. Dê entrada do produto no Estoque ou ligue "Permitir venda sem estoque" em Configurações.`);
      continue;
    }
    reservas.push({ id: item.id, reservadaDepois: arredondar(reservada + item.quantidade) });
  }
  return { erros, reservas };
};

/** Libera reserva (devolucao ou cancelamento). Produto que sumiu nao tem o que liberar. */
export const planoDeLiberacao = (args: {
  liberar: ReadonlyArray<PedidoDeItem>;
  produtosPorId: Record<string, ProdutoParaCondicional | undefined>;
}): { id: string; reservadaDepois: number }[] => (
  somarPorProduto(args.liberar).flatMap((linha) => {
    const produto = args.produtosPorId[linha.id];
    if (!produto || linha.quantidade <= 0) return [];
    return [{ id: linha.id, reservadaDepois: Math.max(0, arredondar(numero(produto.quantidadeReservada) - linha.quantidade)) }];
  })
);

/**
 * DEVOLUCAO (parcial ou total): soma o que voltou em cada item. Nao deixa
 * devolver mais do que esta com o cliente.
 */
export const planejarDevolucao = (
  itens: ReadonlyArray<ItemCondicional>,
  devolucoes: ReadonlyArray<PedidoDeItem>,
): { erros: string[]; itens: ItemCondicional[]; liberar: PedidoDeItem[]; tudoDevolvido: boolean } => {
  const erros: string[] = [];
  const porId = new Map(somarPorProduto(devolucoes.filter((d) => numero(d.quantidade) > 0)).map((d) => [d.id, d.quantidade]));
  if (porId.size === 0) return { erros: ['Informe a quantidade devolvida de pelo menos um item.'], itens: [...itens], liberar: [], tudoDevolvido: false };

  const novos = itens.map((item) => {
    const volta = porId.get(item.id) || 0;
    if (volta <= 0) return item;
    const pendente = quantidadePendente(item);
    if (volta > pendente) {
      erros.push(`"${item.nome}": devolvendo ${volta}, mas só ${pendente} está com o cliente.`);
      return item;
    }
    if (!item.unidadeMedidaFracionado && !Number.isInteger(volta)) {
      erros.push(`"${item.nome}" não aceita quantidade fracionada. Use um número inteiro.`);
      return item;
    }
    return { ...item, quantidadeDevolvida: arredondar(numero(item.quantidadeDevolvida) + volta) };
  });
  for (const id of porId.keys()) {
    if (!itens.some((item) => item.id === id)) erros.push('Um dos itens devolvidos não faz parte deste condicional. Atualize a tela.');
  }
  const liberar = [...porId.entries()].map(([id, quantidade]) => ({ id, quantidade }));
  const tudoDevolvido = novos.every((item) => quantidadePendente(item) === 0);
  return { erros, itens: erros.length ? [...itens] : novos, liberar: erros.length ? [] : liberar, tudoDevolvido };
};

export interface ItemDaPreVenda extends UnidadeMedidaProduto {
  id: string;
  nome: string;
  codigo: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  subtotal: number;
}

/** FECHAMENTO: o que ficou com o cliente vira os itens da pre-venda. */
export const itensQueFicaram = (itens: ReadonlyArray<ItemCondicional>): ItemDaPreVenda[] => (
  itens
    .map((item) => ({ item, quantidade: quantidadePendente(item) }))
    .filter(({ quantidade }) => quantidade > 0)
    .map(({ item, quantidade }) => ({
      id: item.id,
      nome: item.nome,
      codigo: item.codigo,
      precoUnitario: item.precoUnitario,
      quantidade,
      desconto: 0,
      subtotal: arredondar(item.precoUnitario * quantidade, 2),
      unidadeMedidaSigla: item.unidadeMedidaSigla,
      unidadeMedidaFracionado: item.unidadeMedidaFracionado,
      unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais,
    }))
);

export const STATUS_DA_PRE_VENDA_GERADA = STATUS_PRE_VENDA;

export interface ResumoCondicional {
  pecasLevadas: number;
  pecasDevolvidas: number;
  pecasComCliente: number;
  valorLevado: number;
  valorComCliente: number;
}

export const resumirCondicional = (itens: ReadonlyArray<ItemCondicional>): ResumoCondicional => {
  let pecasLevadas = 0;
  let pecasDevolvidas = 0;
  let valorLevado = 0;
  let valorComCliente = 0;
  for (const item of itens) {
    pecasLevadas += numero(item.quantidade);
    pecasDevolvidas += numero(item.quantidadeDevolvida);
    valorLevado += numero(item.quantidade) * numero(item.precoUnitario);
    valorComCliente += quantidadePendente(item) * numero(item.precoUnitario);
  }
  return {
    pecasLevadas: arredondar(pecasLevadas),
    pecasDevolvidas: arredondar(pecasDevolvidas),
    pecasComCliente: arredondar(pecasLevadas - pecasDevolvidas),
    valorLevado: arredondar(valorLevado, 2),
    valorComCliente: arredondar(valorComCliente, 2),
  };
};

/** Quais acoes a tela mostra para cada situacao. */
export const acoesDoCondicional = (status: string): { devolver: boolean; fechar: boolean; cancelar: boolean } => {
  const aberto = status === 'aberto';
  return { devolver: aberto, fechar: aberto, cancelar: aberto };
};

/**
 * Mensagem quando a empresa ainda nao liga o condicional. A tela e o servidor
 * usam a mesma frase (CLAUDE.md, regra 1: bloquear com mensagem clara).
 */
export const MENSAGEM_CONDICIONAL_DESLIGADO = 'O condicional está desligado nesta empresa. Marque "Trabalha com condicional" em Configurações > Configurações Gerais para usar.';
