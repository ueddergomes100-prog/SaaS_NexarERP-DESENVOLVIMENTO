import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { spedyService, type SpedyInvoice } from './spedyService';
import { isExportCfop, resolveInvoiceDestination, resolveInvoiceUnitFields } from '../utils/fiscalDomain';

/**
 * Emite NFC-e pra um pedido JA SALVO -- usado pelo app do vendedor externo
 * (VendedorMeusPedidos.tsx), pra emitir a nota de um pedido que o proprio
 * vendedor ja fechou, sem precisar do desktop.
 *
 * O payload montado aqui e' equivalente ao que `PedidoVendaForm.tsx` ja
 * monta hoje em DOIS pontos independentes (ao finalizar a venda, e ao
 * reemitir de dentro do pedido salvo) -- mesmos campos, mesma regra de
 * NCM/CFOP/CSOSN por produto. Foi ESCRITO DE NOVO aqui, de proposito, em vez
 * de refatorar qualquer um dos dois pontos do desktop pra compartilhar
 * codigo: sao dois fluxos fiscais reais, ja em producao, e mexer neles so
 * pra ganhar reuso seria risco desnecessario pra entregar um terceiro
 * consumidor. O que e' de fato compartilhado (e seguro compartilhar) sao as
 * pecas puras -- `resolveInvoiceUnitFields`/`resolveInvoiceDestination`/
 * `isExportCfop` (fiscalDomain.ts) e o cliente da API (`spedyService`).
 */

export class NfceEmissaoError extends Error {}

interface ItemPedidoParaEmissao {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  unidadeMedidaSigla?: string;
  fatorConversao?: number;
}

interface PagamentoPedidoParaEmissao {
  formaPagamento: string;
  valor: number;
}

export interface PedidoParaEmissao {
  id: string;
  tenantId: string;
  clienteNome: string;
  itens: ItemPedidoParaEmissao[];
  pagamentos: PagamentoPedidoParaEmissao[];
  valorTotal: number;
  valorTotalItens: number;
}

const toSpedyPaymentMethod = (method: string) => {
  if (method === 'Pix') return 'pix';
  if (method.includes('Crédito')) return 'creditCard';
  if (method.includes('Débito')) return 'debitCard';
  if (method === 'Dinheiro') return 'money';
  return 'other';
};

const buildReceiver = async (tenantId: string, clienteNome: string) => {
  const isConsumidorFinal = clienteNome.toUpperCase() === 'CONSUMIDOR FINAL';

  if (!isConsumidorFinal) {
    const snapClient = await getDocs(query(
      collection(db, 'clientes'),
      where('tenantId', '==', tenantId),
      where('nome', '==', clienteNome),
    ));
    if (!snapClient.empty) {
      const cData = snapClient.docs[0].data();
      const cDoc = (cData.documento || '').replace(/\D/g, '');
      const cCep = (cData.cep || '01001-000').replace(/\D/g, '');
      if (cDoc) {
        return {
          name: clienteNome,
          federalTaxNumber: cDoc,
          email: cData.email || undefined,
          address: {
            street: cData.endereco || 'Rua Principal',
            number: cData.numero || '123',
            district: cData.bairro || 'Centro',
            postalCode: cCep,
            city: {
              code: cData.codigoIbge || '3550308',
              name: cData.cidade || 'São Paulo',
              state: cData.estado || 'SP',
            },
          },
        };
      }
    }
  }

  return {
    name: 'Consumidor Final',
    federalTaxNumber: '12345678901',
    address: {
      street: 'Rua Principal',
      number: '123',
      district: 'Centro',
      postalCode: '01001000',
      city: { code: '3550308', name: 'São Paulo', state: 'SP' },
    },
  };
};

/** Emite a NFC-e e espera (com polling curto) a autorizacao da SEFAZ,
 *  igual o desktop ja faz -- devolve o status final que a tela decide como
 *  mostrar. */
