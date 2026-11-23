import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { emitirNfceDoPedido, NfceEmissaoError, type PedidoParaEmissao } from '../../services/nfceEmissaoService';
import { spedyService } from '../../services/spedyService';
import { createAuditLog } from '../../services/logService';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { numeroDaNota } from '../../utils/nomeArquivoDomain';
import { dataHoraDoCupom, htmlDoCupomNaoFiscal, montarCupomNaoFiscal, quandoDaVendaNoCaixa, type LarguraDaBobina } from '../../utils/cupomDoCaixaDomain';

/**
 * Cupom no fim da venda da Frente de Caixa (23/11/2026). Regra de qual cupom
 * sai e o desenho do cupom nao fiscal: src/utils/cupomDoCaixaDomain.ts.
 */

/** Le a venda como o servidor gravou (o papel bate com o banco). */
export const lerVendaGravada = async (pedidoId: string): Promise<Record<string, unknown> | null> => {
  const snap = await getDoc(doc(db, 'pedidos_venda', pedidoId));
  return snap.exists() ? snap.data() : null;
};

/**
 * Imprime uma pagina HTML num quadro escondido: o caixa nao sai da tela nem
 * abre outra aba. O navegador mostra a janela de impressao (a impressora
 * termica escolhida fica lembrada); o quadro e' removido depois.
 */
