import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import {
  applyStockFieldDeltas,
  formatSequenceValue,
  getCurrentMaxSequence,
  getNextTenantSequenceValue,
  writeTenantSequenceValue,
} from '../utils/firestoreAtomic';
import { computeReservationDelta } from '../utils/estoqueReservaDomain';
import { toStockAdjustmentItems } from '../utils/embalagemDomain';
import { buildDocumentMetadata } from '../utils/documentMetadata';
import { toCents } from '../utils/financeDomain';
import { STATUS_PRE_VENDA, type OrigemPedido } from '../utils/preVendaDomain';
import { getDateInputInTimeZone } from '../utils/dateTime';

/**
 * Criacao de Pedido/Orcamento pelo aplicativo do vendedor externo.
 *
 * Deliberadamente NAO reaproveita a funcao de salvar de PedidoVendaForm.tsx/
 * OrcamentoForm.tsx (4000 e 1200 linhas, com parcelamento, limite de
 * credito, saldo de banco, comissao, conferencia de mercadoria...) -- extrair
 * aquilo com seguranca exigiria revisar cada uma dessas regras financeiras
 * de perto, risco desproporcional pro que o vendedor externo precisa fazer.
 *
 * Em vez disso, usa os MESMOS blocos atomicos de baixo nivel que aquelas
 * telas usam (numeracao de sequencia, reserva de estoque, metadados de
 * auditoria — tudo de firestoreAtomic.ts/embalagemDomain.ts/
 * documentMetadata.ts), montando um documento deliberadamente mais simples:
 *
 *   Pedido do vendedor externo = SEMPRE Pre-venda (reserva estoque, sem
 *   pagamento nem comissao ainda -- a loja finaliza depois, na tela normal
 *   de Pedido de Venda). Decisao do dono do produto: a loja precisa
 *   conferir/ajustar o que faltar no estoque antes de fechar a venda.
 *
 *   Orcamento do vendedor externo = mesmo formato de um orcamento comum,
 *   sem os campos de veiculo (proposito de oficina) que o vendedor externo
 *   nao usa.
 */

export interface ItemVendaExterna {
  id: string;
  nome: string;
  codigo?: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  subtotal: number;
  unidadeMedidaSigla: string;
  unidadeMedidaFracionado: boolean;
  unidadeMedidaCasasDecimais: number;
}

const semDesconto = () => ({
  tipo: 'valor' as const,
  valorInformado: 0,
  valorAplicadoCentavos: 0,
  excedeuLimite: false,
});

export interface CriarPreVendaExternaParams {
  tenantId: string;
  usuarioId: string;
  vendedorId: string;
  vendedorNome: string;
  clienteId: string;
  clienteNome: string;
  itens: ItemVendaExterna[];
  permitirVendaSemEstoque: boolean;
}

export const criarPreVendaExterna = async (
  params: CriarPreVendaExternaParams,
): Promise<{ id: string; numeroPedido: string }> => {
  const { tenantId, usuarioId, vendedorId, vendedorNome, clienteId, clienteNome, itens, permitirVendaSemEstoque } = params;

  const valorTotalItens = itens.reduce((soma, item) => soma + item.subtotal, 0);
  const currentMaxPedido = await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);

  let novoId = '';
  let numeroGravado = '';

  await runTransaction(db, async (transaction) => {
    const nextPedido = await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
    numeroGravado = formatSequenceValue(nextPedido, 4);

    const novoRef = doc(collection(db, 'pedidos_venda'));
    novoId = novoRef.id;

    const reservaNova = toStockAdjustmentItems(itens);
    const deltasReserva = computeReservationDelta([], reservaNova);
    if (deltasReserva.length > 0) {
      await applyStockFieldDeltas(transaction, db, deltasReserva, permitirVendaSemEstoque);
    }

    writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);

    transaction.set(novoRef, {
      numeroPedido: numeroGravado,
      clienteId,
      clienteNome,
      itens,
      valorTotalItens,
      valorTotalItensCentavos: toCents(valorTotalItens),
      valorTotalDescontos: 0,
      valorTotalDescontosCentavos: 0,
      descontoGeral: semDesconto(),
      frete: 0,
      encargos: 0,
      valorTotal: valorTotalItens,
      valorTotalCentavos: toCents(valorTotalItens),
      dataVenda: getDateInputInTimeZone(),
      status: STATUS_PRE_VENDA,
      // 'balcao', nao um valor novo: quem cria e' sempre uma pessoa com
      // permissao propria (vendas.pre_venda_criar), igual ao balcao -- a
      // origem 'agente' existe pra distinguir integracao automatizada
      // (bot do WhatsApp), que nao e' o caso aqui. Ver preVendaDomain.ts.
      origem: 'balcao' as OrigemPedido,
      estoqueReservado: itens.length > 0,
      tenantId,
      usuarioResponsavelId: usuarioId,
      vendedorId,
      vendedorNome,
      createdAt: serverTimestamp(),
      ...buildDocumentMetadata(usuarioId, serverTimestamp()),
    });
  });

  return { id: novoId, numeroPedido: numeroGravado };
};

export interface CriarOrcamentoExternoParams {
  tenantId: string;
  usuarioId: string;
  clienteId: string;
  clienteNome: string;
  clienteTelefone: string;
  itens: ItemVendaExterna[];
}

export const criarOrcamentoExterno = async (
  params: CriarOrcamentoExternoParams,
): Promise<{ id: string; numeroOrcamento: string }> => {
  const { tenantId, usuarioId, clienteId, clienteNome, clienteTelefone, itens } = params;

  const valorTotalItens = itens.reduce((soma, item) => soma + item.subtotal, 0);
  const currentMaxOrcamento = await getCurrentMaxSequence(db, 'orcamentos', tenantId, 'numeroOrcamento').catch(() => 0);

  let novoId = '';
  let numeroGravado = '';

  await runTransaction(db, async (transaction) => {
    const nextOrcamento = await getNextTenantSequenceValue(transaction, db, tenantId, 'orcamentos', currentMaxOrcamento);
    numeroGravado = formatSequenceValue(nextOrcamento, 4);

    const novoRef = doc(collection(db, 'orcamentos'));
    novoId = novoRef.id;

    transaction.set(novoRef, {
      numeroOrcamento: numeroGravado,
      clienteId,
      clienteNome,
      clienteTelefone,
      // Campos de veiculo (proposito de oficina/OS) ficam vazios -- o
      // vendedor externo nao os usa, e a tela de Orcamentos ja trata esses
      // campos como opcionais.
      placa: '',
      modelo: '',
      ano: '',
      cor: '',
      observacoes: '',
      status: 'Pendente',
      validadeDias: '15',
      servicos: [],
      pecas: itens,
      valorTotal: valorTotalItens,
      desconto: semDesconto(),
      tenantId,
      createdAt: serverTimestamp(),
      ...buildDocumentMetadata(usuarioId, serverTimestamp()),
    });
  });

  return { id: novoId, numeroOrcamento: numeroGravado };
};
