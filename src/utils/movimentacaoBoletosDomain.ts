/**
 * Movimentacao dos boletos pagos (Boletos › Ver movimentacao) e resumo do
 * arquivo de retorno importado -- 25/11/2026, pedido do dono pela Embala Minas:
 * "deu baixa em todos boletos pelo retorno, mas nao apareceu o registro do que
 * foi baixado" e "mostrar os boletos que foram pagos, com o nome do cliente e o
 * dia que foi pago". A loja importou o retorno, viu "concluido" em verde e nada
 * tinha sido baixado: o sistema nao achou nenhum boleto (faltava vincular os do
 * sistema anterior). Agora o fim da importacao diz o que entrou e o que ficou de
 * fora, e nada encontrado e' aviso, nunca sucesso.
 *
 * Regra pura: sem tela.
 */

export interface BoletoPagoDaMovimentacao {
  id: string;
  clienteNome: string;
  descricao: string;
  nossoNumero: string;
  /** AAAA-MM-DD; vazio quando o titulo antigo nao gravou. */
  dataPagamento: string;
  valorCentavos: number;
  /** O que o banco recebeu; sem ele, o valor do titulo. */
  valorPagoCentavos: number;
  bancoNome: string;
}

export interface DiaDaMovimentacao {
  data: string;
  boletos: BoletoPagoDaMovimentacao[];
  totalPagoCentavos: number;
}

/** Boletos pagos separados por dia do pagamento, do mais recente; sem data por ultimo. */
export const movimentacaoPorDia = (boletos: BoletoPagoDaMovimentacao[]): DiaDaMovimentacao[] => {
  const porDia = new Map<string, BoletoPagoDaMovimentacao[]>();
  boletos.forEach((b) => {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(b.dataPagamento) ? b.dataPagamento : '';
    porDia.set(dia, [...(porDia.get(dia) || []), b]);
  });
  return [...porDia.entries()]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : b.localeCompare(a)))
    .map(([data, lista]) => ({
      data,
      boletos: [...lista].sort((x, y) => x.clienteNome.localeCompare(y.clienteNome, 'pt-BR')),
      totalPagoCentavos: lista.reduce((soma, b) => soma + (b.valorPagoCentavos || b.valorCentavos), 0),
    }));
};

export interface BaixaDoRetorno {
  clienteNome: string;
  nossoNumero: string;
  dataPagamento: string;
  valorPagoCentavos: number;
  acrescimoCentavos: number;
  descontoCentavos: number;
}

export interface ResumoDoRetorno {
  baixados: BaixaDoRetorno[];
  /** Nosso numero dos pagos no arquivo que nao existem aqui. */
  naoEncontrados: string[];
  /** Ja' estavam pagos aqui (o mesmo arquivo importado de novo). */
  jaPagos: number;
  recusados: string[];
  avulsosLancados: number;
}

export type GravidadeDoRetorno = 'sucesso' | 'aviso';

/** Sucesso so' quando algo foi baixado (ou ja' estava) e nada ficou de fora. */
export const gravidadeDoRetorno = (r: ResumoDoRetorno): GravidadeDoRetorno => (
  (r.baixados.length > 0 || r.jaPagos > 0) && r.naoEncontrados.length === 0 && r.recusados.length === 0 ? 'sucesso' : 'aviso'
);

/** Titulo da janela do fim da importacao. */
export const tituloDoRetorno = (r: ResumoDoRetorno): string => {
  if (r.baixados.length === 0 && r.jaPagos === 0) return 'Nenhum boleto foi baixado';
  const partes = [`${r.baixados.length} boleto(s) baixado(s)`];
  if (r.naoEncontrados.length > 0) partes.push(`${r.naoEncontrados.length} não encontrado(s)`);
  if (r.recusados.length > 0) partes.push(`${r.recusados.length} ficou(aram) de fora`);
  return partes.join('; ');
};

/** O que fazer com os nao encontrados (o caso da Embala Minas: boletos do sistema anterior sem vinculo). */
export const AJUDA_NAO_ENCONTRADOS = 'Os boletos não encontrados não existem aqui com esse nosso número. '
  + 'Se forem boletos do sistema anterior, use Mais opções › "Vincular boletos do sistema anterior" e importe este mesmo arquivo de novo (o que já foi baixado não repete).';
