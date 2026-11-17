import { and, collection, getCountFromServer, getDocs, limit, orderBy, query, where, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import { splitSearchTerms } from '../utils/textSearch';

/**
 * BUSCA E CONTAGENS DA TELA DE ESTOQUE SEM LER A COLECAO INTEIRA
 * (17/11/2026, fase 4 da otimizacao de leituras).
 */

/** Quantos produtos cada pagina da lista traz. */
export const TAMANHO_PAGINA_ESTOQUE = 50;
/** Teto de cada consulta da busca pelo comeco do nome. */
const LIMITE_BUSCA_NOME = 60;
/** Fim do intervalo de prefixo (maior caractere usado pelo Firestore). */
const FIM_DO_PREFIXO = '';

export type ProdutoAchado = DocumentData & { id: string };

/**
 * Busca no banco pelo PRIMEIRO termo digitado (antes do "+"): nome que comeca
 * com ele (como digitado e em maiusculas -- os nomes sao padronizados em
 * maiusculas) e codigo, codigo de barras ou referencia exatamente iguais. Os
 * outros termos do "+" quem chama confere em memoria (matchesAllSearchTerms).
 * Palavra no meio do nome nao acha aqui: a tela oferece a busca completa.
 */
export const buscarProdutosNoBanco = async (tenantId: string, termoDigitado: string): Promise<ProdutoAchado[]> => {
  const primeiro = splitSearchTerms(termoDigitado)[0] ?? '';
  if (!tenantId || !primeiro) return [];
  const estoque = collection(db, 'estoque');
  const prefixos = [...new Set([primeiro, primeiro.toUpperCase()])];
  const consultas = [
    ...prefixos.map((p) => query(
      estoque,
      where('tenantId', '==', tenantId),
      where('nome', '>=', p),
      where('nome', '<', p + FIM_DO_PREFIXO),
      orderBy('nome'),
      limit(LIMITE_BUSCA_NOME),
    )),
    ...(['codigo', 'codigoBarras', 'referencia'] as const).flatMap((campo) => [...new Set([primeiro, primeiro.toUpperCase()])].map((valor) => query(
      estoque,
      and(where('tenantId', '==', tenantId), where(campo, '==', valor)),
      limit(LIMITE_BUSCA_NOME),
    ))),
  ];
  const snaps = await Promise.all(consultas.map((q) => getDocs(q).catch((erro) => {
    console.error('Consulta da busca de produtos falhou:', erro);
    return null;
  })));
  const porId = new Map<string, ProdutoAchado>();
  snaps.forEach((snap) => snap?.docs.forEach((d) => porId.set(d.id, { id: d.id, ...d.data() })));
  return [...porId.values()];
};

/**
 * Cartoes de resumo pela contagem do servidor (1 leitura a cada mil
 * produtos). "Baixo" e "Esgotados" dependem do indice tenantId+quantidade;
 * sem ele publicado, ficam null e a tela mostra "—" em vez de um numero errado.
 */
export const contarResumoDoEstoque = async (tenantId: string): Promise<{ total: number | null; baixo: number | null; esgotados: number | null }> => {
  const estoque = collection(db, 'estoque');
  const contar = async (...restricoes: ReturnType<typeof where>[]) => {
    try {
      return (await getCountFromServer(query(estoque, where('tenantId', '==', tenantId), ...restricoes))).data().count;
    } catch (erro) {
      console.error('Contagem do resumo do estoque falhou:', erro);
      return null;
    }
  };
  const [total, baixo, esgotados] = await Promise.all([
    contar(),
    contar(where('quantidade', '>', 0), where('quantidade', '<', 5)),
    contar(where('quantidade', '<=', 0)),
  ]);
  return { total, baixo, esgotados };
};
