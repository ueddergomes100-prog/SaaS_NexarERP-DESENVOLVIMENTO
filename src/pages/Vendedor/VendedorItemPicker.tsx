import React, { useMemo, useRef, useState } from 'react';
import { Search, Check, Trash2, Gift, Pencil, X } from 'lucide-react';
import ProdutoOpcaoBusca from '../../components/common/ProdutoOpcaoBusca';
import { LISTAR_TUDO_TERM, searchProducts } from '../../utils/productSearch';
import { resolveUnidadeMedidaProduto, temUnidadeMedidaCadastrada, avisoUnidadeMedidaAusente } from '../../utils/unidadeMedidaDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { podeVenderSemEstoque } from '../../utils/estoqueReservaDomain';
import { showError, showWarning } from '../../utils/alerts';
import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';
import { lerPrecoDigitado, precificarNoApp, precoDaTabelaDoItem, promocaoParaMostrar, trocarPrecoDoItem, type PrecosDoApp } from '../../utils/precoAppVendasDomain';
import { faixasDeAtacadoDoProduto, textoDoValorAtacado } from '../../utils/precoVendaDomain';
import { bonificarItem, cobrarItem, ehBonificado, resumoDaBonificacao } from '../../utils/bonificacaoDomain';
import { camposDeUnidadeDoItem, findOpcaoUnidadeVenda, mostraSeletorDeUnidade, opcaoNaUnidadeDoEstoque, opcoesDeUnidadeDaTela, toBaseQuantity } from '../../utils/embalagemDomain';

export interface ProdutoVendedorExterno {
  id: string;
  nome: string;
  codigo?: string;
  precoVenda: number;
  /** Preco a vista (0/ausente = nao cadastrado). Entra na tabela do item (promocoes, 19/10/2026). */
  precoAVista?: number;
  quantidade: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  ativo?: boolean;
  /** Trava do produto mesmo com "Permitir venda sem estoque" ligado (estoqueReservaDomain.ts). */
  bloquearVendaSemEstoque?: boolean;
  /** Embalagens do cadastro (rolo, tubo, saco -- embalagemDomain.ts). */
  embalagens?: unknown;
  /** So' vende na embalagem: a unidade solta nao e' oferecida (embalagemDomain). */
  venderSoNaEmbalagem?: boolean;
  /** Aba "Atacado" do produto: faixa de quantidade com preco proprio (precoVendaDomain). */
  atacado?: unknown;
}

interface Props {
  produtos: ProdutoVendedorExterno[];
  itens: ItemVendaExterna[];
  onItensChange: (itens: ItemVendaExterna[]) => void;
  permitirVendaSemEstoque: boolean;
  /** App do tecnico (fase 3): a empresa pode esconder os valores em R$ do tecnico. Padrao mostra. */
  mostrarValores?: boolean;
  /** Promocoes de hoje (usePromocoesVigentes). Sem isto, preco de venda puro. */
  precos?: PrecosDoApp | null;
  /** Pedido confere quota e limite por venda da promocao; orcamento e OS nao (como no desktop). */
  consomeQuota?: boolean;
  /** Bonificacao (30/10/2026): mostra "Bonificar" em cada item (empresa ligou + permissao). So' no pedido. */
  podeBonificar?: boolean;
  /** Permissao "App: Alterar o preco do item" (podeAlterarPrecoNoApp). So' pedido e orcamento. */
  podeAlterarPreco?: boolean;
  /** Config "Vender por embalagem" (21/11/2026): mostra a escolha da unidade no produto marcado. */
  venderPorEmbalagem?: boolean;
}

const RESULTADOS_LIMITE = 15;

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Busca de produto com SELECAO MULTIPLA (2026-09-23, pedido do dono).
 *
 * Antes o vendedor tinha que buscar, escolher 1 produto e clicar em "+" pra
 * cada item -- pra um pedido com 10 produtos diferentes eram 10 voltas
 * completas no fluxo. Agora a lista de resultado fica ABERTA (nao fecha ao
 * marcar), cada produto marcado entra numa selecao com quantidade propria
 * (comeca em 1, editavel ali mesmo), e um botao so' manda todos pro pedido de
 * uma vez. A selecao sobrevive a trocar o termo de busca -- da pra marcar
 * "SPR" ai buscar "GEL" e marcar mais, sem perder o que já foi escolhido.
 *
 * Deliberadamente NAO reaproveita o ProductAutocomplete (usado por PDV,
 * Pedido de Venda e OS no desktop): aquele trava no primeiro clique e fecha o
 * painel -- exatamente o oposto do que precisa aqui. Escrever a lista de novo
 * aqui evita arriscar as telas desktop, que continuam com o fluxo de sempre.
 */
