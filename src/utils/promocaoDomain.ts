/**
 * PROMOCOES (pedido do dono, 2026-10-01; modelo: tela "Promocoes" do Uniplus
 * que o Shopping Rural usava).
 *
 * Uma promocao e' um cadastro proprio: nome, periodo (ou continua), dias da
 * semana, em que formas de pagamento vale ("so a vista" ou todas), limite de
 * unidades por venda e a lista de produtos. Cada produto tem o preco
 * promocional -- fixo (R$) ou % sobre o preco atual -- e a QUOTA: quantas
 * unidades podem sair no preco promocional (vendeu a quota, acabou pra ele).
 *
 * Na venda, o item entra no preco promocional sozinho enquanto a promocao vale
 * (precoVendaDomain.precoAutomatico). Promocao "so a vista" sai do item quando
 * o pagamento vira parcelado.
 *
 * A quota e' conferida contra o que ja saiu nas vendas (pedidos nao cancelados
 * que levaram a promocao) -- a promocao nao guarda contador, entao venda
 * cancelada devolve a quota sozinha.
 *
 * Regra pura: sem tela, sem Firestore.
 */

export type TipoPrecoPromocao = 'valor' | 'percentual';
export type FormasDaPromocao = 'todas' | 'vista';
export type StatusPromocao = 'inativa' | 'agendada' | 'vigente' | 'encerrada';

export const ROTULO_STATUS_PROMOCAO: Record<StatusPromocao, string> = {
  inativa: 'Inativa',
  agendada: 'Agendada',
  vigente: 'Valendo',
  encerrada: 'Encerrada',
};

export const DIAS_DA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export interface ItemPromocao {
  produtoId: string;
  codigo: string;
  nome: string;
  tipo: TipoPrecoPromocao;
  /** Tipo 'valor': preco promocional em R$ (unidade base). Tipo 'percentual': % de desconto. */
  valor: number;
  /** Unidades que podem sair na promocao; null = sem limite. */
  quota: number | null;
}

export interface Promocao {
  nome: string;
  /** true = promocao INDIVIDUAL, criada no cadastro do produto (um produto so').
   *  Mesmo registro da tela Promocoes -- por isso as duas nunca se duplicam. */
  individual: boolean;
  dataInicio: string;
  /** Vazio quando a promocao e' continua. */
  dataFim: string;
  continua: boolean;
  inativa: boolean;
  /** 0 = domingo ... 6 = sabado. Vazio = todos os dias. */
  diasSemana: number[];
  formas: FormasDaPromocao;
  /** Maximo de unidades de UM produto da promocao numa venda; null = sem limite. */
  limitePorVenda: number | null;
  observacao: string;
  itens: ItemPromocao[];
}

export interface PromocaoComId extends Promocao {
  id: string;
}

const limpar = (texto: unknown): string => String(texto ?? '').replace(/\s+/g, ' ').trim();
const positivoOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Promocao lida do Firestore, completa (documento parcial nao quebra a tela). */
export const lerPromocao = (dados: Record<string, unknown>): Promocao => ({
  nome: limpar(dados.nome),
  individual: dados.individual === true,
  dataInicio: limpar(dados.dataInicio),
  dataFim: limpar(dados.dataFim),
  continua: dados.continua === true,
  inativa: dados.inativa === true,
  diasSemana: Array.isArray(dados.diasSemana) ? (dados.diasSemana as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
  formas: dados.formas === 'vista' ? 'vista' : 'todas',
  limitePorVenda: positivoOuNulo(dados.limitePorVenda),
  observacao: limpar(dados.observacao),
  itens: Array.isArray(dados.itens)
    ? (dados.itens as Array<Record<string, unknown>>).filter((i) => i && i.produtoId).map((i) => ({
      produtoId: String(i.produtoId),
      codigo: limpar(i.codigo),
      nome: limpar(i.nome),
      tipo: i.tipo === 'percentual' ? 'percentual' : 'valor',
      valor: Number(i.valor) || 0,
      quota: positivoOuNulo(i.quota),
    }))
    : [],
});

/** Dia da semana de uma data AAAA-MM-DD (0 = domingo), sem fuso. */
export const diaDaSemana = (data: string): number => {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, (m || 1) - 1, d || 1)).getUTCDay();
};

export const statusDaPromocao = (p: Pick<Promocao, 'inativa' | 'dataInicio' | 'dataFim' | 'continua'>, hoje: string): StatusPromocao => {
  if (p.inativa) return 'inativa';
  if (p.dataInicio && hoje < p.dataInicio) return 'agendada';
  if (!p.continua && p.dataFim && hoje > p.dataFim) return 'encerrada';
  return 'vigente';
};

