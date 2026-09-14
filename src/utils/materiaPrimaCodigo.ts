import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Proximo codigo de materia-prima: maior codigo numerico ja usado + 1 (nao
 * a contagem de registros -- contagem quebra a sequencia quando existe
 * registro sem codigo ou apos qualquer exclusao). Mesmo padrao de
 * getProximoCodigoCliente/getProximoCodigoFornecedor.
 */
export const getProximoCodigoMateriaPrima = async (tenantId: string): Promise<string> => {
  const q = query(collection(db, 'materias_primas'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  const maxCodigo = snap.docs.reduce((max, docSnap) => {
    const parsed = Number.parseInt(String(docSnap.data().codigo || '').replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return String(maxCodigo + 1);
};
