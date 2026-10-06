import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { transactionNetCents } from './financeDomain';
import { consultarSaldoDoClienteNoGrupo } from '../services/filialService';

/** Mesmas formas de pagamento excluidas do saldo em aberto em ContasReceber.tsx
 * (cartao fica na tela Banco, nao e' "credito concedido" ao cliente). */
const FORMAS_EXCLUIDAS_SALDO_ABERTO = ['Cartão de Crédito', 'Cartão de Débito'];

/**
 * Soma o saldo em aberto (transacoes 'Pendente', excluindo cartao) de UM
 * cliente especifico, em centavos. Mesma regra de agrupamento usada em
 * ContasReceber.tsx (linhas 533-568), mas com query direta no Firestore
 * (nao carrega a colecao inteira de `transacoes` do tenant) -- usado na
 * checagem de limite de credito ao finalizar uma venda a prazo.
 */
export const calcularSaldoEmAbertoClienteCents = async (tenantId: string, clienteId: string, noGrupo = false): Promise<number> => {
  // Filiais (2026-10-06): o limite de credito e' do GRUPO -- o servidor soma o
  // que o cliente deve em todas as filiais (a tela so' enxerga a dela).
  if (noGrupo) return (await consultarSaldoDoClienteNoGrupo(clienteId)).totalCentavos;
  const q = query(
    collection(db, 'transacoes'),
    where('tenantId', '==', tenantId),
    where('clienteId', '==', clienteId),
    where('status', '==', 'Pendente'),
  );
  const snap = await getDocs(q);
  return snap.docs.reduce((total, docSnap) => {
    const data = docSnap.data();
    if (FORMAS_EXCLUIDAS_SALDO_ABERTO.includes(data.formaPagamento)) return total;
    return total + transactionNetCents(data);
  }, 0);
};
