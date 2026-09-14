import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Proximo codigo de fornecedor: maior codigo numerico ja usado + 1 (nao a
 * contagem de fornecedores -- contagem quebra a sequencia quando existe
 * registro sem codigo ou apos qualquer exclusao, reusando um codigo ja
 * existente ou deixando buraco). Mesmo padrao de getProximoCodigoCliente
 * (clienteCodigo.ts) -- achado o bug real ao importar fornecedores da Sol
 * Natus: 3 fornecedores antigos sem codigo faziam getCountFromServer+1
 * comecar do 4 em vez de preencher 1, 2, 3.
 */
export const getProximoCodigoFornecedor = async (tenantId: string): Promise<string> => {
  const q = query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  const maxCodigo = snap.docs.reduce((max, docSnap) => {
    const parsed = Number.parseInt(String(docSnap.data().codigo || '').replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return String(maxCodigo + 1);
};