/** A promocao vale HOJE (periodo + dia da semana)? */
export const promocaoValeNoDia = (p: Promocao, hoje: string): boolean => (
  statusDaPromocao(p, hoje) === 'vigente' && (p.diasSemana.length === 0 || p.diasSemana.includes(diaDaSemana(hoje)))
);

/** Preco promocional do item sobre o preco atual (ambos por unidade base). */
export const precoPromocionalDoItem = (item: Pick<ItemPromocao, 'tipo' | 'valor'>, precoAtual: number): number => {
  if (item.tipo === 'percentual') {
    const pct = Math.min(100, Math.max(0, Number(item.valor) || 0));
    return Math.round(precoAtual * (100 - pct)) / 100;
  }
  return Math.max(0, Math.round((Number(item.valor) || 0) * 100) / 100);
};

/** Margem do preco promocional sobre o custo -- pra ninguem por item abaixo do custo sem ver. */
export const margemDaPromocao = (precoPromocional: number, custo: number): { lucroPercentual: number | null; abaixoDoCusto: boolean } => {
  if (!(custo > 0)) return { lucroPercentual: null, abaixoDoCusto: false };
  return {
    lucroPercentual: Math.round(((precoPromocional - custo) / custo) * 1000) / 10,
    abaixoDoCusto: precoPromocional < custo,
  };
};

/** Problemas que impedem salvar (em portugues), todos de uma vez. */
export const errosDaPromocao = (p: Promocao, precosAtuais: Record<string, number> = {}): string[] => {
  const erros: string[] = [];
  if (limpar(p.nome).length < 3) erros.push('Dê um nome à promoção (mínimo 3 letras), ex.: "SEMANA DO PET".');
  if (!p.dataInicio) erros.push('Informe a data de início.');
  if (!p.continua && !p.dataFim) erros.push('Informe a data final, ou marque "Promoção contínua" (sem data para acabar).');
  if (!p.continua && p.dataInicio && p.dataFim && p.dataFim < p.dataInicio) erros.push('A data final está antes da data de início.');
  if (p.itens.length === 0) erros.push('Coloque pelo menos um produto na promoção.');
  p.itens.forEach((i) => {
    if (i.tipo === 'percentual' && !(i.valor > 0 && i.valor < 100)) erros.push(`${i.nome}: o desconto precisa ficar entre 0% e 100%.`);
    if (i.tipo === 'valor' && !(i.valor > 0)) erros.push(`${i.nome}: informe o preço promocional.`);
    const atual = precosAtuais[i.produtoId];
    if (i.tipo === 'valor' && atual > 0 && i.valor >= atual) erros.push(`${i.nome}: o preço promocional (R$ ${i.valor.toFixed(2)}) não é menor que o preço atual (R$ ${atual.toFixed(2)}).`);
  });
  const repetidos = p.itens.filter((i, idx) => p.itens.findIndex((x) => x.produtoId === i.produtoId) !== idx);
  if (repetidos.length > 0) erros.push(`Produto repetido na promoção: ${repetidos.map((r) => r.nome).join(', ')}.`);
  return erros;
};

/** Dados para gravar, sem nenhum `undefined` (o Firestore recusa). */
export const promocaoParaGravar = (p: Promocao): Promocao => ({
  nome: limpar(p.nome).toUpperCase(),
  individual: p.individual,
  dataInicio: p.dataInicio,
  dataFim: p.continua ? '' : p.dataFim,
  continua: p.continua,
  inativa: p.inativa,
  diasSemana: [...new Set(p.diasSemana)].sort(),
  formas: p.formas,
  limitePorVenda: p.limitePorVenda && p.limitePorVenda > 0 ? Math.floor(p.limitePorVenda) : null,
  observacao: limpar(p.observacao),
  itens: p.itens.map((i) => ({
    produtoId: i.produtoId,
    codigo: limpar(i.codigo),
    nome: limpar(i.nome),
    tipo: i.tipo,
    valor: Math.round((Number(i.valor) || 0) * 100) / 100,
    quota: i.quota && i.quota > 0 ? i.quota : null,
  })),
});

export interface PromocaoDoProduto {
  promocaoId: string;
  nome: string;
  preco: number;
  soAVista: boolean;
  quota: number | null;
  limitePorVenda: number | null;
}

/** Precos do produto na unidade base: venda (= a prazo) e a vista (0 = sem). */
export interface PrecosDoProduto { venda: number; vista: number }

/**
 * Sobre que preco o desconto em % incide: promocao "so a vista" desconta do
 * preco a vista (quando cadastrado); "todas as formas", do preco de venda.
 */
export const precoBaseDaPromocao = (formas: FormasDaPromocao, precos: PrecosDoProduto): number => (
  formas === 'vista' && precos.vista > 0 ? precos.vista : precos.venda
);

/**
 * A promocao que vale HOJE para o produto. Com mais de uma, fica a de menor
 * preco (o cliente nunca paga mais caro por existir uma segunda promocao).
 */
