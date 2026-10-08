/**
 * OFFLINE DO APP DO TECNICO (maquinas pesadas, fase 4 -- 2026-10-08).
 *
 * Na roca nao tem sinal. O que o tecnico faz na OS tem que ficar no aparelho
 * e subir sozinho quando a rede voltar. Tres pecas:
 *
 *  1. Firestore com cache persistente (services/firebase.ts, so' no app):
 *     leitura do que ja' foi visto (clientes, equipamentos, pecas, servicos,
 *     OS) e GRAVACOES simples (set/update) ficam na fila do proprio SDK.
 *  2. O que o SDK nao faz sozinho vira PENDENCIA aqui: numero da OS
 *     (precisa de transacao no servidor), reserva de estoque (idem), fotos e
 *     assinatura (arquivo no Storage). Guardadas no aparelho
 *     (utils/filaOffline.ts, IndexedDB) e reproduzidas por
 *     services/sincronizacaoOfflineService.ts.
 *  3. Service worker com cache dos arquivos do app (public/sw.js), para o
 *     app abrir sem rede.
 *
 * Este arquivo e' a parte pura: tipos, ordem de envio, textos e regras de
 * nova tentativa.
 */

export type TipoPendencia = 'numero_os' | 'reserva_os' | 'foto' | 'assinatura' | 'canhoto';

export interface PendenciaBase {
  id: string;
  tenantId: string;
  usuarioId: string;
  osId: string;
  tipo: TipoPendencia;
  /** ISO. */
  criadoEm: string;
  tentativas: number;
  ultimoErro: string;
  /** ISO da ultima tentativa, para o espacamento entre tentativas. */
  ultimaTentativaEm: string;
}

export interface PendenciaNumeroOs extends PendenciaBase { tipo: 'numero_os'; }
export interface PendenciaReservaOs extends PendenciaBase { tipo: 'reserva_os'; }
export interface PendenciaFoto extends PendenciaBase { tipo: 'foto'; legenda: string; nomeArquivo: string; }
export interface PendenciaAssinatura extends PendenciaBase { tipo: 'assinatura'; nomeAssinante: string; }
/** Foto do canhoto de uma entrega do romaneio (app do motorista, 2026-10-08). `osId` fica vazio. */
export interface PendenciaCanhoto extends PendenciaBase { tipo: 'canhoto'; romaneioId: string; pedidoId: string; nomeArquivo: string; }

export type Pendencia = PendenciaNumeroOs | PendenciaReservaOs | PendenciaFoto | PendenciaAssinatura | PendenciaCanhoto;

/** Numero que a OS carrega enquanto nao passou pelo servidor. */
export const NUMERO_OS_PROVISORIO = 'PENDENTE';

export const rotuloNumeroOS = (numeroOS: unknown, numeroProvisorio: unknown): string => (
  numeroProvisorio === true || numeroOS === NUMERO_OS_PROVISORIO || !numeroOS ? 'nº pendente' : `#${String(numeroOS)}`
);

export const ROTULO_PENDENCIA: Record<TipoPendencia, string> = {
  numero_os: 'Numerar a OS',
  reserva_os: 'Reservar o estoque das peças',
  foto: 'Enviar foto',
  assinatura: 'Enviar assinatura',
  canhoto: 'Enviar foto do canhoto',
};

const PESO: Record<TipoPendencia, number> = { numero_os: 0, reserva_os: 1, assinatura: 2, foto: 3, canhoto: 3 };

/** Numero primeiro (a OS precisa existir "de verdade"), depois reserva, assinatura e fotos, na ordem em que foram feitas. */
export const ordenarPendencias = <T extends Pendencia>(lista: ReadonlyArray<T>): T[] => (
  [...lista].sort((a, b) => PESO[a.tipo] - PESO[b.tipo] || a.criadoEm.localeCompare(b.criadoEm))
);

export const LIMITE_TENTATIVAS = 8;

/** Espera entre tentativas cresce com o numero de falhas (30 s, 1 min, 2, 4, 8... ate 30 min). */
export const esperaAposFalhaMs = (tentativas: number): number => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, tentativas - 1));

export const podeTentarAgora = (p: Pick<Pendencia, 'tentativas' | 'ultimaTentativaEm'>, agoraIso: string): boolean => {
  if (p.tentativas === 0 || !p.ultimaTentativaEm) return true;
  if (p.tentativas >= LIMITE_TENTATIVAS) return false;
  const ultima = Date.parse(p.ultimaTentativaEm);
  const agora = Date.parse(agoraIso);
  if (!Number.isFinite(ultima) || !Number.isFinite(agora)) return true;
  return agora - ultima >= esperaAposFalhaMs(p.tentativas);
};

export interface ResumoPendencias {
  total: number;
  travadas: number;
  texto: string;
}

export const resumoPendencias = (lista: ReadonlyArray<Pick<Pendencia, 'tentativas'>>): ResumoPendencias => {
  const total = lista.length;
  const travadas = lista.filter((p) => p.tentativas >= LIMITE_TENTATIVAS).length;
  const texto = total === 0
    ? 'Tudo enviado'
    : total === 1 ? '1 pendência para enviar' : `${total} pendências para enviar`;
  return { total, travadas, texto: travadas > 0 ? `${texto} (${travadas} com erro — toque para ver)` : texto };
};

/** Fotos que ainda nao subiram aparecem na OS como "pendente", com a legenda digitada. */
export interface FotoPendenteExibicao {
  pendenciaId: string;
  legenda: string;
  criadoEm: string;
  erro: string;
}

export const fotosPendentesDaOs = (lista: ReadonlyArray<Pendencia>, osId: string): FotoPendenteExibicao[] => (
  lista
    .filter((p): p is PendenciaFoto => p.tipo === 'foto' && p.osId === osId)
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
    .map((p) => ({ pendenciaId: p.id, legenda: p.legenda, criadoEm: p.criadoEm, erro: p.ultimoErro }))
);

export const temAssinaturaPendente = (lista: ReadonlyArray<Pendencia>, osId: string): boolean => (
  lista.some((p) => p.tipo === 'assinatura' && p.osId === osId)
);

/** Canhotos de uma rota ainda no aparelho, por pedido (o app mostra "foto pendente"). */
export const canhotosPendentesDaRota = (lista: ReadonlyArray<Pendencia>, romaneioId: string): Map<string, PendenciaCanhoto> => {
  const mapa = new Map<string, PendenciaCanhoto>();
  lista
    .filter((p): p is PendenciaCanhoto => p.tipo === 'canhoto' && p.romaneioId === romaneioId)
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
    .forEach((p) => mapa.set(p.pedidoId, p));
  return mapa;
};

/** Mensagem curta para a faixa do app. */
export const textoDaFaixaOffline = (online: boolean, resumo: ResumoPendencias, enviando: boolean): string | null => {
  if (!online) return resumo.total > 0 ? `Sem conexão — ${resumo.texto.toLowerCase()} quando a rede voltar` : 'Sem conexão — o que você fizer fica guardado no aparelho';
  if (enviando) return 'Enviando pendências…';
  if (resumo.total > 0) return resumo.texto;
  return null;
};
