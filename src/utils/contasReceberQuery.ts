import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { transactionNetCents } from './financeDomain';
import { consultarSaldoDoClienteNoGrupo } from '../services/filialService';
import { diasDeAtraso, maiorAtrasoEmDias } from './parametrosVendaDomain';
import { getDateInputInTimeZone } from './dateTime';

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
export const calcularSaldoEmAbertoClienteCents = async (tenantId: string, clienteId: string, noGrupo = false): Promise<number> => (
  (await situacaoEmAbertoDoCliente(tenantId, clienteId, noGrupo)).saldoCentavos
);

export interface SituacaoEmAbertoDoCliente {
  saldoCentavos: number;
  /** Maior atraso (dias) entre os titulos pendentes -- parametrosVendaDomain.bloqueioPorAtraso. */
  maiorAtrasoDias: number;
  /** Quantas contas em aberto e quantas vencidas (28/11/2026, aviso na venda do app). Com filiais, so' o total vem do servidor: 0 aqui. */
  quantidade: number;
  vencidas: number;
}

/**
 * Saldo em aberto E maior atraso do cliente, numa consulta so' (fase A dos
 * parametros de venda, 2026-10-07). Com filiais, o servidor olha o grupo.
 */
export const situacaoEmAbertoDoCliente = async (tenantId: string, clienteId: string, noGrupo = false): Promise<SituacaoEmAbertoDoCliente> => {
  // Filiais (2026-10-06): o limite de credito e' do GRUPO -- o servidor soma o
  // que o cliente deve em todas as filiais (a tela so' enxerga a dela).
  if (noGrupo) {
    const r = await consultarSaldoDoClienteNoGrupo(clienteId);
    return { saldoCentavos: r.totalCentavos, maiorAtrasoDias: Number(r.maiorAtrasoDias) || 0, quantidade: 0, vencidas: 0 };
  }
  const q = query(
    collection(db, 'transacoes'),
    where('tenantId', '==', tenantId),
    where('clienteId', '==', clienteId),
    where('status', '==', 'Pendente'),
  );
  const snap = await getDocs(q);
  const titulos = snap.docs.map((docSnap) => docSnap.data());
  const doCliente = titulos.filter((data) => !FORMAS_EXCLUIDAS_SALDO_ABERTO.includes(data.formaPagamento));
  const saldoCentavos = doCliente.reduce((total, data) => total + transactionNetCents(data), 0);
  const hoje = getDateInputInTimeZone();
  return {
    saldoCentavos,
    maiorAtrasoDias: maiorAtrasoEmDias(titulos, hoje),
    quantidade: doCliente.length,
    vencidas: doCliente.filter((data) => diasDeAtraso(data.dataVencimento, hoje) > 0).length,
  };
};
