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
 *
 * `quotaConferida` (app Vendas, 19/10/2026): false enquanto nao se sabe quanto
 * ja' saiu das promocoes com quota (carregando ou sem internet). Ao voltar a
 * internet, confere de novo.
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
  const [quotaConferida, setQuotaConferida] = useState(true);
  const [voltouInternet, setVoltouInternet] = useState(0);
  useEffect(() => {
    const ligou = () => setVoltouInternet((n) => n + 1);
    window.addEventListener('online', ligou);
    return () => window.removeEventListener('online', ligou);
  }, []);
  useEffect(() => {
    if (!tenantId) return undefined;
    const comQuota = promocoes.filter((p) => p.itens.some((i) => i.quota !== null));
    if (comQuota.length === 0) { setVendidoPorPromocao({}); setQuotaConferida(true); return undefined; }
    let cancelado = false;
    setQuotaConferida(false);
    Promise.all(comQuota.map(async (p) => [p.id, await vendidoNaPromocao(tenantId, p.id, ignorarDocumentoId).catch(() => null)] as const))
      .then((pares) => {
        if (cancelado) return;
        setVendidoPorPromocao(Object.fromEntries(pares.map(([id, vendido]) => [id, vendido || {}])));
        setQuotaConferida(pares.every(([, vendido]) => vendido !== null));
      });
    return () => { cancelado = true; };
  }, [tenantId, promocoes, ignorarDocumentoId, voltouInternet]);

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

  return { promocoes, hoje, tabelaDe, promocaoDe, quantidadeLiberada, quotaConferida };
};