export const promocaoDoProduto = (
  promocoes: PromocaoComId[],
  produtoId: string,
  precos: PrecosDoProduto,
  hoje: string,
): PromocaoDoProduto | null => {
  let melhor: PromocaoDoProduto | null = null;
  promocoes.forEach((p) => {
    if (!promocaoValeNoDia(p, hoje)) return;
    const item = p.itens.find((i) => i.produtoId === produtoId);
    if (!item) return;
    const preco = precoPromocionalDoItem(item, precoBaseDaPromocao(p.formas, precos));
    if (!(preco > 0)) return;
    if (!melhor || preco < melhor.preco) {
      melhor = { promocaoId: p.id, nome: p.nome, preco, soAVista: p.formas === 'vista', quota: item.quota, limitePorVenda: p.limitePorVenda };
    }
  });
  return melhor;
};

/**
 * Quantas unidades ainda podem sair na promocao nesta venda: o menor entre o
 * que sobra da quota e o limite por venda. null = sem limite.
 */
export const quantidadeLiberadaNaPromocao = (
  promo: Pick<PromocaoDoProduto, 'quota' | 'limitePorVenda'>,
  jaVendido: number,
  jaNestaVenda: number,
): number | null => {
  const restanteQuota = promo.quota === null ? null : Math.max(0, promo.quota - Math.max(0, jaVendido) - Math.max(0, jaNestaVenda));
  const restanteLimite = promo.limitePorVenda === null ? null : Math.max(0, promo.limitePorVenda - Math.max(0, jaNestaVenda));
  if (restanteQuota === null) return restanteLimite;
  if (restanteLimite === null) return restanteQuota;
  return Math.min(restanteQuota, restanteLimite);
};

/** Texto curto do periodo: "01/10 a 15/10", "a partir de 01/10", "só qua e sáb". */
export const resumoDoPeriodo = (p: Pick<Promocao, 'dataInicio' | 'dataFim' | 'continua' | 'diasSemana'>): string => {
  const br = (d: string) => (d ? d.split('-').reverse().join('/') : '');
  const periodo = p.continua || !p.dataFim ? `a partir de ${br(p.dataInicio)}` : `${br(p.dataInicio)} a ${br(p.dataFim)}`;
  const dias = p.diasSemana.length > 0 && p.diasSemana.length < 7 ? ` · só ${p.diasSemana.map((d) => DIAS_DA_SEMANA[d].toLowerCase()).join(', ')}` : '';
  return `${periodo}${dias}`;
};

// ---------------------------------------------------------------------------
// UM PRODUTO, UMA PROMOCAO POR VEZ (decisao do dono, 2026-10-01)
// ---------------------------------------------------------------------------
//
// "Se definir um item em promocao na tela individual do produto e tentar criar
// de novo na tela de promocoes, nao pode dar -- tem que falar que ele ja esta
// com promocao no cadastro dele, e vice-versa." Vale entre duas promocoes da
// tela tambem: o mesmo produto nao fica em duas promocoes no mesmo periodo.

const fimEfetivo = (p: Pick<Promocao, 'continua' | 'dataFim'>): string => (p.continua || !p.dataFim ? '9999-12-31' : p.dataFim);

export const periodosSeCruzam = (
  a: Pick<Promocao, 'dataInicio' | 'dataFim' | 'continua'>,
  b: Pick<Promocao, 'dataInicio' | 'dataFim' | 'continua'>,
): boolean => (a.dataInicio || '0000-00-00') <= fimEfetivo(b) && (b.dataInicio || '0000-00-00') <= fimEfetivo(a);

/**
 * Produtos da promocao `nova` que ja estao em OUTRA promocao ativa no mesmo
 * periodo -- uma mensagem por produto, dizendo onde ele esta. Promocao
 * inativa ou ja encerrada nao conta.
 */
export const conflitosDaPromocao = (
  nova: Promocao & { id?: string },
  existentes: PromocaoComId[],
  hoje: string,
): string[] => {
  if (nova.inativa) return [];
  const mensagens: string[] = [];
  existentes.forEach((outra) => {
    if (outra.id === nova.id || outra.inativa) return;
    if (statusDaPromocao(outra, hoje) === 'encerrada') return;
    if (!periodosSeCruzam(nova, outra)) return;
    nova.itens.forEach((item) => {
      if (!outra.itens.some((i) => i.produtoId === item.produtoId)) return;
      const onde = outra.individual
        ? 'em promoção individual, no cadastro do produto'
        : `na promoção "${outra.nome}" (tela Promoções)`;
      mensagens.push(`${item.nome} já está ${onde}, ${resumoDoPeriodo(outra)}. Tire de lá ou ajuste as datas antes.`);
    });
  });
  return mensagens;
};