import { useCallback, useEffect, useRef, useState } from 'react';
import { and, collection, getDocs, limit, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type QueryDocumentSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from '../services/firebase';
import { acompanharCatalogo, catalogoJaCarregado } from '../services/catalogoEstoqueService';
import { splitSearchTerms } from '../utils/textSearch';
import { ehBuscaNumerica } from '../utils/buscaNumerica';

export { contemDigitos, ehBuscaNumerica } from '../utils/buscaNumerica';

/**
 * LISTA DE CADASTRO COM LIMITE (17/11/2026, fase 4 da otimizacao de leituras;
 * dono: "cliente, fornecedor, tudo precisa de limites").
 *
 * Tres modos, escolhidos sozinhos:
 *  - padrao: paginas de `tamanhoPagina` pela ordem de `campoOrdem` (precisa do
 *    indice tenantId + campoOrdem), ao vivo, com `verMais`;
 *  - busca: no banco, pelo comeco de `campoOrdem` e pelos `camposExatos`
 *    iguais ao texto; quem chama aplica o filtro de texto de sempre por cima;
 *  - completo (`completo` = true, ou busca com o cadastro ja' carregado, ou
 *    `buscarEmTudo()`): o catalogo compartilhado (catalogoEstoqueService.ts),
 *    lido uma vez por pagina aberta e o mesmo das outras telas.
 * Se o indice da paginacao nao existir (failed-precondition), cai sozinho no
 * modo completo -- a tela nunca fica vazia por causa de indice atrasado.
 */
export interface OpcoesListaPaginada {
  colecao: string;
  tenantId: string | null | undefined;
  /** Filtro, relatorio ou outra coisa que precise de todos os registros. */
  completo: boolean;
  termoBusca: string;
  campoOrdem?: string;
  camposExatos?: string[];
  tamanhoPagina?: number;
  habilitado?: boolean;
  /**
   * Busca so' de numero (CPF/CNPJ, telefone, codigo -- com ou sem pontos,
   * inteiro ou um pedaco) vai ao cadastro inteiro: o banco so' acharia o
   * documento completo e escrito igual ao gravado (17/11/2026, "busca o CPF
   * esta sem funcionar"). Quem chama compara pelos digitos.
   */
  buscaNumericaNoCadastroInteiro?: boolean;
}


interface Pagina<T> { itens: T[]; ultimoDoc: QueryDocumentSnapshot<DocumentData> | null; cheia: boolean }

const FIM_DO_PREFIXO = '';

export function useListaPaginada<T extends { id: string }>({
  colecao, tenantId, completo, termoBusca, campoOrdem = 'nome', camposExatos = [], tamanhoPagina = 50, habilitado = true,
  buscaNumericaNoCadastroInteiro = false,
}: OpcoesListaPaginada) {
  const termo = termoBusca.trim();
  const [buscaCompleta, setBuscaCompleta] = useState(false);
  const [semIndice, setSemIndice] = useState(false);
  useEffect(() => { if (termo === '') setBuscaCompleta(false); }, [termo]);

  const numerica = buscaNumericaNoCadastroInteiro && ehBuscaNumerica(termo);
  const modoCompleto = completo || semIndice || (termo !== '' && (buscaCompleta || numerica || catalogoJaCarregado(colecao, tenantId)));
  const modoBusca = !modoCompleto && termo !== '';
  const modoPaginado = !modoCompleto && !modoBusca;
  const [carregando, setCarregando] = useState(true);

  // Completo: catalogo compartilhado, ao vivo.
  const [todos, setTodos] = useState<T[]>([]);
  useEffect(() => {
    if (!habilitado || !tenantId || !modoCompleto) return;
    setCarregando(true);
    return acompanharCatalogo(colecao, tenantId, (snap) => {
      setTodos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as T)));
      setCarregando(false);
    }, (erro) => {
      console.error(`Erro ao carregar ${colecao}:`, erro);
      setCarregando(false);
    });
  }, [habilitado, tenantId, modoCompleto, colecao]);

  // Padrao: uma escuta por pagina.
  const [paginas, setPaginas] = useState<Array<Pagina<T>>>([]);
  const escutas = useRef<Unsubscribe[]>([]);
  const abrirPagina = useCallback((indice: number, depoisDe: QueryDocumentSnapshot<DocumentData> | null) => {
    if (!tenantId) return;
    const restricoes = [where('tenantId', '==', tenantId), orderBy(campoOrdem), ...(depoisDe ? [startAfter(depoisDe)] : []), limit(tamanhoPagina)];
    escutas.current[indice]?.();
    escutas.current[indice] = onSnapshot(query(collection(db, colecao), ...restricoes), (snap) => {
      const pagina: Pagina<T> = {
        itens: snap.docs.map((d) => ({ id: d.id, ...d.data() } as T)),
        ultimoDoc: snap.docs[snap.docs.length - 1] ?? null,
        cheia: snap.size >= tamanhoPagina,
      };
      setPaginas((atual) => { const novo = [...atual]; novo[indice] = pagina; return novo; });
      setCarregando(false);
    }, (erro) => {
      // Indice ainda nao publicado: usa o cadastro inteiro (como era antes).
      if ((erro as { code?: string }).code === 'failed-precondition') setSemIndice(true);
      else console.error(`Erro ao carregar ${colecao}:`, erro);
      setCarregando(false);
    });
  }, [tenantId, colecao, campoOrdem, tamanhoPagina, setSemIndice]);
  useEffect(() => {
    if (!habilitado || !tenantId || !modoPaginado) return;
    setCarregando(true);
    setPaginas([]);
    abrirPagina(0, null);
    return () => {
      escutas.current.forEach((parar) => parar?.());
      escutas.current = [];
    };
  }, [habilitado, tenantId, modoPaginado, abrirPagina]);
  const ultima = paginas[paginas.length - 1];
  const temMais = modoPaginado && Boolean(ultima?.cheia && ultima.ultimoDoc);
  const verMais = () => { if (ultima?.ultimoDoc) abrirPagina(paginas.length, ultima.ultimoDoc); };

  // Busca no banco.
  const [achados, setAchados] = useState<T[]>([]);
  const chaveCamposExatos = camposExatos.join('|');
  useEffect(() => {
    if (!habilitado || !tenantId || !modoBusca) return;
    let cancelado = false;
    setCarregando(true);
    const espera = window.setTimeout(() => {
      const primeiro = splitSearchTerms(termo)[0] ?? '';
      const valores = [...new Set([primeiro, primeiro.toUpperCase()])];
      const ref = collection(db, colecao);
      const consultas = [
        ...valores.map((v) => query(ref, where('tenantId', '==', tenantId), where(campoOrdem, '>=', v), where(campoOrdem, '<', v + FIM_DO_PREFIXO), orderBy(campoOrdem), limit(60))),
        ...chaveCamposExatos.split('|').filter(Boolean).flatMap((campo) => valores.map((v) => query(ref, and(where('tenantId', '==', tenantId), where(campo, '==', v)), limit(60)))),
      ];
      Promise.all(consultas.map((q) => getDocs(q).catch((erro) => { console.error('Consulta da busca falhou:', erro); return null; })))
        .then((snaps) => {
          if (cancelado) return;
          const porId = new Map<string, T>();
          snaps.forEach((s) => s?.docs.forEach((d) => porId.set(d.id, { id: d.id, ...d.data() } as T)));
          setAchados([...porId.values()]);
          setCarregando(false);
        });
    }, 350);
    return () => { cancelado = true; window.clearTimeout(espera); };
  }, [habilitado, tenantId, modoBusca, termo, colecao, campoOrdem, chaveCamposExatos]);

  const itens: T[] = modoCompleto ? todos : modoBusca ? achados : paginas.flatMap((p) => p?.itens ?? []);
  return {
    itens,
    carregando,
    temMais,
    verMais,
    /** A busca foi so' no banco (comeco do nome/campos exatos)? */
    buscaNoBanco: modoBusca,
    buscarEmTudo: () => setBuscaCompleta(true),
    modoCompleto,
  };
}
