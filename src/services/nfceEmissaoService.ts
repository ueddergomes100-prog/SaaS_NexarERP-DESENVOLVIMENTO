import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { spedyService, type SpedyInvoice } from './spedyService';
import { DEFAULT_REGIME_TRIBUTARIO, usesCsosn, type RegimeTributario } from '../utils/fiscalDomain';
import {
  TEXTO_OPTANTE_SIMPLES_NACIONAL, montarItemNotaFiscal, montarPagamentosNota, produtoFiscalDoCadastro,
  somarTributos, textoTributosAproximados, type ProdutoFiscal, type ValoresTributosItem,
} from '../utils/notaFiscalItemDomain';
import { ratearValorPorPesos } from '../utils/notaAvulsaDomain';

/**
 * NFC-e (cupom fiscal) de um pedido -- montagem UNICA, usada pelos tres
 * pontos que emitem cupom: fim da venda e "Emitir cupom" no pedido
 * (PedidoVendaForm.tsx) e o app do vendedor (VendedorMeusPedidos.tsx).
 *
 * Ate 2026-09-30 cada ponto tinha a sua copia, e as tres mandavam:
 * NCM 87082999 / CSOSN 400 inventados quando o produto nao tinha, CSOSN
 * mesmo com a empresa no regime normal, PIS/COFINS 07 fixo, unidade UN,
 * sem codigo de barras, sem tributos aproximados (Lei 12.741, obrigatoria na
 * venda ao consumidor), o id interno do banco como "codigo do produto" e --
 * sem cliente identificado -- o CPF falso 12345678901 com endereco de Sao
 * Paulo. Agora o item sai de notaFiscalItemDomain (mesma regra da NF-e) e,
 * sem cliente identificado, a nota vai sem destinatario (a NFC-e permite).
 */

export class NfceEmissaoError extends Error {}

export interface ItemPedidoParaEmissao {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  unidadeMedidaSigla?: string;
  fatorConversao?: number;
  embalagemId?: string;
}

interface PagamentoPedidoParaEmissao {
  formaPagamento: string;
  valor: number;
}

export interface PedidoParaEmissao {
  id: string;
  tenantId: string;
  clienteNome: string;
  clienteId?: string | null;
  itens: ItemPedidoParaEmissao[];
  pagamentos: PagamentoPedidoParaEmissao[];
  valorTotal: number;
  valorTotalItens: number;
}

/** Destinatario da NFC-e: so' cliente identificado com CPF/CNPJ; endereco so' se estiver completo. */
const montarDestinatario = async (tenantId: string, clienteNome: string, clienteId?: string | null) => {
  if (!clienteNome || clienteNome.trim().toUpperCase() === 'CONSUMIDOR FINAL') return null;
  let cData: Record<string, unknown> | null = null;
  if (clienteId) {
    const snap = await getDoc(doc(db, 'clientes', clienteId));
    if (snap.exists() && snap.data().tenantId === tenantId) cData = snap.data();
  }
  if (!cData) {
    const snapClient = await getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', clienteNome)));
    if (!snapClient.empty) cData = snapClient.docs[0].data();
  }
  const documento = String(cData?.documento || '').replace(/\D/g, '');
  if (!cData || !(documento.length === 11 || documento.length === 14)) return null;
  const s = (campo: string) => String(cData?.[campo] || '').trim();
  const enderecoCompleto = s('endereco') && s('numero') && s('bairro') && s('cep') && s('cidade') && s('estado') && s('codigoIbge');
  return {
    name: clienteNome,
    federalTaxNumber: documento,
    ...(s('email') ? { email: s('email') } : {}),
    ...(enderecoCompleto ? {
      address: {
        street: s('endereco'),
        number: s('numero'),
        district: s('bairro'),
        postalCode: s('cep').replace(/\D/g, ''),
        city: { code: s('codigoIbge'), name: s('cidade'), state: s('estado') },
      },
    } : {}),
  };
};

/**
 * Monta o corpo da NFC-e. Cadastro fiscal incompleto (sem NCM, CSOSN/CST
 * invalido para o regime...) lanca NfceEmissaoError com o nome do produto e o
 * que corrigir -- o cupom nao sai com dado inventado.
 */
