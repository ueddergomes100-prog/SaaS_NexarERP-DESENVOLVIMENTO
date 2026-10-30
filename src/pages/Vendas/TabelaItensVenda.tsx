import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Gift, Search, Trash2 } from 'lucide-react';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import ProductSearchModal from '../../components/common/ProductSearchModal';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
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
 *  - o lancamento fica na barra unica acima da grade (LancamentoItens.css,
 *    no PedidoVendaForm); a linha de codigo que existia aqui saiu no mesmo
 *    dia porque duplicava a busca, que ja' aceita codigo e nome.
 *  - num item ja' lancado, CODIGO, quantidade, preco unitario e desconto
 *    editam na propria celula: clique, digite, Enter aplica, Tab aplica e
 *    vai para a proxima celula, Esc desfaz. Trocar o codigo troca o produto
 *    da linha (mantendo a quantidade), sem precisar remover e lancar de novo:
 *    a celula do codigo vira a MESMA busca da barra (lista por codigo ou
 *    nome enquanto digita) com a lupa da consulta completa ao lado
 *    (pedido do dono, 13/10: "digitei 2, tinha que aparecer qual item").
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
  /** Bonificacao (30/10/2026): item de brinde -- preco 0, preco cheio em precoReferencia. */
  bonificado?: boolean;
  precoReferencia?: number;
}

export interface ProdutoLancavel extends SearchableProduct {
  id: string;
  nome: string;
  precoVenda?: number | null;
  quantidade: number;
  quantidadeReservada?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
}

export interface TabelaItensVendaHandle {
  /** F5: abre a quantidade da linha selecionada para edicao. */
  editarSelecionado: () => void;
}

