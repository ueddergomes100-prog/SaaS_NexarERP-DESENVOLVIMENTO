import React, { useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
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

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VendedorItemPicker: React.FC<Props> = ({ produtos, itens, onItensChange, permitirVendaSemEstoque }) => {
  const [produtoBusca, setProdutoBusca] = useState('');
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoVendedorExterno | null>(null);
  const [quantidadeInput, setQuantidadeInput] = useState('1');

  const handleAdicionar = () => {
    if (!produtoSelecionado) {
      showError('Atenção', 'Busque e selecione um produto da lista.');
      return;
    }
    const qtd = Number(quantidadeInput.replace(',', '.')) || 0;
    if (qtd <= 0) {
      showError('Atenção', 'A quantidade deve ser maior que zero.');
      return;
    }

    const unidade = resolveUnidadeMedidaProduto(produtoSelecionado);

    if (!permitirVendaSemEstoque && qtd > (produtoSelecionado.quantidade || 0)) {
      showError('Estoque insuficiente', `Só há ${produtoSelecionado.quantidade || 0} ${unidade.unidadeMedidaSigla} de ${produtoSelecionado.nome} em estoque.`);
      return;
    }

    if (!isValidSaleQuantity(qtd, unidade.unidadeMedidaFracionado, unidade.unidadeMedidaCasasDecimais)) {
      showError('Quantidade inválida', unidade.unidadeMedidaFracionado
        ? `A quantidade de ${produtoSelecionado.nome} aceita no máximo ${unidade.unidadeMedidaCasasDecimais} casa(s) decimal(is).`
        : `${produtoSelecionado.nome} é vendido em ${unidade.unidadeMedidaSigla}, que não permite quantidade fracionada. Use um número inteiro.`);
      return;
    }

    if (!temUnidadeMedidaCadastrada(produtoSelecionado)) {
      showWarning(avisoUnidadeMedidaAusente(produtoSelecionado.nome).text);
    }

    const subtotal = produtoSelecionado.precoVenda * qtd;
    const novoItem: ItemVendaExterna = {
      id: produtoSelecionado.id,
      nome: produtoSelecionado.nome,
      ...(produtoSelecionado.codigo ? { codigo: produtoSelecionado.codigo } : {}),
      precoUnitario: produtoSelecionado.precoVenda,
      quantidade: qtd,
      desconto: 0,
      subtotal,
      unidadeMedidaSigla: unidade.unidadeMedidaSigla,
      unidadeMedidaFracionado: unidade.unidadeMedidaFracionado,
      unidadeMedidaCasasDecimais: unidade.unidadeMedidaCasasDecimais,
    };

    onItensChange([...itens, novoItem]);
    setProdutoSelecionado(null);
    setProdutoBusca('');
    setQuantidadeInput('1');
  };

  const handleRemover = (index: number) => {
    onItensChange(itens.filter((_, i) => i !== index));
  };

  const total = itens.reduce((soma, item) => soma + item.subtotal, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: '14px', top: '17px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <div style={{ paddingLeft: '30px' }}>
            <ProductAutocomplete
              value={produtoBusca}
              onChange={setProdutoBusca}
              products={produtos}
              onSelect={(produto) => setProdutoSelecionado(produto)}
              renderItem={renderProdutoOpcaoBusca}
              variant="inline"
              placeholder="Buscar produto por nome ou código"
              ariaLabel="Buscar produto"
            />
          </div>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={quantidadeInput}
          onChange={(e) => setQuantidadeInput(e.target.value.replace(/[^0-9,.]/g, ''))}
          style={{
            width: '64px', height: '48px', borderRadius: '14px', border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', textAlign: 'center', fontSize: '15px', fontWeight: 700,
          }}
        />
        <button
          type="button"
          onClick={handleAdicionar}
          style={{
            width: '48px', height: '48px', borderRadius: '14px', border: 'none', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <Plus size={22} />
        </button>
      </div>

      {itens.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
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
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.nome}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {item.quantidade} {item.unidadeMedidaSigla} &times; {formatarMoeda(item.precoUnitario)}
                </div>
              </div>
              <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(item.subtotal)}</div>
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
        <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>Total</span>
        <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>{formatarMoeda(total)}</span>
      </div>
    </div>
  );
};

export default VendedorItemPicker;
