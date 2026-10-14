import {
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
 * frontend, mas se ele atrasar num projeto o Firestore responde
 * `failed-precondition` e a tela quebraria. Aqui ela cai na consulta de
 * RESERVA (a antiga, mais larga) e avisa no console: os números continuam
 * certos, só custam mais. Mesmo padrão do Dashboard (assinarColecaoDoPeriodo).
 *
 * Regra para quem usa: a reserva devolve um SUPERCONJUNTO da enxuta, então a
 * tela mantém o filtro que já fazia no navegador — os dois caminhos mostram o
 * mesmo resultado.
 */

const avisarReserva = (rotulo: string) => {
  console.warn(`${rotulo}: índice composto ainda não publicado neste projeto; usando a consulta antiga (mais leituras).`);
};

const faltaIndice = (erro: unknown) => (erro as FirestoreError | undefined)?.code === 'failed-precondition';

export const assinarComReserva = (
  enxuta: Query<DocumentData>,
  reserva: Query<DocumentData>,
  rotulo: string,
  aoReceber: (snapshot: QuerySnapshot<DocumentData>) => void,
  aoFalhar?: (erro: FirestoreError) => void,
): (() => void) => {
  let ativo = true;
  let cancelar = onSnapshot(enxuta, aoReceber, (erro) => {
    if (!ativo) return;
    if (faltaIndice(erro)) {
      avisarReserva(rotulo);
      cancelar = onSnapshot(reserva, aoReceber, aoFalhar);
      return;
    }
    if (aoFalhar) aoFalhar(erro);
    else console.error(`${rotulo}:`, erro);
  });
  return () => {
    ativo = false;
    cancelar();
  };
};

export const lerComReserva = async (
  enxuta: Query<DocumentData>,
  reserva: Query<DocumentData>,
  rotulo: string,
): Promise<QuerySnapshot<DocumentData>> => {
  try {
    return await getDocs(enxuta);
  } catch (erro) {
    if (!faltaIndice(erro)) throw erro;
    avisarReserva(rotulo);
    return getDocs(reserva);
  }
};
