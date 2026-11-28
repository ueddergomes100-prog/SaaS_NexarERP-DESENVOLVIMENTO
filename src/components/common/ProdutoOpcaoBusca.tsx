import React from 'react';
import { destacarTrechosDaBusca, nivelDeEstoque } from '../../utils/buscaProdutoOpcaoDomain';
import { resumoDeReserva } from '../../utils/estoqueReservaDomain';
import { atacadoParaBusca } from '../../utils/fichaProdutoBuscaDomain';

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
 * Em 21/11/2026 (cliente: "esta' pequeno, so' aparecem 6") a mesma marcacao
 * ganhou um segundo arranjo: quando o painel e' LARGO (campo de produto do
 * Pedido de Venda, PDV, OS...), a linha vira colunas -- codigo | nome |
 * estoque | preco -- numa linha so', com letra de 16 px. Painel estreito
 * (celula da grade, telas pequenas) continua no arranjo de duas linhas. A
 * troca e' feita por container query em ProductAutocomplete.css; aqui a
 * marcacao e' uma so'.
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
  /** Reservado em pre-venda, condicional, OS ou troca (estoqueReservaDomain.ts). */
  quantidadeReservada?: number | null;
  unidadeMedidaSigla?: string | null;
  unidadeMedidaCasasDecimais?: number | null;
  /** Aba "Atacado" do cadastro: a menor faixa aparece embaixo do preco. */
  atacado?: unknown;
}

const ROTULO_ESTOQUE: Record<ReturnType<typeof nivelDeEstoque>, string> = {
  zerado: 'sem estoque',
  baixo: 'estoque baixo',
  ok: 'em estoque',
};

const formatarPreco = (valor: unknown) => (
  Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
);

/** "1.200" e "2,5": quantidade no jeito brasileiro, com as casas da unidade. */
const formatarQuantidade = (valor: number, casas: number) => {
  const digitos = Math.max(0, Math.min(Math.trunc(casas) || 0, 4));
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: digitos, maximumFractionDigits: digitos });
};

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
  // Reserva visivel em TODA busca (maquinas pesadas, fase 2): quem tem
  // estoque reservado ve o disponivel de verdade, nao so o total.
  const reserva = resumoDeReserva(produto);
  // Atacado (23/11/2026): a primeira faixa embaixo do preco, na coluna do preco.
  const atacado = atacadoParaBusca(produto)[0];

  return (
    <>
      <span className="produto-opcao__nome">
        {destacarTrechosDaBusca(produto.nome, termo).map((trecho, indice) => (
          trecho.destaque
            ? <mark key={indice} className="produto-opcao__match">{trecho.texto}</mark>
            : <React.Fragment key={indice}>{trecho.texto}</React.Fragment>
        ))}
      </span>

      <span className="produto-opcao__preco">
        {formatarPreco(produto.precoVenda)}
        {atacado && (
          <span className="produto-opcao__atacado" title={`Preço de atacado: ${formatarPreco(atacado.preco)} ${atacado.quantidade}`}>
            <span>Valor atacado: {formatarPreco(atacado.preco)}</span>
            <span>{atacado.quantidade}</span>
          </span>
        )}
      </span>

      <span className="produto-opcao__meta">
        <span className={`produto-opcao__estoque is-${nivel}`}>
          <i className="produto-opcao__ponto" aria-hidden="true" />
          {nivel === 'zerado'
            ? ROTULO_ESTOQUE.zerado
            : `${formatarQuantidade(quantidade, casas)} ${produto.unidadeMedidaSigla || 'UN'}`}
        </span>
        {reserva.temReserva && (
          <span className="produto-opcao__reserva" title="Quantidade presa em pré-venda, condicional, OS ou troca em aberto">
            Reservado: {formatarQuantidade(reserva.reservada, casas)} · Disponível: {formatarQuantidade(reserva.disponivel, casas)}
          </span>
        )}
        {/* O "cód." some quando a lista esta' em colunas: ali o titulo da coluna ja' diz. */}
        {codigo && (
          <span className="produto-opcao__codigo">
            <span className="produto-opcao__codigo-rotulo">cód. </span>{codigo}
          </span>
        )}
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
