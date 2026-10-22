import { NOME_DA_TELA, PERMISSAO_LIBERAR_DESCONTO, podeLiberarDesconto, type TelaDoDesconto } from './conferenciaDescontoDomain';
import { hasTenantFullAccess } from './roles';

/**
 * LIBERACAO DE DESCONTO PELO CELULAR (pedido do dono, 21/10/2026).
 *
 * Hoje o desconto acima do limite (modo "senha") so' passa com o gerente
 * digitando a senha NA ESTACAO (SolicitarAprovacaoDescontoModal). Com isto o
 * vendedor pode "Pedir ao gerente": o pedido fica gravado, quem pode liberar
 * recebe um aviso no celular, abre o app na tela Liberacoes e aprova ou
 * recusa -- confirmando com o PIN ou a senha (decisao do dono: mesmo nivel
 * de seguranca de hoje; celular esquecido aberto nao libera desconto). A
 * estacao acompanha e segue sozinha quando aprovado.
 *
 * O pedido vence em 10 minutos. Tudo pelo servidor: a colecao
 * `liberacoes_desconto` nao tem regra no Firestore (so' o servidor le e
 * grava); a estacao e o app consultam pela API. A senha na estacao continua
 * valendo como sempre.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */

export type TelaDoPedidoRemoto = TelaDoDesconto | 'orcamento';

export const NOME_DA_TELA_REMOTA: Record<TelaDoPedidoRemoto, string> = { ...NOME_DA_TELA, orcamento: 'Orçamento' };

/** O gerente tem 10 minutos; depois o vendedor pede de novo (ou usa a senha). */
export const VALIDADE_DO_PEDIDO_MS = 10 * 60 * 1000;
export const MINUTOS_DE_VALIDADE_DO_PEDIDO = VALIDADE_DO_PEDIDO_MS / 60000;

/** A estacao pergunta ao servidor a cada 3 s enquanto espera; o app, a cada 10 s na tela. */
export const INTERVALO_CONSULTA_ESTACAO_MS = 3000;
export const INTERVALO_CONSULTA_APP_MS = 10000;

export const MOTIVO_MAXIMO = 300;
export const DOCUMENTO_MAXIMO = 120;
export const MOTIVO_RECUSA_MAXIMO = 200;

export type StatusLiberacaoRemota = 'pendente' | 'aprovada' | 'recusada' | 'vencida' | 'cancelada';

export const ROTULO_STATUS_LIBERACAO: Record<StatusLiberacaoRemota, string> = {
  pendente: 'Aguardando o gerente',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  vencida: 'Venceu sem resposta',
  cancelada: 'Cancelada pelo vendedor',
};

export interface PedidoRemoto {
  tela: TelaDoPedidoRemoto;
  baseCentavos: number;
  descontoCentavos: number;
  /** Texto da tela ("Desconto de 12,5% neste pedido, acima do limite..."). */
  motivo: string;
  /** "Pedido #0231 — JOÃO" / "Cupom no PDV" / "OS #45". */
  documento: string;
}

/** O que fica gravado e o que a tela/app leem. */
export interface RegistroDaLiberacao extends PedidoRemoto {
  id: string;
  status: StatusLiberacaoRemota;
  solicitanteId: string;
  solicitanteNome: string;
  /** Sessao que pediu: e' para ela que o comprovante e' emitido. */
  estacaoUid: string;
  criadoEmIso: string;
  expiraEmMs: number;
  aprovadorId?: string;
  aprovadorNome?: string;
  respondidoEmIso?: string;
  comprovanteId?: string;
  motivoRecusa?: string;
}

const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const texto = (v: unknown, maximo: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, maximo);

const TELAS: readonly TelaDoPedidoRemoto[] = ['pedido', 'pdv', 'os', 'orcamento'];

export const lerPedidoRemoto = (corpo: unknown): { erro: string } | { pedido: PedidoRemoto } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const tela = TELAS.find((t) => t === c.tela);
  if (!tela) return { erro: 'Tela da liberação inválida. Atualize a página e tente de novo.' };
  const baseCentavos = numero(c.baseCentavos);
  const descontoCentavos = numero(c.descontoCentavos);
  if (!Number.isInteger(baseCentavos) || !Number.isInteger(descontoCentavos) || baseCentavos <= 0 || descontoCentavos <= 0 || descontoCentavos > baseCentavos) {
    return { erro: 'Valores do desconto inválidos. Confira o desconto e peça a liberação de novo.' };
  }
  return { pedido: { tela, baseCentavos, descontoCentavos, motivo: texto(c.motivo, MOTIVO_MAXIMO), documento: texto(c.documento, DOCUMENTO_MAXIMO) } };
};

export const percentualDoDesconto = (baseCentavos: number, descontoCentavos: number): number => (
  baseCentavos > 0 ? Math.round((descontoCentavos / baseCentavos) * 1000) / 10 : 0
);

export const formatarReais = (centavos: number): string => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;

