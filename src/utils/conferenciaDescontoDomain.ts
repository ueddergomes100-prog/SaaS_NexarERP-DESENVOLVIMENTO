/*
 * DESCONTO, LIBERACAO E VENDEDOR CONFERIDOS PELO SERVIDOR (19/10/2026,
 * auditoria "so' a tela protege", decisao do dono: o servidor confere tudo).
 *
 * Com a chave "Venda pelo servidor" ligada, o Finalizar do Pedido de Venda, do
 * PDV e da OS passa pelo servidor, que agora tambem confere:
 *
 *  - o desconto de cada item contra o limite do PRODUTO (sempre bloqueia) e,
 *    no Pedido de Venda com o modo "bloquear", contra o limite da tela;
 *  - o desconto TOTAL contra o limite da tela (Configuracoes), descontado o
 *    que o cadastro do cliente ja autoriza, no modo da empresa
 *    (avisar/bloquear/senha) -- as mesmas regras de descontoDomain.ts;
 *  - no modo "senha", a LIBERACAO: o servidor confere a senha (ou o PIN) do
 *    aprovador e entrega um COMPROVANTE que vale pouco tempo, para aquela
 *    tela e aquele valor, e e' gasto na venda;
 *  - com "Exigir identificacao do vendedor" ligado (Pedido de Venda), que o
 *    vendedor da venda e' quem digitou codigo + senha (outro comprovante).
 *
 * Com a chave desligada, a tela segue conferindo sozinha (fica para a 3e).
 * O PRECO de cada item ainda vem da tela -- conferir preco e' outro passo.
 */
import {
  checarLimiteComCliente,
  checarLimiteTotal,
  excedeLimiteItem,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  resolveLimiteItem,
  type LimiteDescontoConfig,
  type ModoLimiteDesconto,
} from './descontoDomain';
import { hasModuleAccess } from './roles';
import { parseExigirIdentificacaoVendedor } from './vendedorPinDomain';

export type TelaDoDesconto = 'pedido' | 'pdv' | 'os';

/** Campo de `configuracoes` com o limite de cada tela (o mesmo que a tela le). */
export const CAMPO_DO_LIMITE: Record<TelaDoDesconto, string> = {
  pedido: 'limiteDescontoPedido',
  pdv: 'limiteDescontoPdv',
  os: 'limiteDescontoOS',
};

export const NOME_DA_TELA: Record<TelaDoDesconto, string> = {
  pedido: 'Pedido de Venda',
  pdv: 'PDV',
  os: 'Ordem de Serviço',
};

/** Comprovante vale 30 minutos: da para fechar o pagamento com calma, mas nao serve no dia seguinte. */
export const VALIDADE_DO_COMPROVANTE_MS = 30 * 60 * 1000;
export const MINUTOS_DE_VALIDADE = VALIDADE_DO_COMPROVANTE_MS / 60000;

/** A senha do aprovador tem de ter sido digitada agora (sessao do aprovador com no maximo 5 minutos). */
export const IDADE_MAXIMA_DO_LOGIN_DO_APROVADOR_S = 5 * 60;

export const TIPO_LIBERACAO = 'liberacao_desconto';
export const TIPO_IDENTIFICACAO = 'identificacao_vendedor';

/** Status HTTP de "falta liberacao/identificacao valida": a tela pede de novo. */
export const STATUS_PEDIR_DE_NOVO = 428;

export const PERMISSAO_LIBERAR_DESCONTO = 'vendas.liberar_desconto';

const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export interface ConfigDoDesconto {
  limite: LimiteDescontoConfig;
  modo: ModoLimiteDesconto;
}

/** Limite e modo da tela, lidos de `configuracoes` como a tela le. */
export const configDoDesconto = (config: Record<string, unknown> | null | undefined, tela: TelaDoDesconto): ConfigDoDesconto => ({
  limite: parseLimiteDescontoConfig(config ? config[CAMPO_DO_LIMITE[tela]] : undefined),
  modo: parseModoLimiteDesconto(config ? config.modoLimiteDesconto : undefined),
});

/** A empresa exige que o vendedor se identifique (codigo + senha) a cada venda? */
export const exigeIdentificacaoDoVendedor = (config: Record<string, unknown> | null | undefined): boolean => (
  parseExigirIdentificacaoVendedor(config ? config.exigirIdentificacaoVendedor : undefined)
);

const descricaoDoLimite = (limite: LimiteDescontoConfig) => (
  limite.tipo === 'valor'
    ? `R$ ${limite.valor.toFixed(2).replace('.', ',')}`
    : `${String(limite.valor).replace('.', ',')}%`
);

// ---------------------------------------------------------------------------
// Desconto de cada item
// ---------------------------------------------------------------------------

export interface ItemParaConferir {
  nome: string;
  /** Preco x quantidade, antes do desconto. */
  brutoCentavos: number;
  descontoCentavos: number;
  /** Cadastro do produto (so' o limite proprio importa); null = avulso. */
  produto?: { descontoMaximoPercentual?: number | null } | null;
}

