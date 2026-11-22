import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { db } from '../../services/firebase';
import {
  COLECAO_HISTORICO_ANTERIOR,
  ultimosPedidosAnteriores,
  type ItemHistoricoAnterior,
} from '../../utils/historicoSistemaAnteriorDomain';

/**
 * "Compras no sistema anterior" (22/11/2026, migracao Embala Minas): os
 * ultimos pedidos que o cliente fez no sistema antigo, so' para consulta.
 * Nao aparece nada quando o cliente nao tem historico importado.
 */

interface PedidoAnterior {
  id: string;
  pedido: string;
  data: string;
  total: number;
  itens: ItemHistoricoAnterior[];
}

const moeda = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const qtd = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

interface Props {
  tenantId: string | null | undefined;
  clienteId: string | null | undefined;
  /** Mostrar os valores (o app esconde quando o vendedor nao ve valores). */
  mostrarValores?: boolean;
  compacto?: boolean;
}

const ComprasSistemaAnterior: React.FC<Props> = ({ tenantId, clienteId, mostrarValores = true, compacto = false }) => {
  const [pedidos, setPedidos] = useState<PedidoAnterior[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !clienteId) { setPedidos([]); return; }
    let cancelado = false;
    // Sem orderBy (dispensa indice composto): sao no maximo 5 por cliente.
    getDocs(query(collection(db, COLECAO_HISTORICO_ANTERIOR), where('tenantId', '==', tenantId), where('clienteId', '==', clienteId)))
      .then((snap) => {
        if (cancelado) return;
        const lista = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            pedido: String(x.pedido || ''),
            data: String(x.data || ''),
            total: Number(x.total) || 0,
            itens: Array.isArray(x.itens) ? (x.itens as ItemHistoricoAnterior[]) : [],
          };
        });
        setPedidos(ultimosPedidosAnteriores(lista, 5));
      })
      .catch((erro) => {
        // Consulta auxiliar: se falhar, a ficha continua funcionando sem ela.
        console.error('Erro ao carregar compras do sistema anterior:', erro);
        if (!cancelado) setPedidos([]);
      });
    return () => { cancelado = true; };
  }, [tenantId, clienteId]);

  if (pedidos.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: compacto ? '14px' : '15px' }}>
        <History size={compacto ? 16 : 18} style={{ color: 'var(--accent-purple)' }} /> Compras no sistema anterior
      </div>
      {pedidos.map((p) => (
        <div key={p.id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setAberto(aberto === p.id ? null : p.id)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--bg-tertiary)', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', textAlign: 'left' }}
          >
            {aberto === p.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ flex: 1 }}>{dataBr(p.data)} · Pedido {p.pedido} · {p.itens.length} item(ns)</span>
            {mostrarValores && <strong>{moeda(p.total)}</strong>}
          </button>
          {aberto === p.id && (
            <div style={{ padding: '6px 10px', fontSize: '12.5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {p.itens.map((i, k) => (
                <div key={k} style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
                  <span style={{ flex: 1 }}>{qtd(i.quantidade)} {i.unidade} · {i.descricao}</span>
                  {mostrarValores && <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{moeda(i.valorUnitario)} = {moeda(i.valorTotal)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ComprasSistemaAnterior;
