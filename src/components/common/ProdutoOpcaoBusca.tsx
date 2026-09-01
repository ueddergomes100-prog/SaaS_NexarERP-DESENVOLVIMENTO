import React from 'react';
import { destacarTrechosDaBusca, nivelDeEstoque } from '../../utils/buscaProdutoOpcaoDomain';

/**
 * A linha de produto na busca -- autocomplete e popup "Ver mais".
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTAVA ERRADO
 * ---------------------------------------------------------------------------
 *
 * Nome, estoque e preco dividiam UMA linha, e quem cedia era sempre o nome:
 * "SOPRADOR D...", "CALCA MASC...". Num catalogo em que os produtos comecam
 * com as mesmas palavras ("RACAO QUATREE GOURMET ..."), cortar o FIM e o pior
 * corte possivel -- e' exatamente ali que mora a diferenca entre 20KG e
 * 10,1KG. O vendedor lia duas linhas iguais e tinha que abrir pra saber qual
 * era qual.
 *
 * ---------------------------------------------------------------------------
 * O DESENHO
 * ---------------------------------------------------------------------------
 *
 * O nome ganha a linha inteira e quebra em ate duas -- nunca e' cortado no
 * meio de uma palavra. Embaixo, uma faixa menor com estoque e codigo. O preco
 * sai da disputa: coluna propria a direita, com numero tabular, pras virgulas
 * ficarem uma embaixo da outra e o olho correr a coluna sem ler.
 *
 * Custa altura: cabem ~5 produtos por tela em vez de 6. E' o preco de ler o
 * nome inteiro, e no balcao a pergunta e' QUAL produto, nao quanto custa.
 *
 * Uma so implementacao pras quatro telas (Pedido de Venda, OS, Orcamento,
 * PDV) -- antes cada uma desenhava a sua, com informacao diferente: a OS nem
 * mostrava estoque, o Orcamento nem o codigo.
 */

export interface ProdutoParaOpcaoBusca {
  nome?: string | null;
  codigo?: string | null;
  codigoBarras?: string | null;
  skuSistema?: string | null;
  precoVenda?: number | null;
  quantidade?: number | null;
  unidadeMedidaSigla?: string | null;
  unidadeMedidaCasasDecimais?: number | null;
}

const ROTULO_ESTOQUE: Record<ReturnType<typeof nivelDeEstoque>, string> = {
  zerado: 'sem estoque',
  baixo: 'estoque baixo',
  ok: 'em estoque',
};

const formatarPreco = (valor: unknown) => (
  Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
);

interface Props {
  produto: ProdutoParaOpcaoBusca;
  /** O que foi digitado, pra marcar onde a busca casou. */
  termo?: string;
}

const ProdutoOpcaoBusca: React.FC<Props> = ({ produto, termo }) => {
  const nivel = nivelDeEstoque(produto.quantidade);
  const codigo = produto.codigo || produto.codigoBarras || produto.skuSistema || '';
  const casas = produto.unidadeMedidaCasasDecimais ?? 0;
  const quantidade = Number(produto.quantidade || 0);

  return (
    <>
      <span className="produto-opcao__nome">
        {destacarTrechosDaBusca(produto.nome, termo).map((trecho, indice) => (
          trecho.destaque
            ? <mark key={indice} className="produto-opcao__match">{trecho.texto}</mark>
            : <React.Fragment key={indice}>{trecho.texto}</React.Fragment>
        ))}
      </span>

      <span className="produto-opcao__preco">{formatarPreco(produto.precoVenda)}</span>

      <span className="produto-opcao__meta">
        <span className={`produto-opcao__estoque is-${nivel}`}>
          <i className="produto-opcao__ponto" aria-hidden="true" />
          {nivel === 'zerado'
            ? ROTULO_ESTOQUE.zerado
            : `${quantidade.toFixed(casas)} ${produto.unidadeMedidaSigla || 'UN'}`}
        </span>
        {codigo && <span className="produto-opcao__codigo">cód. {codigo}</span>}
      </span>
    </>
  );
};

export default ProdutoOpcaoBusca;

/** Atalho pro `renderItem` das telas: uma linha em cada uma, em vez de cada
 *  uma escrever a sua marcacao. */
export const renderProdutoOpcaoBusca = (
  produto: ProdutoParaOpcaoBusca,
  _destacado: boolean,
  termo?: string,
) => <ProdutoOpcaoBusca produto={produto} termo={termo} />;