const VendedorItemPicker: React.FC<Props> = ({ produtos, itens, onItensChange, permitirVendaSemEstoque, mostrarValores = true, precos = null, consomeQuota = false, podeBonificar = false, podeAlterarPreco = false, venderPorEmbalagem = false }) => {
  const [produtoBusca, setProdutoBusca] = useState('');
  // Tocar na busca ja' mostra a lista (mesmo comportamento do Pedido de Venda);
  // "Mostrar mais" aumenta o corte. "#" lista tudo, "#gel" filtra.
  const [focado, setFocado] = useState(false);
  const [limite, setLimite] = useState(RESULTADOS_LIMITE);
  // produtoId -> quantidade digitada (string, mesma logica do campo antigo).
  const [selecionados, setSelecionados] = useState<Record<string, string>>({});
  // produtoId -> embalagem escolhida ('' ou ausente = unidade do cadastro). 21/11/2026.
  const [unidadesEscolhidas, setUnidadesEscolhidas] = useState<Record<string, string>>({});

  const termo = produtoBusca.trim() || (focado ? LISTAR_TUDO_TERM : '');
  const resultado = useMemo(() => {
    if (!termo) return { items: [], total: 0, truncated: false };
    return searchProducts(produtos, termo, { limit: limite });
  }, [produtos, termo, limite]);

  // Item com o preco aberto para editar (uma linha por vez).
  const [precoEmEdicao, setPrecoEmEdicao] = useState<{ index: number; valor: string } | null>(null);

  const totalSelecionados = Object.keys(selecionados).length;
  const buscaRef = useRef<HTMLInputElement | null>(null);

  /**
   * Fecha a lista de produtos (23/11/2026, pedido do dono: "pra adicionar tem
   * que descer la embaixo, e os itens marcados ficam embaixo de tudo"). A
   * lista aberta empurrava os itens do pedido para o fim da tela; fechada, os
   * itens aparecem logo abaixo da busca. O que estava marcado continua marcado.
   */
  const fecharLista = () => {
    setProdutoBusca('');
    setFocado(false);
    setLimite(RESULTADOS_LIMITE);
    buscaRef.current?.blur();
  };

  /**
   * Toque na lista com o teclado aberto (23/11/2026, Android): o toque tirava
   * o foco da busca ANTES do clique, o teclado fechava, a tela pulava e o
   * clique se perdia -- o vendedor tinha de tocar duas vezes para marcar o
   * item. Segurando o foco no toque, o clique chega inteiro; o teclado fecha
   * depois, ja' com o item marcado (fecharTecladoDaBusca). Campos dentro da
   * lista (quantidade, unidade) continuam recebendo foco normalmente.
   */
  const manterFocoNaBusca = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    e.preventDefault();
  };

  const fecharTecladoDaBusca = () => {
    if (document.activeElement === buscaRef.current) buscaRef.current?.blur();
  };

  const alternarSelecao = (produtoId: string) => {
    setSelecionados((atual) => {
      if (produtoId in atual) {
        const { [produtoId]: _remover, ...resto } = atual;
        return resto;
      }
      return { ...atual, [produtoId]: '1' };
    });
  };

  const alterarQuantidadeSelecionada = (produtoId: string, valor: string) => {
    setSelecionados((atual) => (
      produtoId in atual ? { ...atual, [produtoId]: valor.replace(/[^0-9,.]/g, '') } : atual
    ));
  };

  const handleAdicionarSelecionados = () => {
    const idsSelecionados = Object.keys(selecionados);
    if (idsSelecionados.length === 0) {
      showError('Atenção', 'Marque pelo menos um produto da lista antes de adicionar.');
      return;
    }

    const erros: string[] = [];
    const semUnidade: string[] = [];
    const foraDaPromocao: string[] = [];
    const novosItens: ItemVendaExterna[] = [];

    idsSelecionados.forEach((id) => {
      const produto = produtos.find((p) => p.id === id);
      if (!produto) return; // saiu do catalogo ativo entre marcar e adicionar -- ignora, nao ha mais o que validar.

      const qtd = Number((selecionados[id] || '').replace(',', '.')) || 0;
      if (qtd <= 0) {
        erros.push(`${produto.nome}: quantidade deve ser maior que zero`);
        return;
      }

      const unidadeDoCadastro = resolveUnidadeMedidaProduto(produto);
      // Unidade escolhida (rolo, tubo...): estoque, quantidade e preco nela (21/11/2026).
      const opcao = findOpcaoUnidadeVenda(opcoesDeUnidadeDaTela(produto, venderPorEmbalagem), unidadesEscolhidas[id]);
      const unidade = opcao.embalagemId
        ? { unidadeMedidaSigla: opcao.sigla, unidadeMedidaFracionado: opcao.permiteFracionado, unidadeMedidaCasasDecimais: opcao.casasDecimais }
        : unidadeDoCadastro;
      const qtdNoEstoque = toBaseQuantity(qtd, opcao.fatorConversao);

      if (!podeVenderSemEstoque(permitirVendaSemEstoque, produto) && qtdNoEstoque > (produto.quantidade || 0)) {
        erros.push(`${produto.nome}: só há ${produto.quantidade || 0} ${unidadeDoCadastro.unidadeMedidaSigla} em estoque`);
        return;
      }

      if (!isValidSaleQuantity(qtd, unidade.unidadeMedidaFracionado, unidade.unidadeMedidaCasasDecimais)) {
        erros.push(unidade.unidadeMedidaFracionado
          ? `${produto.nome}: aceita no máximo ${unidade.unidadeMedidaCasasDecimais} casa(s) decimal(is)`
          : `${produto.nome}: é vendido em ${unidade.unidadeMedidaSigla}, que não permite quantidade fracionada`);
        return;
      }

      if (!temUnidadeMedidaCadastrada(produto)) semUnidade.push(produto.nome);

      // Embalagem fracionaria (meio metro, lata) entra na unidade do estoque:
      // 1 meio metro = 0,5 M3 a R$ 220 (embalagemDomain, 21/11/2026). A
      // quantidade digitada ja' foi conferida na embalagem, logo acima.
      const opcaoDoItem = opcaoNaUnidadeDoEstoque(opcao, opcoesDeUnidadeDaTela(produto, false)[0]);
      const qtdDoItem = opcaoDoItem !== opcao ? qtdNoEstoque : qtd;
      // Preco pela tabela do dia (promocao), como no desktop. Ver precoAppVendasDomain.
      const preco = precificarNoApp({ precos, produto, quantidade: qtdDoItem, naVenda: [...itens, ...novosItens], consomeQuota, unidade: opcaoDoItem });
      if (preco.aviso) foraDaPromocao.push(preco.aviso);
      novosItens.push({
        id: produto.id,
        nome: produto.nome,
        ...(produto.codigo ? { codigo: produto.codigo } : {}),
        precoUnitario: preco.preco,
        quantidade: qtdDoItem,
        desconto: 0,
        subtotal: Math.round(preco.preco * qtdDoItem * 100) / 100,
        unidadeMedidaSigla: unidade.unidadeMedidaSigla,
        unidadeMedidaFracionado: unidade.unidadeMedidaFracionado,
        unidadeMedidaCasasDecimais: unidade.unidadeMedidaCasasDecimais,
        ...(opcaoDoItem.embalagemId || opcaoDoItem.origem ? camposDeUnidadeDoItem(opcaoDoItem, qtdDoItem) : {}),
        ...(preco.campos || {}),
      });
    });

    // Tudo ou nada: reportar 3 problemas e adicionar so os outros 7 deixaria
    // o vendedor sem saber, na hora, o que realmente entrou no pedido.
    if (erros.length > 0) {
      showError(
        erros.length === 1 ? 'Não foi possível adicionar' : `${erros.length} produtos não puderam ser adicionados`,
        erros.join(' · '),
      );
      return;
    }

    onItensChange([...itens, ...novosItens]);
    semUnidade.forEach((nome) => showWarning(avisoUnidadeMedidaAusente(nome).text));
    foraDaPromocao.forEach((aviso) => showWarning(aviso));
    setSelecionados({});
    setUnidadesEscolhidas({});
    fecharLista();
  };

  const handleRemover = (index: number) => {
    setPrecoEmEdicao(null);
    onItensChange(itens.filter((_, i) => i !== index));
  };

  const handleAplicarPreco = () => {
    if (!precoEmEdicao) return;
    const preco = lerPrecoDigitado(precoEmEdicao.valor);
    if (preco === null) {
      showError('Preço inválido', 'Digite o preço em reais, maior que zero (por exemplo 129,90). Para dar o item de brinde, use a bonificação.');
      return;
    }
    onItensChange(itens.map((item, i) => (i === precoEmEdicao.index ? trocarPrecoDoItem(item, preco) : item)));
    setPrecoEmEdicao(null);
  };

  const handleAlternarBonificacao = (index: number) => {
    setPrecoEmEdicao(null);
    onItensChange(itens.map((item, i) => (i !== index ? item : ehBonificado(item) ? cobrarItem(item) : bonificarItem(item))));
  };

  const total = itens.reduce((soma, item) => soma + item.subtotal, 0);
  const bonificacao = resumoDaBonificacao(itens);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          ref={buscaRef}
          type="text"
          value={produtoBusca}
          onChange={(e) => { setProdutoBusca(e.target.value); setLimite(RESULTADOS_LIMITE); }}
          onFocus={() => setFocado(true)}
          placeholder="Buscar produto por nome ou código"
          title="Digite # para listar todos"
          aria-label="Buscar produto"
          style={{
            width: '100%', height: '48px', padding: '0 14px 0 42px', borderRadius: 'var(--app-raio-linha)', border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', color: 'var(--text-primary)', fontSize: '16px', boxSizing: 'border-box',
          }}
        />
      </div>

      {termo && (
        resultado.items.length === 0 ? (
          <div style={{ padding: '18px 4px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>
            Nenhum produto encontrado para &quot;{produtoBusca}&quot;.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} onMouseDown={manterFocoNaBusca}>
            {resultado.items.map((produto) => {
              const marcado = produto.id in selecionados;
              return (
                <div
                  key={produto.id}
                  onClick={() => { alternarSelecao(produto.id); fecharTecladoDaBusca(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', cursor: 'pointer',
                    backgroundColor: marcado ? 'rgba(153,100,240,0.14)' : 'var(--bg-elevated)',
                    border: `1.5px solid ${marcado ? 'var(--brand-500)' : 'var(--border-color)'}`,
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      width: '24px', height: '24px', borderRadius: '7px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: marcado ? 'var(--brand-500)' : 'transparent', border: `1.5px solid ${marcado ? 'var(--brand-500)' : 'var(--text-muted)'}`,
                    }}
                  >
                    {marcado && <Check size={15} color="#fff" strokeWidth={3} />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <ProdutoOpcaoBusca produto={produto} termo={produtoBusca} />
                    {/* Valor atacado (28/11/2026): a partir da quantidade da faixa o pedido ja' entra nesse preco. */}
                    {mostrarValores && (() => {
                      const texto = textoDoValorAtacado(faixasDeAtacadoDoProduto(produto), String(produto.unidadeMedidaSigla || ''), formatarMoeda);
                      return texto ? <span className="app-valor-atacado">{texto}</span> : null;
                    })()}
                    {mostrarValores && (() => {
                      const promo = promocaoParaMostrar(precos, produto);
                      return promo ? (
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#10b981' }} title={promo.nome}>
                          {promo.soAVista ? 'Promoção à vista' : 'Promoção'}: {formatarMoeda(promo.preco)}
                        </span>
                      ) : null;
                    })()}
                  </div>

                  {/* Unidade (rolo, tubo, saco): so' com embalagem e "Vender por embalagem" ligado (21/11/2026). */}
                  {marcado && (() => {
                    const opcoes = opcoesDeUnidadeDaTela(produto, venderPorEmbalagem);
                    if (!mostraSeletorDeUnidade(opcoes)) return null;
                    return (
                      <select
                        value={findOpcaoUnidadeVenda(opcoes, unidadesEscolhidas[produto.id]).embalagemId}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setUnidadesEscolhidas((atual) => ({ ...atual, [produto.id]: e.target.value }))}
                        aria-label={`Unidade de ${produto.nome}`}
                        style={{
                          height: '40px', maxWidth: '96px', borderRadius: '10px', border: '1px solid var(--border-color)', flexShrink: 0,
                          backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600, padding: '0 6px',
                        }}
                      >
                        {opcoes.map((opcao) => (
                          <option key={opcao.embalagemId || 'base'} value={opcao.embalagemId}>{opcao.label}</option>
                        ))}
                      </select>
                    );
                  })()}
                  {marcado && (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={selecionados[produto.id]}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => alterarQuantidadeSelecionada(produto.id, e.target.value)}
                      aria-label={`Quantidade de ${produto.nome}`}
                      style={{
                        width: '52px', height: '40px', borderRadius: '10px', border: '1px solid var(--border-color)', flexShrink: 0,
                        backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', textAlign: 'center', fontSize: '16px', fontWeight: 700,
                      }}
                    />
                  )}
                </div>
              );
            })}
            {resultado.truncated && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setLimite((atual) => atual + 30)}
                style={{ width: '100%', padding: '12px', fontSize: '14px' }}
              >
                Mostrar mais ({resultado.total - resultado.items.length} restantes)
              </button>
            )}
          </div>
        )
      )}

      {/* Barra FIXA no pe' da tela enquanto a lista esta' aberta ou ha' produto
          marcado (23/11/2026): "Adicionar" sem precisar descer a lista inteira
          e "Fechar lista" para voltar aos itens do pedido. */}
      {(termo || totalSelecionados > 0) && (
        <div
          onMouseDown={manterFocoNaBusca}
          style={{
            position: 'sticky', bottom: '-16px', zIndex: 5, margin: '0 -20px', padding: '10px 20px 12px', display: 'flex', gap: '10px',
            backgroundColor: 'var(--bg-primary)', borderTop: '1px solid var(--border-color)', boxShadow: '0 -8px 18px rgba(0,0,0,0.18)',
          }}
        >
          {termo && (
            <button
              type="button"
              onClick={fecharLista}
              style={{
                flex: totalSelecionados > 0 ? '0 0 auto' : 1, height: '48px', padding: '0 16px', borderRadius: '14px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
                color: 'var(--text-primary)', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
              }}
            >
              <X size={17} />
              {totalSelecionados > 0 ? 'Fechar' : `Fechar lista${itens.length > 0 ? ` · ver ${itens.length} ${itens.length === 1 ? 'item adicionado' : 'itens adicionados'}` : ''}`}
            </button>
          )}
          {totalSelecionados > 0 && (
            <button
              type="button"
              onClick={handleAdicionarSelecionados}
              style={{
                flex: 1, height: '48px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#fff', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
              }}
            >
              <Check size={18} />
              Adicionar {totalSelecionados} {totalSelecionados === 1 ? 'item' : 'itens'}
            </button>
          )}
        </div>
      )}

      {itens.length > 0 && (
        <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '4px' }}>
          Itens adicionados ({itens.length})
        </div>
      )}

      {itens.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          Nenhum item adicionado ainda.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {itens.map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              style={{
                padding: '14px', borderRadius: 'var(--app-raio-linha)',
                backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {item.nome}
                </div>
                <div style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {item.quantidade} {item.unidadeMedidaSigla}{mostrarValores ? <> &times; {formatarMoeda(ehBonificado(item) ? Number(item.precoReferencia) || 0 : item.precoUnitario)}</> : null}
                </div>
                {ehBonificado(item) && (
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#d97706', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Gift size={13} /> Bonificado · sem cobrança
                  </div>
                )}
                {mostrarValores && !ehBonificado(item) && item.origemPreco === 'promocao' && item.tabelaPreco && (
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#10b981', marginTop: '2px' }} title={item.promocaoNome}>
                    promoção · de <s>{formatarMoeda(item.tabelaPreco.venda)}</s>
                  </div>
                )}
                {mostrarValores && !ehBonificado(item) && item.origemPreco === 'atacado' && item.tabelaPreco && (
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#10b981', marginTop: '2px' }}>
                    atacado · de <s>{formatarMoeda(item.tabelaPreco.venda)}</s>
                  </div>
                )}
                {mostrarValores && !ehBonificado(item) && item.origemPreco !== 'atacado' && item.tabelaPreco?.atacado && (
                  <div className="app-valor-atacado">
                    {textoDoValorAtacado(item.tabelaPreco.atacado, String(item.unidadeMedidaSigla || ''), formatarMoeda)}
                  </div>
                )}
                {mostrarValores && !ehBonificado(item) && item.origemPreco === 'manual' && (
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#d97706', marginTop: '2px' }}>
                    preço alterado{precoDaTabelaDoItem(item) > 0 ? <> · tabela {formatarMoeda(precoDaTabelaDoItem(item))}</> : null}
                  </div>
                )}
              </div>
              {mostrarValores && <div style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(item.subtotal)}</div>}
              {podeAlterarPreco && mostrarValores && !ehBonificado(item) && (
                <button
                  type="button"
                  onClick={() => setPrecoEmEdicao(precoEmEdicao?.index === index ? null : { index, valor: item.precoUnitario.toFixed(2).replace('.', ',') })}
                  aria-label={`Alterar o preço de ${item.nome}`}
                  title="Alterar o preço"
                  style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', padding: '6px' }}
                >
                  <Pencil size={16} />
                </button>
              )}
              {(podeBonificar || ehBonificado(item)) && (
                <button
                  type="button"
                  onClick={() => handleAlternarBonificacao(index)}
                  disabled={!podeBonificar}
                  aria-label={ehBonificado(item) ? `Voltar ${item.nome} para cobrado` : `Bonificar ${item.nome}`}
                  title={ehBonificado(item) ? 'Voltar para cobrado' : 'Bonificar (brinde, sem cobrança)'}
                  style={{
                    color: ehBonificado(item) ? '#d97706' : 'var(--text-muted)', background: ehBonificado(item) ? 'rgba(217,119,6,0.12)' : 'transparent',
                    border: 'none', borderRadius: '8px', cursor: podeBonificar ? 'pointer' : 'default', display: 'flex', padding: '6px',
                  }}
                >
                  <Gift size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRemover(index)}
                aria-label={`Remover ${item.nome}`}
                style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}
              >
                <Trash2 size={16} />
              </button>
              </div>
              {precoEmEdicao?.index === index && (() => {
                const digitado = lerPrecoDigitado(precoEmEdicao.valor);
                const tabela = precoDaTabelaDoItem(item);
                return (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                    <label htmlFor={`preco-item-${index}`} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      Preço de {item.unidadeMedidaSigla} (R$)
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        id={`preco-item-${index}`}
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        value={precoEmEdicao.valor}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setPrecoEmEdicao({ index, valor: e.target.value.replace(/[^0-9,.]/g, '') })}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAplicarPreco(); } }}
                        style={{
                          flex: 1, minWidth: 0, height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '16px', fontWeight: 700, boxSizing: 'border-box',
                        }}
                      />
                      <button type="button" className="btn-secondary" onClick={() => setPrecoEmEdicao(null)} style={{ height: '44px', padding: '0 12px', fontSize: '14px' }}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleAplicarPreco}
                        style={{ height: '44px', padding: '0 16px', borderRadius: '10px', border: 'none', fontSize: '14px', fontWeight: 700, color: '#fff', cursor: 'pointer', background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)' }}
                      >
                        Aplicar
                      </button>
                    </div>
                    {digitado !== null && tabela > 0 && digitado < tabela && (
                      <div style={{ fontSize: '12.5px', color: '#d97706', marginTop: '8px' }}>
                        Abaixo do preço da tabela ({formatarMoeda(tabela)}): a diferença conta como desconto quando a loja faturar.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {bonificacao.quantidadeDeItens > 0 && mostrarValores && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13.5px', color: '#d97706', fontWeight: 600 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Gift size={14} /> Bonificação (sem cobrança)</span>
          <span>{formatarMoeda(bonificacao.bonificadoCentavos / 100)}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px' }}>
        <span style={{ fontSize: '15px', color: 'var(--text-secondary)', fontWeight: 500 }}>Total</span>
        <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>{mostrarValores ? formatarMoeda(total) : '—'}</span>
      </div>
    </div>
  );
};

export default VendedorItemPicker;
