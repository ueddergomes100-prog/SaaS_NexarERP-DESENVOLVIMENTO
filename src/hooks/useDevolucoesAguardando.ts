import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { STATUS_DEVOLUCAO } from '../utils/devolucaoVendaDomain';

/**
 * Quantas devolucoes pedidas pelo app Vendas estao "Aguardando confirmacao"
 * na filial (24/11/2026). Consulta enxuta: so' as aguardando (igualdades, sem
 * indice composto), e so' quando `ativo` (quem enxerga o menu de Devolucoes).
 */
export const useDevolucoesAguardando = (ativo: boolean): number => {
  const { tenantId } = useAuth();
  const [quantidade, setQuantidade] = useState(0);
  useEffect(() => {
    if (!ativo || !tenantId) {
      setQuantidade(0);
      return undefined;
    }
    const q = query(
      collection(db, 'devolucoes_venda'),
      where('tenantId', '==', tenantId),
      where('status', '==', STATUS_DEVOLUCAO.aguardando),
    );
    return onSnapshot(q, (snap) => setQuantidade(snap.size), (erro) => {
      console.error('Menu (devoluções aguardando):', erro);
      setQuantidade(0);
    });
  }, [ativo, tenantId]);
  return quantidade;
};
