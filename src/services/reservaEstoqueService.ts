import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { STATUS_PEDIDO_ABERTO } from '../utils/preVendaDomain';
import {
  analisarSaidaComReserva,
  quantidadeDoProdutoNosItens,
  textoDaSaidaComReserva,
  type AnaliseDaSaida,
  type ReservaEncontrada,
  type SituacaoDaSaida,
} from '../utils/estoqueReservaDomain';
import { showError, showWarning } from '../utils/alerts';

/*
 * QUEM SEGURA A RESERVA DE UM PRODUTO.
 *
 * O produto guarda so' o numero (`quantidadeReservada`); quem segura cada
 * unidade sao os documentos em aberto: pre-venda, OS com reserva, condicional
 * e troca. Usado pela janela "Reservas de ..." (OrigensDaReservaModal) e, desde
 * 13/10/2026, pela venda (PDV, Pedido de Venda, OS) para dizer na mensagem
 * QUAL documento segura a peca -- antes o usuario tinha de abrir pre-venda por
 * pre-venda para achar.
 */
export const buscarReservasDoProduto = async (
  tenantId: string,
  produtoId: string,
  ignorarDocumentoId?: string,
): Promise<ReservaEncontrada[]> => {
  const base = (colecao: string) => collection(db, colecao);
  const [pedidos, ordens, condicionais, trocas] = await Promise.all([
    getDocs(query(base('pedidos_venda'), where('tenantId', '==', tenantId), where('estoqueReservado', '==', true))),
    getDocs(query(base('ordens_de_servico'), where('tenantId', '==', tenantId), where('estoqueReservado', '==', true))),
    getDocs(query(base('condicionais'), where('tenantId', '==', tenantId), where('status', '==', 'aberto'))),
    getDocs(query(base('trocas'), where('tenantId', '==', tenantId), where('estoqueReservado', '==', true))),
  ]);
  const achadas: ReservaEncontrada[] = [];
  pedidos.docs.forEach((d) => {
    const dados = d.data();
    if (d.id === ignorarDocumentoId || !STATUS_PEDIDO_ABERTO.includes(String(dados.status || ''))) return;
    const qtd = quantidadeDoProdutoNosItens(dados.itens, produtoId);
    if (qtd > 0) achadas.push({ origem: 'pre_venda', documentoId: d.id, numero: String(dados.numeroPedido || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
  });
  ordens.docs.forEach((d) => {
    const dados = d.data();
    if (d.id === ignorarDocumentoId) return;
    const qtd = quantidadeDoProdutoNosItens(dados.pecas, produtoId);
    if (qtd > 0) achadas.push({ origem: 'ordem_de_servico', documentoId: d.id, numero: String(dados.numeroOS || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
  });
  condicionais.docs.forEach((d) => {
    const dados = d.data();
    const qtd = quantidadeDoProdutoNosItens(dados.itens, produtoId);
    if (qtd > 0) achadas.push({ origem: 'condicional', documentoId: d.id, numero: String(dados.numeroCondicional || dados.numero || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
  });
  trocas.docs.forEach((d) => {
    const dados = d.data();
    const qtd = quantidadeDoProdutoNosItens(dados.itens, produtoId);
    if (qtd > 0) achadas.push({ origem: 'troca', documentoId: d.id, numero: String(dados.numeroTroca || dados.numero || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
  });
  return achadas;
};

export interface ProdutoComReserva {
  id: string;
  nome: string;
  quantidade?: unknown;
  quantidadeReservada?: unknown;
  unidadeMedidaSigla?: string | null;
  unidadeMedidaCasasDecimais?: number | null;
}

export interface ArgsDaSaida {
  tenantId: string | null | undefined;
  produto: ProdutoComReserva;
  /** Total do produto no documento depois da mudanca, na unidade base. */
  pedida: number;
  /** O que este documento ja' segura gravado (pre-venda/OS aberta com reserva). */
  reservadoPeloDocumento?: number;
  /** Para a lista de quem segura a reserva nao citar o proprio documento. */
  documentoAtualId?: string;
  permiteVendaSemEstoque: boolean;
}

export interface ConferenciaDaSaida {
  situacao: SituacaoDaSaida;
  analise: AnaliseDaSaida;
  /** Numeros do produto, sem a lista de documentos (cabe numa mensagem que junta varios itens). */
  resumo: string;
  /** Mostra a mensagem completa, com quem segura a reserva (busca no banco). */
  mostrar: () => void;
}

/** Decide na hora (sincrono); a mensagem com os documentos fica em `mostrar`. */
export const conferirSaidaDoProduto = (args: ArgsDaSaida): ConferenciaDaSaida => {
  const analise = analisarSaidaComReserva({
    quantidade: args.produto.quantidade,
    quantidadeReservada: args.produto.quantidadeReservada,
    pedida: args.pedida,
    reservadoPeloDocumento: args.reservadoPeloDocumento,
    permiteVendaSemEstoque: args.permiteVendaSemEstoque,
  });
  const resumo = textoDaSaidaComReserva({
    analise,
    pedida: args.pedida,
    reservas: [],
    sigla: args.produto.unidadeMedidaSigla,
    casas: args.produto.unidadeMedidaCasasDecimais,
  });
  return { situacao: analise.situacao, analise, resumo, mostrar: () => { void mostrarMensagemDaReserva(args, analise); } };
};

/**
 * Atalho para a tela que confere um produto por vez (PDV, OS):
 * - `true`: pode seguir (inclusive no caso "so' avisa" da empresa que vende sem estoque);
 * - `false`: travou por causa da reserva (a mensagem ja' foi mostrada);
 * - `'sem_estoque'`: falta estoque fisico, sem reserva no meio -- a tela mostra
 *   a mensagem dela, como sempre mostrou.
 */
export const conferirSaidaComReserva = (args: ArgsDaSaida): true | false | 'sem_estoque' => {
  const conferencia = conferirSaidaDoProduto(args);
  if (conferencia.situacao === 'ok') return true;
  if (conferencia.situacao === 'bloquear_estoque') return 'sem_estoque';
  conferencia.mostrar();
  return conferencia.situacao === 'avisar_reserva';
};

const mostrarMensagemDaReserva = async (args: ArgsDaSaida, analise: AnaliseDaSaida) => {
  let reservas: ReservaEncontrada[] = [];
  if (args.tenantId) {
    try {
      reservas = await buscarReservasDoProduto(args.tenantId, args.produto.id, args.documentoAtualId);
    } catch (erro) {
      // Sem a lista, a mensagem sai so' com os numeros -- a decisao (travar/avisar) nao muda.
      console.error('Erro ao procurar quem segura a reserva:', erro);
    }
  }
  const texto = textoDaSaidaComReserva({
    analise,
    pedida: args.pedida,
    reservas,
    sigla: args.produto.unidadeMedidaSigla,
    casas: args.produto.unidadeMedidaCasasDecimais,
  });
  if (analise.situacao === 'avisar_reserva') {
    showWarning(`${args.produto.nome}: parte do estoque está reservada`, `${texto} A venda segue porque a empresa vende sem estoque.`);
    return;
  }
  showError(
    `${args.produto.nome}: estoque reservado`,
    `${texto} Venda até o disponível, ou libere a peça cancelando ou ajustando o documento que a reserva.`,
  );
};
