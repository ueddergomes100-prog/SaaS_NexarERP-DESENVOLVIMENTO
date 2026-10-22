/**
 * CAIXAS E TRANSFERENCIAS ENTRE CONTAS (pedido do dono, 21/10/2026).
 *
 * "Todo ERP tem": transferir dinheiro do Sicoob para o Banco do Brasil, do
 * caixa para o banco (deposito), do banco para o caixa (suprimento), do caixa
 * para o cofre. Decisoes do dono (caixinhas, 21/10):
 *  - a empresa cadastra os caixas que quiser; por padrao o sistema cria o
 *    CAIXA (a gaveta da frente de caixa) e o COFRE;
 *  - o saldo do caixa nasce do saldo inicial + transferencias + lancamentos
 *    a mao (a venda em dinheiro NAO entra sozinha: o Fluxo de Caixa continua
 *    mostrando as vendas como hoje);
 *  - cheque recebido ganha o passo DEPOSITAR (fica "aguardando compensacao")
 *    antes de COMPENSAR, e DEVOLVIDO para o que volta;
 *  - a sangria do PDV "para deposito" escolhe o banco e credita o banco na hora.
 *
 * Caixa e' dinheiro fisico: nunca fica negativo (a transferencia e' recusada).
 * Banco pode (cheque especial), como a transferencia entre bancos ja' aceita.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */

export type TipoConta = 'caixa' | 'banco';

export interface ContaRef {
  tipo: TipoConta;
  id: string;
}

export const ROTULO_TIPO_CONTA: Record<TipoConta, string> = { caixa: 'Caixa', banco: 'Banco' };

/** Criados na primeira vez que a empresa abre a tela (idempotente). */
export const CAIXAS_PADRAO: ReadonlyArray<{ nome: string; descricao: string }> = [
  { nome: 'CAIXA', descricao: 'Gaveta da frente de caixa' },
  { nome: 'COFRE', descricao: 'Dinheiro guardado na loja' },
];

export const NOME_CAIXA_MAX = 40;
export const DESCRICAO_MAX = 120;
export const EXTRATO_LIMITE = 300;

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const texto = (v: unknown, maximo: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, maximo);

export const normalizarNomeCaixa = (v: unknown): string => texto(v, NOME_CAIXA_MAX).toUpperCase();

export const formatarReais = (centavos: number): string => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;

const valorPositivo = (v: unknown): number | null => {
  const n = numero(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const dataValida = (v: unknown): string | null => (typeof v === 'string' && DATA_ISO.test(v) ? v : null);

const contaRef = (v: unknown): ContaRef | null => {
  const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const tipo = c.tipo === 'caixa' || c.tipo === 'banco' ? c.tipo : null;
  const id = typeof c.id === 'string' && ID_VALIDO.test(c.id) ? c.id : null;
  return tipo && id ? { tipo, id } : null;
};

export const mesmaConta = (a: ContaRef, b: ContaRef): boolean => a.tipo === b.tipo && a.id === b.id;

// ---------------------------------------------------------------------------
// CADASTRO DO CAIXA
// ---------------------------------------------------------------------------

export interface CadastroDeCaixa {
  nome: string;
  descricao: string;
  /** So' na criacao: vira o primeiro lancamento. */
  saldoInicialCentavos: number;
  ativo: boolean;
}

export const lerCadastroDeCaixa = (corpo: unknown): { erro: string } | { caixa: CadastroDeCaixa } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const nome = normalizarNomeCaixa(c.nome);
  if (!nome) return { erro: 'Informe o nome do caixa (ex.: CAIXA, COFRE).' };
  const saldo = c.saldoInicialCentavos === undefined || c.saldoInicialCentavos === null || c.saldoInicialCentavos === '' ? 0 : numero(c.saldoInicialCentavos);
  if (!Number.isInteger(saldo) || saldo < 0) return { erro: 'O saldo inicial precisa ser um valor igual ou maior que zero.' };
  return { caixa: { nome, descricao: texto(c.descricao, DESCRICAO_MAX), saldoInicialCentavos: saldo, ativo: c.ativo !== false } };
};

// ---------------------------------------------------------------------------
// LANCAMENTO A MAO NO CAIXA (ajuste)
// ---------------------------------------------------------------------------

export interface LancamentoDeCaixa {
  direcao: 'credito' | 'debito';
  valorCentavos: number;
  descricao: string;
  data: string;
}

export const lerLancamentoDeCaixa = (corpo: unknown): { erro: string } | { lancamento: LancamentoDeCaixa } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const direcao = c.direcao === 'credito' || c.direcao === 'debito' ? c.direcao : null;
  if (!direcao) return { erro: 'Escolha se é entrada ou saída do caixa.' };
  const valorCentavos = valorPositivo(c.valorCentavos);
  if (!valorCentavos) return { erro: 'Informe um valor maior que zero.' };
  const descricao = texto(c.descricao, DESCRICAO_MAX);
  if (!descricao) return { erro: 'Informe uma descrição para o lançamento.' };
  const data = dataValida(c.data);
  if (!data) return { erro: 'Informe a data do lançamento.' };
  return { lancamento: { direcao, valorCentavos, descricao, data } };
};

// ---------------------------------------------------------------------------
// TRANSFERENCIA ENTRE CONTAS
// ---------------------------------------------------------------------------

export interface PedidoDeTransferencia {
  origem: ContaRef;
  destino: ContaRef;
  valorCentavos: number;
  data: string;
  descricao: string;
}

