import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Repeat, Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import type { SearchableClient } from '../../utils/clientSearch';
import { hasTenantFullAccess } from '../../utils/roles';
import { OBSERVACAO_PEDIDO_MAX, clienteComCodigo, normalizarObservacaoPedido } from '../../utils/pedidoVendedorDomain';
import { PERMISSAO_TROCA_SOLICITAR, errosDoRascunhoDeTroca, type ItemTrocaRascunho } from '../../utils/trocaDomain';
import { trocaService } from '../../services/trocaService';
import VendedorHeader from './VendedorHeader';
import VendedorSeletorCliente from './VendedorSeletorCliente';
import type { ClienteConfirmavel } from './VendedorConfirmarClienteModal';
import VendedorItemPickerTroca from './VendedorItemPickerTroca';
import type { ProdutoVendedorExterno } from './VendedorItemPicker';
import type { VendedorNovoPedidoNavState } from './vendedorNavState';
import { podeCadastrarClienteNoApp } from './vendedorPermissoes';
import { buscarRascunho, novoLocalId, RascunhoStorageError, salvarRascunho } from './vendedorRascunhosStore';

interface ClienteVendedor extends SearchableClient, ClienteConfirmavel {
  id: string;
  nome: string;
  telefone?: string;
}

/**
 * TROCA no app do vendedor: reposicao SEM COBRANCA de produto estragado
 * (rasgado, com bicho...). Mesmo fluxo do pedido: salva RASCUNHO no aparelho e
 * so' vai pra loja em "Enviar dados"; la' a loja aprova ou recusa. O produto
 * estragado NAO volta ao estoque -- a loja so' da' baixa na reposicao.
 * Plano: docs/PLANO_TROCAS_VENDEDOR.md.
 */
