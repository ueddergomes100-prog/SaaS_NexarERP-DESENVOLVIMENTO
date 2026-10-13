import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { CornerDownLeft, Pencil, Trash2 } from 'lucide-react';
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
 * partir do ERP antigo dos clientes):
 *
 *  - a PRIMEIRA linha e' a linha de lancamento: Codigo (matricula) ->
 *    o produto aparece sozinho -> Qtd -> Enter lanca e o cursor volta para o
 *    codigo. Codigo que nao existe: Enter abre a busca por nome com o texto.
 *  - quantidade, preco unitario e desconto de um item ja' lancado editam na
 *    propria celula: clique (ou F5 na linha selecionada), digite, Enter aplica,
 *    Tab aplica e vai para a proxima celula, Esc desfaz.
 *
 * A regra do item (estoque, venda fracionada, limite de desconto, preco abaixo
 * da tabela) continua no formulario: ele recebe o que foi digitado e devolve
 * a mensagem de erro, que aparece aqui. Parte pura em itensVendaDomain.ts.
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
  onRemover: (index: number) => void;
}

const moeda = (valor: number) => `R$ ${(Number(valor) || 0).toFixed(2).replace('.', ',')}`;

interface Edicao {
  index: number;
  campo: CampoEditavel;
  texto: string;
}

