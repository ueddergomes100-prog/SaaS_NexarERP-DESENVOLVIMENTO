import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import {
  applyStockFieldDeltas,
  formatSequenceValue,
  getCurrentMaxSequence,
  getNextTenantSequenceValue,
  writeTenantSequenceValue,
} from '../utils/firestoreAtomic';
import { computeReservationDelta, computeReservationRelease } from '../utils/estoqueReservaDomain';
import { toStockAdjustmentItems } from '../utils/embalagemDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { toCents } from '../utils/financeDomain';
import { isPedidoAberto, STATUS_CANCELADA, STATUS_PRE_VENDA, type OrigemPedido } from '../utils/preVendaDomain';
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
  /** Recado pra loja; vai no campo `observacao` do pedido (o mesmo da retaguarda). */
  observacao?: string;
  /** O pedido sai COM (true) ou SEM (false) nota fiscal, como o vendedor marcou. Ausente = nao informado. */
  comNotaFiscal?: boolean;
  /** Id fixo do documento (o id do rascunho). Com ele, reenviar o mesmo
   *  rascunho depois de uma queda de conexao NAO cria um segundo pedido: se
   *  o primeiro envio chegou a gravar, a transacao so' devolve o que ja
   *  existe. Sem ele, gera id novo como antes. */
  idDocumento?: string;
  /** Config da empresa (Modulo 12). Quando ligada, a pre-venda nasce
   *  'aguardando' conferencia e entra na Fila de Expedicao -- mesmo
   *  comportamento que a pre-venda gravada em PedidoVendaForm.tsx ja tem;
   *  antes desta pre-venda (app do vendedor externo) nunca ganhava o campo,
   *  entao nunca aparecia na fila. */
  conferenciaMercadoriaAtiva?: boolean;
}

export const criarPreVendaExterna = async (
  params: CriarPreVendaExternaParams,
): Promise<{ id: string; numeroPedido: string }> => {
  const { tenantId, usuarioId, vendedorId, vendedorNome, clienteId, clienteNome, itens, permitirVendaSemEstoque, idDocumento, observacao, comNotaFiscal, conferenciaMercadoriaAtiva } = params;

  const valorTotalItens = itens.reduce((soma, item) => soma + item.subtotal, 0);
  const currentMaxPedido = await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);

  let novoId = '';
  let numeroGravado = '';

  await runTransaction(db, async (transaction) => {
    const novoRef = idDocumento ? doc(db, 'pedidos_venda', idDocumento) : doc(collection(db, 'pedidos_venda'));
    novoId = novoRef.id;

    if (idDocumento) {
      const existente = await transaction.get(novoRef);
      if (existente.exists()) {
        numeroGravado = existente.data().numeroPedido || '';
        return;
      }
    }

    const nextPedido = await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
    numeroGravado = formatSequenceValue(nextPedido, 4);

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
      // Mesma regra de PedidoVendaForm.tsx: com o modulo de conferencia
      // ligado, a pre-venda ja nasce 'aguardando' e cai direto na Fila de
      // Expedicao -- sem isso a pre-venda do app nunca era vista pela loja.
      ...(conferenciaMercadoriaAtiva ? { statusConferencia: 'aguardando' as const } : {}),
      observacao: (observacao || '').trim(),
      // Marca do vendedor: a loja ve na pre-venda se o pedido leva nota fiscal. So' grava quando
      // foi informado (nunca undefined no Firestore) -- venda de balcao nao tem o campo.
      ...(typeof comNotaFiscal === 'boolean' ? { comNotaFiscal } : {}),
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
  /** Mesmo papel do `idDocumento` de criarPreVendaExterna. */
  idDocumento?: string;
}

export const criarOrcamentoExterno = async (
  params: CriarOrcamentoExternoParams,
): Promise<{ id: string; numeroOrcamento: string }> => {
  const { tenantId, usuarioId, clienteId, clienteNome, clienteTelefone, itens, idDocumento } = params;

  const valorTotalItens = itens.reduce((soma, item) => soma + item.subtotal, 0);
  const currentMaxOrcamento = await getCurrentMaxSequence(db, 'orcamentos', tenantId, 'numeroOrcamento').catch(() => 0);

  let novoId = '';
  let numeroGravado = '';

  await runTransaction(db, async (transaction) => {
    const novoRef = idDocumento ? doc(db, 'orcamentos', idDocumento) : doc(collection(db, 'orcamentos'));
    novoId = novoRef.id;

    if (idDocumento) {
      const existente = await transaction.get(novoRef);
      if (existente.exists()) {
        numeroGravado = existente.data().numeroOrcamento || '';
        return;
      }
    }

    const nextOrcamento = await getNextTenantSequenceValue(transaction, db, tenantId, 'orcamentos', currentMaxOrcamento);
    numeroGravado = formatSequenceValue(nextOrcamento, 4);

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

export interface CancelarPedidoExternoParams {
  usuarioId: string;
  pedidoId: string;
  /** O app so' cancela pedido do proprio vendedor. */
  vendedorId: string;
}

/**
 * Cancela uma pre-venda do vendedor externo: libera a reserva de estoque e
 * marca Cancelada. Mesma transacao de `handleCancelarPreVenda`
 * (PedidoVendaForm.tsx), reescrita com as mesmas pecas atomicas em vez de
 * chamar o formulario do desktop. Nao mexe em financeiro -- pre-venda nunca
 * gerou nenhum.
 */
export const cancelarPedidoExterno = async (params: CancelarPedidoExternoParams): Promise<{ numeroPedido: string }> => {
  const { usuarioId, pedidoId, vendedorId } = params;
  let numeroPedido = '';

  await runTransaction(db, async (transaction) => {
    const ref = doc(db, 'pedidos_venda', pedidoId);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('Este pedido não existe mais.');
    const data = snap.data();
    numeroPedido = data.numeroPedido || '';

    if (data.vendedorId !== vendedorId) {
      throw new Error('Este pedido é de outro vendedor e não pode ser cancelado por aqui.');
    }
    if (!isPedidoAberto(data.status)) {
      throw new Error(`Este pedido está "${data.status}" e não pode mais ser cancelado pelo aplicativo. Fale com a loja.`);
    }

    if (data.estoqueReservado === true) {
      await applyStockFieldDeltas(
        transaction,
        db,
        computeReservationRelease(toStockAdjustmentItems(data.itens || [])),
        true,
      );
    }

    transaction.update(ref, {
      status: STATUS_CANCELADA,
      estoqueReservado: false,
      ...buildDocumentUpdateMetadata(usuarioId, serverTimestamp(), 'Pré-venda cancelada pelo aplicativo do vendedor'),
    });
  });

  return { numeroPedido };
};
