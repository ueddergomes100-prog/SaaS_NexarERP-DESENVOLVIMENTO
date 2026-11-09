import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { juntarRegistros, type RegistroLido } from '../utils/historicoAlteracoesDomain';

/**
 * Leitura do Histórico de alterações (`empresas/{tenantId}/logs`). So' dono,
 * administrador e quem tem a permissao "administrativo.logs" leem (rules).
 */

const colecao = (tenantId: string) => collection(db, 'empresas', tenantId, 'logs');

const lerConsulta = async (consulta: ReturnType<typeof query>): Promise<RegistroLido[]> => {
  const snap = await getDocs(consulta);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RegistroLido, 'id'>) }));
};

/**
 * Tudo que foi registrado sobre um documento: pelo id principal (registros
 * antigos e novos) e pelos documentos relacionados (ex.: a devolucao que
 * aparece no pedido). So' igualdade, sem indice composto.
 */
export const lerHistoricoDoDocumento = async (tenantId: string, ids: string[]): Promise<RegistroLido[]> => {
  const alvos = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 10);
  if (!tenantId || alvos.length === 0) return [];
  const [principais, relacionados] = await Promise.all([
    lerConsulta(query(colecao(tenantId), where('registroRelacionadoId', 'in', alvos))),
    lerConsulta(query(colecao(tenantId), where('documentosRelacionados', 'array-contains-any', alvos))),
  ]);
  return juntarRegistros(principais, relacionados);
};

export const LIMITE_REGISTROS_PERIODO = 1500;

/** Registros do periodo, do mais novo ao mais antigo (os outros filtros sao feitos na tela). */
export const lerHistoricoDoPeriodo = async (
  tenantId: string,
  inicio: Date,
  fim: Date,
): Promise<{ registros: RegistroLido[]; cortado: boolean }> => {
  if (!tenantId) return { registros: [], cortado: false };
  const registros = await lerConsulta(query(
    colecao(tenantId),
    where('dataHora', '>=', Timestamp.fromDate(inicio)),
    where('dataHora', '<=', Timestamp.fromDate(fim)),
    orderBy('dataHora', 'desc'),
    limit(LIMITE_REGISTROS_PERIODO),
  ));
  return { registros, cortado: registros.length >= LIMITE_REGISTROS_PERIODO };
};
