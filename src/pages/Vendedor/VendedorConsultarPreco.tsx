import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { resolveUnidadeMedidaProduto, temUnidadeMedidaCadastrada } from '../../utils/unidadeMedidaDomain';
import { buscarIdsProdutosMaisVendidos } from '../../services/vendedorRankingService';
import type { ProdutoVendedorExterno } from './VendedorItemPicker';
import type { VendedorNovoPedidoNavState } from './vendedorNavState';
import VendedorHeader from './VendedorHeader';

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VendedorConsultarPreco: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const produtosAtivos = useMemo(() => produtos.filter((p) => p.ativo !== false), [produtos]);

  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<ProdutoVendedorExterno | null>(null);
  const [idsMaisVendidos, setIdsMaisVendidos] = useState<string[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelado = false;
    buscarIdsProdutosMaisVendidos(tenantId).then((ids) => { if (!cancelado) setIdsMaisVendidos(ids); }).catch(() => {});
    return () => { cancelado = true; };
  }, [tenantId]);

  const maisVendidos = useMemo(() => {
    const porId = new Map(produtosAtivos.map((p) => [p.id, p]));
    return idsMaisVendidos.map((id) => porId.get(id)).filter((p): p is ProdutoVendedorExterno => !!p);
  }, [idsMaisVendidos, produtosAtivos]);

  const unidade = selecionado ? resolveUnidadeMedidaProduto(selecionado) : null;

  const irParaNovoPedido = (produto: ProdutoVendedorExterno) => {
    const un = resolveUnidadeMedidaProduto(produto);
    const state: VendedorNovoPedidoNavState = {
      itemPreAdicionado: {
        id: produto.id,
        nome: produto.nome,
        ...(produto.codigo ? { codigo: produto.codigo } : {}),
        precoUnitario: produto.precoVenda || 0,
        quantidade: 1,
        desconto: 0,
        subtotal: produto.precoVenda || 0,
        unidadeMedidaSigla: un.unidadeMedidaSigla,
        unidadeMedidaFracionado: un.unidadeMedidaFracionado,
        unidadeMedidaCasasDecimais: un.unidadeMedidaCasasDecimais,
      },
    };
    navigate('/vendedor/pedido/novo', { state });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Consultar Preço" />

      <div style={{ padding: '16px 20px 0' }}>
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
        {selecionado ? (
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
              {!temUnidadeMedidaCadastrada(selecionado) && ' · sem unidade cadastrada (entrou como UN)'}
            </div>

            <button
              type="button"
              onClick={() => irParaNovoPedido(selecionado)}
              style={{
                marginTop: '10px', height: '48px', borderRadius: '14px', border: 'none', display: 'flex',
                alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', fontWeight: 700,
                color: '#fff', cursor: 'pointer', background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
              }}
            >
              <Plus size={18} /> Adicionar a um novo pedido
            </button>

            <button
              type="button"
              onClick={() => { setSelecionado(null); setBusca(''); }}
              style={{ fontSize: '12.5px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, alignSelf: 'center', marginTop: '2px' }}
            >
              Buscar outro produto
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {maisVendidos.length > 0 && (
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
                Mais vendidos
              </div>
            )}
            {maisVendidos.map((produto) => (
              <div
                key={produto.id}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
              >
                <button
                  type="button"
                  onClick={() => setSelecionado(produto)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {produto.nome}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {formatarMoeda(produto.precoVenda || 0)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => irParaNovoPedido(produto)}
                  aria-label={`Adicionar ${produto.nome} a um novo pedido`}
                  style={{
                    width: '36px', height: '36px', borderRadius: '10px', border: 'none', flexShrink: 0,
                    background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  <Plus size={18} />
                </button>
              </div>
            ))}
            {maisVendidos.length === 0 && (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                Busque um produto pra ver o preço.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VendedorConsultarPreco;
