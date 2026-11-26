import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { hasTenantFullAccess, isPlatformAdminRole } from '../utils/roles';
import { consultasDaBusca, fimDoPrefixo, LIMITE_POR_CONSULTA } from '../utils/buscaGlobalDomain';
import { lerComReserva } from '../services/consultaComReserva';
import { podeAbrirCaminho } from '../utils/buscaTelasDomain';
import type { SearchableProduct } from '../utils/productSearch';

export type TipoDoResultado = 'OS' | 'Cliente' | 'Fornecedor' | 'Produto';

export interface ResultadoDaBusca {
  type: TipoDoResultado;
  id: string;
  title: string;
  subtitle: string;
  link: string;
}

/**
 * Pode abrir o caminho? Mesma regra das abas (dono/plataforma tudo; o resto pela
 * permissao da rota; modulo do plano bloqueado barra) -- buscaTelasDomain.ts.
 */
export const usePodeAbrirCaminho = (): ((caminho: string) => boolean) => {
  const { userRole, isOwner, isPlatformAdmin, userPermissions, blockedModules } = useAuth();
  const plataforma = Boolean(isPlatformAdmin) || isPlatformAdminRole(userRole);
  const acessoTotal = hasTenantFullAccess(userRole, isOwner);
  return useCallback((caminho: string) => podeAbrirCaminho({
    caminho,
    acessoTotal,
    plataforma,
    permissoes: userPermissions,
    modulosBloqueados: blockedModules,
  }), [acessoTotal, plataforma, userPermissions, blockedModules]);
};

/**
 * Busca de cadastros (OS, clientes, fornecedores, produtos) da barra de cima e
 * da lupa do menu no topo. Consultas pequenas no cadastro inteiro
 * (buscaGlobalDomain.ts): nome que comeca com o termo e codigos exatos, ate' 5
 * por consulta. So' volta o que a pessoa pode abrir (pedido do dono, 26/11/2026).
 * Termo com menos de 2 letras: nada.
 */
