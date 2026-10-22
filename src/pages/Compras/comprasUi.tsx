import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Trash2 } from 'lucide-react';
import { db } from '../../services/firebase';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import type { ItemDaCotacao } from '../../utils/comprasDomain';

/**
 * Pecas comuns das telas de Compras (22/10/2026): produtos do estoque para a
 * busca e a grade de itens (produto + quantidade [+ preco]).
 */

export interface ProdutoParaCompra {
  id: string;
  nome: string;
  codigo?: string;
  categoria?: string;
  unidadeMedidaSigla?: string;
  precoCusto?: number;
  ultimoCusto?: number;
  ativo?: boolean;
  temGrade?: boolean;
}

/** Produtos do estoque (ativos, sem o principal de grade), ao vivo. */
export const useProdutosParaCompra = (tenantId: string | null | undefined): ProdutoParaCompra[] => {
  const [produtos, setProdutos] = useState<ProdutoParaCompra[]>([]);
  useEffect(() => {
    if (!tenantId) return undefined;
    return onSnapshot(
      query(collection(db, 'estoque'), where('tenantId', '==', tenantId)),
      (snap) => setProdutos(snap.docs.map((d) => ({
        id: d.id,
        nome: String(d.data().nome || ''),
        codigo: d.data().codigo,
        categoria: d.data().categoria,
        unidadeMedidaSigla: d.data().unidadeMedidaSigla,
        precoCusto: Number(d.data().precoCusto) || 0,
        ultimoCusto: Number(d.data().ultimoCusto) || 0,
        ativo: d.data().ativo ?? d.data().statusAtivo ?? true,
        temGrade: d.data().temGrade === true,
      }))),
      (erro) => console.error('Erro ao carregar produtos para compras:', erro),
    );
  }, [tenantId]);
  return produtos;
};

export const estiloCampo: React.CSSProperties = { width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' };
export const estiloRotulo: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' };

export const centavosDoTexto = (texto: string): number => {
  const n = Number(String(texto || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};
export const textoDosCentavos = (c: number): string => (c > 0 ? (c / 100).toFixed(2).replace('.', ',') : '');
export const quantidadeDoTexto = (texto: string): number => {
  const n = Number(String(texto || '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export interface LinhaDeItem extends ItemDaCotacao {
  /** Texto do campo de preco (so' pedido de compra). */
  precoTexto: string;
  quantidadeTexto: string;
}

export const linhaDoProduto = (p: ProdutoParaCompra, comPreco: boolean): LinhaDeItem => ({
  produtoId: p.id,
  codigo: String(p.codigo || ''),
  nome: p.nome,
  unidade: String(p.unidadeMedidaSigla || 'UN'),
  quantidade: 1,
  quantidadeTexto: '1',
  observacao: '',
  precoTexto: comPreco ? textoDosCentavos(Math.round((p.ultimoCusto || p.precoCusto || 0) * 100)) : '',
});

/** Grade de itens: busca de produto em cima, linhas editaveis embaixo. */
export const GradeDeItens: React.FC<{
  produtos: ProdutoParaCompra[];
  linhas: LinhaDeItem[];
  onMudar: (linhas: LinhaDeItem[]) => void;
  comPreco: boolean;
  somenteLeitura?: boolean;
}> = ({ produtos, linhas, onMudar, comPreco, somenteLeitura = false }) => {
  const [busca, setBusca] = useState('');
  const adicionar = (p: ProdutoParaCompra) => {
    setBusca('');
    if (linhas.some((l) => l.produtoId === p.id)) return;
    onMudar([...linhas, linhaDoProduto(p, comPreco)]);
  };
  const mudarLinha = (i: number, campos: Partial<LinhaDeItem>) => onMudar(linhas.map((l, j) => (j === i ? { ...l, ...campos } : l)));

  return (
    <div className="card" style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {!somenteLeitura && (
        <div style={{ position: 'relative' }}>
          <ProductAutocomplete
            value={busca}
            products={produtos}
            onChange={setBusca}
            onSelect={adicionar}
            placeholder="Buscar…"
            ariaLabel="Buscar produto do estoque"
            travarAoSelecionar={false}
            renderItem={(p) => (<><span>{p.codigo ? `#${p.codigo} — ${p.nome}` : p.nome}</span><span style={{ color: 'var(--text-muted)' }}>{p.categoria}</span></>)}
          />
        </div>
      )}
      <div className="table-wrapper">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th style={{ width: '110px' }}>Quantidade</th>
              <th style={{ width: '70px' }}>Und.</th>
              {comPreco && <th style={{ width: '140px' }}>Preço unit. (R$)</th>}
              {comPreco && <th style={{ width: '130px', textAlign: 'right' }}>Subtotal</th>}
              {!comPreco && <th>Observação</th>}
              {!somenteLeitura && <th style={{ width: '44px' }} />}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Nenhum item ainda. Busque o produto acima para adicionar.</td></tr>
            ) : linhas.map((l, i) => (
              <tr key={l.produtoId}>
                <td>{l.codigo || '—'}</td>
                <td style={{ fontWeight: 600 }}>{l.nome}</td>
                <td>
                  {somenteLeitura ? l.quantidade.toLocaleString('pt-BR') : (
                    <input value={l.quantidadeTexto} inputMode="decimal" onChange={(e) => mudarLinha(i, { quantidadeTexto: e.target.value, quantidade: quantidadeDoTexto(e.target.value) })} style={{ ...estiloCampo, padding: '6px 8px' }} aria-label={`Quantidade de ${l.nome}`} />
                  )}
                </td>
                <td>{l.unidade}</td>
                {comPreco && (
                  <td>
                    {somenteLeitura ? textoDosCentavos(centavosDoTexto(l.precoTexto)) : (
                      <input value={l.precoTexto} inputMode="decimal" onChange={(e) => mudarLinha(i, { precoTexto: e.target.value })} style={{ ...estiloCampo, padding: '6px 8px' }} aria-label={`Preço de ${l.nome}`} />
                    )}
                  </td>
                )}
                {comPreco && <td style={{ textAlign: 'right', fontWeight: 600 }}>{(Math.round(l.quantidade * centavosDoTexto(l.precoTexto)) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>}
                {!comPreco && (
                  <td>
                    {somenteLeitura ? (l.observacao || '—') : (
                      <input value={l.observacao} maxLength={120} onChange={(e) => mudarLinha(i, { observacao: e.target.value })} style={{ ...estiloCampo, padding: '6px 8px' }} aria-label={`Observação de ${l.nome}`} title="Marca, referência, embalagem…" />
                    )}
                  </td>
                )}
                {!somenteLeitura && (
                  <td>
                    <button type="button" onClick={() => onMudar(linhas.filter((_, j) => j !== i))} aria-label={`Tirar ${l.nome}`} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
