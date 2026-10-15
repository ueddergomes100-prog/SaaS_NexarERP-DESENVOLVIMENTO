import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { transactionDueDateInput } from '../../utils/financeDomain';
import type { ContaParaAgrupar } from '../../utils/contasAgrupadasDomain';
import ContasAgrupadas from './ContasAgrupadas';

/**
 * So consulta -- ver o que esta pendente/vencido e o valor, sem marcar como
 * pago. Le direto a colecao `transacoes` (mesma que o desktop usa em
 * ContasPagar.tsx), filtrando por `tipo: 'saida'`. Sem escrita nenhuma no
 * Firestore, de proposito: mexer com saldo de banco/quitar conta fica pro
 * desktop por enquanto.
 *
 * Agrupada por fornecedor (15/10/2026): uma linha por nome, com quantas notas
 * e o total; ao tocar, as notas abrem embaixo (ContasAgrupadas.tsx).
 */

type Conta = ContaParaAgrupar;

const VendedorContasPagar: React.FC = () => {
  const { tenantId, userPermissions } = useAuth();
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);

  const podeVer = userPermissions.includes('financeiro.pagar');

  useEffect(() => {
    if (!tenantId || !podeVer) return;
    let cancelado = false;
    setCarregando(true);

    getDocs(query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'saida'),
      // So' o que esta em aberto: o banco devolve os pendentes em vez do
      // historico inteiro (antes um titulo pago aparecia como pendente,
      // porque o filtro procurava o status 'Recebida', que nao existe).
      where('status', '==', 'Pendente'),
    )).then((snap) => {
      if (cancelado) return;
      const lista: Conta[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            descricao: data.descricao || '',
            vencimento: transactionDueDateInput(data),
            valor: Number(data.valor || 0),
            nome: data.fornecedorNome || '',
          };
        })
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      setContas(lista);
      setCarregando(false);
    }).catch(() => setCarregando(false));

    return () => { cancelado = true; };
  }, [tenantId, podeVer]);

  if (!podeVer) {
    return <Navigate to="/vendedor" replace />;
  }

  const hoje = getDateInputInTimeZone();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Contas a Pagar" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <ContasAgrupadas contas={contas} hoje={hoje} carregando={carregando} rotuloTotal="Total pendente" rotuloNome="fornecedor" />
      </div>
    </div>
  );
};

export default VendedorContasPagar;