interface Props {
  itens: ItemDaTabela[];
  catalogo: ProdutoLancavel[];
  podeEditar: boolean;
  podeRemover: boolean;
  permitirDescontoPorItem: boolean;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  /** Devolve a mensagem de erro em portugues, ou null quando aplicou. */
  onAtualizarItem: (index: number, campos: { quantidade?: number; precoUnitario?: number; desconto?: number }) => string | null;
  /** Troca o produto da linha (codigo editado), mantendo a quantidade. Erro em portugues ou null. */
  onTrocarProduto: (index: number, produto: ProdutoLancavel) => string | null;
  onRemover: (index: number) => void;
  /** Bonificar / voltar para cobrado (so' quando a empresa ligou e a pessoa pode bonificar). */
  onAlternarBonificacao?: (index: number) => void;
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
  itens, catalogo, podeEditar, podeRemover, permitirDescontoPorItem, selectedIndex, onSelect,
  onAtualizarItem, onTrocarProduto, onRemover, onAlternarBonificacao,
}, ref) => {
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  // Evita aplicar duas vezes (Enter ja' aplicou e o blur vem em seguida).
  const aplicando = useRef(false);
  // Troca de produto pela consulta completa (lupa ou "Ver mais" na celula do codigo).
  const [consulta, setConsulta] = useState<{ index: number; texto: string } | null>(null);
  const consultaAberta = useRef(false);
  const trocaInputRef = useRef<HTMLInputElement>(null);
  const trocaRef = useRef<HTMLDivElement>(null);
  const editandoCodigo = edicao?.campo === 'codigo';

  // Ao abrir a troca, o cursor ja' vai para a busca.
  useEffect(() => {
    if (editandoCodigo) trocaInputRef.current?.focus();
  }, [editandoCodigo, edicao?.index]);

  const colunas = 6 + (podeRemover ? 1 : 0);

  const campoEditavel = (campo: CampoEditavel) => podeEditar && (campo !== 'desconto' || permitirDescontoPorItem);

  const iniciarEdicao = (index: number, campo: CampoEditavel) => {
    if (!campoEditavel(campo)) return;
    const item = itens[index];
    if (!item) return;
    // Item bonificado vai a preco zero: preco e desconto nao se editam (volte para cobrado antes).
    if (item.bonificado && (campo === 'precoUnitario' || campo === 'desconto')) return;
    onSelect(index);
    // Troca de produto comeca VAZIA: a busca trava quando ja' vem com texto
    // (ProductAutocomplete), e o codigo atual continua a vista na linha.
    setEdicao({ index, campo, texto: campo === 'codigo' ? '' : textoParaEdicao(campo, item) });
  };

  useImperativeHandle(ref, () => ({
    editarSelecionado: () => { if (selectedIndex !== null) iniciarEdicao(selectedIndex, 'quantidade'); },
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

  /** Produto escolhido na busca da celula ou na consulta completa: troca e abre a quantidade. */
  const trocarPor = (index: number, produto: ProdutoLancavel) => {
    const item = itens[index];
    if (!item) { setEdicao(null); return; }
    const falha = onTrocarProduto(index, produto);
    if (falha) {
      showError('Não foi possível trocar o produto', falha);
      setEdicao(null);
      return;
    }
    // Trocou: confere a quantidade em seguida (Esc sai sem mexer).
    setEdicao({ index, campo: 'quantidade', texto: textoParaEdicao('quantidade', item) });
  };

  const abrirConsulta = (index: number, texto: string) => {
    const item = itens[index];
    consultaAberta.current = true;
    setConsulta({ index, texto: texto.trim() === (item?.codigo || '') ? '' : texto.trim() });
  };

  const fecharConsulta = () => {
    consultaAberta.current = false;
    setConsulta(null);
    setEdicao(null);
  };

  // Clicou fora da troca (e nao foi para a consulta completa): cancela sem mexer.
  const aoSairDaTroca = () => {
    window.setTimeout(() => {
      if (consultaAberta.current) return;
      if (trocaRef.current && trocaRef.current.contains(document.activeElement)) return;
      setEdicao((atual) => (atual?.campo === 'codigo' ? null : atual));
    }, 150);
  };

  const celula = (index: number, item: ItemDaTabela, campo: CampoEditavel, conteudo: React.ReactNode, classe: string) => {
    const emEdicao = edicao && edicao.index === index && edicao.campo === campo ? edicao : null;
    if (emEdicao && campo === 'codigo') {
      return (
        <td className={`tiv-td tiv-td-troca ${classe}`}>
          <div
            ref={trocaRef}
            className="tiv-troca"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEdicao(null); } }}
            onBlur={aoSairDaTroca}
            onClick={(e) => e.stopPropagation()}
          >
            <ProductAutocomplete
              value={emEdicao.texto}
              onChange={(texto) => setEdicao({ ...emEdicao, texto })}
              products={catalogo}
              onSelect={(produto) => trocarPor(index, produto)}
              renderItem={renderProdutoOpcaoBusca}
              inputRef={trocaInputRef}
              autoFocus
              placeholder="Código ou nome"
              ariaLabel={`Trocar o produto ${item.nome}`}
              className="tiv-troca-busca"
              onViewMore={() => abrirConsulta(index, emEdicao.texto)}
            />
            <button
              type="button"
              className="tiv-troca-consulta"
              title="Abrir a consulta completa de produtos"
              aria-label="Abrir a consulta completa de produtos"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => abrirConsulta(index, emEdicao.texto)}
            >
              <Search size={16} />
            </button>
          </div>
        </td>
      );
    }
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
    <div className={editandoCodigo ? 'tiv tiv-trocando' : 'tiv'}>
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
          {itens.length === 0 ? (
            <tr>
              <td colSpan={colunas} className="tiv-vazio">Nenhum item na venda ainda. Digite o código ou o nome do produto na barra acima.</td>
            </tr>
          ) : itens.map((item, index) => (
            <tr
              key={index}
              onClick={() => onSelect(index)}
              className={selectedIndex === index ? 'tiv-linha tiv-linha-selecionada' : 'tiv-linha'}
            >
              {celula(index, item, 'codigo', <span className="tiv-cod">{item.codigo || '—'}</span>, '')}
              <td className="tiv-td" title={item.nome}><span className="tiv-nome">{item.nome}</span></td>
              {celula(index, item, 'quantidade', (
                <span className="tiv-num">{item.quantidade.toFixed(item.unidadeMedidaCasasDecimais ?? 0)} <span className="tiv-unidade">{item.unidadeMedidaSigla || 'UN'}</span></span>
              ), 'tiv-centro')}
              {celula(index, item, 'precoUnitario', (
                <span className="tiv-num">
                  {moeda(item.bonificado ? Number(item.precoReferencia) || 0 : item.precoUnitario)}
                  {item.bonificado && <span className="tiv-sub" style={{ color: '#d97706', fontWeight: 700 }} title="Brinde: vai sem cobrança">bonificado</span>}
                  {!item.bonificado && item.origemPreco === 'promocao' && (
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
                  <div style={{ display: 'inline-flex', gap: '2px' }}>
                    {(onAlternarBonificacao || item.bonificado) && (
                      <button
                        type="button"
                        className="tiv-remover"
                        disabled={!onAlternarBonificacao}
                        onClick={(e) => { e.stopPropagation(); onAlternarBonificacao?.(index); }}
                        title={item.bonificado ? 'Voltar para cobrado' : 'Bonificar (brinde, sem cobrança)'}
                        aria-label={item.bonificado ? `Voltar ${item.nome} para cobrado` : `Bonificar ${item.nome}`}
                        style={{ color: item.bonificado ? '#d97706' : 'var(--text-muted)' }}
                      >
                        <Gift size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="tiv-remover"
                      onClick={(e) => { e.stopPropagation(); onRemover(index); }}
                      title="Tirar da venda"
                      aria-label={`Tirar ${item.nome} da venda`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <ProductSearchModal
        open={consulta !== null}
        onClose={fecharConsulta}
        products={catalogo}
        onSelect={(produto) => {
          const indice = consulta?.index;
          consultaAberta.current = false;
          setConsulta(null);
          if (indice !== undefined) trocarPor(indice, produto);
        }}
        renderItem={renderProdutoOpcaoBusca}
        initialQuery={consulta?.texto || ''}
        title={consulta && itens[consulta.index] ? `Trocar ${itens[consulta.index].nome}` : 'Trocar produto'}
      />
    </div>
  );
});

TabelaItensVenda.displayName = 'TabelaItensVenda';

export default TabelaItensVenda;
