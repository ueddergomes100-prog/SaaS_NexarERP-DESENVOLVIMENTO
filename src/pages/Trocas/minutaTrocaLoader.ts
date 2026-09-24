import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { DEFAULT_ORDENAR_MINUTA_POR_LOCAL, ordenarPorLocalizacao } from '../../utils/conferenciaDomain';
import { rotuloDoMotivoTroca } from '../../utils/trocaDomain';
import type { MinutaCliente, MinutaItem } from '../Expedicao/MinutaPrintDocument';

/**
 * Monta os dados de UMA minuta de troca (cliente, codigo do vendedor, itens
 * enriquecidos com o cadastro do produto). Usado pela minuta individual e
 * pela minuta em LOTE -- o mesmo papel, uma ou varias vezes, sem duplicar a
 * montagem.
 */
export interface MinutaTrocaMontada {
  /** O documento da minuta le "pedidoData": aqui vai a troca com os nomes adaptados. */
  trocaData: Record<string, unknown>;
  itens: MinutaItem[];
  cliente: MinutaCliente | null;
  vendedorCodigo: string;
}

export const montarMinutaDeTroca = async (args: {
  troca: Record<string, any> & { id: string };
  tenantId: string;
  config: Record<string, any>;
}): Promise<MinutaTrocaMontada> => {
  const { troca, tenantId, config } = args;

  let cliente: MinutaCliente | null = null;
  try {
    if (troca.clienteId) {
      const clienteSnap = await getDoc(doc(db, 'clientes', troca.clienteId));
      if (clienteSnap.exists() && clienteSnap.data().tenantId === tenantId) cliente = clienteSnap.data() as MinutaCliente;
    }
  } catch (err) {
    console.error('Erro ao buscar o cliente da minuta de troca:', err);
  }

  let vendedorCodigo = '';
  try {
    if (troca.vendedorId) {
      const vendedorSnap = await getDoc(doc(db, 'usuarios', troca.vendedorId));
      if (vendedorSnap.exists() && vendedorSnap.data().tenantId === tenantId) {
        vendedorCodigo = String(vendedorSnap.data().codigoVendedor || '');
      }
    }
  } catch (err) {
    console.error('Erro ao buscar o vendedor da minuta de troca:', err);
  }

  // Codigo, codigo de barras, marca e local vem do CADASTRO do produto (a troca so' guarda id/nome/quantidade).
  const enriquecidos: MinutaItem[] = await Promise.all(
    (Array.isArray(troca.itens) ? troca.itens : []).map(async (item: any): Promise<MinutaItem> => {
      const base: MinutaItem = {
        id: item.id,
        // O motivo sai junto do nome: o entregador leva o produto certo e sabe por que.
        nome: `${item.nome} — ${rotuloDoMotivoTroca(item.motivo)}${item.motivoDescricao ? ` (${item.motivoDescricao})` : ''}`,
        quantidade: item.quantidade,
        unidadeMedidaSigla: item.unidadeMedidaSigla,
        unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais,
      };
      try {
        const estoqueSnap = await getDoc(doc(db, 'estoque', item.id));
        if (estoqueSnap.exists()) {
          const produto = estoqueSnap.data();
          return { ...base, codigo: produto.codigo || '', codigoBarras: String(produto.codigoBarras || '').trim(), marca: produto.marca || '', localizacaoEstoque: produto.localizacaoEstoque || '' };
        }
      } catch (err) {
        console.error('Erro ao buscar dados de estoque do item da minuta de troca:', err);
      }
      return base;
    }),
  );
  const ordenarPorLocal = config.ordenarMinutaPorLocal ?? DEFAULT_ORDENAR_MINUTA_POR_LOCAL;

  return {
    trocaData: {
      id: troca.id,
      numeroPedido: troca.numeroTroca,
      createdAt: troca.createdAt,
      status: '',
      clienteNome: troca.clienteNome,
      observacao: troca.observacao || '',
      vendedorNome: troca.vendedorNome,
      pagamentos: [],
    },
    itens: ordenarPorLocal ? ordenarPorLocalizacao(enriquecidos) : enriquecidos,
    cliente,
    vendedorCodigo,
  };
};

export const nomeDoUsuarioLogado = async (uid: string, fallback: string): Promise<string> => {
  try {
    const perfilSnap = await getDoc(doc(db, 'usuarios', uid));
    const perfil = perfilSnap.exists() ? perfilSnap.data() : null;
    return String(perfil?.nome || perfil?.nomeResponsavel || fallback || '');
  } catch (err) {
    console.error('Erro ao buscar o usuario da minuta de troca:', err);
    return fallback;
  }
};
