import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { bloqueioPorBalanco } from '../utils/balancoDomain';

/**
 * Trava do balanco (21/10/2026) no caminho que grava pela tela (empresa sem
 * "Venda pelo servidor"): le a configuracao NA HORA de finalizar -- o balanco
 * pode ter sido aberto depois que a tela carregou. Com a venda pelo servidor,
 * o proprio servidor tambem recusa. Sem conseguir ler, nao trava (a venda nao
 * pode parar por falta de conexao com a configuracao).
 */
export const mensagemDaTravaDoBalanco = async (tenantId: string, acao: string): Promise<string | null> => {
  try {
    const snap = await getDoc(doc(db, 'configuracoes', tenantId));
    return bloqueioPorBalanco(snap.exists() ? snap.data().balancoEmAndamento : null, acao);
  } catch {
    return null;
  }
};
