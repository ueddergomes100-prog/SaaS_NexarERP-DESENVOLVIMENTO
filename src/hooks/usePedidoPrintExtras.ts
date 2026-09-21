import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';

export interface ItemPrintExtra {
  codigo: string;
  marca: string;
}

export interface PedidoPrintExtras {
  /** Por id do produto: codigo (matricula) e marca, do CADASTRO -- o pedido
   * guarda so' id/nome/quantidade/preco. */
  itens: Record<string, ItemPrintExtra>;
  /** Codigo do vendedor (cadastro de Usuarios), quando existir. */
  vendedorCodigo: string;
  /** Quem esta imprimindo. */
  usuarioNome: string;
}

const VAZIO: PedidoPrintExtras = { itens: {}, vendedorCodigo: '', usuarioNome: '' };

/**
 * Dados que o modelo de impressao "Pre-venda" imprime e que nao vem no
 * pedido: matricula e marca de cada produto, codigo do vendedor e o nome de
 * quem imprime. Cada consulta tem o proprio try: cadastro que nao carrega
 * (ou permissao que nao alcanca, como no app do vendedor) deixa o campo em
 * branco e NUNCA impede a impressao.
 */
export const usePedidoPrintExtras = (pedidoData: any): PedidoPrintExtras => {
  const { currentUser, tenantId } = useAuth();
  const [extras, setExtras] = useState<PedidoPrintExtras>(VAZIO);

  useEffect(() => {
    let cancelado = false;
    if (!pedidoData || !tenantId) return undefined;

    (async () => {
      const resultado: PedidoPrintExtras = { itens: {}, vendedorCodigo: '', usuarioNome: '' };

      const ids: string[] = Array.from(new Set<string>(
        (Array.isArray(pedidoData.itens) ? pedidoData.itens : [])
          .map((item: any) => String(item?.id || ''))
          .filter((id: string) => id && id !== 'avulso'),
      ));
      await Promise.all(ids.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, 'estoque', id));
          if (snap.exists() && snap.data().tenantId === tenantId) {
            const produto = snap.data();
            resultado.itens[id] = { codigo: String(produto.codigo || ''), marca: String(produto.marca || '') };
          }
        } catch (erro) {
          console.error('Erro ao buscar o produto para a impressao do pedido:', erro);
        }
      }));

      try {
        if (pedidoData.vendedorId) {
          const snap = await getDoc(doc(db, 'usuarios', pedidoData.vendedorId));
          if (snap.exists() && snap.data().tenantId === tenantId) {
            resultado.vendedorCodigo = String(snap.data().codigoVendedor || '');
          }
        }
      } catch (erro) {
        console.error('Erro ao buscar o vendedor para a impressao do pedido:', erro);
      }

      try {
        if (currentUser) {
          const snap = await getDoc(doc(db, 'usuarios', currentUser.uid));
          const perfil = snap.exists() ? snap.data() : null;
          resultado.usuarioNome = String(perfil?.nome || perfil?.nomeResponsavel || currentUser.displayName || currentUser.email || '');
        }
      } catch (erro) {
        console.error('Erro ao buscar o usuario para a impressao do pedido:', erro);
        resultado.usuarioNome = currentUser?.displayName || currentUser?.email || '';
      }

      if (!cancelado) setExtras(resultado);
    })();

    return () => { cancelado = true; };
  }, [pedidoData, currentUser, tenantId]);

  return extras;
};
