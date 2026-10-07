/*
 * BAIXA E ESTORNO DE TITULOS -- UM SO' CAMINHO PARA O SISTEMA INTEIRO.
 *
 * Contas a Pagar, Contas a Receber e Fluxo de Caixa baixam e estornam por
 * aqui. Desde 2026-10-05 (item 8 da auditoria de infra, fatia 1) quem GRAVA
 * e' o servidor (server/routes/financeiro.routes.js): titulo, saldo do banco e
 * venda/OS de origem, numa transacao so', com o dado lido la'. O navegador
 * so' diz o que a pessoa escolheu -- e as firestore.rules deixam de aceitar
 * saldo de banco escrito por quem so' tem permissao de Pagar/Receber.
 *
 * Antes o Fluxo de Caixa tinha um estorno proprio que so' trocava o status
 * para Pendente: nao devolvia o saldo do banco, nao mexia na venda/OS de
 * origem e aparecia ate' em recebimento do balcao.
 *
 * Regras de QUEM pode ser estornado: baixaFinanceiraDomain (puras, testadas,
 * as mesmas que o servidor usa -- compiladas para server/domain/).
 */
import { auth } from './firebase';
import { showError, showSuccess } from '../utils/alerts';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import { fromCents, transactionNetAmount } from '../utils/financeDomain';
import {
  dataBrasileira,
  planejarEstornoPagar,
  planejarEstornoReceber,
  type PlanoEstorno,
  type TituloParaEstorno,
} from '../utils/baixaFinanceiraDomain';
import { pedirMotivoEstorno } from '../utils/baixaFinanceiraUi';

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

/** Erro ja' em portugues, pronto para a tela (vem do servidor ou da rede). */
export class BaixaFinanceiraError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BaixaFinanceiraError';
    this.status = status;
  }
}

type RotaFinanceiro =
  | '/baixa'
  | '/estorno'
  | '/cartao/conciliar'
  | '/cheque/compensar'
  | '/cheque-emitido/compensar'
  | '/boleto/retorno'
  | '/banco/lancamento'
  | '/banco/transferencia';

const chamarFinanceiro = async <T>(caminho: RotaFinanceiro, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) {
    throw new BaixaFinanceiraError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new BaixaFinanceiraError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/financeiro${caminho}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    // Sem resposta nao da' para saber se gravou: a mensagem manda conferir a lista
    // antes de repetir (o servidor recusa baixar de novo um titulo ja' pago).
    throw new BaixaFinanceiraError(`${mensagemDeFalhaDeRede(erro)} Confira na lista se a operação foi registrada antes de repetir.`, 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new BaixaFinanceiraError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  }
  return dados as T;
};

export type TipoLancamento = 'entrada' | 'saida';

/** O que qualquer tela precisa entregar para estornar um lancamento. */
export interface TituloEstornavel extends TituloParaEstorno {
  id: string;
  descricao: string;
  valor: number;
  tipo?: TipoLancamento | string;
  bancoNome?: string;
  pedidoId?: string;
  osId?: string;
}

export interface UsuarioEstorno {
  uid: string;
  email?: string | null;
}

/** Plano de estorno conforme o tipo: saida = Contas a Pagar, entrada = Contas a Receber. */
export const planejarEstornoPorTipo = (titulo: TituloParaEstorno, tipo: TipoLancamento | string | undefined): PlanoEstorno => (
  tipo === 'saida' ? planejarEstornoPagar(titulo) : planejarEstornoReceber(titulo)
);

/** O que a pessoa escolheu na tela de baixa. Valor, saldo e venda/OS o servidor le' sozinho. */
export interface PedidoDeBaixa {
  tipo: TipoLancamento;
  transacaoId: string;
  formaPagamento: string;
  /** yyyy-mm-dd: dia em que foi pago/recebido de verdade (pode ser antes de hoje). */
  dataPagamento: string;
  bancoId?: string;
  /** Juros e multa cobrados junto (centavos), so' no Receber. O servidor grava como lancamento proprio. */
  acrescimoCentavos?: number;
  /** Empresa aberta na tela (o admin da plataforma pode estar noutra). */
  tenantId: string;
}

