/**
 * TRAVA DE EDICAO (pedido do dono, 15/10/2026): duas pessoas nao abrem o
 * mesmo documento ao mesmo tempo -- quem salvava por ultimo apagava o que o
 * outro fez. Quem abre "pega a vez"; enquanto a tela estiver aberta, ela
 * avisa o servidor; nas listas o documento fica cinza com "Em edicao por
 * Fulano (celular)" e quem clica nao abre. Vale no computador e no celular.
 *
 * Decisoes do dono (15/10/2026):
 *  - bloqueia (nao abre nem para ver);
 *  - 10 minutos sem mexer na tela liberam a vez; celular desligado ou
 *    navegador fechado liberam em ate 2 minutos (sem o aviso de "continuo
 *    aqui"); o dono ou um gerente libera na hora.
 *
 * O servidor e' quem grava (server/services/travasEdicao.js); as telas so'
 * leem `travas_edicao` para pintar as listas. O tempo e' sempre o do
 * servidor (milissegundos), para relogio errado de celular nao valer.
 */

// Fase 2 (16/10/2026, decisao do dono "todas as telas"): OS, orcamento,
// condicional, troca, romaneio e os cadastros de produto, cliente e fornecedor.
export const TIPOS_DE_TRAVA = [
  'conferencia', 'pedido_venda',
  'ordem_servico', 'orcamento', 'condicional', 'troca', 'romaneio',
  'produto', 'cliente', 'fornecedor',
] as const;
export type TipoDeTrava = typeof TIPOS_DE_TRAVA[number];

export type Aparelho = 'computador' | 'celular';

/** Sem o aviso de "continuo aqui" por mais que isto, a tela foi fechada ou caiu. */
export const SEM_SINAL_LIBERA_MS = 2 * 60 * 1000;
/** Tela aberta sem ninguem mexer por mais que isto: a vez e' liberada. */
export const PARADO_LIBERA_MS = 10 * 60 * 1000;
/** De quanto em quanto tempo a tela avisa que continua aberta. */
export const INTERVALO_DO_SINAL_MS = 30 * 1000;

export interface TravaDeEdicao {
  tenantId: string;
  tipo: TipoDeTrava;
  registroId: string;
  usuarioId: string;
  usuarioNome: string;
  aparelho: Aparelho;
  /** Uma por tela aberta: o mesmo usuario em dois aparelhos sao duas sessoes. */
  sessaoId: string;
  desdeMs: number;
  ultimoSinalMs: number;
  ultimaAtividadeMs: number;
  /** Ate quando a trava vale sem novo sinal (o menor dos dois prazos). */
  validaAteMs: number;
}

export const ROTULO_DO_TIPO: Record<TipoDeTrava, string> = {
  conferencia: 'a conferência',
  pedido_venda: 'o pedido',
  ordem_servico: 'a OS',
  orcamento: 'o orçamento',
  condicional: 'o condicional',
  troca: 'a troca',
  romaneio: 'o romaneio',
  produto: 'o produto',
  cliente: 'o cadastro do cliente',
  fornecedor: 'o cadastro do fornecedor',
};

export const ehTipoDeTrava = (valor: unknown): valor is TipoDeTrava => TIPOS_DE_TRAVA.includes(valor as TipoDeTrava);

/** Documento da trava: um por registro de cada tipo, dentro da empresa. */
export const idDaTrava = (tenantId: string, tipo: TipoDeTrava, registroId: string): string => `${tenantId}__${tipo}__${registroId}`;

export const calcularValidade = (ultimoSinalMs: number, ultimaAtividadeMs: number): number => (
  Math.min(ultimoSinalMs + SEM_SINAL_LIBERA_MS, ultimaAtividadeMs + PARADO_LIBERA_MS)
);

/** A trava ainda segura o documento? (sem trava, ou vencida = livre) */
export const travaAtiva = (trava: Pick<TravaDeEdicao, 'validaAteMs'> | null | undefined, agoraMs: number): boolean => (
  Boolean(trava) && Number(trava!.validaAteMs) > agoraMs
);

export type ResultadoDePegar =
  | { tipo: 'livre' }
  | { tipo: 'mesma_sessao' }
  /** O mesmo usuario em outra tela/aparelho: a nova abertura assume a vez. */
  | { tipo: 'mesmo_usuario' }
  | { tipo: 'de_outro'; trava: TravaDeEdicao };

export const avaliarPegar = (
  atual: TravaDeEdicao | null | undefined,
  pedido: { usuarioId: string; sessaoId: string },
  agoraMs: number,
): ResultadoDePegar => {
  if (!atual || !travaAtiva(atual, agoraMs)) return { tipo: 'livre' };
  if (atual.sessaoId === pedido.sessaoId) return { tipo: 'mesma_sessao' };
  if (atual.usuarioId === pedido.usuarioId) return { tipo: 'mesmo_usuario' };
  return { tipo: 'de_outro', trava: atual };
};

export type ResultadoDoSinal =
  | { tipo: 'ok'; validaAteMs: number }
  /** Ninguem pegou, mas a vez venceu (parado demais ou sem sinal): a tela pode pegar de novo ao mexer. */
  | { tipo: 'venceu' }
  | { tipo: 'perdeu'; trava: TravaDeEdicao };

/** O aviso de "continuo aqui" de uma tela: renova, venceu ou outra pessoa/tela ficou com a vez. */
export const avaliarSinal = (
  atual: TravaDeEdicao | null | undefined,
  sessaoId: string,
  agoraMs: number,
): ResultadoDoSinal => {
  if (atual && atual.sessaoId !== sessaoId && travaAtiva(atual, agoraMs)) return { tipo: 'perdeu', trava: atual };
  if (!atual || atual.sessaoId !== sessaoId || !travaAtiva(atual, agoraMs)) return { tipo: 'venceu' };
  return { tipo: 'ok', validaAteMs: atual.validaAteMs };
};

const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** "Em edição por MARIA no celular desde 14:32" -- para a lista cinza e o aviso. */
export const descreverTrava = (trava: Pick<TravaDeEdicao, 'usuarioNome' | 'aparelho' | 'desdeMs'>): string => (
  `Em edição por ${trava.usuarioNome || 'outro usuário'} no ${trava.aparelho === 'celular' ? 'celular' : 'computador'} desde ${hora(trava.desdeMs)}`
);

/** Mensagem para quem tentou abrir o que outra pessoa esta editando. */
export const mensagemDeBloqueio = (tipo: TipoDeTrava, trava: Pick<TravaDeEdicao, 'usuarioNome' | 'aparelho' | 'desdeMs'>): string => (
  `${descreverTrava(trava)}. Espere terminar para abrir ${ROTULO_DO_TIPO[tipo]}: assim um não apaga o que o outro fez. Se a pessoa saiu e deixou aberto, a vez é liberada sozinha depois de 10 minutos parada, ou o dono/gerente libera agora.`
);
