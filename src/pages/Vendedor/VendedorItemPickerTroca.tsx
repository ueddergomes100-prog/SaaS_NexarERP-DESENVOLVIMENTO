import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { resolveUnidadeMedidaProduto } from '../../utils/unidadeMedidaDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { showError } from '../../utils/alerts';
import {
  DESCRICAO_MOTIVO_MAX,
  MOTIVOS_TROCA,
  rotuloDoMotivoTroca,
  type ItemTrocaRascunho,
} from '../../utils/trocaDomain';
import type { ProdutoVendedorExterno } from './VendedorItemPicker';

/**
 * Itens de uma TROCA no app do vendedor: produto, quantidade e MOTIVO de cada
 * item (sem preco -- troca nao cobra). Nao confere estoque aqui: quem reserva e'
 * a loja, quando aprova.
 */

interface Props {
  produtos: ProdutoVendedorExterno[];
  itens: ItemTrocaRascunho[];
  onItensChange: (itens: ItemTrocaRascunho[]) => void;
}

const campoBase: React.CSSProperties = {
  width: '100%', height: '48px', borderRadius: '14px', border: '1px solid var(--border-color)', padding: '0 14px',
  backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)',
  // 16px impede o Safari do iOS de dar zoom sozinho ao focar (ver vendedorMobile.css).
  fontSize: '16px',
};

const VendedorItemPickerTroca: React.FC<Props> = ({ produtos, itens, onItensChange }) => {
  const [produtoBusca, setProdutoBusca] = useState('');
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoVendedorExterno | null>(null);
  const [quantidadeInput, setQuantidadeInput] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [motivoDescricao, setMotivoDescricao] = useState('');

  const handleAdicionar = () => {
    if (!produtoSelecionado) {
      showError('Atenção', 'Busque e selecione o produto estragado na lista.');
      return;
    }
    const qtd = Number(quantidadeInput.replace(',', '.')) || 0;
    if (qtd <= 0) {
      showError('Atenção', 'A quantidade deve ser maior que zero.');
      return;
    }
    const unidade = resolveUnidadeMedidaProduto(produtoSelecionado);
    if (!isValidSaleQuantity(qtd, unidade.unidadeMedidaFracionado, unidade.unidadeMedidaCasasDecimais)) {
      showError('Quantidade inválida', unidade.unidadeMedidaFracionado
        ? `A quantidade de ${produtoSelecionado.nome} aceita no máximo ${unidade.unidadeMedidaCasasDecimais} casa(s) decimal(is).`
        : `${produtoSelecionado.nome} é contado em ${unidade.unidadeMedidaSigla}, que não permite quantidade fracionada. Use um número inteiro.`);
      return;
    }
    if (!motivo) {
      showError('Atenção', 'Escolha o motivo da troca.');
      return;
    }
    if (motivo === 'outro' && motivoDescricao.trim().length < 3) {
      showError('Atenção', 'Descreva o motivo (você escolheu "Outro").');
      return;
    }

    onItensChange([...itens, {
      id: produtoSelecionado.id,
      nome: produtoSelecionado.nome,
      ...(produtoSelecionado.codigo ? { codigo: produtoSelecionado.codigo } : {}),
      quantidade: qtd,
      unidadeMedidaSigla: unidade.unidadeMedidaSigla,
      motivo,
      ...(motivo === 'outro' ? { motivoDescricao: motivoDescricao.trim() } : {}),
    }]);
    setProdutoSelecionado(null);
    setProdutoBusca('');
    setQuantidadeInput('1');
    setMotivo('');
    setMotivoDescricao('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ProductAutocomplete
            value={produtoBusca}
            onChange={(valor) => {
              setProdutoBusca(valor);
              if (produtoSelecionado && valor !== produtoSelecionado.nome) setProdutoSelecionado(null);
            }}
            products={produtos}
            onSelect={(produto) => {
              setProdutoSelecionado(produto);
              setProdutoBusca(produto.nome);
            }}
            renderItem={renderProdutoOpcaoBusca}
            variant="inline"
            placeholder="Buscar o produto estragado"
            ariaLabel="Buscar produto"
          />
        </div>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Quantidade"
          value={quantidadeInput}
          onChange={(e) => setQuantidadeInput(e.target.value.replace(/[^0-9,.]/g, ''))}
          style={{ ...campoBase, width: '64px', padding: 0, textAlign: 'center', fontWeight: 700 }}
        />
      </div>

      <select
        aria-label="Motivo da troca"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        style={{ ...campoBase, color: motivo ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        <option value="">Motivo da troca...</option>
        {MOTIVOS_TROCA.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>

      {motivo === 'outro' && (
        <input
          type="text"
          aria-label="Descreva o motivo"
          value={motivoDescricao}
          maxLength={DESCRICAO_MOTIVO_MAX}
          onChange={(e) => setMotivoDescricao(e.target.value)}
          placeholder="Descreva o motivo"
          style={campoBase}
        />
      )}

      <button
        type="button"
        onClick={handleAdicionar}
        style={{
          height: '48px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          fontSize: '14.5px', fontWeight: 700, color: '#fff', cursor: 'pointer',
          background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
        }}
      >
        <Plus size={20} /> Adicionar à troca
      </button>

      {itens.length === 0 ? (
        <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
          Nenhum item na troca ainda.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {itens.map((item, indice) => (
            <div
              key={`${item.id}-${indice}`}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{item.nome}</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px', wordBreak: 'break-word' }}>
                  {item.quantidade} {item.unidadeMedidaSigla} · {rotuloDoMotivoTroca(item.motivo)}{item.motivoDescricao ? ` (${item.motivoDescricao})` : ''}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Remover ${item.nome}`}
                onClick={() => onItensChange(itens.filter((_, i) => i !== indice))}
                style={{ width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0, border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VendedorItemPickerTroca;
