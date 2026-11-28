/*
 * CONFERENCIA DO RETORNO DO BANCO ANTES DA BAIXA (28/11/2026, pedido do dono):
 * "antes do sistema ja' baixar tudo, mostrar um popup bonito com o resumo do
 * que vai baixar: documento, data pagamento, data vencimento, juros e multa
 * de cada, valor total de juro e multa que ta' recebendo".
 *
 * Monta, a partir das linhas liquidadas do arquivo e dos titulos do sistema,
 * o que vai ser baixado (com juros/multa, desconto e tarifa de cada um) e o
 * que fica de fora (ja' pago, nao encontrado). Puro: a tela so' desenha.
 */

import { detalheDoRecebimentoBoleto, type DetalheRetornoBoleto } from './boletoEmissaoDomain';
import { differenceInCalendarDays } from './dateTime';

export interface LinhaLiquidada {
  nossoNumero?: string;
  /** Dia do pagamento, AAAA-MM-DD. */
  dataOcorrencia?: string;
  valorPagoCentavos?: number;
  detalhe?: DetalheRetornoBoleto;
}

export interface TituloDoRetorno {
  id: string;
  descricao: string;
  clienteNome?: string;
  fornecedorNome?: string;
  valorCentavos: number;
  status: string;
  dataVencimento?: string;
  boleto?: { nossoNumero?: string; vencimento?: string } | null;
}

export interface DocumentoABaixar {
  tituloId: string;
  nossoNumero: string;
  cliente: string;
  descricao: string;
  vencimento: string;
  dataPagamento: string;
  /** Dias entre o vencimento e o pagamento (0 = em dia). */
  diasDeAtraso: number;
  valorBoletoCentavos: number;
  jurosMultaCentavos: number;
  descontoCentavos: number;
  tarifaCentavos: number;
  pagoCentavos: number;
  liquidoCentavos: number;
  /** Cancelado no sistema e pago no banco: a tela pergunta depois se lanca avulso. */
  canceladoNoSistema: boolean;
}

export interface ConferenciaDoRetorno {
  aBaixar: DocumentoABaixar[];
  jaPagos: Array<{ nossoNumero: string; cliente: string; descricao: string }>;
  naoEncontrados: string[];
  totais: {
    quantidade: number;
    valorBoletosCentavos: number;
    jurosMultaCentavos: number;
    descontoCentavos: number;
    tarifaCentavos: number;
    pagoCentavos: number;
    liquidoCentavos: number;
  };
}

export const montarConferenciaDoRetorno = (liquidados: LinhaLiquidada[], titulos: TituloDoRetorno[]): ConferenciaDoRetorno => {
  const porNossoNumero = new Map<string, TituloDoRetorno>();
  for (const t of titulos) {
    const nn = t.boleto?.nossoNumero;
    if (nn && !porNossoNumero.has(nn)) porNossoNumero.set(nn, t);
  }
  const aBaixar: DocumentoABaixar[] = [];
  const jaPagos: ConferenciaDoRetorno['jaPagos'] = [];
  const naoEncontrados: string[] = [];
  const vistos = new Set<string>();

  for (const linha of liquidados) {
    const nossoNumero = String(linha.nossoNumero || '');
    if (vistos.has(nossoNumero)) continue; // a mesma linha repetida no arquivo nao conta duas vezes
    vistos.add(nossoNumero);
    const titulo = nossoNumero ? porNossoNumero.get(nossoNumero) : undefined;
    if (!titulo) { naoEncontrados.push(nossoNumero || '(sem nosso número)'); continue; }
    const cliente = titulo.clienteNome || titulo.fornecedorNome || 'Cliente não identificado';
    if (titulo.status === 'Paga') { jaPagos.push({ nossoNumero, cliente, descricao: titulo.descricao }); continue; }
    const pago = Math.max(0, Math.round(Number(linha.valorPagoCentavos) || 0)) || titulo.valorCentavos;
    const d = detalheDoRecebimentoBoleto({ valorCentavos: titulo.valorCentavos, valorPagoCentavos: pago, retornoDoBanco: linha.detalhe });
    const vencimento = titulo.boleto?.vencimento || titulo.dataVencimento || '';
    const dataPagamento = linha.dataOcorrencia || '';
    const atraso = vencimento && dataPagamento ? (differenceInCalendarDays(vencimento, dataPagamento) ?? 0) : 0;
    aBaixar.push({
      tituloId: titulo.id,
      nossoNumero,
      cliente,
      descricao: titulo.descricao,
      vencimento,
      dataPagamento,
      diasDeAtraso: Math.max(0, atraso),
      valorBoletoCentavos: d.valorBoleto,
      jurosMultaCentavos: d.jurosMulta,
      descontoCentavos: d.desconto,
      tarifaCentavos: d.tarifa,
      pagoCentavos: d.pago,
      liquidoCentavos: d.liquido,
      canceladoNoSistema: titulo.status === 'Cancelada',
    });
  }

  // Mais atrasado primeiro: e' onde estao os juros.
  aBaixar.sort((a, b) => b.diasDeAtraso - a.diasDeAtraso || a.cliente.localeCompare(b.cliente, 'pt-BR'));
  const soma = (campo: keyof Pick<DocumentoABaixar, 'valorBoletoCentavos' | 'jurosMultaCentavos' | 'descontoCentavos' | 'tarifaCentavos' | 'pagoCentavos' | 'liquidoCentavos'>) => (
    aBaixar.reduce((acc, d) => acc + d[campo], 0)
  );
  return {
    aBaixar,
    jaPagos,
    naoEncontrados,
    totais: {
      quantidade: aBaixar.length,
      valorBoletosCentavos: soma('valorBoletoCentavos'),
      jurosMultaCentavos: soma('jurosMultaCentavos'),
      descontoCentavos: soma('descontoCentavos'),
      tarifaCentavos: soma('tarifaCentavos'),
      pagoCentavos: soma('pagoCentavos'),
      liquidoCentavos: soma('liquidoCentavos'),
    },
  };
};
