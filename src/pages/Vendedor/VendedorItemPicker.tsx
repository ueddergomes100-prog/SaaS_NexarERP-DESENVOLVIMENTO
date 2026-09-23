import React, { useMemo, useState } from 'react';
import { Search, Check, Trash2 } from 'lucide-react';
import ProdutoOpcaoBusca from '../../components/common/ProdutoOpcaoBusca';
import { searchProducts } from '../../utils/productSearch';
import { resolveUnidadeMedidaProduto, temUnidadeMedidaCadastrada, avisoUnidadeMedidaAusente } from '../../utils/unidadeMedidaDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { showError, showWarning } from '../../utils/alerts';
import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';

export interface ProdutoVendedorExterno {
  id: string;
  nome: string;
  codigo?: string;
  precoVenda: number;
  quantidade: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  ativo?: boolean;
}

interface Props {
  produtos: ProdutoVendedorExterno[];
  itens: ItemVendaExterna[];
  onItensChange: (itens: ItemVendaExterna[]) => void;
  permitirVendaSemEstoque: boolean;
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
const VendedorItemPicker: React.FC<Props> = ({ produtos, itens, onItensChange, permitirVendaSemEstoque }) => {
  const [produtoBusca, setProdutoBusca] = useState('');
  // produtoId -> quantidade digitada (string, mesma logica do campo antigo).
  const [selecionados, setSelecionados] = useState<Record<string, string>>({});

  const resultado = useMemo(() => {
    if (!produtoBusca.trim()) return { items: [], total: 0, truncated: false };
    return searchProducts(produtos, produtoBusca, { limit: RESULTADOS_LIMITE });
  }, [produtos, produtoBusca]);

  const totalSelecionados = Object.keys(selecionados).length;

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
    const novosItens: ItemVendaExterna[] = [];

    idsSelecionados.forEach((id) => {
      const produto = produtos.find((p) => p.id === id);
      if (!produto) return; // saiu do catalogo ativo entre marcar e adicionar -- ignora, nao ha mais o que validar.

      const qtd = Number((selecionados[id] || '').replace(',', '.')) || 0;
      if (qtd <= 0) {
        erros.push(`${produto.nome}: quantidade deve ser maior que zero`);
        return;
      }

      const unidade = resolveUnidadeMedidaProduto(produto);

      if (!permitirVendaSemEstoque && qtd > (produto.quantidade || 0)) {
        erros.push(`${produto.nome}: só há ${produto.quantidade || 0} ${unidade.unidadeMedidaSigla} em estoque`);
        return;
      }

      if (!isValidSaleQuantity(qtd, unidade.unidadeMedidaFracionado, unidade.unidadeMedidaCasasDecimais)) {
        erros.push(unidade.unidadeMedidaFracionado
          ? `${produto.nome}: aceita no máximo ${unidade.unidadeMedidaCasasDecimais} casa(s) decimal(is)`
          : `${produto.nome}: é vendido em ${unidade.unidadeMedidaSigla}, que não permite quantidade fracionada`);
        return;
      }

      if (!temUnidadeMedidaCadastrada(produto)) semUnidade.push(produto.nome);

      novosItens.push({
        id: produto.id,
        nome: produto.nome,
        ...(produto.codigo ? { codigo: produto.codigo } : {}),
        precoUnitario: produto.precoVenda,
        quantidade: qtd,
        desconto: 0,
        subtotal: produto.precoVenda * qtd,
        unidadeMedidaSigla: unidade.unidadeMedidaSigla,
        unidadeMedidaFracionado: unidade.unidadeMedidaFracionado,
        unidadeMedidaCasasDecimais: unidade.unidadeMedidaCasasDecimais,
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
    setSelecionados({});
    setProdutoBusca('');
  };

  const handleRemover = (index: number) => {
    onItensChange(itens.filter((_, i) => i !== index));
  };

  const total = itens.reduce((soma, item) => soma + item.subtotal, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={produtoBusca}
          onChange={(e) => setProdutoBusca(e.target.value)}
          placeholder="Buscar produto por nome ou código"
          aria-label="Buscar produto"
          style={{
            width: '100%', height: '48px', padding: '0 14px 0 42px', borderRadius: '14px', border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '16px', boxSizing: 'border-box',
          }}
        />
      </div>

      {produtoBusca.trim() && (
        resultado.items.length === 0 ? (
          <div style={{ padding: '18px 4px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>
            Nenhum produto encontrado para &quot;{produtoBusca}&quot;.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {resultado.items.map((produto) => {
              const marcado = produto.id in selecionados;
              return (
                <div
                  key={produto.id}
                  onClick={() => alternarSelecao(produto.id)}
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
                  </div>

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
              <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', textAlign: 'center', padding: '2px 0' }}>
                Mostrando {resultado.items.length} de {resultado.total} — refine a busca pra ver outros.
              </div>
            )}
          </div>
        )
      )}

      {totalSelecionados > 0 && (
        <button
          type="button"
          onClick={handleAdicionarSelecionados}
          style={{
            width: '100%', height: '48px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#fff', cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
          }}
        >
          <Check size={18} />
          Adicionar {totalSelecionados} {totalSelecionados === 1 ? 'item' : 'itens'} ao pedido
        </button>
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
                display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: '14px',
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.nome}
                </div>
                <div style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {item.quantidade} {item.unidadeMedidaSigla} &times; {formatarMoeda(item.precoUnitario)}
                </div>
              </div>
              <div style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(item.subtotal)}</div>
              <button
                type="button"
                onClick={() => handleRemover(index)}
                aria-label={`Remover ${item.nome}`}
                style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px' }}>
        <span style={{ fontSize: '15px', color: 'var(--text-secondary)', fontWeight: 500 }}>Total</span>
        <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>{formatarMoeda(total)}</span>
      </div>
    </div>
  );
};

export default VendedorItemPicker;
