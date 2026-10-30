/**
 * BONIFICACAO NO PEDIDO (pedido de cliente, 30/10/2026; decisoes do dono).
 *
 * Item bonificado = mercadoria que vai de brinde DENTRO do pedido:
 *  - para o cliente o item sai a PRECO ZERO (precoUnitario 0, subtotal 0): nao
 *    entra no total, na receita, nos titulos nem na comissao (que e' % sobre o
 *    subtotal);
 *  - o ESTOQUE baixa normalmente (a baixa e' por quantidade);
 *  - o preco cheio fica guardado em `precoReferencia` -- e' o valor que vai na
 *    NF-e (valor cheio + CFOP 5.910/6.910, imposto normal; a cobranca e' so' da
 *    parte vendida) e a base do limite;
 *  - so' sai em NF-e: a SEFAZ nao aceita CFOP de bonificacao na NFC-e.
 *
 * Controle: permissao "Pode bonificar" (vendas.bonificar) e a chave da empresa
 * em Configuracoes (por filial). Acima do limite (% do valor vendido no
 * pedido), o faturamento pede a liberacao de um responsavel.
 *
 * Arquivo puro (vai para o servidor por scripts/build-server-domain.mjs).
 */

export const PERMISSAO_BONIFICAR = 'vendas.bonificar';

export interface ItemComBonificacao {
  precoUnitario: number;
  quantidade: number;
  desconto?: number;
  subtotal: number;
  bonificado?: boolean;
  /** Preco cheio (unitario) do item bonificado: valor da NF-e e base do limite. */
  precoReferencia?: number;
}

const centavos = (valor: unknown): number => Math.round((Number(valor) || 0) * 100);
const positivo = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const ehBonificado = (item: { bonificado?: unknown } | null | undefined): boolean => item?.bonificado === true;

export const temItemBonificado = (itens: ReadonlyArray<{ bonificado?: unknown }> | null | undefined): boolean => (
  Array.isArray(itens) && itens.some((item) => ehBonificado(item))
);

/** Valor cheio da linha bonificada, em centavos (preco de referencia x quantidade, arredondado por linha). */
export const valorCheioDaLinhaBonificadaCentavos = (item: Pick<ItemComBonificacao, 'precoReferencia' | 'quantidade'>): number => (
  Math.max(0, Math.round(centavos(item.precoReferencia) * (Number(item.quantidade) || 0)))
);

/** Marca o item como bonificado: guarda o preco cheio e zera o que o cliente paga. */
export const bonificarItem = <T extends ItemComBonificacao>(item: T): T => ({
  ...item,
  bonificado: true,
  precoReferencia: ehBonificado(item) ? positivo(item.precoReferencia) : positivo(item.precoUnitario),
  precoUnitario: 0,
  desconto: 0,
  subtotal: 0,
});

/** Volta o item a ser cobrado, pelo preco cheio que estava guardado. */
export const cobrarItem = <T extends ItemComBonificacao>(item: T): T => {
  if (!ehBonificado(item)) return item;
  const { bonificado: _bonificado, precoReferencia, ...resto } = item;
  const preco = positivo(precoReferencia);
  return {
    ...resto,
    precoUnitario: preco,
    desconto: 0,
    subtotal: Math.max(0, Math.round(centavos(preco) * (Number(item.quantidade) || 0))) / 100,
  } as T;
};

/** Item bonificado nunca leva preco nem desconto: o que vier da tela e' corrigido (preco 0, subtotal 0). */
export const normalizarItemBonificado = <T extends ItemComBonificacao>(item: T): T => (
  ehBonificado(item)
    ? { ...item, precoUnitario: 0, desconto: 0, subtotal: 0, precoReferencia: positivo(item.precoReferencia) }
    : item
);

export interface ResumoBonificacao {
  /** Soma do que o cliente paga nos itens (sem os bonificados), em centavos. */
  vendidoCentavos: number;
  /** Valor cheio dos itens bonificados, em centavos. */
  bonificadoCentavos: number;
  /** Bonificado sobre o vendido, em % (null quando nada foi vendido). */
  percentual: number | null;
  quantidadeDeItens: number;
}