/** Situacao lida AGORA: pedido pendente alem do prazo e' "vencida", mesmo que o banco ainda diga pendente. */
export const situacaoAtual = (registro: { status?: unknown; expiraEmMs?: unknown }, agoraMs: number): StatusLiberacaoRemota => {
  const status = String(registro.status || 'pendente') as StatusLiberacaoRemota;
  if (status === 'pendente' && !(agoraMs <= numero(registro.expiraEmMs))) return 'vencida';
  return (['pendente', 'aprovada', 'recusada', 'vencida', 'cancelada'] as const).includes(status) ? status : 'pendente';
};

export const segundosRestantes = (registro: { expiraEmMs?: unknown }, agoraMs: number): number => (
  Math.max(0, Math.ceil((numero(registro.expiraEmMs) - agoraMs) / 1000))
);

/** "4:59" para o contador da estacao. */
export const textoDoTempoRestante = (segundos: number): string => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

/** Por que este pedido nao pode mais ser respondido (ou null). */
export const erroParaResponder = (registro: { status?: unknown; expiraEmMs?: unknown; aprovadorNome?: unknown }, agoraMs: number): string | null => {
  switch (situacaoAtual(registro, agoraMs)) {
    case 'pendente': return null;
    case 'aprovada': return `Este pedido já foi aprovado${registro.aprovadorNome ? ` por ${String(registro.aprovadorNome)}` : ''}.`;
    case 'recusada': return `Este pedido já foi recusado${registro.aprovadorNome ? ` por ${String(registro.aprovadorNome)}` : ''}.`;
    case 'cancelada': return 'O vendedor cancelou este pedido de liberação.';
    default: return `Este pedido venceu (o gerente tem ${MINUTOS_DE_VALIDADE_DO_PEDIDO} minutos para responder). Peça ao vendedor para pedir de novo.`;
  }
};

/** "ANA pede 12,5% de desconto (R$ 30,00 em R$ 240,00) — Pedido de Venda, Pedido #0231" */
export const textoDoPedido = (r: Pick<RegistroDaLiberacao, 'solicitanteNome' | 'baseCentavos' | 'descontoCentavos' | 'tela' | 'documento'>): string => {
  const pct = percentualDoDesconto(r.baseCentavos, r.descontoCentavos).toLocaleString('pt-BR');
  const onde = [NOME_DA_TELA_REMOTA[r.tela], r.documento].filter(Boolean).join(', ');
  return `${r.solicitanteNome || 'Vendedor'} pede ${pct}% de desconto (${formatarReais(r.descontoCentavos)} em ${formatarReais(r.baseCentavos)}) — ${onde}`;
};

/** Aviso que chega no celular de quem pode liberar. */
export const notificacaoDoPedido = (r: Pick<RegistroDaLiberacao, 'solicitanteNome' | 'baseCentavos' | 'descontoCentavos' | 'tela' | 'documento'>): { titulo: string; corpo: string } => {
  const pct = percentualDoDesconto(r.baseCentavos, r.descontoCentavos).toLocaleString('pt-BR');
  return {
    titulo: 'Liberar desconto?',
    corpo: `${r.solicitanteNome || 'Vendedor'} pede ${pct}% (${formatarReais(r.descontoCentavos)}) — ${[NOME_DA_TELA_REMOTA[r.tela], r.documento].filter(Boolean).join(', ')}`,
  };
};

// ---------------------------------------------------------------------------
// Resposta do gerente (POST /api/descontos/liberacoes/:id/responder)
// ---------------------------------------------------------------------------

export type CredencialDoGerente =
  /** Usuario com login: a senha vira uma sessao recem-aberta (idToken), como na estacao. */
  | { tipo: 'login'; idToken: string }
  /** Vendedor de balcao / login por codigo: o proprio PIN. */
  | { tipo: 'pin'; pin: string };

export interface RespostaDoGerente {
  decisao: 'aprovar' | 'recusar';
  motivoRecusa: string;
  credencial: CredencialDoGerente;
}

export const lerResposta = (corpo: unknown): { erro: string } | { resposta: RespostaDoGerente } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const decisao = c.decisao === 'aprovar' || c.decisao === 'recusar' ? c.decisao : null;
  if (!decisao) return { erro: 'Escolha Aprovar ou Recusar.' };
  const cr = (c.credencial && typeof c.credencial === 'object' ? c.credencial : {}) as Record<string, unknown>;
  let credencial: CredencialDoGerente | null = null;
  if (cr.tipo === 'login' && typeof cr.idToken === 'string' && cr.idToken.length > 20 && cr.idToken.length < 5000) credencial = { tipo: 'login', idToken: cr.idToken };
  if (cr.tipo === 'pin' && typeof cr.pin === 'string' && cr.pin.trim()) credencial = { tipo: 'pin', pin: cr.pin.trim() };
  if (!credencial) return { erro: 'Confirme com a sua senha (ou o seu PIN) para responder.' };
  return { resposta: { decisao, motivoRecusa: texto(c.motivoRecusa, MOTIVO_RECUSA_MAXIMO), credencial } };
};

/** Quem ve a tela Liberacoes no app: dono/gestor, ou quem tem "Liberar desconto". */
export const podeLiberarDescontoNoApp = (userRole: unknown, isOwner: boolean, permissoes: string[]): boolean => (
  hasTenantFullAccess(userRole, isOwner) || permissoes.includes(PERMISSAO_LIBERAR_DESCONTO)
);

export { podeLiberarDesconto };