export const montarNfceDoPedido = async (pedido: PedidoParaEmissao): Promise<{
  payload: Record<string, unknown>;
  itensFiscais: Record<string, unknown>[];
  avisos: string[];
}> => {
  let regime: RegimeTributario = DEFAULT_REGIME_TRIBUTARIO;
  const confSnap = await getDoc(doc(db, 'configuracoes', pedido.tenantId));
  if (confSnap.exists()) regime = (confSnap.data().regimeTributario ?? DEFAULT_REGIME_TRIBUTARIO) as RegimeTributario;

  // Desconto da venda (por item + geral) = bruto - liquido, rateado pelos itens:
  // a SEFAZ confere o desconto total com a soma do desconto dos itens.
  const pesos = pedido.itens.map((it) => Number(it.quantidade || 0) * Number(it.precoUnitario || 0));
  // Bruto somado dos proprios itens (o `valorTotalItens` gravado nao existe em pedido antigo).
  const somaBruta = pesos.reduce((s, v) => s + v, 0);
  const descontoTotal = Math.max(0, Math.round((somaBruta - pedido.valorTotal) * 100) / 100);
  const descontos = descontoTotal > 0 ? ratearValorPorPesos(descontoTotal, pesos) : pesos.map(() => 0);

  const itensFiscais: Record<string, unknown>[] = [];
  const tributos: ValoresTributosItem[] = [];
  const avisos: string[] = [];
  for (let i = 0; i < pedido.itens.length; i += 1) {
    const item = pedido.itens[i];
    let produto: ProdutoFiscal = { nome: item.nome };
    let unidadeCadastro = '';
    if (item.id && item.id !== 'avulso') {
      const pSnap = await getDoc(doc(db, 'estoque', item.id));
      if (pSnap.exists()) {
        produto = { ...produtoFiscalDoCadastro(pSnap.data(), { embalagemId: item.embalagemId }), nome: item.nome };
        unidadeCadastro = String(pSnap.data().unidadeMedidaSigla || '');
      }
    }
    const montado = montarItemNotaFiscal({
      // O peso liquido do cadastro e' por unidade BASE; vendido em embalagem,
      // cada unidade comercial pesa o fator vezes mais (so' conta em exportacao).
      produto: { ...produto, pesoLiquidoUnitarioKg: Number(produto.pesoLiquidoUnitarioKg || 0) * (item.fatorConversao ?? 1) },
      venda: { quantidade: item.quantidade, precoUnitario: item.precoUnitario, desconto: descontos[i], unidadeSigla: item.unidadeMedidaSigla || unidadeCadastro },
      // NFC-e e' sempre venda presencial dentro do estado.
      contexto: { regime, interestadual: false },
      codigoItem: produto.codigo || (item.id === 'avulso' ? 'AVULSO' : item.id),
    });
    if (!montado.ok) {
      throw new NfceEmissaoError(item.id === 'avulso'
        ? `O item avulso "${item.nome}" não tem dados fiscais (NCM, CSOSN): o cupom fiscal só sai com produto cadastrado no Estoque.`
        : montado.erro);
    }
    itensFiscais.push(montado.item);
    tributos.push(montado.tributos);
    avisos.push(...montado.avisos);
  }

  const tributosNota = somarTributos(tributos);
  const informacoes = [
    usesCsosn(regime) ? TEXTO_OPTANTE_SIMPLES_NACIONAL : '',
    textoTributosAproximados(tributosNota, pedido.valorTotal),
  ].filter(Boolean).join(' ');
  const receiver = await montarDestinatario(pedido.tenantId, pedido.clienteNome, pedido.clienteId);
  const descontoItens = itensFiscais.reduce((s, it) => s + Number(it.discountAmount || 0), 0);

  const payload: Record<string, unknown> = {
    isFinalCustomer: true,
    operationType: 'outgoing',
    destination: 'internal',
    presenceType: 'presence',
    operationNature: 'Venda de Mercadoria',
    sendEmailToCustomer: false,
    integrationId: pedido.id,
    ...(informacoes ? { additionalInformation: informacoes } : {}),
    ...(receiver ? { receiver } : {}),
    items: itensFiscais,
    payments: montarPagamentosNota(pedido.pagamentos, pedido.valorTotal),
    total: {
      invoiceAmount: pedido.valorTotal,
      productAmount: Math.round(itensFiscais.reduce((s, it) => s + Number(it.totalAmount || 0), 0) * 100) / 100,
      ...(descontoItens > 0 ? { discountAmount: Math.round(descontoItens * 100) / 100 } : {}),
      ...(tributosNota.total > 0 ? { totalTax: tributosNota.total } : {}),
    },
  };
  return { payload, itensFiscais, avisos: [...new Set(avisos)] };
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

  const { payload: spedyPayload, itensFiscais: payloadItems } = await montarNfceDoPedido(pedido);

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
