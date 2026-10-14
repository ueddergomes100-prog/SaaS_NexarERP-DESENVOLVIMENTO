import {
  getCountFromServer,
  getDocs,
  onSnapshot,
  type DocumentData,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';

/**
 * CONSULTA ENXUTA COM RESERVA (otimização de leituras, 2026-10-14).
 *
 * A consulta enxuta (só o período / só os pendentes) quase sempre precisa de
 * um índice composto. Índice novo é publicado em dev e produção ANTES do
 * frontend, mas se ele atrasar num projeto (ou ainda estiver sendo montado) o
 * Firestore responde `failed-precondition`. Aqui a tela usa a consulta de
 * RESERVA (a antiga, mais larga) e avisa no console: os números continuam
 * certos, só custam mais.
 *
 * Regra para quem usa: a reserva devolve um SUPERCONJUNTO da enxuta, então a
 * tela mantém o filtro que já fazia no navegador — os dois caminhos mostram o
 * mesmo resultado.
 *
 * NUNCA abrir escuta que vai falhar por falta de índice (teste de 14/10): o
 * SDK 12 se perde quando um alvo que falhou é ligado/desligado em seguida
 * (troca de aba, digitar a data, StrictMode) — "INTERNAL ASSERTION FAILED:
 * Unexpected state (ID: ca9)", o cliente do Firestore morre e toda tela
 * aberta depois quebra. Reproduzido no navegador. Por isso, antes da primeira
 * escuta de cada consulta, uma CONTAGEM no servidor (getCountFromServer — RPC
 * avulsa, fora do canal das escutas, 1 leitura) confirma se o índice existe.
 * A resposta fica guardada até recarregar a página, então é uma vez por tipo
 * de consulta (o `rotulo`) por sessão.
 */

const indicesConfirmados = new Set<string>();
const indicesAusentes = new Set<string>();
const conferencias = new Map<string, Promise<boolean>>();

const avisarReserva = (rotulo: string) => {
  console.warn(`${rotulo}: índice composto ainda não publicado neste projeto; usando a consulta antiga (mais leituras).`);
};

const faltaIndice = (erro: unknown) => (erro as FirestoreError | undefined)?.code === 'failed-precondition';

/**
 * O índice da consulta enxuta existe? true = usar a enxuta; false = usar a
 * reserva. Erro que não é de índice (sem rede, permissão) responde true: a
 * escuta segue o caminho normal e mostra o próprio erro.
 */
const indiceDisponivel = (enxuta: Query<DocumentData>, rotulo: string): Promise<boolean> => {
  if (indicesConfirmados.has(rotulo)) return Promise.resolve(true);
  if (indicesAusentes.has(rotulo)) return Promise.resolve(false);
  const emAndamento = conferencias.get(rotulo);
  if (emAndamento) return emAndamento;
  const conferencia = getCountFromServer(enxuta)
    .then(() => {
      indicesConfirmados.add(rotulo);
      return true;
    })
    .catch((erro) => {
      if (!faltaIndice(erro)) return true;
      indicesAusentes.add(rotulo);
      avisarReserva(rotulo);
      return false;
    })
    .finally(() => conferencias.delete(rotulo));
  conferencias.set(rotulo, conferencia);
  return conferencia;
};

export const assinarComReserva = (
  enxuta: Query<DocumentData>,
  reserva: Query<DocumentData>,
  rotulo: string,
  aoReceber: (snapshot: QuerySnapshot<DocumentData>) => void,
  aoFalhar?: (erro: FirestoreError) => void,
): (() => void) => {
  let ativo = true;
  let cancelar: () => void = () => {};
  const tratarErro = (erro: FirestoreError) => {
    if (!ativo) return;
    if (aoFalhar) aoFalhar(erro);
    else console.error(`${rotulo}:`, erro);
  };
  const escutar = (consulta: Query<DocumentData>) => {
    if (!ativo) return;
    cancelar = onSnapshot(consulta, aoReceber, tratarErro);
  };

  if (indicesConfirmados.has(rotulo)) escutar(enxuta);
  else if (indicesAusentes.has(rotulo)) escutar(reserva);
  else void indiceDisponivel(enxuta, rotulo).then((existe) => escutar(existe ? enxuta : reserva));

  return () => {
    ativo = false;
    cancelar();
  };
};

export const lerComReserva = async (
  enxuta: Query<DocumentData>,
  reserva: Query<DocumentData>,
  rotulo: string,
): Promise<QuerySnapshot<DocumentData>> => (
  getDocs((await indiceDisponivel(enxuta, rotulo)) ? enxuta : reserva)
);
