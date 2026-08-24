import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Proximo codigo de cliente: maior codigo numerico ja usado + 1 (nao a
 * contagem de clientes -- contagem quebra a sequencia apos qualquer
 * exclusao, reusando um codigo ja existente). orderBy no Firestore nao
 * serve aqui porque 'codigo' e string sem padding fixo (ordenacao lexica,
 * nao numerica), entao o maximo e calculado no cliente.
 * Compartilhado por ClienteForm.tsx e o popup de cadastro rapido usado nas
 * telas de venda.
 */
export const getProximoCodigoCliente = async (tenantId: string): Promise<string> => {
  const q = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  const maxCodigo = snap.docs.reduce((max, docSnap) => {
    const parsed = Number.parseInt(String(docSnap.data().codigo || '').replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return String(maxCodigo + 1);
};
