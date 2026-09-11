import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { resolveUnidadeMedidaProduto } from '../../utils/unidadeMedidaDomain';
import type { ProdutoVendedorExterno } from './VendedorItemPicker';
import VendedorHeader from './VendedorHeader';

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VendedorConsultarPreco: React.FC = () => {
  const { tenantId } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const produtosAtivos = produtos.filter((p) => p.ativo !== false);

  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<ProdutoVendedorExterno | null>(null);

  const unidade = selecionado ? resolveUnidadeMedidaProduto(selecionado) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Consultar Preço" />

      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '14px', top: '16px', color: 'var(--text-muted)', pointerEvents: 'none', zIndex: 1 }} />
          <ProductAutocomplete
            value={busca}
            onChange={setBusca}
            products={produtosAtivos}
            onSelect={(produto) => setSelecionado(produto)}
            renderItem={renderProdutoOpcaoBusca}
            variant="inline"
            placeholder="Buscar produto por nome ou código"
            ariaLabel="Buscar produto"
          />
        </div>
      </div>

      <div style={{ flex: 1, padding: '16px 20px 24px' }}>
        {!selecionado ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Busque um produto pra ver o preço.
          </div>
        ) : (
          <div style={{ borderRadius: '18px', padding: '24px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{selecionado.nome}</div>
            {selecionado.codigo && (
              <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Código {selecionado.codigo}</div>
            )}
            <div style={{ fontSize: '30px', fontWeight: 800, color: 'var(--brand-400)', marginTop: '6px' }}>
              {formatarMoeda(selecionado.precoVenda || 0)}
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-muted)' }}> / {unidade?.unidadeMedidaSigla}</span>
            </div>
            <div style={{ fontSize: '13px', color: (selecionado.quantidade || 0) > 0 ? 'var(--text-secondary)' : '#ef4444', marginTop: '4px' }}>
              {(selecionado.quantidade || 0) > 0
                ? `${selecionado.quantidade} ${unidade?.unidadeMedidaSigla} em estoque`
                : 'Sem estoque'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VendedorConsultarPreco;
