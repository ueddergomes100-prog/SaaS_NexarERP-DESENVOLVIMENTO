import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { toCents, transactionMovesPhysicalCash } from '../../utils/financeDomain';
import {
  htmlDoRelatorioDoCaixa,
  montarRelatorioDoCaixa,
  type DadosDoRelatorioDoCaixa,
  type LancamentoDoCaixa,
  type SangriaDoCaixa,
} from '../../utils/relatorioDoCaixaBobinaDomain';
import type { LarguraDaBobina } from '../../utils/cupomDoCaixaDomain';
import { imprimirNaBobina } from './cupomDoCaixa';

/**
 * Relatorio do caixa na bobina (26/11/2026): le o que passou pelo caixa e
 * imprime. Regra e papel: src/utils/relatorioDoCaixaBobinaDomain.ts.
 */

const paraData = (valor: unknown): Date | null => {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  const comToDate = valor as { toDate?: () => Date };
  if (typeof comToDate.toDate === 'function') return comToDate.toDate();
  const data = new Date(String(valor));
  return Number.isNaN(data.getTime()) ? null : data;
};

/** Titulo do Firestore no formato do relatorio. */
const lancamentoDoDocumento = (id: string, t: Record<string, any>, recebimento: boolean): LancamentoDoCaixa => {
  const centavos = t.valorCentavos !== null && t.valorCentavos !== undefined && Number.isFinite(Number(t.valorCentavos))
    ? Number(t.valorCentavos)
    : toCents(Number(t.valor || 0));
  return {
    id,
    pedidoId: recebimento ? '' : String(t.pedidoId || t.sourceId || ''),
    paymentIndex: Number.isFinite(Number(t.paymentIndex)) && t.paymentIndex !== null && t.paymentIndex !== undefined ? Number(t.paymentIndex) : null,
    descricao: String(t.descricao || ''),
    clienteNome: String(t.clienteNome || ''),
    formaPagamento: String(t.formaPagamento || ''),
    valorCentavos: centavos,
    criadoEm: paraData(recebimento ? (t.recebidoEm || t.updatedAt) : t.createdAt),
    // Notinha estornada depois volta a Pendente: sai das contas do caixa.
    cancelado: t.estornada === true || t.status === 'Cancelada' || (recebimento && t.status !== 'Paga'),
    dinheiro: transactionMovesPhysicalCash(t),
    ...(recebimento ? { recebimento: true } : {}),
  };
};

/** Titulos das vendas deste caixa (as mesmas que o fechamento soma) e as notinhas recebidas nele (28/11/2026). */
export const lerLancamentosDoCaixa = async (tenantId: string, sessaoId: string): Promise<LancamentoDoCaixa[]> => {
  const [vendas, recebidas] = await Promise.all([
    getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('pdvSessionId', '==', sessaoId))),
    getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('recebidoNoCaixaId', '==', sessaoId))),
  ]);
  return [
    ...vendas.docs.filter((d) => d.data().tipo !== 'saida').map((d) => lancamentoDoDocumento(d.id, d.data(), false)),
    ...recebidas.docs.filter((d) => d.data().tipo !== 'saida').map((d) => lancamentoDoDocumento(d.id, d.data(), true)),
  ];
};

/** Sangrias como o PDV grava (array no documento do caixa). */
export const sangriasDoCaixa = (brutas: unknown): SangriaDoCaixa[] => (
  Array.isArray(brutas) ? brutas : []
).map((s: Record<string, unknown>) => ({
  valorCentavos: Number(s?.valorCentavos || 0),
  motivo: String(s?.motivo || ''),
  registradoEm: paraData(s?.registradoEm),
  registradoPorNome: String(s?.registradoPorNome || ''),
  bancoNome: String(s?.bancoNome || ''),
}));

/** Nome e CNPJ do cabecalho (o mesmo do cupom). */
export const empresaDoRelatorio = (config: Record<string, unknown> | null): { nome: string; cnpj: string } => ({
  nome: String(config?.nomeFantasia || config?.nomeOficina || config?.razaoSocial || '').trim(),
  cnpj: String(config?.cnpj || '').trim(),
});

export const imprimirRelatorioDoCaixa = async (
  dados: Omit<DadosDoRelatorioDoCaixa, 'lancamentos'> & { tenantId: string; sessaoId: string; lancamentos?: LancamentoDoCaixa[] },
  largura: LarguraDaBobina = 80,
): Promise<void> => {
  const { tenantId, sessaoId, lancamentos, ...resto } = dados;
  const lidos = lancamentos || await lerLancamentosDoCaixa(tenantId, sessaoId);
  await imprimirNaBobina(htmlDoRelatorioDoCaixa(montarRelatorioDoCaixa({ ...resto, lancamentos: lidos }), largura));
};
