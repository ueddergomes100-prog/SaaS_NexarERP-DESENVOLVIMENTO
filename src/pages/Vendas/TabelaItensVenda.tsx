import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { CornerDownLeft, Trash2 } from 'lucide-react';
import { showError } from '../../utils/alerts';
import type { SearchableProduct } from '../../utils/productSearch';
import {
  campoSeguinte,
  interpretarDesconto,
  interpretarPreco,
  interpretarQuantidade,
  localizarProdutoPorCodigo,
  textoParaEdicao,
  type CampoEditavel,
} from '../../utils/itensVendaDomain';
import './TabelaItensVenda.css';

/*
 * ITENS DA VENDA como grade de lancamento (2026-10-13, pedido do dono a
 * partir do ERP antigo dos clientes; refeita no mesmo dia depois da critica
 * ao visual):
 *
 *  - a PRIMEIRA linha e' a linha de lancamento: Codigo (matricula) ->
 *    o produto aparece sozinho -> Qtd -> Enter lanca e o cursor volta para o
 *    codigo. Codigo que nao existe: Enter abre a busca por nome com o texto.
 *  - num item ja' lancado, CODIGO, quantidade, preco unitario e desconto
 *    editam na propria celula: clique, digite, Enter aplica, Tab aplica e
 *    vai para a proxima celula, Esc desfaz. Trocar o codigo troca o produto
 *    da linha (mantendo a quantidade), sem precisar remover e lancar de novo.
 *
 * A regra do item (estoque, venda fracionada, limite de desconto, preco abaixo
 * da tabela) continua no formulario: ele recebe o que foi digitado e devolve
 * a mensagem de erro, que aparece aqui. Parte pura em itensVendaDomain.ts.
 *
 * Desenho: colunas numericas com largura fixa e numeros tabulares, nunca
 * quebrando linha; o nome do produto e' a unica coluna elastica. A celula
 * editavel parece texto e so' revela a borda tracejada ao passar o mouse.
 */

export interface ItemDaTabela {
  nome: string;
  codigo?: string;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  subtotal: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  origemPreco?: string;
  promocaoNome?: string;
  tabelaPreco?: { venda: number } | null;
}

export interface ProdutoLancavel extends SearchableProduct {
  id: string;
  nome: string;
  quantidade: number;
  quantidadeReservada?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
}

export interface TabelaItensVendaHandle {
  /** F5: abre a quantidade da linha selecionada para edicao. */
  editarSelecionado: () => void;
  focarCodigo: () => void;
}

interface Props {
  itens: ItemDaTabela[];
  catalogo: ProdutoLancavel[];
  podeLancar: boolean;
  podeEditar: boolean;
  podeRemover: boolean;
  permitirDescontoPorItem: boolean;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  /** Preco que o produto entraria hoje (a vista / venda / promocao). */
  precoSugerido: (produto: ProdutoLancavel) => number;
  onLancarPorCodigo: (produto: ProdutoLancavel, quantidade: number) => void;
  /** Codigo nao encontrado: abre a busca por nome com o que foi digitado. */
  onBuscarPorNome: (texto: string) => void;
  /** Devolve a mensagem de erro em portugues, ou null quando aplicou. */
  onAtualizarItem: (index: number, campos: { quantidade?: number; precoUnitario?: number; desconto?: number }) => string | null;
  /** Troca o produto da linha (codigo editado), mantendo a quantidade. Erro em portugues ou null. */
  onTrocarProduto: (index: number, produto: ProdutoLancavel) => string | null;
  onRemover: (index: number) => void;
}

const moeda = (valor: number) => `R$ ${(Number(valor) || 0).toFixed(2).replace('.', ',')}`;

interface Edicao {
  index: number;
  campo: CampoEditavel;
  texto: string;
}

const ROTULO_ARIA: Record<CampoEditavel, string> = {
  codigo: 'Código',
  quantidade: 'Quantidade',
  precoUnitario: 'Preço unitário',
  desconto: 'Desconto',
};

