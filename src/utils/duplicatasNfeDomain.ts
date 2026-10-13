/*
 * DUPLICATAS (PARCELAS DO BOLETO) NA NF-e.
 *
 * A SEFAZ recusa parcela com vencimento antes da data de emissao: "900
 * Rejeicao: Data de vencimento da parcela nao informada ou menor que Data de
 * Emissao" (pedido #0119, 13/10/2026 -- venda de 01/10 em boleto, nota
 * emitida 12 dias depois). Nao ha' como mandar essa parcela sem mentir a
 * data, e o grupo de cobranca [cobr] e' opcional na NF-e: a parcela que ja'
 * venceu fica fora da nota (com aviso a quem emite) e o boleto continua
 * valendo no financeiro. A forma de pagamento [pag] continua indo inteira.
 */

export interface PagamentoComVencimento {
  formaPagamento: string;
  dataVencimento?: string | null;
  numeroParcelaAPrazo?: number | null;
  valor?: number | null;
  valorCentavos: number;
}

export interface DuplicataDaNota {
  number: string;
  dueDate: string;
  amount: number;
}

const dataBr = (iso: string) => iso.split('-').reverse().join('/');

/**
 * `hoje` no formato AAAA-MM-DD (data da emissao, fuso do Brasil). Devolve as
 * duplicatas que vao na nota e as parcelas vencidas que ficaram de fora.
 */
export const duplicatasDaNota = (pagamentos: PagamentoComVencimento[], hoje: string): {
  duplicatas: DuplicataDaNota[];
  vencidas: string[];
  aviso: string | null;
} => {
  const boletos = pagamentos.filter((p) => p.formaPagamento === 'Boleto' && p.dataVencimento);
  const duplicatas: DuplicataDaNota[] = [];
  const vencidas: string[] = [];
  boletos.forEach((p) => {
    const vencimento = String(p.dataVencimento);
    if (vencimento < hoje) {
      vencidas.push(dataBr(vencimento));
      return;
    }
    duplicatas.push({
      number: String(p.numeroParcelaAPrazo || 1).padStart(3, '0'),
      dueDate: `${vencimento}T00:00:00`,
      amount: Number(p.valor ?? p.valorCentavos / 100),
    });
  });
  const aviso = vencidas.length === 0
    ? null
    : `${vencidas.length === 1 ? 'A parcela do boleto que venceu em' : 'As parcelas do boleto que venceram em'} ${vencidas.join(', ')} não ${vencidas.length === 1 ? 'foi' : 'foram'} na nota: a SEFAZ não aceita vencimento antes da data de emissão. O boleto continua valendo no financeiro.`;
  return { duplicatas, vencidas, aviso };
};