const VendedorNovaTroca: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { localId } = useParams();
  const estadoNavegacao = (location.state as VendedorNovoPedidoNavState | null) || null;
  const { tenantId, currentUser, userPermissions, userRole, isOwner } = useAuth();
  const podeSolicitar = hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_TROCA_SOLICITAR);
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean; statusAtivo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);

  const [rascunhoAberto] = useState(() => (
    localId && tenantId && currentUser ? buscarRascunho(tenantId, currentUser.uid, localId) : null
  ));
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteVendedor | null>(() => {
    if (rascunhoAberto) return { ...rascunhoAberto.cliente };
    return estadoNavegacao?.clientePreSelecionado
      ? { id: estadoNavegacao.clientePreSelecionado.id, nome: estadoNavegacao.clientePreSelecionado.nome }
      : null;
  });
  const [itens, setItens] = useState<ItemTrocaRascunho[]>(() => rascunhoAberto?.itensTroca || []);
  const [observacao, setObservacao] = useState(() => rascunhoAberto?.observacao || '');
  const [salvando, setSalvando] = useState(false);

  const produtosAtivos = produtos.filter((p) => p.ativo !== false && p.statusAtivo !== false);

  if (!podeSolicitar) return <Navigate to="/vendedor" replace />;
  if (localId && !rascunhoAberto) return <Navigate to="/vendedor/rascunhos" replace />;

  const handleSalvar = async () => {
    if (!tenantId || !currentUser || salvando) return;
    const erros = errosDoRascunhoDeTroca({ clienteId: clienteSelecionado?.id, itens });
    if (erros.length > 0) {
      showError('Confira a troca', erros.join('\n'));
      return;
    }
    if (!clienteSelecionado) return;

    setSalvando(true);
    try {
      // Aviso anti-abuso (so' avisa): cliente que nao comprou o produto nos ultimos 60 dias.
      // Sem internet a conferencia pula -- o servidor confere de novo ao enviar e a loja ve o aviso.
      try {
        const previa = await trocaService.previa({
          clienteId: clienteSelecionado.id,
          itens: itens.map((i) => ({ id: i.id, quantidade: i.quantidade, motivo: i.motivo, ...(i.motivoDescricao ? { motivoDescricao: i.motivoDescricao } : {}) })),
        });
        if (!previa.ok) {
          showError('Confira a troca', previa.erros.join('\n'));
          return;
        }
        if (previa.avisos.length > 0) {
          const escolha = await NexusSwal.fire({
            icon: 'warning',
            title: 'Confira antes de salvar',
            html: `<div style="text-align:left;font-size:14px">${previa.avisos.map((a) => a.mensagem.replace(/[<>&]/g, '')).join('<br/><br/>')}<br/><br/>A loja também vai ver este aviso.</div>`,
            showCancelButton: true,
            confirmButtonText: 'Salvar mesmo assim',
            cancelButtonText: 'Voltar e revisar',
          });
          if (!escolha.isConfirmed) return;
        }
      } catch {
        // Sem conexao: segue e salva o rascunho no aparelho.
      }

      const agora = new Date().toISOString();
      salvarRascunho(tenantId, currentUser.uid, {
        localId: rascunhoAberto?.localId || novoLocalId(),
        tipo: 'troca',
        cliente: {
          id: clienteSelecionado.id,
          nome: clienteSelecionado.nome,
          ...(clienteSelecionado.telefone ? { telefone: clienteSelecionado.telefone } : {}),
        },
        itens: [],
        itensTroca: itens,
        ...(normalizarObservacaoPedido(observacao) ? { observacao: normalizarObservacaoPedido(observacao) } : {}),
        criadoEm: rascunhoAberto?.criadoEm || agora,
        atualizadoEm: agora,
      });
      showSuccess('Rascunho salvo! Toque em "Enviar dados" para a loja receber o pedido de troca.');
      navigate('/vendedor/rascunhos', { replace: true });
    } catch (error) {
      showError('Não foi possível salvar', error instanceof RascunhoStorageError ? error.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={localId ? 'Editar Troca' : 'Nova Troca'} />

      <div style={{ padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          style={{
            display: 'flex', gap: '10px', padding: '12px 14px', borderRadius: '14px', border: '1px solid rgba(245,158,11,0.45)',
            backgroundColor: 'rgba(245,158,11,0.10)', fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.45,
          }}
        >
          <Repeat size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '1px' }} />
          <span><strong style={{ color: 'var(--text-primary)' }}>Troca não cobra do cliente.</strong> A loja entrega outro igual e dá baixa só na reposição; o produto estragado não volta ao estoque.</span>
        </div>

        {clienteSelecionado ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
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
            onClick={() => navigate('/vendedor/cliente/novo', { state: { retornarPara: 'troca' } })}
            style={{ fontSize: '14px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0, textAlign: 'left' }}
          >
            + Cadastrar novo cliente
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <VendedorItemPickerTroca produtos={produtosAtivos} itens={itens} onItensChange={setItens} />

        <div style={{ marginTop: '22px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label htmlFor="troca-observacao" style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Observação
          </label>
          <textarea
            id="troca-observacao"
            value={observacao}
            onChange={(evento) => setObservacao(evento.target.value)}
            maxLength={OBSERVACAO_PEDIDO_MAX}
            rows={3}
            placeholder="Ex.: 2 sacos chegaram rasgados, cliente quer a reposição na próxima entrega"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '16px',
              backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'none',
            }}
          />
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textAlign: 'right' }}>{observacao.length}/{OBSERVACAO_PEDIDO_MAX}</div>
        </div>
      </div>

      <div style={{ padding: '16px 20px calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button
          type="button"
          onClick={() => void handleSalvar()}
          disabled={salvando}
          style={{
            width: '100%', height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px', fontSize: '16px', fontWeight: 700, color: '#fff', cursor: salvando ? 'default' : 'pointer',
            opacity: salvando ? 0.7 : 1, background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
          }}
        >
          <Save size={18} />
          {salvando ? 'Conferindo...' : 'Salvar rascunho'}
        </button>
      </div>
    </div>
  );
};

export default VendedorNovaTroca;