/**
 * Da' baixa num titulo pelo servidor: Pagar debita o banco; Receber credita o
 * banco e atualiza a venda/OS. Tudo ou nada. Erro sobe como
 * BaixaFinanceiraError, com a frase pronta para o usuario.
 */
export const registrarBaixa = async (pedido: PedidoDeBaixa): Promise<void> => {
  await chamarFinanceiro<{ ok: boolean }>('/baixa', {
    tipo: pedido.tipo,
    transacaoId: pedido.transacaoId,
    formaPagamento: pedido.formaPagamento,
    dataPagamento: pedido.dataPagamento,
    ...(pedido.bancoId ? { bancoId: pedido.bancoId } : {}),
    // Juros e multa (parametros de venda, fase A): so' vai quando ha' valor.
    ...(pedido.acrescimoCentavos && pedido.acrescimoCentavos > 0 ? { acrescimoCentavos: pedido.acrescimoCentavos } : {}),
    tenantId: pedido.tenantId,
  });
};

/**
 * Desfaz a baixa pelo servidor, tudo ou nada:
 *  - o titulo volta a Pendente (e, no recebimento, com a forma de antes);
 *  - o saldo do banco que a baixa mexeu e' corrigido;
 *  - a venda/OS de origem volta a mostrar o pagamento como pendente.
 * O servidor confere as regras de novo com o dado de AGORA: alguem pode ter
 * estornado ou alterado o titulo depois que a tela carregou. O log de
 * auditoria tambem sai de la'.
 */
export const executarEstorno = async (args: {
  titulo: TituloEstornavel;
  tipo: TipoLancamento;
  motivo: string;
  tenantId: string;
}): Promise<void> => {
  await chamarFinanceiro<{ ok: boolean }>('/estorno', {
    tipo: args.tipo,
    transacaoId: args.titulo.id,
    motivo: args.motivo,
    tenantId: args.tenantId,
  });
};

// ---------------------------------------------------------------------------
// Fatia 2 (2026-10-05): as outras telas do Financeiro que mexiam no saldo do
// banco tambem pedem ao servidor (server/services/movimentoBanco.js). A tela
// manda so' o que a pessoa escolheu; titulo, valor e saldo sao lidos la'.
// ---------------------------------------------------------------------------

/** Banco > conciliar recebimento de cartao. `bancoId` so' vale para titulo antigo sem banco. */
export const conciliarCartaoNoBanco = (args: { transacaoId: string; bancoId?: string; tenantId: string }) => (
  chamarFinanceiro<{ ok: boolean }>('/cartao/conciliar', { ...args })
);

/** Cheques > compensar cheque RECEBIDO (credita o banco). */
export const compensarChequeRecebido = (args: { transacaoId: string; bancoId?: string; tenantId: string }) => (
  chamarFinanceiro<{ ok: boolean }>('/cheque/compensar', { ...args })
);

/** Cheques > compensar cheque EMITIDO pela empresa (debita o banco), no dia informado. */
export const compensarChequeEmitido = (args: { transacaoId: string; dataPagamento: string; tenantId: string }) => (
  chamarFinanceiro<{ ok: boolean }>('/cheque-emitido/compensar', { ...args })
);

/** Boletos > baixa de UM boleto pelo arquivo de retorno. Boleto ja' pago volta com jaEstavaPago. */
export const baixarBoletoPeloRetorno = (args: { transacaoId: string; valorPagoCentavos: number; dataPagamento?: string; tenantId: string }) => (
  chamarFinanceiro<{ ok: boolean; jaEstavaPago: boolean }>('/boleto/retorno', { ...args })
);