/** Resultado da emissao: a nota da Spedy e os itens EXATAMENTE como foram enviados (quem grava a nota
 *  local guarda `itensFiscais`, necessario pra devolver item por item depois). */
export interface NfceEmitida {
  nota: SpedyInvoice;
  itensFiscais: Record<string, unknown>[];
}

export const emitirNfceDoPedido = async (pedido: PedidoParaEmissao): Promise<NfceEmitida> => {
  const runtimeConfig = await spedyService.getRuntimeConfig();
  if (!runtimeConfig.spedyEnabled || !runtimeConfig.spedyApiKeyConfigured) {
    throw new NfceEmissaoError('A integração com a Spedy não está ativa ou configurada. Fale com o administrador do sistema.');
  }

  const apiKey = '__backend_proxy__';
  const env = runtimeConfig.spedyEnvironment;

  const payloadItems: Record<string, unknown>[] = [];
  for (const item of pedido.itens) {
    let ncm = '87082999';
    let cfop = 5102;
    let csosn = 400;
    let origem = 0;
    let pesoLiquidoUnitarioKg = 0;

    if (item.id !== 'avulso') {
      const pSnap = await getDoc(doc(db, 'estoque', item.id));
      if (pSnap.exists()) {
        const pData = pSnap.data();
        ncm = pData.ncm || ncm;
        cfop = Number(pData.cfop) || cfop;
        csosn = Number(pData.csosn) || csosn;
        origem = Number(pData.origem) || origem;
        pesoLiquidoUnitarioKg = Number(pData.pesoLiquidoUnitarioKg) || 0;
      }
    }

    const unitFields = resolveInvoiceUnitFields({
      cfop,
      unidadeComercial: item.unidadeMedidaSigla || 'UN',
      quantidadeComercial: item.quantidade,
      valorUnitarioComercial: item.precoUnitario,
      pesoLiquidoUnitarioKg: pesoLiquidoUnitarioKg * (item.fatorConversao ?? 1),
    });
    if (!unitFields.ok) {
      throw new NfceEmissaoError(`${item.nome}: ${unitFields.error}`);
    }

    payloadItems.push({
      code: item.id === 'avulso' ? 'AVULSO' : item.id,
      description: item.nome,
      ncm,
      cfop,
      ...unitFields.fields!,
      totalAmount: item.precoUnitario * item.quantidade,
      makeupTotal: true,
      taxes: {
        icms: { origin: origem, csosn },
        pis: { cst: 7 },
        cofins: { cst: 7 },
      },
    });
  }

  const receiver = await buildReceiver(pedido.tenantId, pedido.clienteNome);

  const spedyPayload = {
    isFinalCustomer: true,
    operationType: 'outgoing',
    destination: resolveInvoiceDestination((payloadItems.find((pi) => isExportCfop(pi.cfop as number)) as { cfop?: number } | undefined)?.cfop, 'internal'),
    presenceType: 'presence',
    operationNature: 'Venda de Mercadoria',
    sendEmailToCustomer: false,
    integrationId: pedido.id,
    receiver,
    items: payloadItems,
    payments: pedido.pagamentos.map((payment) => ({
      method: toSpedyPaymentMethod(payment.formaPagamento),
      amount: payment.valor,
    })),
    total: {
      invoiceAmount: pedido.valorTotal,
      productAmount: pedido.valorTotalItens,
    },
  };

  const spedyNote = await spedyService.emitConsumerInvoice(apiKey, env, spedyPayload);

  let currentStatus = spedyNote.status;
  let finalNote = spedyNote;
  let attempts = 0;
  while (['enqueued', 'processing', 'created'].includes(currentStatus) && attempts < 10) {
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    try {
      finalNote = await spedyService.getConsumerInvoice(apiKey, env, spedyNote.id);
      currentStatus = finalNote.status;
    } catch {
      // Mantem o ultimo status conhecido -- o polling e' so UX, o cupom ja foi enviado.
    }
    attempts++;
  }

  return { nota: finalNote, itensFiscais: payloadItems };
};
