import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTenantCollection } from './useTenantCollection';
import { getDateInputInTimeZone } from '../utils/dateTime';
import { lerPromocao, promocaoDoProduto, quantidadeLiberadaNaPromocao, type PromocaoComId, type PromocaoDoProduto } from '../utils/promocaoDomain';
import { tabelaComPromocao, type ProdutoPrecificavel, type UnidadeDoItem } from '../utils/precoComPromocaoDomain';
import type { TabelaDePrecoDoItem } from '../utils/precoVendaDomain';
import { vendidoNaPromocao } from '../services/promocaoService';

/**
 * Promocoes que valem hoje para a empresa, prontas para precificar item
 * (2026-10-06). Compartilhado por PDV, Orcamento e OS -- o Pedido de Venda
 * ja' fazia isso por conta propria. Expoe:
 *  - tabelaDe(produto, unidade): a tabela do item com a promocao de hoje;
 *  - quantidadeLiberada(produto, jaNestaVenda): quanto ainda cabe na quota /
 *    limite por venda (null = sem limite). So' as telas que VENDEM (PDV, OS)
 *    precisam conferir; orcamento nao consome quota.
 *
 * `ignorarDocumentoId`: o proprio pedido/OS em edicao, para a quota nao
 * contar o que ele mesmo ja' gravou.
 */
export const usePromocoesVigentes = (tenantId: string | null | undefined, ignorarDocumentoId?: string) => {
  const { items } = useTenantCollection<{ id: string } & Record<string, unknown>>('promocoes', tenantId ?? null, { enabled: Boolean(tenantId) });
  const promocoes = useMemo<PromocaoComId[]>(
    () => items.map((p) => ({ ...lerPromocao(p), id: p.id })).filter((p) => !p.inativa),
    [items],
  );
  const hoje = getDateInputInTimeZone();

  // promocaoId -> produtoId -> quantidade ja' vendida em OUTROS documentos.
  const [vendidoPorPromocao, setVendidoPorPromocao] = useState<Record<string, Record<string, number>>>({});
  useEffect(() => {
    if (!tenantId) return undefined;
    const comQuota = promocoes.filter((p) => p.itens.some((i) => i.quota !== null));
    if (comQuota.length === 0) { setVendidoPorPromocao({}); return undefined; }
    let cancelado = false;
    Promise.all(comQuota.map(async (p) => [p.id, await vendidoNaPromocao(tenantId, p.id, ignorarDocumentoId).catch(() => ({}))] as const))
      .then((pares) => { if (!cancelado) setVendidoPorPromocao(Object.fromEntries(pares)); });
    return () => { cancelado = true; };
  }, [tenantId, promocoes, ignorarDocumentoId]);

  const tabelaDe = useCallback(
    (produto: ProdutoPrecificavel, unidade?: UnidadeDoItem): TabelaDePrecoDoItem => tabelaComPromocao(produto, promocoes, hoje, unidade),
    [promocoes, hoje],
  );

  const promocaoDe = useCallback(
    (produto: ProdutoPrecificavel): PromocaoDoProduto | null => promocaoDoProduto(
      promocoes,
      produto.id,
      { venda: Number(produto.precoVenda) || 0, vista: Number(produto.precoAVista) || 0 },
      hoje,
    ),
    [promocoes, hoje],
  );

  /** Quanto do produto ainda cabe na promocao de hoje (null = sem limite; sem promocao tambem null). */
  const quantidadeLiberada = useCallback((produto: ProdutoPrecificavel, jaNestaVenda: number): { promo: PromocaoDoProduto; liberada: number | null } | null => {
    const promo = promocaoDe(produto);
    if (!promo) return null;
    return { promo, liberada: quantidadeLiberadaNaPromocao(promo, vendidoPorPromocao[promo.promocaoId]?.[produto.id] || 0, jaNestaVenda) };
  }, [promocaoDe, vendidoPorPromocao]);

  return { promocoes, hoje, tabelaDe, promocaoDe, quantidadeLiberada };
};