/** Cadastro de Bancos > ajuste ou tarifa lancado a mao. */
export const lancarNoBanco = (args: {
  bancoId: string;
  tipo: 'ajuste' | 'tarifa';
  direcao: 'credito' | 'debito';
  valorCentavos: number;
  descricao: string;
  data: string;
  tenantId: string;
}) => chamarFinanceiro<{ ok: boolean }>('/banco/lancamento', { ...args });

/** Cadastro de Bancos > transferencia entre dois bancos da empresa. */
export const transferirEntreBancos = (args: {
  origemId: string;
  destinoId: string;
  valorCentavos: number;
  descricao?: string;
  data: string;
  tenantId: string;
}) => chamarFinanceiro<{ ok: boolean }>('/banco/transferencia', { ...args });

/**
 * O fluxo completo que as telas usam no clique de "Estornar": permissao,
 * regra, confirmacao com motivo, gravacao e aviso. Devolve true se estornou.
 */
export const estornarBaixaComConfirmacao = async (args: {
  titulo: TituloEstornavel;
  tipo: TipoLancamento;
  podeEstornar: boolean;
  tenantId: string | null;
  usuario: UsuarioEstorno | null;
}): Promise<boolean> => {
  const { titulo, tipo, podeEstornar, tenantId, usuario } = args;
  if (!usuario || !tenantId) return false;
  const nomeAcao = tipo === 'saida' ? 'pagamentos' : 'recebimentos';

  if (!podeEstornar) {
    showError('Sem permissão', `Você não tem permissão para estornar ${nomeAcao}. Peça a um responsável liberar "Financeiro: Estornar Pagamento/Recebimento" no seu usuário.`);
    return false;
  }
  const plano = planejarEstornoPorTipo(titulo, tipo);
  if (!plano.permitido) {
    showError('Não é possível estornar', plano.bloqueio);
    return false;
  }

  const quando = titulo.dataPagamento ? `${tipo === 'saida' ? 'paga' : 'recebido'} em ${dataBrasileira(titulo.dataPagamento)}` : '';
  const forma = titulo.formaPagamento ? `(${titulo.formaPagamento})` : '';
  const valor = tipo === 'saida' ? Number(titulo.valor) : transactionNetAmount(titulo);
  const noBanco = plano.bancoId && plano.ajusteBancoCentavos !== 0
    ? (plano.ajusteBancoCentavos > 0
      ? ` R$ ${fromCents(plano.ajusteBancoCentavos).toFixed(2)} voltam para o saldo do banco${titulo.bancoNome ? ` ${titulo.bancoNome}` : ''}.`
      : ` R$ ${fromCents(-plano.ajusteBancoCentavos).toFixed(2)} saem do saldo do banco.`)
    : '';
  const daVenda = tipo === 'entrada' && (titulo.pedidoId || titulo.osId)
    ? ' A venda (ou OS) de origem passa a mostrar esse valor como a receber.'
    : '';

  const motivo = await pedirMotivoEstorno({
    titulo: tipo === 'saida' ? 'Estornar pagamento?' : 'Estornar recebimento?',
    texto: `${tipo === 'saida' ? 'A conta' : 'O recebimento'} "${titulo.descricao}" de R$ ${valor.toFixed(2)}, ${quando} ${forma}, volta para Pendente.${daVenda}${noBanco} Depois é só dar baixa de novo com a data certa.`
      .replace(/\s+,/g, ',').replace(/\s{2,}/g, ' '),
  });
  if (!motivo) return false;

  try {
    await executarEstorno({ titulo, tipo, motivo, tenantId });
    showSuccess(tipo === 'saida' ? 'Pagamento estornado! A conta voltou para Pendente.' : 'Recebimento estornado! A conta voltou para Pendente.');
    return true;
  } catch (erro) {
    console.error('Erro ao estornar:', erro);
    showError('Não foi possível estornar', erro instanceof Error ? erro.message : 'Tente novamente.');
    return false;
  }
};