const TabelaItensVenda = forwardRef<TabelaItensVendaHandle, Props>(({
  itens, catalogo, podeLancar, podeEditar, podeRemover, permitirDescontoPorItem, selectedIndex, onSelect,
  precoSugerido, onLancarPorCodigo, onBuscarPorNome, onAtualizarItem, onRemover,
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

  const iniciarEdicao = (index: number, campo: CampoEditavel) => {
    if (!podeEditar) return;
    if (campo === 'desconto' && !permitirDescontoPorItem) return;
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
    const atualValor = item[atual.campo];
    if (Math.abs(valor - atualValor) < 0.00001) { setEdicao(null); return true; }
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
    if (!ok) return;
    if (e.key === 'Tab') {
      const proximo = e.shiftKey ? null : campoSeguinte(atual.campo, permitirDescontoPorItem);
      if (proximo) setEdicao({ index: atual.index, campo: proximo, texto: textoParaEdicao(proximo, { ...itens[atual.index], [atual.campo]: itens[atual.index][atual.campo] }) });
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

  const celulaEditavel = (index: number, item: ItemDaTabela, campo: CampoEditavel, conteudo: React.ReactNode, alinhamento: 'center' | 'right') => {
    const editavel = podeEditar && (campo !== 'desconto' || permitirDescontoPorItem);
    const emEdicao = edicao && edicao.index === index && edicao.campo === campo ? edicao : null;
    if (emEdicao) {
      return (
        <td className="tiv-td" style={{ textAlign: alinhamento }}>
          <input
            autoFocus
            className="tiv-input"
            value={emEdicao.texto}
            inputMode="decimal"
            aria-label={`${campo === 'quantidade' ? 'Quantidade' : campo === 'precoUnitario' ? 'Preço unitário' : 'Desconto'} de ${item.nome}`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setEdicao({ ...emEdicao, texto: e.target.value })}
            onKeyDown={(e) => aoTeclarNaCelula(e, emEdicao)}
            onBlur={() => { if (!aplicando.current) aplicarEdicao(emEdicao); }}
            onClick={(e) => e.stopPropagation()}
            style={{ textAlign: alinhamento }}
          />
        </td>
      );
    }
    if (!editavel) return <td className="tiv-td" style={{ textAlign: alinhamento }}>{conteudo}</td>;
    return (
      <td className="tiv-td" style={{ textAlign: alinhamento }}>
        <button
          type="button"
          className="tiv-celula-editavel"
          title="Clique para alterar"
          onClick={(e) => { e.stopPropagation(); iniciarEdicao(index, campo); }}
          style={{ justifyContent: alinhamento === 'right' ? 'flex-end' : 'center' }}
        >
          <span>{conteudo}</span>
          <Pencil size={12} className="tiv-lapis" aria-hidden="true" />
        </button>
      </td>
    );
  };

  return (
    <div className="table-wrapper tiv">
      <table className="tiv-tabela">
        <thead>
          <tr>
            <th className="tiv-th tiv-col-cod">Cód.</th>
            <th className="tiv-th tiv-col-produto">Produto</th>
            <th className="tiv-th" style={{ textAlign: 'center' }}>Qtd</th>
            <th className="tiv-th" style={{ textAlign: 'right' }}>V. Unit</th>
            <th className="tiv-th" style={{ textAlign: 'right' }}>Desc.</th>
            <th className="tiv-th" style={{ textAlign: 'right' }}>Subtotal</th>
            {podeRemover && <th className="tiv-th" style={{ textAlign: 'center' }}>Ação</th>}
          </tr>
        </thead>
        <tbody>
          {podeLancar && (
            <tr className="tiv-lancamento" title="Digite o código do produto, Enter, a quantidade e Enter de novo">
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
                  inputMode="text"
                />
              </td>
              <td className="tiv-td">
                {produtoDaLinha ? (
                  <div className="tiv-produto-achado">
                    <span className="tiv-produto-nome">{produtoDaLinha.nome}</span>
                    <span className="tiv-produto-dica">
                      Disponível {disponivel(produtoDaLinha)} {produtoDaLinha.unidadeMedidaSigla || 'UN'}
                    </span>
                  </div>
                ) : codigo.trim() ? (
                  <span className="tiv-dica tiv-dica-alerta">Não achei esse código. Enter abre a busca por nome.</span>
                ) : (
                  <span className="tiv-dica">Digite o código do produto e Enter.</span>
                )}
              </td>
              <td className="tiv-td" style={{ textAlign: 'center' }}>
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
              <td className="tiv-td tiv-num" style={{ textAlign: 'right' }}>{produtoDaLinha ? moeda(precoDaLinha) : '—'}</td>
              <td className="tiv-td tiv-num" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
              <td className="tiv-td tiv-num" style={{ textAlign: 'right', fontWeight: 600 }}>
                {produtoDaLinha && !qtdDaLinha.erro ? moeda(precoDaLinha * qtdDaLinha.valor) : '—'}
              </td>
              {podeRemover && (
                <td className="tiv-td" style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="tiv-botao-lancar"
                    onClick={lancar}
                    disabled={!podeLancarAgora}
                    title="Lançar o item (Enter)"
                    aria-label="Lançar o item"
                  >
                    <CornerDownLeft size={15} /> Lançar
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
              className={selectedIndex === index ? 'item-row-selectable selected tiv-linha' : 'item-row-selectable tiv-linha'}
            >
              <td className="tiv-td tiv-cod">{item.codigo || '—'}</td>
              <td className="tiv-td">{item.nome}</td>
              {celulaEditavel(index, item, 'quantidade', (
                <>{item.quantidade.toFixed(item.unidadeMedidaCasasDecimais ?? 0)} {item.unidadeMedidaSigla || 'UN'}</>
              ), 'center')}
              {celulaEditavel(index, item, 'precoUnitario', (
                <span className="tiv-num">
                  {moeda(item.precoUnitario)}
                  {item.origemPreco === 'promocao' && (
                    <span className="tiv-sub tiv-sub-promo" title={item.promocaoNome ? `Promoção: ${item.promocaoNome}` : 'Promoção'}>
                      PROMOÇÃO{item.tabelaPreco ? <span className="tiv-sub-de"> · de <s>{moeda(item.tabelaPreco.venda)}</s></span> : null}
                    </span>
                  )}
                  {item.origemPreco === 'vista' && <span className="tiv-sub">preço à vista</span>}
                  {item.origemPreco === 'manual' && <span className="tiv-sub" title="Preço digitado: não muda com a forma de pagamento">preço digitado</span>}
                </span>
              ), 'right')}
              {celulaEditavel(index, item, 'desconto', (
                <span className="tiv-num" style={{ color: item.desconto > 0 ? '#ef4444' : 'var(--text-muted)' }}>
                  {item.desconto > 0 ? `-${moeda(item.desconto)}` : '-'}
                </span>
              ), 'right')}
              <td className="tiv-td tiv-num" style={{ textAlign: 'right', fontWeight: 600 }}>{moeda(item.subtotal)}</td>
              {podeRemover && (
                <td className="tiv-td" style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="tiv-botao-remover"
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