const TabelaItensVenda = forwardRef<TabelaItensVendaHandle, Props>(({
  itens, catalogo, podeLancar, podeEditar, podeRemover, permitirDescontoPorItem, selectedIndex, onSelect,
  precoSugerido, onLancarPorCodigo, onBuscarPorNome, onAtualizarItem, onTrocarProduto, onRemover,
}, ref) => {
  const codigoRef = useRef<HTMLInputElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState('');
  const [qtd, setQtd] = useState('1');
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  // Evita aplicar duas vezes (Enter ja' aplicou e o blur vem em seguida).
  const aplicando = useRef(false);

  const produtoDaLinha = localizarProdutoPorCodigo(catalogo, codigo);
  const precoDaLinha = produtoDaLinha ? precoSugerido(produtoDaLinha) : 0;
  const qtdDaLinha = interpretarQuantidade(qtd);
  const podeLancarAgora = Boolean(produtoDaLinha) && !qtdDaLinha.erro;
  const colunas = 6 + (podeRemover ? 1 : 0);

  const campoEditavel = (campo: CampoEditavel) => podeEditar && (campo !== 'desconto' || permitirDescontoPorItem);

  const iniciarEdicao = (index: number, campo: CampoEditavel) => {
    if (!campoEditavel(campo)) return;
    const item = itens[index];
    if (!item) return;
    onSelect(index);
    setEdicao({ index, campo, texto: textoParaEdicao(campo, item) });
  };

  useImperativeHandle(ref, () => ({
    editarSelecionado: () => { if (selectedIndex !== null) iniciarEdicao(selectedIndex, 'quantidade'); },
    focarCodigo: () => codigoRef.current?.focus(),
  }));

  /** Aplica a celula em edicao. Devolve true quando aplicou (ou nada mudou). */
  const aplicarEdicao = (atual: Edicao): boolean => {
    const item = itens[atual.index];
    if (!item) { setEdicao(null); return true; }

    if (atual.campo === 'codigo') {
      const texto = atual.texto.trim();
      if (!texto || texto === (item.codigo || '')) { setEdicao(null); return true; }
      const produto = localizarProdutoPorCodigo(catalogo, texto);
      if (!produto) {
        showError('Produto não encontrado', `Não achei nenhum produto com o código "${texto}". Confira o código no Estoque.`);
        setEdicao(null);
        return false;
      }
      const falha = onTrocarProduto(atual.index, produto);
      if (falha) { showError('Não foi possível trocar o produto', falha); setEdicao(null); return false; }
      setEdicao(null);
      return true;
    }

    let valor: number;
    let erro: string | null;
    if (atual.campo === 'quantidade') ({ valor, erro } = interpretarQuantidade(atual.texto));
    else if (atual.campo === 'precoUnitario') ({ valor, erro } = interpretarPreco(atual.texto));
    else ({ valor, erro } = interpretarDesconto(atual.texto, item.precoUnitario * item.quantidade));
    if (erro) {
      showError('Não foi possível alterar o item', erro);
      setEdicao(null);
      return false;
    }
    if (Math.abs(valor - item[atual.campo]) < 0.00001) { setEdicao(null); return true; }
    const falha = onAtualizarItem(atual.index, { [atual.campo]: valor });
    if (falha) {
      showError('Não foi possível alterar o item', falha);
      setEdicao(null);
      return false;
    }
    setEdicao(null);
    return true;
  };

  const aoTeclarNaCelula = (e: React.KeyboardEvent<HTMLInputElement>, atual: Edicao) => {
    if (e.key === 'Escape') { e.preventDefault(); setEdicao(null); return; }
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    aplicando.current = true;
    const ok = aplicarEdicao(atual);
    aplicando.current = false;
    if (!ok || e.key !== 'Tab' || e.shiftKey) return;
    const proximo = campoSeguinte(atual.campo, permitirDescontoPorItem);
    if (proximo && campoEditavel(proximo)) {
      // O item pode ter acabado de mudar (quantidade/produto): o texto vem do
      // estado novo no proximo render, por isso a edicao e' aberta sem texto
      // e preenchida pelo iniciarEdicao do clique... aqui basta o valor atual.
      const item = itens[atual.index];
      setEdicao({ index: atual.index, campo: proximo, texto: item ? textoParaEdicao(proximo, item) : '' });
    }
  };

  const lancar = () => {
    if (!produtoDaLinha || qtdDaLinha.erro) {
      if (!produtoDaLinha && codigo.trim()) { onBuscarPorNome(codigo.trim()); setCodigo(''); return; }
      if (qtdDaLinha.erro) showError('Quantidade', qtdDaLinha.erro);
      return;
    }
    onLancarPorCodigo(produtoDaLinha, qtdDaLinha.valor);
    setCodigo('');
    setQtd('1');
    codigoRef.current?.focus();
  };

  const aoTeclarNoCodigo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (produtoDaLinha) { qtdRef.current?.focus(); qtdRef.current?.select(); return; }
    if (codigo.trim()) { onBuscarPorNome(codigo.trim()); setCodigo(''); }
  };

  const disponivel = (p: ProdutoLancavel) => Math.max(0, (Number(p.quantidade) || 0) - (Number(p.quantidadeReservada) || 0));

  const celula = (index: number, item: ItemDaTabela, campo: CampoEditavel, conteudo: React.ReactNode, classe: string) => {
    const emEdicao = edicao && edicao.index === index && edicao.campo === campo ? edicao : null;
    if (emEdicao) {
      return (
        <td className={`tiv-td ${classe}`}>
          <input
            autoFocus
            className={`tiv-input tiv-input-celula ${campo === 'codigo' ? 'tiv-input-cod' : ''}`}
            value={emEdicao.texto}
            inputMode={campo === 'codigo' ? 'text' : 'decimal'}
            aria-label={`${ROTULO_ARIA[campo]} de ${item.nome}`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setEdicao({ ...emEdicao, texto: e.target.value })}
            onKeyDown={(e) => aoTeclarNaCelula(e, emEdicao)}
            onBlur={() => { if (!aplicando.current) aplicarEdicao(emEdicao); }}
            onClick={(e) => e.stopPropagation()}
          />
        </td>
      );
    }
    if (!campoEditavel(campo)) return <td className={`tiv-td ${classe}`}>{conteudo}</td>;
    return (
      <td className={`tiv-td ${classe}`}>
        <button
          type="button"
          className="tiv-editavel"
          title={campo === 'codigo' ? 'Clique para trocar o produto pelo código' : 'Clique para alterar'}
          onClick={(e) => { e.stopPropagation(); iniciarEdicao(index, campo); }}
        >
          {conteudo}
        </button>
      </td>
    );
  };

  return (
    <div className="tiv">
      <table className="tiv-tabela">
        <colgroup>
          <col className="tiv-col-cod" />
          <col className="tiv-col-produto" />
          <col className="tiv-col-qtd" />
          <col className="tiv-col-unit" />
          <col className="tiv-col-desc" />
          <col className="tiv-col-subtotal" />
          {podeRemover && <col className="tiv-col-acao" />}
        </colgroup>
        <thead>
          <tr>
            <th className="tiv-th">Cód.</th>
            <th className="tiv-th">Produto</th>
            <th className="tiv-th tiv-centro">Qtd</th>
            <th className="tiv-th tiv-direita">V. Unit</th>
            <th className="tiv-th tiv-direita">Desc.</th>
            <th className="tiv-th tiv-direita">Subtotal</th>
            {podeRemover && <th className="tiv-th tiv-centro">Ação</th>}
          </tr>
        </thead>
        <tbody>
          {podeLancar && (
            <tr className="tiv-lancamento">
              <td className="tiv-td">
                <input
                  ref={codigoRef}
                  className="tiv-input tiv-input-cod"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={aoTeclarNoCodigo}
                  placeholder="Código"
                  aria-label="Código do produto para lançar"
                  autoComplete="off"
                />
              </td>
              <td className="tiv-td">
                {produtoDaLinha ? (
                  <div className="tiv-achado">
                    <span className="tiv-achado-nome">{produtoDaLinha.nome}</span>
                    <span className="tiv-achado-estoque">Disponível {disponivel(produtoDaLinha)} {produtoDaLinha.unidadeMedidaSigla || 'UN'}</span>
                  </div>
                ) : (
                  <span className={codigo.trim() ? 'tiv-dica tiv-dica-alerta' : 'tiv-dica'}>
                    {codigo.trim() ? 'Não achei esse código. Enter abre a busca por nome.' : 'Digite o código do produto e Enter.'}
                  </span>
                )}
              </td>
              <td className="tiv-td tiv-centro">
                <input
                  ref={qtdRef}
                  className="tiv-input tiv-input-qtd"
                  value={qtd}
                  onChange={(e) => setQtd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lancar(); } }}
                  onFocus={(e) => e.target.select()}
                  aria-label="Quantidade a lançar"
                  inputMode="decimal"
                  disabled={!produtoDaLinha}
                />
              </td>
              <td className="tiv-td tiv-direita tiv-num tiv-previa">{produtoDaLinha ? moeda(precoDaLinha) : ''}</td>
              <td className="tiv-td tiv-direita tiv-num tiv-previa" />
              <td className="tiv-td tiv-direita tiv-num tiv-previa tiv-forte">
                {produtoDaLinha && !qtdDaLinha.erro ? moeda(precoDaLinha * qtdDaLinha.valor) : ''}
              </td>
              {podeRemover && (
                <td className="tiv-td tiv-centro">
                  <button
                    type="button"
                    className="tiv-lancar"
                    onClick={lancar}
                    disabled={!podeLancarAgora}
                    title="Lançar o item (Enter)"
                    aria-label="Lançar o item"
                  >
                    <CornerDownLeft size={15} />
                  </button>
                </td>
              )}
            </tr>
          )}

          {itens.length === 0 ? (
            <tr>
              <td colSpan={colunas} className="tiv-vazio">Nenhum produto adicionado à venda.</td>
            </tr>
          ) : itens.map((item, index) => (
            <tr
              key={index}
              onClick={() => onSelect(index)}
              className={selectedIndex === index ? 'tiv-linha tiv-linha-selecionada' : 'tiv-linha'}
            >
              {celula(index, item, 'codigo', <span className="tiv-cod">{item.codigo || '—'}</span>, '')}
              <td className="tiv-td tiv-nome" title={item.nome}>{item.nome}</td>
              {celula(index, item, 'quantidade', (
                <span className="tiv-num">{item.quantidade.toFixed(item.unidadeMedidaCasasDecimais ?? 0)} <span className="tiv-unidade">{item.unidadeMedidaSigla || 'UN'}</span></span>
              ), 'tiv-centro')}
              {celula(index, item, 'precoUnitario', (
                <span className="tiv-num">
                  {moeda(item.precoUnitario)}
                  {item.origemPreco === 'promocao' && (
                    <span className="tiv-sub tiv-sub-promo" title={item.promocaoNome ? `Promoção: ${item.promocaoNome}` : 'Promoção'}>
                      promoção{item.tabelaPreco ? <> · de <s>{moeda(item.tabelaPreco.venda)}</s></> : null}
                    </span>
                  )}
                  {item.origemPreco === 'vista' && <span className="tiv-sub">à vista</span>}
                  {item.origemPreco === 'manual' && <span className="tiv-sub" title="Preço digitado: não muda com a forma de pagamento">digitado</span>}
                </span>
              ), 'tiv-direita')}
              {celula(index, item, 'desconto', (
                <span className={item.desconto > 0 ? 'tiv-num tiv-desconto' : 'tiv-num tiv-sem-valor'}>
                  {item.desconto > 0 ? `−${moeda(item.desconto)}` : '—'}
                </span>
              ), 'tiv-direita')}
              <td className="tiv-td tiv-direita tiv-num tiv-forte">{moeda(item.subtotal)}</td>
              {podeRemover && (
                <td className="tiv-td tiv-centro">
                  <button
                    type="button"
                    className="tiv-remover"
                    onClick={(e) => { e.stopPropagation(); onRemover(index); }}
                    title="Tirar da venda"
                    aria-label={`Tirar ${item.nome} da venda`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

TabelaItensVenda.displayName = 'TabelaItensVenda';

export default TabelaItensVenda;