export const imprimirNaBobina = (html: string): Promise<void> => new Promise((resolve, reject) => {
  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.title = 'Cupom';
  Object.assign(quadro.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  document.body.appendChild(quadro);
  const remover = () => { window.setTimeout(() => quadro.remove(), 1000); };
  const janela = quadro.contentWindow;
  const documento = quadro.contentDocument || janela?.document;
  if (!janela || !documento) {
    quadro.remove();
    reject(new Error('O navegador não deixou preparar a impressão do cupom.'));
    return;
  }
  documento.open();
  documento.write(html);
  documento.close();
  // Espera o conteudo desenhar antes de chamar a impressao.
  window.setTimeout(() => {
    try {
      janela.focus();
      janela.print();
      resolve();
    } catch (erro) {
      reject(erro instanceof Error ? erro : new Error('Não foi possível imprimir o cupom.'));
    } finally {
      remover();
    }
  }, 250);
});

/** Monta o cupom nao fiscal da venda gravada e manda para a impressora. */
export const imprimirCupomNaoFiscal = async (args: {
  pedidoId: string;
  empresa: Record<string, unknown> | null;
  documentoDoCliente?: string;
  operador: string;
  largura?: LarguraDaBobina;
  /** Reimpressao pelo historico: sai "2a VIA", com a hora da venda e a da reimpressao. */
  segundaVia?: boolean;
}): Promise<void> => {
  const venda = await lerVendaGravada(args.pedidoId);
  if (!venda) throw new Error('A venda não foi encontrada para imprimir o cupom. Reimprima pelo sistema, em Pedidos de Venda.');
  const agora = new Date();
  const cupom = montarCupomNaoFiscal({
    venda,
    empresa: args.empresa,
    documentoDoCliente: args.documentoDoCliente,
    // Operador da 2a via e' quem reimprime; a hora do cupom continua a da venda.
    operador: args.operador,
    emitidoEm: args.segundaVia ? (quandoDaVendaNoCaixa(venda) || agora) : agora,
  });
  await imprimirNaBobina(htmlDoCupomNaoFiscal(cupom, args.largura || 80, args.segundaVia ? { reimpressoEm: dataHoraDoCupom(agora) } : null));
};

/** Reabre o cupom fiscal (PDF da NFC-e) ja' autorizado, para imprimir de novo. */
export const reabrirCupomFiscal = (spedyId: string): Promise<void> => spedyService.openFiscalFile(spedyId, 'consumer', 'pdf');

export type ResultadoDoCupomFiscal =
  | { situacao: 'autorizado'; numero: string }
  | { situacao: 'aguardando' }
  | { situacao: 'rejeitado'; motivo: string };

/**
 * Emite a NFC-e da venda gravada (a mesma emissao do Pedido de Venda e do app
 * Vendas), registra a nota e o historico e, autorizada, abre o cupom (PDF) para
 * imprimir. Erro de configuracao/rede sobe como NfceEmissaoError ou Error, em
 * portugues.
 */
export const emitirCupomFiscalDoCaixa = async (args: {
  pedidoId: string;
  tenantId: string;
  usuario: { uid: string; email: string | null };
}): Promise<ResultadoDoCupomFiscal> => {
  const venda = await lerVendaGravada(args.pedidoId);
  if (!venda) throw new NfceEmissaoError('A venda não foi encontrada para emitir o cupom fiscal. Emita pelo sistema, em Pedidos de Venda.');

  const pedido: PedidoParaEmissao = {
    id: args.pedidoId,
    tenantId: args.tenantId,
    clienteNome: String(venda.clienteNome || 'CONSUMIDOR FINAL'),
    clienteId: venda.clienteId ? String(venda.clienteId) : null,
    itens: Array.isArray(venda.itens) ? venda.itens as PedidoParaEmissao['itens'] : [],
    pagamentos: Array.isArray(venda.pagamentos) ? venda.pagamentos as PedidoParaEmissao['pagamentos'] : [],
    valorTotal: Number(venda.valorTotal || 0),
    valorTotalItens: Number(venda.valorTotalItens || 0),
  };

  const { nota, itensFiscais } = await emitirNfceDoPedido(pedido);
  const numeroPedido = String(venda.numeroPedido || '');
  const numeroCupom = numeroDaNota(nota.number);

  const notaRef = await addDoc(collection(db, 'notas_fiscais'), {
    spedyId: nota.id,
    number: nota.number,
    accessKey: nota.accessKey || null,
    tipo: 'NFC-e',
    clienteNome: pedido.clienteNome,
    valor: pedido.valorTotal,
    itensFiscais,
    status: nota.status,
    processingMessage: nota.processingDetail?.message || null,
    processingCode: nota.processingDetail?.code || null,
    tenantId: args.tenantId,
    createdAt: serverTimestamp(),
    data: new Date().toISOString(),
    pedidoId: pedido.id,
    ...buildDocumentMetadata(args.usuario.uid, serverTimestamp()),
  });

  const rejeitado = nota.status === 'rejected' || nota.status === 'denied';
  const motivo = `${nota.processingDetail?.code || ''} ${nota.processingDetail?.message || ''}`.trim();
  createAuditLog({
    tenantId: args.tenantId,
    usuarioId: args.usuario.uid,
    usuarioEmail: args.usuario.email || args.usuario.uid,
    modulo: 'fiscal',
    acao: 'emissao',
    descricao: nota.status === 'authorized'
      ? `NFC-e ${numeroCupom} do Pedido ${numeroPedido} emitida na Frente de Caixa e autorizada pela SEFAZ.`
      : rejeitado
        ? `NFC-e do Pedido ${numeroPedido} não emitida na Frente de Caixa: a SEFAZ rejeitou (${motivo || 'motivo não informado'}).`
        : `NFC-e do Pedido ${numeroPedido} enviada pela Frente de Caixa; aguardando a SEFAZ.`,
    registroRelacionadoId: notaRef.id,
    documentosRelacionados: [pedido.id],
    documentoTipo: 'nota_fiscal',
    documentoNumero: numeroCupom ? `NFC-e ${numeroCupom}` : `NFC-e do Pedido ${numeroPedido}`,
    ...(rejeitado && motivo ? { motivo } : {}),
    status: rejeitado ? 'erro' : 'sucesso',
  });

  if (nota.status === 'authorized') {
    await spedyService.openFiscalFile(nota.id, 'consumer', 'pdf');
    return { situacao: 'autorizado', numero: numeroCupom };
  }
  if (rejeitado) return { situacao: 'rejeitado', motivo: nota.processingDetail?.message || 'Motivo não informado pela SEFAZ.' };
  return { situacao: 'aguardando' };
};