export const useBuscaGlobal = (termo: string, maximo = 10): { resultados: ResultadoDaBusca[]; buscando: boolean } => {
  const { currentUser, tenantId } = useAuth();
  const podeAbrir = usePodeAbrirCaminho();
  const [resultados, setResultados] = useState<ResultadoDaBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (termo.trim().length < 2) {
      setResultados([]);
      setBuscando(false);
      return undefined;
    }
    setBuscando(true);
    let cancelado = false;
    const espera = setTimeout(async () => {
      const termLower = termo.toLowerCase();
      try {
        if (!currentUser || !tenantId) return;
        const c = consultasDaBusca(termo);
        type Docs = QueryDocumentSnapshot<DocumentData>[];
        const semResultado: Promise<Docs> = Promise.resolve([]);
        const falhou = (erro: unknown): Docs => {
          console.error('Busca global:', erro);
          return [];
        };
        // Cadastro que a pessoa nao pode abrir nem e' consultado.
        const consulta = (caminho: string, fazer: () => Promise<Docs>): Promise<Docs> => (podeAbrir(caminho) ? fazer() : semResultado);
        const porNome = (colecao: string, campo: string): Promise<Docs> => {
          if (!c.prefixoNome) return semResultado;
          const enxuta = query(
            collection(db, colecao),
            where('tenantId', '==', tenantId),
            where(campo, '>=', c.prefixoNome),
            where(campo, '<=', fimDoPrefixo(c.prefixoNome)),
            orderBy(campo),
            limit(LIMITE_POR_CONSULTA),
          );
          const reserva = query(collection(db, colecao), where('tenantId', '==', tenantId), limit(80));
          return lerComReserva(enxuta, reserva, `Busca global (${colecao})`)
            .then((snap) => snap.docs.filter((d) => String(d.data()[campo] || '').toLowerCase().includes(termLower)))
            .catch(falhou);
        };
        const porValor = (colecao: string, campo: string, valores: Array<string | number>): Promise<Docs> => (
          valores.length === 0 ? semResultado : getDocs(query(
            collection(db, colecao),
            where('tenantId', '==', tenantId),
            where(campo, 'in', valores),
            limit(LIMITE_POR_CONSULTA),
          )).then((snap) => snap.docs).catch(falhou)
        );

        const [osPorNumero, osPorPlaca, osPorCliente, clientesPorNome, clientesPorDocumento, fornecedoresPorNome, fornecedoresPorDocumento, produtosPorCodigo, produtosPorBarras, produtosPorNome] = await Promise.all([
          consulta('/os', () => porValor('ordens_de_servico', 'numeroOS', c.numerosOS)),
          consulta('/os', () => porValor('ordens_de_servico', 'placa', c.placas)),
          consulta('/os', () => porNome('ordens_de_servico', 'clienteNome')),
          consulta('/clientes', () => porNome('clientes', 'nome')),
          consulta('/clientes', () => porValor('clientes', 'documento', c.documentos)),
          consulta('/fornecedores', () => porNome('fornecedores', 'nome')),
          consulta('/fornecedores', () => porValor('fornecedores', 'cnpj', c.documentos)),
          consulta('/estoque', () => porValor('estoque', 'codigo', c.codigosProduto)),
          consulta('/estoque', () => (c.codigoBarras ? porValor('estoque', 'codigoBarras', [c.codigoBarras]) : semResultado)),
          consulta('/estoque', () => porNome('estoque', 'nome')),
        ]);
        const unicos = (...listas: Docs[]) => {
          const vistos = new Set<string>();
          return listas.flat().filter((d) => {
            if (vistos.has(d.id)) return false;
            vistos.add(d.id);
            return true;
          });
        };

        const achados: ResultadoDaBusca[] = [];
        unicos(osPorNumero, osPorPlaca, osPorCliente).forEach((doc) => {
          const data = doc.data();
          achados.push({
            type: 'OS',
            id: doc.id,
            title: `OS #${data.numeroOS || doc.id.substring(0, 8).toUpperCase()}${data.placa ? ` - Placa: ${String(data.placa).toUpperCase()}` : ''}`,
            subtitle: String(data.clienteNome || ''),
            link: `/os/editar/${doc.id}`,
          });
        });
        unicos(clientesPorDocumento, clientesPorNome).forEach((doc) => {
          const data = doc.data();
          achados.push({
            type: 'Cliente',
            id: doc.id,
            title: String(data.nome || 'Cliente sem nome'),
            subtitle: String(data.telefone || data.documento || 'Sem detalhes'),
            link: `/clientes/editar/${doc.id}`,
          });
        });
        unicos(fornecedoresPorDocumento, fornecedoresPorNome).forEach((doc) => {
          const data = doc.data();
          if (data.ativo === false) return;
          achados.push({
            type: 'Fornecedor',
            id: doc.id,
            title: String(data.nome || 'Fornecedor sem nome'),
            subtitle: String(data.cnpj || data.telefone || data.celular || 'Sem detalhes'),
            link: `/fornecedores/editar/${doc.id}`,
          });
        });
        unicos(produtosPorCodigo, produtosPorBarras, produtosPorNome).forEach((doc) => {
          const data = doc.data() as SearchableProduct;
          // Produto inativado nunca aparece na busca (mesma regra de productMatchesSearch).
          if (data.ativo === false) return;
          achados.push({
            type: 'Produto',
            id: doc.id,
            title: data.nome || 'Produto sem nome',
            subtitle: `Código: ${data.codigo || data.codigoBarras || data.skuSistema || '-'}`,
            link: `/estoque/editar/${doc.id}`,
          });
        });
        // Se a permissao mudou no meio, a regra das abas vale de novo no clique.
        if (!cancelado) setResultados(achados.filter((r) => podeAbrir(r.link)).slice(0, maximo));
      } catch (erro) {
        console.error(erro);
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 500);
    return () => {
      cancelado = true;
      clearTimeout(espera);
    };
  }, [termo, currentUser, tenantId, podeAbrir, maximo]);

  return { resultados, buscando };
};