export const resumoDaBonificacao = (itens: ReadonlyArray<ItemComBonificacao>): ResumoBonificacao => {
  let vendidoCentavos = 0;
  let bonificadoCentavos = 0;
  let quantidadeDeItens = 0;
  for (const item of itens) {
    if (ehBonificado(item)) {
      bonificadoCentavos += valorCheioDaLinhaBonificadaCentavos(item);
      quantidadeDeItens += 1;
    } else {
      vendidoCentavos += centavos(item.subtotal);
    }
  }
  return {
    vendidoCentavos,
    bonificadoCentavos,
    percentual: vendidoCentavos > 0 ? Math.round((bonificadoCentavos / vendidoCentavos) * 1000) / 10 : null,
    quantidadeDeItens,
  };
};

// ---------------------------------------------------------------------------
// Configuracao da empresa (por filial)
// ---------------------------------------------------------------------------

export interface ConfigBonificacao {
  /** A empresa trabalha com bonificacao (nasce desligada, como toda chave nova). */
  ativa: boolean;
  /** Ate' quantos % do valor vendido no pedido sem liberacao. 0 = toda bonificacao pede liberacao. */
  limitePercentual: number;
}

export const DEFAULT_CONFIG_BONIFICACAO: ConfigBonificacao = { ativa: false, limitePercentual: 0 };

export const parseConfigBonificacao = (valor: unknown): ConfigBonificacao => {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const limite = Number(v.limitePercentual);
  return {
    ativa: v.ativa === true,
    limitePercentual: Number.isFinite(limite) && limite > 0 ? Math.min(100, Math.round(limite * 100) / 100) : 0,
  };
};

export type SituacaoDaBonificacao =
  | { ok: true; precisaLiberacao: false }
  | { ok: true; precisaLiberacao: true; mensagem: string }
  | { ok: false; mensagem: string };

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

export const MENSAGEM_BONIFICACAO_DESLIGADA = 'Esta empresa não trabalha com bonificação. Volte o item para cobrado, ou peça ao administrador para ligar a bonificação em Configurações.';
export const MENSAGEM_SEM_PERMISSAO_BONIFICAR = 'Você não tem a permissão "Vendas: Pode bonificar". Volte o item para cobrado, ou peça a quem pode bonificar.';
export const MENSAGEM_SO_BONIFICADO = 'Este pedido só tem itens bonificados. Bonificação vai junto de uma venda: inclua pelo menos um item cobrado, ou volte um dos itens para cobrado.';
export const MENSAGEM_NFCE_COM_BONIFICACAO = 'Este pedido tem item bonificado, e a SEFAZ não aceita bonificação em NFC-e (cupom). Emita uma NF-e para este pedido.';

/**
 * A bonificacao do pedido pode seguir? Sem item bonificado, sempre. Com:
 * a empresa precisa ter ligado, quem bonifica precisa da permissao, o pedido
 * precisa vender alguma coisa e, acima do limite, precisa de liberacao.
 */
export const situacaoDaBonificacao = (args: {
  itens: ReadonlyArray<ItemComBonificacao>;
  config: ConfigBonificacao;
  podeBonificar: boolean;
}): SituacaoDaBonificacao => {
  const resumo = resumoDaBonificacao(args.itens);
  if (resumo.quantidadeDeItens === 0) return { ok: true, precisaLiberacao: false };
  if (!args.config.ativa) return { ok: false, mensagem: MENSAGEM_BONIFICACAO_DESLIGADA };
  if (!args.podeBonificar) return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO_BONIFICAR };
  if (resumo.vendidoCentavos <= 0) return { ok: false, mensagem: MENSAGEM_SO_BONIFICADO };
  const limiteCentavos = Math.floor(resumo.vendidoCentavos * (args.config.limitePercentual / 100));
  if (resumo.bonificadoCentavos <= limiteCentavos + 1) return { ok: true, precisaLiberacao: false };
  return {
    ok: true,
    precisaLiberacao: true,
    mensagem: `A bonificação deste pedido (${reais(resumo.bonificadoCentavos)}, ${String(resumo.percentual).replace('.', ',')}% do vendido) passa do limite da empresa (${String(args.config.limitePercentual).replace('.', ',')}%) e precisa da liberação de um responsável.`,
  };
};

// ---------------------------------------------------------------------------
// Nota fiscal
// ---------------------------------------------------------------------------

/** CFOP da bonificacao: 5.910 dentro do estado, 6.910 para fora. */
export const cfopDaBonificacao = (interestadual: boolean): string => (interestadual ? '6910' : '5910');