/**
 * Problema no desconto de UM item, ou null. Limite do produto sempre bloqueia
 * (como no Pedido e no PDV); o limite da tela por item so' no Pedido de Venda
 * com o modo "bloquear" (o unico lugar onde a tela confere item a item).
 */
export const problemaNoDescontoDoItem = (
  item: ItemParaConferir,
  tela: TelaDoDesconto,
  { limite, modo }: ConfigDoDesconto,
): string | null => {
  if (!(item.descontoCentavos > 0) || !(item.brutoCentavos > 0)) return null;
  if (item.produto && excedeLimiteItem(item.produto, item.descontoCentavos, item.brutoCentavos)) {
    return `${item.nome} aceita no máximo ${resolveLimiteItem(item.produto)}% de desconto, definido no próprio cadastro. Reduza o desconto do item e finalize de novo.`;
  }
  if (tela === 'pedido' && modo === 'bloquear') {
    const checagem = checarLimiteTotal(limite, item.brutoCentavos, item.descontoCentavos);
    if (checagem.excedeu) {
      return `O desconto de ${item.nome} (${checagem.percentualAplicado.toFixed(1).replace('.', ',')}%) passa do limite de ${descricaoDoLimite(limite)} configurado para ${NOME_DA_TELA[tela]}. Reduza o desconto do item e finalize de novo.`;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Desconto total
// ---------------------------------------------------------------------------

export interface SituacaoDoDesconto {
  /** Passou do limite (acima do que o cliente ja tem direito). */
  excedeu: boolean;
  percentualAplicado: number;
  /** Modo "bloquear": a venda nao passa. */
  erro: string | null;
  /** Modo "senha": a venda so' passa com um comprovante de liberacao. */
  precisaLiberacao: boolean;
}

export const situacaoDoDescontoTotal = (args: {
  tela: TelaDoDesconto;
  config: ConfigDoDesconto;
  baseCentavos: number;
  descontoCentavos: number;
  percentualDoCliente: number;
}): SituacaoDoDesconto => {
  const checagem = checarLimiteComCliente(args.config.limite, args.baseCentavos, args.descontoCentavos, args.percentualDoCliente);
  const percentual = checagem.percentualAplicado.toFixed(1).replace('.', ',');
  if (!checagem.excedeu) return { excedeu: false, percentualAplicado: checagem.percentualAplicado, erro: null, precisaLiberacao: false };
  if (args.config.modo === 'bloquear') {
    return {
      excedeu: true,
      percentualAplicado: checagem.percentualAplicado,
      erro: `O desconto (${percentual}%) passa do limite de ${descricaoDoLimite(args.config.limite)} configurado para ${NOME_DA_TELA[args.tela]}. Reduza o desconto para continuar.`,
      precisaLiberacao: false,
    };
  }
  return { excedeu: true, percentualAplicado: checagem.percentualAplicado, erro: null, precisaLiberacao: args.config.modo === 'senha' };
};

// ---------------------------------------------------------------------------
// Comprovantes (gravados so' pelo servidor em `comprovantes_servidor`)
// ---------------------------------------------------------------------------

export interface Comprovante {
  tenantId?: unknown;
  tipo?: unknown;
  /** uid da sessao que pediu (a estacao/operador que vai finalizar). */
  emitidoPara?: unknown;
  pessoaId?: unknown;
  pessoaNome?: unknown;
  expiraEmMs?: unknown;
  criadoEmIso?: unknown;
  tela?: unknown;
  baseCentavos?: unknown;
  descontoCentavos?: unknown;
}

const PEDIR_LIBERACAO_DE_NOVO = 'Toque em Finalizar de novo e peça a liberação outra vez.';
const IDENTIFICAR_DE_NOVO = 'Toque em Finalizar de novo e digite o código e a senha do vendedor.';

const problemaBasico = (c: Comprovante | null, esperado: { tenantId: string; emitidoPara: string; tipo: string; agoraMs: number }): 'nao_vale' | 'venceu' | null => {
  if (!c || c.tenantId !== esperado.tenantId || c.tipo !== esperado.tipo || c.emitidoPara !== esperado.emitidoPara) return 'nao_vale';
  const expira = numero(c.expiraEmMs);
  if (!Number.isFinite(expira) || esperado.agoraMs > expira) return 'venceu';
  return null;
};

/** O comprovante de liberacao cobre este desconto? null = cobre. */
export const problemaDaLiberacao = (
  c: Comprovante | null,
  esperado: { tenantId: string; emitidoPara: string; tela: TelaDoDesconto; baseCentavos: number; descontoCentavos: number; agoraMs: number },
): string | null => {
  const basico = problemaBasico(c, { ...esperado, tipo: TIPO_LIBERACAO });
  if (basico === 'nao_vale' || (c && c.tela !== esperado.tela)) {
    return `A liberação do desconto não vale para esta venda (já foi usada ou foi dada em outra tela). ${PEDIR_LIBERACAO_DE_NOVO}`;
  }
  if (basico === 'venceu') return `A liberação do desconto venceu (vale ${MINUTOS_DE_VALIDADE} minutos). ${PEDIR_LIBERACAO_DE_NOVO}`;
  const descontoLiberado = numero(c!.descontoCentavos);
  const baseLiberada = numero(c!.baseCentavos);
  const percentualLiberado = baseLiberada > 0 ? (descontoLiberado / baseLiberada) * 100 : 0;
  const percentualAgora = esperado.baseCentavos > 0 ? (esperado.descontoCentavos / esperado.baseCentavos) * 100 : 0;
  // 1 centavo de folga, como nos limites (arredondamento).
  if (!(esperado.descontoCentavos <= descontoLiberado + 1) || percentualAgora > percentualLiberado + 0.05) {
    return `O desconto mudou depois da liberação. ${PEDIR_LIBERACAO_DE_NOVO}`;
  }
  return null;
};

/** O comprovante de identificacao e' deste vendedor? null = e'. */
export const problemaDaIdentificacao = (
  c: Comprovante | null,
  esperado: { tenantId: string; emitidoPara: string; vendedorId: string; agoraMs: number },
): string | null => {
  const basico = problemaBasico(c, { ...esperado, tipo: TIPO_IDENTIFICACAO });
  if (basico === 'venceu') return `A identificação do vendedor venceu (vale ${MINUTOS_DE_VALIDADE} minutos). ${IDENTIFICAR_DE_NOVO}`;
  if (basico === 'nao_vale' || c!.pessoaId !== esperado.vendedorId) {
    return `Esta empresa exige que o vendedor se identifique em cada venda, e a identificação desta venda não confere (já foi usada ou é de outro vendedor). ${IDENTIFICAR_DE_NOVO}`;
  }
  return null;
};

export const MENSAGEM_FALTA_LIBERACAO = `Este desconto passa do limite e precisa da liberação de um responsável. ${PEDIR_LIBERACAO_DE_NOVO}`;
export const MENSAGEM_FALTA_IDENTIFICACAO = `Esta empresa exige que o vendedor se identifique em cada venda. ${IDENTIFICAR_DE_NOVO}`;

/** O que fica gravado na venda/OS: quem liberou vem do comprovante, nunca da tela. */
export const aprovacaoDoComprovante = (c: Comprovante, comprovanteId: string) => ({
  modo: 'senha' as const,
  aprovadoPorId: String(c.pessoaId || ''),
  aprovadoPorNome: String(c.pessoaNome || ''),
  aprovadoEm: typeof c.criadoEmIso === 'string' && c.criadoEmIso ? c.criadoEmIso : new Date().toISOString(),
  comprovanteId,
});

// ---------------------------------------------------------------------------
// Pedido de liberacao (POST /api/descontos/liberar)
// ---------------------------------------------------------------------------

export type AprovadorDoPedido =
  | { tipo: 'login'; idToken: string }
  | { tipo: 'vendedor'; codigo: string; pin: string };

export interface PedidoDeLiberacao {
  tela: TelaDoDesconto;
  baseCentavos: number;
  descontoCentavos: number;
  aprovador: AprovadorDoPedido;
}

export const lerPedidoDeLiberacao = (corpo: unknown): { erro: string } | { pedido: PedidoDeLiberacao } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const tela = c.tela === 'pedido' || c.tela === 'pdv' || c.tela === 'os' ? c.tela : null;
  if (!tela) return { erro: 'Tela da liberação inválida. Atualize a página e tente de novo.' };
  const baseCentavos = numero(c.baseCentavos);
  const descontoCentavos = numero(c.descontoCentavos);
  if (!Number.isInteger(baseCentavos) || !Number.isInteger(descontoCentavos) || baseCentavos <= 0 || descontoCentavos <= 0 || descontoCentavos > baseCentavos) {
    return { erro: 'Valores do desconto inválidos. Confira o desconto e peça a liberação de novo.' };
  }
  const a = (c.aprovador && typeof c.aprovador === 'object' ? c.aprovador : {}) as Record<string, unknown>;
  if (a.tipo === 'login' && typeof a.idToken === 'string' && a.idToken.length > 20 && a.idToken.length < 5000) {
    return { pedido: { tela, baseCentavos, descontoCentavos, aprovador: { tipo: 'login', idToken: a.idToken } } };
  }
  if (a.tipo === 'vendedor' && typeof a.codigo === 'string' && typeof a.pin === 'string') {
    return { pedido: { tela, baseCentavos, descontoCentavos, aprovador: { tipo: 'vendedor', codigo: a.codigo, pin: a.pin } } };
  }
  return { erro: 'Escolha quem está liberando e digite a senha.' };
};

/** Quem pode liberar: dono, Admin/Master ou quem tem "Liberar desconto" (a mesma lista da tela). */
export const podeLiberarDesconto = (registro: { role?: unknown; permissoes?: unknown }, id: string, tenantId: string): boolean => hasModuleAccess({
  role: registro.role,
  isOwner: id === tenantId,
  permissions: Array.isArray(registro.permissoes) ? registro.permissoes.filter((p): p is string => typeof p === 'string') : [],
  requiredPermission: PERMISSAO_LIBERAR_DESCONTO,
});
