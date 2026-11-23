/**
 * PAGAMENTO NO PAPEL: QUANTO FOI PAGO NA COMPRA E QUANTO FICOU A PRAZO
 * (23/11/2026, pedido do dono -- caso Jomarly, pedido 0339).
 *
 * Venda de R$ 442,00: R$ 412,00 no debito e R$ 30,00 a prazo. O pedido
 * impresso dizia so' "Cond. Pagto: CARTAO DE DEBITO / PAGAMENTO A PRAZO" e
 * "Vr Liquido: 442,00" -- parecia que o cliente tinha pago tudo. Agora todo
 * modelo de impressao (pedido A4, meia folha, pre-venda, pre-venda simples,
 * OS personalizada) mostra o valor de CADA forma e, separado, o que ficou a
 * prazo com o vencimento.
 *
 * A prazo = o cliente ainda deve a loja: "Pagamento a Prazo" e "Boleto".
 * Cartao (mesmo parcelado), Pix, dinheiro e cheque o cliente ja' pagou na
 * compra -- quem parcela o cartao e' a operadora, nao a loja.
 *
 * Fonte: os pagamentos gravados no documento (`pagamentos`). Pagamento a
 * prazo parcelado ou boleto parcelado chegam como varios registros, um por
 * vencimento; cartao parcelado no modo completo tambem (cartao.numero).
 */

export const FORMAS_A_PRAZO_DO_CLIENTE = ['Pagamento a Prazo', 'Boleto'];

export interface ParcelaImpressa {
  /** AAAA-MM-DD; vazio quando o documento nao guardou. */
  dataVencimento: string;
  valorCentavos: number;
}

export interface FormaImpressa {
  forma: string;
  valorCentavos: number;
  aPrazo: boolean;
  /** Vezes no cartao (2 ou mais) ou parcelas do a prazo/boleto. 1 = sem parcelamento. */
  vezes: number;
  /** So' das formas a prazo, em ordem de vencimento. */
  parcelas: ParcelaImpressa[];
}

export interface PagamentoImpresso {
  formas: FormaImpressa[];
  pagoNaCompraCentavos: number;
  aPrazoCentavos: number;
  temAPrazo: boolean;
}

type Registro = Record<string, unknown>;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const centavos = (p: Registro): number => {
  if (p.valorCentavos !== undefined && p.valorCentavos !== null && Number.isFinite(Number(p.valorCentavos))) {
    return Math.round(Number(p.valorCentavos));
  }
  const reais = Number(p.valor);
  return Number.isFinite(reais) ? Math.round(reais * 100) : 0;
};

const dataIso = (v: unknown): string => {
  const s = texto(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

export const ehFormaAPrazo = (forma: string, condicao?: unknown): boolean =>
  FORMAS_A_PRAZO_DO_CLIENTE.includes(forma) || texto(condicao) === 'aprazo';

export const pagamentoImpresso = (pagamentos: unknown): PagamentoImpresso => {
  const lista = Array.isArray(pagamentos) ? (pagamentos as unknown[]).filter((p): p is Registro => !!p && typeof p === 'object') : [];
  const porForma = new Map<string, FormaImpressa & { registrosDeCartao: number }>();

  lista.forEach((p) => {
    const forma = texto(p.formaPagamento) || texto(p.forma) || 'Outros';
    const valor = centavos(p);
    if (valor <= 0) return;
    const aPrazo = ehFormaAPrazo(forma, p.condicaoPagamento);
    const atual = porForma.get(forma) || { forma, valorCentavos: 0, aPrazo, vezes: 1, parcelas: [], registrosDeCartao: 0 };
    atual.valorCentavos += valor;
    atual.aPrazo = atual.aPrazo || aPrazo;
    if (aPrazo) {
      atual.parcelas.push({ dataVencimento: dataIso(p.dataVencimento) || dataIso(p.dataPrevistaRecebimento), valorCentavos: valor });
    }
    const cartao = p.cartao && typeof p.cartao === 'object' ? p.cartao as Registro : null;
    const totalNoCartao = Number(cartao?.totalParcelas);
    const exibicao = Number(p.parcelasExibicao);
    if (cartao?.numero !== undefined) atual.registrosDeCartao += 1;
    atual.vezes = Math.max(atual.vezes, Number.isFinite(totalNoCartao) ? totalNoCartao : 1, Number.isFinite(exibicao) ? exibicao : 1);
    porForma.set(forma, atual);
  });

  const formas: FormaImpressa[] = Array.from(porForma.values()).map(({ registrosDeCartao, ...forma }) => {
    const parcelas = [...forma.parcelas].sort((a, b) => (a.dataVencimento || '9999').localeCompare(b.dataVencimento || '9999'));
    const vezes = forma.aPrazo ? Math.max(1, parcelas.length) : Math.max(forma.vezes, registrosDeCartao, 1);
    return { ...forma, parcelas, vezes };
  });

  const aPrazoCentavos = formas.filter((f) => f.aPrazo).reduce((s, f) => s + f.valorCentavos, 0);
  const pagoNaCompraCentavos = formas.filter((f) => !f.aPrazo).reduce((s, f) => s + f.valorCentavos, 0);
  return { formas, pagoNaCompraCentavos, aPrazoCentavos, temAPrazo: aPrazoCentavos > 0 };
};

/** "23/12/2026" a partir de "2026-12-23". */
export const dataBrDoVencimento = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** "venc. 23/12/2026" ou "2x: 23/12/2026, 22/01/2027". Vazio sem data. */
export const textoDosVencimentos = (forma: FormaImpressa): string => {
  const datas = forma.parcelas.map((p) => dataBrDoVencimento(p.dataVencimento)).filter(Boolean);
  if (datas.length === 0) return forma.vezes > 1 ? `${forma.vezes}x` : '';
  if (datas.length === 1 && forma.vezes <= 1) return `venc. ${datas[0]}`;
  return `${forma.vezes}x: ${datas.join(', ')}`;
};

/** Nome da forma com as vezes do cartao: "Cartão de Crédito 3x". */
export const rotuloDaForma = (forma: FormaImpressa): string =>
  (!forma.aPrazo && forma.vezes > 1 ? `${forma.forma} ${forma.vezes}x` : forma.forma);
