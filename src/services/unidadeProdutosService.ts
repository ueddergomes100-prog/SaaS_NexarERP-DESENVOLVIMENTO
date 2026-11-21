import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch, type DocumentReference } from 'firebase/firestore';
import { db } from './firebase';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { mudancasDoProdutoPelaUnidade, type UnidadeDeMedida } from '../utils/vendaFracionadaDomain';
import { embalagensComUnidadesAtuais } from '../utils/embalagemDomain';
import { obterCatalogoEstoque } from './catalogoEstoqueService';

const TAMANHO_LOTE = 400;

/**
 * Depois de alterar "Fracionada" ou as casas decimais de uma unidade de
 * medida, leva a mudanca para os produtos que usam essa unidade (21/11/2026).
 * Antes a copia que cada produto guarda ficava velha e a venda continuava
 * recusando quantidade quebrada -- ver vendaFracionadaDomain.ts.
 *
 * Acha o produto pelo id da unidade e, para cadastro antigo sem id, pela
 * sigla. So' grava em quem precisa mudar.
 *
 * Embalagens (21/11/2026, caso PREGO em G): a embalagem tambem guarda uma
 * copia da unidade dela. Elas sao achadas no catalogo compartilhado do
 * estoque (escuta ao vivo, sem leitura a mais) e acertadas na mesma gravacao.
 */
export const atualizarProdutosDaUnidade = async (params: {
  tenantId: string;
  unidadeId: string;
  sigla: string;
  unidade: UnidadeDeMedida;
  usuarioId: string;
}): Promise<{ produtos: number; alterados: number }> => {
  const { tenantId, unidadeId, sigla, unidade, usuarioId } = params;
  const base = collection(db, 'estoque');
  const [peloId, pelaSigla, catalogo] = await Promise.all([
    getDocs(query(base, where('tenantId', '==', tenantId), where('unidadeMedidaId', '==', unidadeId))),
    getDocs(query(base, where('tenantId', '==', tenantId), where('unidadeMedidaSigla', '==', sigla))),
    obterCatalogoEstoque(tenantId),
  ]);
  const vistos = new Map<string, { ref: DocumentReference; dados: Record<string, unknown> }>();
  peloId.forEach((d) => vistos.set(d.id, { ref: d.ref, dados: d.data() }));
  pelaSigla.forEach((d) => {
    const idGravado = String(d.data().unidadeMedidaId ?? '').trim();
    // Pela sigla so' quem nao aponta para OUTRA unidade (cadastro antigo, sem id, ou o 'un' de reserva).
    if (!vistos.has(d.id) && (!idGravado || idGravado === 'un' || idGravado === unidadeId)) {
      vistos.set(d.id, { ref: d.ref, dados: d.data() });
    }
  });

  const mudancasPorProduto = new Map<string, { ref: DocumentReference; mudancas: Record<string, unknown> }>();
  vistos.forEach(({ ref, dados }, id) => {
    const mudancas = mudancasDoProdutoPelaUnidade(dados, unidade);
    if (Object.keys(mudancas).length > 0) mudancasPorProduto.set(id, { ref, mudancas: { ...mudancas } });
  });

  // Embalagens nesta unidade: pelo id; embalagem antiga sem id, pela sigla.
  const siglaDaUnidade = sigla.trim().toUpperCase();
  const daUnidade = (e: { unidadeMedidaId: string; unidadeMedidaSigla: string }) => (
    e.unidadeMedidaId === unidadeId || (!e.unidadeMedidaId && e.unidadeMedidaSigla === siglaDaUnidade)
      ? { sigla, permiteFracionado: unidade.permiteFracionado, casasDecimais: unidade.casasDecimais }
      : null
  );
  catalogo.forEach((d) => {
    const dados = d.data();
    if (dados.tenantId !== tenantId || !Array.isArray(dados.embalagens) || dados.embalagens.length === 0) return;
    const acerto = embalagensComUnidadesAtuais(dados.embalagens, daUnidade);
    if (acerto.alteradas === 0) return;
    const atual = mudancasPorProduto.get(d.id) || { ref: doc(db, 'estoque', d.id), mudancas: {} };
    atual.mudancas.embalagens = acerto.embalagens;
    mudancasPorProduto.set(d.id, atual);
  });

  const paraGravar = [...mudancasPorProduto.values()];
  for (let i = 0; i < paraGravar.length; i += TAMANHO_LOTE) {
    const lote = writeBatch(db);
    paraGravar.slice(i, i + TAMANHO_LOTE).forEach(({ ref, mudancas }) => {
      lote.update(ref, {
        ...mudancas,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(usuarioId, serverTimestamp()),
      });
    });
    await lote.commit();
  }
  return { produtos: vistos.size, alterados: paraGravar.length };
};
