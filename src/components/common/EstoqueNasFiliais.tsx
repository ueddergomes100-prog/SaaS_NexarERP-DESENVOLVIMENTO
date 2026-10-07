import React, { useEffect, useState } from 'react';
import { Warehouse } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { consultarEstoqueNasFiliais } from '../../services/filialService';
import type { EstoqueDaFilial } from '../../utils/cadastroGrupoDomain';

/**
 * ESTOQUE NAS FILIAIS (Filiais, fase 2 -- 2026-10-06). "10 CENTRO 12 · 20
 * BAIXADA 0" para o produto, com a filial atual em destaque. Decisao do dono:
 * todo usuario ve, so' a quantidade (custo e valores das outras ficam
 * escondidos). Empresa sem filiais nao mostra nada.
 *
 * Guarda as respostas por 30 s: a busca de produto troca o item destacado a
 * cada seta, e nao precisa perguntar ao servidor de novo pelo mesmo produto.
 */

const VALIDADE_MS = 30_000;
const cache = new Map<string, { em: number; dados: EstoqueDaFilial[] }>();

const formatar = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }));

export const useEstoqueNasFiliais = (chave: string | null, atrasoMs = 0): EstoqueDaFilial[] | null => {
  const { grupo } = useAuth();
  const [dados, setDados] = useState<EstoqueDaFilial[] | null>(null);

  useEffect(() => {
    if (!grupo || !chave) { setDados(null); return undefined; }
    const guardado = cache.get(chave);
    if (guardado && Date.now() - guardado.em < VALIDADE_MS) { setDados(guardado.dados); return undefined; }
    setDados(null);
    let cancelado = false;
    const timer = setTimeout(() => {
      consultarEstoqueNasFiliais([chave])
        .then((r) => {
          const lista = r[chave] || [];
          cache.set(chave, { em: Date.now(), dados: lista });
          if (!cancelado) setDados(lista);
        })
        .catch(() => { if (!cancelado) setDados([]); });
    }, atrasoMs);
    return () => { cancelado = true; clearTimeout(timer); };
  }, [grupo, chave, atrasoMs]);

  return dados;
};

interface EstoqueNasFiliaisProps {
  chave: string | null;
  /** Linha unica e discreta (rodape da busca de produto). */
  compacto?: boolean;
  /** Espera antes de perguntar (a busca muda o destaque a cada tecla). */
  atrasoMs?: number;
}

const EstoqueNasFiliais: React.FC<EstoqueNasFiliaisProps> = ({ chave, compacto = false, atrasoMs = 0 }) => {
  const { grupo, tenantId } = useAuth();
  const dados = useEstoqueNasFiliais(chave, atrasoMs);
  if (!grupo || !chave) return null;

  const itens = dados === null
    ? <span style={{ color: 'var(--text-muted)' }}>consultando…</span>
    : dados.length === 0
      ? <span style={{ color: 'var(--text-muted)' }}>sem informação</span>
      : dados.map((f, i) => {
        const atual = f.tenantId === tenantId;
        return (
          <span key={f.tenantId} style={{ whiteSpace: 'nowrap', fontWeight: atual ? 700 : 500, color: atual ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {i > 0 && <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>}
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--accent-purple)', marginRight: '4px' }}>{f.codigo}</span>
            {f.nome} <strong style={{ fontVariantNumeric: 'tabular-nums', color: f.disponivel > 0 ? '#10b981' : 'var(--text-muted)' }}>{formatar(f.disponivel)}</strong>
          </span>
        );
      });

  if (compacto) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '8px 16px', borderTop: '1px solid var(--border-color)', fontSize: '12px', background: 'var(--bg-secondary)' }}
      >
        <Warehouse size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
        <span style={{ color: 'var(--text-muted)' }}>Estoque nas filiais:</span>
        {itens}
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '13px' }}
    >
      <Warehouse size={16} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} aria-hidden="true" />
      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Estoque disponível nas filiais:</span>
      {itens}
    </div>
  );
};

export default EstoqueNasFiliais;
