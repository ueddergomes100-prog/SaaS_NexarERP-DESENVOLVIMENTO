import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { differenceInCalendarDays, formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';

/**
 * So consulta -- ver o que esta pendente/vencido e o valor, sem marcar como
 * pago. Le direto a colecao `transacoes` (mesma que o desktop usa em
 * ContasPagar.tsx), filtrando por `tipo: 'saida'`. Sem escrita nenhuma no
 * Firestore, de proposito: mexer com saldo de banco/quitar conta fica pro
 * desktop por enquanto.
 */

interface Conta {
  id: string;
  descricao: string;
  vencimento: string;
  valor: number;
  status: string;
  fornecedorNome: string;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VendedorContasPagar: React.FC = () => {
  const { tenantId, userPermissions } = useAuth();
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    let cancelado = false;
    setCarregando(true);

    getDocs(query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'saida'),
    )).then((snap) => {
      if (cancelado) return;
      const lista: Conta[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            descricao: data.descricao || '',
            vencimento: data.data || '',
            valor: Number(data.valor || 0),
            status: data.status || 'Pendente',
            fornecedorNome: data.fornecedorNome || '',
          };
        })
        .filter((conta) => conta.status !== 'Cancelada' && conta.status !== 'Paga')
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      setContas(lista);
      setCarregando(false);
    }).catch(() => setCarregando(false));

    return () => { cancelado = true; };
  }, [tenantId]);

  if (!userPermissions.includes('financeiro.pagar')) {
    return <Navigate to="/vendedor" replace />;
  }

  const hoje = getDateInputInTimeZone();
  const totalPendente = contas.reduce((soma, conta) => soma + conta.valor, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Contas a Pagar" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {!carregando && contas.length > 0 && (
          <div
            style={{
              padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 600 }}>Total pendente</span>
            <span style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)' }}>{formatarMoeda(totalPendente)}</span>
          </div>
        )}

        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : contas.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
            Nenhuma conta pendente.
          </div>
        ) : (
          contas.map((conta) => {
            const diasAtraso = differenceInCalendarDays(conta.vencimento, hoje) ?? 0;
            const vencida = diasAtraso > 0;
            return (
              <div
                key={conta.id}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conta.fornecedorNome || conta.descricao || 'Sem descrição'}
                  </div>
                  <div style={{ fontSize: '13px', color: vencida ? '#ef4444' : 'var(--text-muted)', marginTop: '3px', fontWeight: vencida ? 700 : 500 }}>
                    Vence {formatDateInputPtBr(conta.vencimento)}{vencida ? ` · ${diasAtraso}d atrasada` : ''}
                  </div>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(conta.valor)}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default VendedorContasPagar;