export const lerPedidoDeTransferencia = (corpo: unknown): { erro: string } | { pedido: PedidoDeTransferencia } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const origem = contaRef(c.origem);
  const destino = contaRef(c.destino);
  if (!origem) return { erro: 'Escolha de onde o dinheiro sai.' };
  if (!destino) return { erro: 'Escolha para onde o dinheiro vai.' };
  if (mesmaConta(origem, destino)) return { erro: 'Origem e destino são a mesma conta. Escolha contas diferentes.' };
  const valorCentavos = valorPositivo(c.valorCentavos);
  if (!valorCentavos) return { erro: 'Informe um valor maior que zero.' };
  const data = dataValida(c.data);
  if (!data) return { erro: 'Informe a data da transferência.' };
  return { pedido: { origem, destino, valorCentavos, data, descricao: texto(c.descricao, DESCRICAO_MAX) } };
};

/** Caixa e' dinheiro fisico: nao sai mais do que tem. */
export const erroDeSaldoDoCaixa = (nome: string, saldoCentavos: number, valorCentavos: number): string | null => (
  valorCentavos > saldoCentavos
    ? `O ${nome} tem ${formatarReais(saldoCentavos)}; não dá para tirar ${formatarReais(valorCentavos)}. Confira o saldo ou lance a entrada que falta.`
    : null
);

/** Texto de cada lado do par de lancamentos. */
export const descricoesDaTransferencia = (nomeOrigem: string, nomeDestino: string, descricao: string): { saida: string; entrada: string } => ({
  saida: descricao || `Transferência para ${nomeDestino}`,
  entrada: descricao || `Transferência de ${nomeOrigem}`,
});

// ---------------------------------------------------------------------------
// SANGRIA DO PDV PARA DEPOSITO
// ---------------------------------------------------------------------------

export const MOTIVO_SANGRIA_DEPOSITO = 'Sangria para depósito';

export interface SangriaParaDeposito {
  bancoId: string;
  valorCentavos: number;
  sessaoId: string;
  data: string;
}

export const lerSangriaParaDeposito = (corpo: unknown): { erro: string } | { sangria: SangriaParaDeposito } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const bancoId = typeof c.bancoId === 'string' && ID_VALIDO.test(c.bancoId) ? c.bancoId : '';
  if (!bancoId) return { erro: 'Escolha em qual banco o dinheiro será depositado.' };
  const valorCentavos = valorPositivo(c.valorCentavos);
  if (!valorCentavos) return { erro: 'Informe um valor maior que zero.' };
  const sessaoId = typeof c.sessaoId === 'string' && ID_VALIDO.test(c.sessaoId) ? c.sessaoId : '';
  if (!sessaoId) return { erro: 'Caixa do PDV não identificado. Feche e abra o PDV e tente de novo.' };
  const data = dataValida(c.data);
  if (!data) return { erro: 'Informe a data da sangria.' };
  return { sangria: { bancoId, valorCentavos, sessaoId, data } };
};

// ---------------------------------------------------------------------------
// SITUACAO DO CHEQUE RECEBIDO
// ---------------------------------------------------------------------------

/** Antes de compensar: na carteira, depositado (aguardando o banco) ou devolvido. Compensado = titulo Paga. */
export type SituacaoChequeRecebido = 'em_carteira' | 'depositado' | 'devolvido' | 'compensado';

export const ROTULO_SITUACAO_CHEQUE_RECEBIDO: Record<SituacaoChequeRecebido, string> = {
  em_carteira: 'Em carteira',
  depositado: 'Depositado — aguardando compensação',
  devolvido: 'Devolvido',
  compensado: 'Compensado',
};

// `cheque` e' `object` (nao `{ situacao?: unknown }`) de proposito: o tipo da
// tela (ChequeDetails) nao tem `situacao`, e o TypeScript recusaria um objeto
// sem nenhuma propriedade em comum.
interface ChequeLido {
  status?: unknown;
  tipo?: unknown;
  cheque?: object | null;
}

export const situacaoDoCheque = (t: ChequeLido): SituacaoChequeRecebido => {
  if (t.status === 'Paga') return 'compensado';
  const s = t.cheque && typeof t.cheque === 'object' ? (t.cheque as { situacao?: unknown }).situacao : undefined;
  return s === 'depositado' || s === 'devolvido' ? s : 'em_carteira';
};

const erroBasico = (t: ChequeLido): string | null => {
  if (t.tipo === 'saida') return 'Este é um cheque emitido pela empresa; depositar e devolver valem só para cheque recebido.';
  if (t.status === 'Cancelada') return 'Este cheque está cancelado.';
  if (t.status === 'Paga') return 'Este cheque já foi compensado.';
  return null;
};

export const erroParaDepositarCheque = (t: ChequeLido): string | null => {
  const basico = erroBasico(t);
  if (basico) return basico;
  if (situacaoDoCheque(t) === 'depositado') return 'Este cheque já está depositado. Quando o banco confirmar, use "Confirmar compensação".';
  return null;
};

export const erroParaDevolverCheque = (t: ChequeLido): string | null => {
  const basico = erroBasico(t);
  if (basico) return basico;
  if (situacaoDoCheque(t) === 'devolvido') return 'Este cheque já está marcado como devolvido.';
  return null;
};

export const erroParaVoltarChequeParaCarteira = (t: ChequeLido): string | null => {
  const basico = erroBasico(t);
  if (basico) return basico;
  if (situacaoDoCheque(t) === 'em_carteira') return 'Este cheque já está na carteira.';
  return null;
};
