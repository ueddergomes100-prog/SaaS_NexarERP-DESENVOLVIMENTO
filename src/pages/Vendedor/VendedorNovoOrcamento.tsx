import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { usePromocoesVigentes } from '../../hooks/usePromocoesVigentes';
import { showError, showSuccess } from '../../utils/alerts';
import type { SearchableClient } from '../../utils/clientSearch';
import VendedorHeader from './VendedorHeader';
import VendedorSeletorCliente from './VendedorSeletorCliente';
import type { ClienteConfirmavel } from './VendedorConfirmarClienteModal';
import { clienteComCodigo } from '../../utils/pedidoVendedorDomain';
import VendedorItemPicker, { type ProdutoVendedorExterno } from './VendedorItemPicker';
import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';
import type { VendedorNovoPedidoNavState } from './vendedorNavState';
import { podeCadastrarClienteNoApp } from './vendedorPermissoes';
import { buscarRascunho, novoLocalId, RascunhoStorageError, salvarRascunho } from './vendedorRascunhosStore';
import VendedorRodapeRascunho, { camposDePronto, mensagemDeRascunhoSalvo } from './VendedorRodapeRascunho';

interface ClienteVendedor extends SearchableClient, ClienteConfirmavel {
  id: string;
  nome: string;
  telefone?: string;
}

/** Mesmo fluxo de VendedorNovoPedido: salva rascunho no aparelho, envia so'
 *  em "Enviar dados". */
const VendedorNovoOrcamento: React.FC = () => {
  const navigate = useNavigate();
  const { localId } = useParams();
  const location = useLocation();
  const estadoNavegacao = (location.state as VendedorNovoPedidoNavState | null) || null;
  const { tenantId, currentUser, userPermissions } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);
  // Promocoes de hoje (19/10/2026): orcamento mostra o preco da promocao, sem consumir quota (como no desktop).
  const promocoesVigentes = usePromocoesVigentes(tenantId);

  const [rascunhoAberto] = useState(() => (
    localId && tenantId && currentUser ? buscarRascunho(tenantId, currentUser.uid, localId) : null
  ));

  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteVendedor | null>(
    () => {
      if (rascunhoAberto) return { ...rascunhoAberto.cliente };
      // Volta do cadastro de cliente ja' com o cliente novo escolhido.
      return estadoNavegacao?.clientePreSelecionado
        ? { id: estadoNavegacao.clientePreSelecionado.id, nome: estadoNavegacao.clientePreSelecionado.nome }
        : null;
    },
  );
  const [itens, setItens] = useState<ItemVendaExterna[]>(() => rascunhoAberto?.itens || []);

  const produtosAtivos = produtos.filter((p) => p.ativo !== false);

  if (localId && !rascunhoAberto) {
    return <Navigate to="/vendedor/rascunhos" replace />;
  }

  const handleSalvar = (pronto: boolean) => {
    if (!clienteSelecionado) {
      showError('Atenção', 'Selecione o cliente.');
      return;
    }
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item.');
      return;
    }
    if (!tenantId || !currentUser) return;

    const agora = new Date().toISOString();
    try {
      salvarRascunho(tenantId, currentUser.uid, {
        localId: rascunhoAberto?.localId || novoLocalId(),
        tipo: 'orcamento',
        cliente: {
          id: clienteSelecionado.id,
          nome: clienteSelecionado.nome,
          ...(clienteSelecionado.telefone ? { telefone: clienteSelecionado.telefone } : {}),
        },
        itens,
        criadoEm: rascunhoAberto?.criadoEm || agora,
        atualizadoEm: agora,
        ...camposDePronto(pronto, agora),
      });
      showSuccess(mensagemDeRascunhoSalvo(pronto, 'orçamento'));
      navigate('/vendedor/rascunhos', { replace: true });
    } catch (error) {
      showError('Não foi possível salvar', error instanceof RascunhoStorageError ? error.message : 'Tente novamente.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={localId ? 'Editar Rascunho' : 'Novo Orçamento'} />

      <div style={{ padding: '16px 20px 0' }}>
        {clienteSelecionado ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: 'var(--app-raio-linha)',
              backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{clienteComCodigo(clienteSelecionado)}</div>
            </div>
            <button
              type="button"
              onClick={() => setClienteSelecionado(null)}
              style={{ fontSize: '13.5px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Trocar
            </button>
          </div>
        ) : (
          <VendedorSeletorCliente clientes={clientes} onConfirmar={setClienteSelecionado} />
        )}
        {!clienteSelecionado && podeCadastrarClienteNoApp(userPermissions) && (
          <button
            type="button"
            onClick={() => navigate('/vendedor/cliente/novo', { state: { retornarPara: 'orcamento' } })}
            style={{ marginTop: '10px', fontSize: '14px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          >
            + Cadastrar novo cliente
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <VendedorItemPicker produtos={produtosAtivos} itens={itens} onItensChange={setItens} permitirVendaSemEstoque precos={promocoesVigentes} />
      </div>

      <VendedorRodapeRascunho aoSalvar={handleSalvar} />
    </div>
  );
};

export default VendedorNovoOrcamento;
