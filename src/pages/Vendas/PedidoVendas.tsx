import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Plus, Search, FileText, Printer, XCircle, UserCheck } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { spedyService } from '../../services/spedyService';
import { isPlatformAdminRole } from '../../utils/roles';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { PEDIDO_PRINT_LOTE_SAFETY_LIMIT } from './pedidoPrintLoteConstants';
import {
  contaComoFaturamento,
  isPedidoAberto,
  STATUS_CANCELADA,
  STATUS_EM_ANALISE,
  STATUS_PRE_VENDA,
} from '../../utils/preVendaDomain';
import {
  listaGeralDeVendasEscondidaParaFuncionario,
  parseExigirIdentificacaoVendedor,
} from '../../utils/vendedorPinDomain';

interface ItemVenda {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
}

interface PedidoVendaData {
  id: string;
  numeroPedido: string;
  createdAt?: { seconds?: number; nanoseconds?: number };
  clienteNome?: string;
  formaPagamento?: string;
  status: string;
  valorTotal: number;
  itens?: ItemVenda[];
  tenantId: string;
  statusConferencia?: string;
  vendedorId?: string;
  vendedorNome?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
}

// Modulo 12 (Conferencia de mercadoria) -- rotulos/cores da coluna opcional.
// Fatia 1/4 so grava 'aguardando'; os demais estados existem desde ja pra
// nao precisar voltar neste arquivo nas fatias 3/4.
const CONFERENCIA_STATUS_LABELS: Record<string, string> = {
  aguardando: 'Aguardando Conferência',
  em_conferencia: 'Em Conferência',
  conferido: 'Conferido',
  divergente: 'Divergente',
};
const CONFERENCIA_STATUS_COLORS: Record<string, string> = {
  aguardando: '#f59e0b',
  em_conferencia: '#3b82f6',
  conferido: '#10b981',
  divergente: '#ef4444',
};

const PedidoVendas: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { currentUser, tenantId, userRole, userPermissions, isOwner, vendasVisiveisDeUsuarioId, nivelAcesso, trabalhaComPreVenda, agenteDigitalAtivo, controlaFiscal } = useAuth();

  // Mesma permissao cobre editar/finalizar E recusar um pedido pendente do
  // agente -- nao criar uma permissao a mais so pra recusar.
  const canEditPendenteVenda = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.pedidos_pendentes_editar'));

  const [pedidos, setPedidos] = useState<PedidoVendaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('Ativos');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Linha destacada por um clique simples (distinta de selectedIds, que sao
   * os checkboxes de impressao em lote). Abrir exige duplo clique ou Enter. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Previa dos itens do pedido, aberta pelo botao "Ver Itens" na barra de
   * acoes -- so aparece com exatamente 1 pedido marcado no checkbox. Fecha
   * sozinha se a selecao deixar de ser exatamente 1. */
  const [showItemPreview, setShowItemPreview] = useState(false);
  const [conferenciaMercadoriaAtiva, setConferenciaMercadoriaAtiva] = useState(false);
  const [exigirIdentificacaoVendedor, setExigirIdentificacaoVendedor] = useState(false);

  // Lista geral so e' escondida da TELA (nao do Firestore) do funcionario
  // comum quando a empresa liga "Exigir identificacao do vendedor" -- ver
  // vendedorPinDomain.ts. Quem tem acesso total continua vendo tudo.
  const listaEscondida = listaGeralDeVendasEscondidaParaFuncionario({
    exigirIdentificacaoVendedor,
    role: userRole,
    isOwner,
    nivelAcesso,
  });

  // Estado para armazenar IDs dos cupons autorizados
  const [authorizedCupons, setAuthorizedCupons] = useState<Record<string, { spedyId: string; status: string }>>({});

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    // Monitora notas fiscais do tipo NFC-e
    const qNotas = query(
      collection(db, 'notas_fiscais'),
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'NFC-e')
    );

    const unsubscribeNotas = onSnapshot(qNotas, (snapshot) => {
      const cupons: Record<string, { spedyId: string; status: string }> = {};
      snapshot.forEach(d => {
        const data = d.data();
        if (data.pedidoId) {
          cupons[data.pedidoId] = {
            spedyId: data.spedyId || '',
            status: data.status || ''
          };
        }
      });
      setAuthorizedCupons(cupons);
    });

    return () => unsubscribeNotas();
  }, [currentUser, tenantId]);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : {};
        setConferenciaMercadoriaAtiva(data.conferenciaMercadoria === true);
        setExigirIdentificacaoVendedor(parseExigirIdentificacaoVendedor(data.exigirIdentificacaoVendedor));
      })
      .catch((err) => console.error('Erro ao verificar configuração de conferência de mercadoria:', err));
  }, [currentUser, tenantId]);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    const q = query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const p: PedidoVendaData[] = [];
      snapshot.forEach(doc => p.push({ id: doc.id, ...doc.data() } as PedidoVendaData));
      p.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      // Filtra no cliente, e nao com um where(vendedorId) na query, porque
      // venda antiga pode ter so usuarioResponsavelId/criadoPor -- um where
      // num campo so sumiria com pedido que e' do proprio usuario.
      setPedidos(filtrarVendasVisiveis(p, vendasVisiveisDeUsuarioId));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  // Pedido "Em Analise" so e gravado por integracao externa (agente de
  // WhatsApp) -- nenhuma tela deste sistema grava esse status (ver
  // handleFinalizarVenda em PedidoVendaForm.tsx, sempre grava 'Finalizada').
  // Fatia 3/4 do recurso de pedidos pendentes vai deixar editar/finalizar.
  const handleRecusar = async (pedido: PedidoVendaData) => {
    if (!currentUser || !tenantId) return;

    const result = await NexusSwal.fire({
      title: 'Recusar Pedido Pendente?',
      html: `O pedido <strong>#${pedido.numeroPedido}</strong> (${pedido.clienteNome || 'sem cliente'}) veio de uma integração externa e ainda não gerou baixa de estoque nem lançamento financeiro — recusar só marca como cancelado, não reverte nada.<br/><br/>Digite o motivo (mínimo 8 caracteres):`,
      input: 'text',
      inputAttributes: { minlength: '8', required: 'true', placeholder: 'Motivo da recusa...' },
      showCancelButton: true,
      confirmButtonText: 'Confirmar Recusa',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || motivo.trim().length < 8) {
          NexusSwal.showValidationMessage('O motivo deve ter pelo menos 8 caracteres.');
          return false;
        }
        return motivo;
      },
    });

    if (!result.isConfirmed) return;
    const motivo = (result.value as string).trim();

    try {
      await updateDoc(doc(db, 'pedidos_venda', pedido.id), {
        status: 'Cancelada',
        motivoRecusa: motivo,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Pedido pendente recusado: ${motivo}`),
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || '',
          modulo: 'vendas',
          acao: 'recusa_pedido_pendente',
          descricao: `Pedido pendente #${pedido.numeroPedido} recusado. Motivo: ${motivo}`,
          registroRelacionadoId: pedido.id,
          status: 'sucesso',
        });
      } catch {
        // ignore audit log error
      }

      showSuccess('Pedido recusado.');
    } catch {
      showError('Erro', 'Não foi possível recusar o pedido.');
    }
  };

  const filteredPedidos = pedidos.filter(p => {
    // "Ativos / Faturados" = so o que virou venda de verdade. Pedido em
    // aberto (pre-venda do balcao ou pendente do agente) tem aba propria --
    // misturar os dois faria a aba principal mostrar como venda algo que
    // ainda nao faturou.
    const matchStatus = activeTab === 'Ativos'
      ? contaComoFaturamento(p.status)
      : activeTab === 'PreVendas'
        ? p.status === STATUS_PRE_VENDA
        : activeTab === 'Pendentes'
          ? p.status === STATUS_EM_ANALISE
          : p.status === STATUS_CANCELADA;
    if (!matchStatus) return false;
    if (!searchTerm) return true;
    return p.clienteNome?.toLowerCase().includes(searchTerm.toLowerCase()) || p.numeroPedido?.includes(searchTerm);
  });

  const allVisibleSelected = filteredPedidos.length > 0 && filteredPedidos.every(p => selectedIds.has(p.id));

  const toggleSelectOne = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= PEDIDO_PRINT_LOTE_SAFETY_LIMIT) {
        showError('Limite de seleção atingido', `Selecione no máximo ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} pedidos por vez para impressão em lote.`);
        return current;
      }
      next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(current => {
        const next = new Set(current);
        filteredPedidos.forEach(p => next.delete(p.id));
        return next;
      });
      return;
    }

    const idsToSelect = filteredPedidos.map(p => p.id).slice(0, PEDIDO_PRINT_LOTE_SAFETY_LIMIT);
    if (filteredPedidos.length > PEDIDO_PRINT_LOTE_SAFETY_LIMIT) {
      showError('Limite de seleção atingido', `Apenas os primeiros ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} pedidos foram selecionados. Imprima este lote e selecione o restante em seguida.`);
    }
    setSelectedIds(new Set(idsToSelect));
  };

  const handlePrintSelected = () => {
    if (selectedIds.size === 0) return;
    navigate(`/pedidos-venda/print-lote?ids=${Array.from(selectedIds).join(',')}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingCart size={28} color="var(--accent-purple)" />
            Pedidos de Venda
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Gerenciamento de vendas diretas e PDV</p>
        </div>
        <button className="btn-primary" onClick={() => openTab('/pedidos-venda/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={20} /> Nova Venda (PDV)
        </button>
      </div>

      {listaEscondida ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <UserCheck size={48} color="var(--accent-purple)" />
          <h2 style={{ fontSize: '18px', margin: 0 }}>Lista geral de pedidos desativada</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px', margin: 0 }}>
            Sua empresa ativou "Exigir identificação do vendedor a cada venda". Por isso, esta lista fica disponível só para dono, Master ou Admin. Para consultar e reimprimir suas próprias vendas, use a tela <strong>Minhas Vendas</strong>.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => openTab('/minhas-vendas', 'Minhas Vendas')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <UserCheck size={18} /> Ir para Minhas Vendas
          </button>
        </div>
      ) : (
      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div className="search-bar" style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por cliente ou número do pedido..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', backgroundColor: 'var(--bg-tertiary)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
            <button
              onClick={() => setActiveTab('Ativos')}
              style={{ padding: '8px 16px', backgroundColor: activeTab === 'Ativos' ? 'var(--accent-purple)' : 'transparent', color: activeTab === 'Ativos' ? 'white' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}
            >
              Ativos / Faturados
            </button>
            {trabalhaComPreVenda && (
              <button
                onClick={() => setActiveTab('PreVendas')}
                style={{ padding: '8px 16px', backgroundColor: activeTab === 'PreVendas' ? 'rgba(245, 158, 11, 0.2)' : 'transparent', color: activeTab === 'PreVendas' ? '#f59e0b' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}
              >
                Pré-vendas
              </button>
            )}
            {agenteDigitalAtivo && (
              <button
                onClick={() => setActiveTab('Pendentes')}
                style={{ padding: '8px 16px', backgroundColor: activeTab === 'Pendentes' ? 'rgba(245, 158, 11, 0.2)' : 'transparent', color: activeTab === 'Pendentes' ? '#f59e0b' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}
              >
                Pendentes
              </button>
            )}
            <button
              onClick={() => setActiveTab('Cancelados')}
              style={{ padding: '8px 16px', backgroundColor: activeTab === 'Cancelados' ? 'rgba(239, 68, 68, 0.2)' : 'transparent', color: activeTab === 'Cancelados' ? '#ef4444' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}
            >
              Cancelados
            </button>
          </div>
          {selectedIds.size === 1 && (
            <button
              onClick={() => setShowItemPreview((atual) => !atual)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
            >
              <FileText size={18} />
              {showItemPreview ? 'Ocultar Itens' : 'Ver Itens'}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={handlePrintSelected}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
            >
              <Printer size={18} />
              Imprimir Selecionados ({selectedIds.size})
            </button>
          )}
        </div>

        {showItemPreview && selectedIds.size === 1 && (() => {
          const pedidoPreview = filteredPedidos.find((p) => selectedIds.has(p.id));
          if (!pedidoPreview) return null;
          return (
            <div style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '24px' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
                Itens do pedido #{pedidoPreview.numeroPedido}
              </p>
              {(pedidoPreview.itens || []).length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nenhum item encontrado neste pedido.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {(pedidoPreview.itens || []).map((item, index) => (
                    <div key={`${item.id}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '4px 0', borderBottom: index < (pedidoPreview.itens || []).length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                      <span>{item.nome}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{item.quantidade}x</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px', width: '1%' }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    disabled={filteredPedidos.length === 0}
                    title="Selecionar todos"
                    aria-label="Selecionar todos os pedidos visíveis"
                  />
                </th>
                <th style={{ padding: '16px' }}>Nº Pedido</th>
                <th style={{ padding: '16px' }}>Data</th>
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px' }}>Vendedor</th>
                <th style={{ padding: '16px' }}>Forma Pgto</th>
                <th style={{ padding: '16px' }}>Status</th>
                {conferenciaMercadoriaAtiva && <th style={{ padding: '16px' }}>Conferência</th>}
                <th style={{ padding: '16px', textAlign: 'right' }}>Total (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={conferenciaMercadoriaAtiva ? 10 : 9} style={{ textAlign: 'center', padding: '40px' }}>Carregando pedidos...</td>
                </tr>
              ) : filteredPedidos.length === 0 ? (
                <tr>
                  <td colSpan={conferenciaMercadoriaAtiva ? 10 : 9} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <ShoppingCart size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhum pedido de venda encontrado.</p>
                  </td>
                </tr>
              ) : (
                filteredPedidos.map(p => (
                  // 1 clique seleciona, 2 cliques abrem o pedido -- mesmo padrao
                  // de Estoque/Clientes/OS/Orcamentos. Esta tela abria com 1
                  // clique so; passou a exigir 2 pra ficar consistente com as
                  // outras e nao abrir aba a cada clique de leitura (o limite de
                  // abas e 8). As celulas de checkbox e de acoes param a
                  // propagacao pra continuarem com o comportamento delas.
                  <tr
                    key={p.id}
                    className={selectedId === p.id ? 'row-selectable is-selected' : 'row-selectable'}
                    onClick={() => setSelectedId(p.id)}
                    onDoubleClick={() => openTab(`/pedidos-venda/visualizar/${p.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') openTab(`/pedidos-venda/visualizar/${p.id}`);
                    }}
                    tabIndex={0}
                    title="Clique para selecionar, duplo clique para visualizar"
                    style={{ borderBottom: '1px solid var(--border-color)', opacity: p.status === 'Cancelada' ? 0.6 : 1 }}
                  >
                    <td style={{ padding: '16px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelectOne(p.id)}
                        aria-label={`Selecionar pedido ${p.numeroPedido}`}
                      />
                    </td>
                    <td style={{ padding: '16px', fontWeight: 600 }}>#{p.numeroPedido}</td>
                    <td style={{ padding: '16px' }}>{p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                    <td style={{ padding: '16px' }}>{p.clienteNome}</td>
                    <td style={{ padding: '16px' }}>{p.vendedorNome || '-'}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ backgroundColor: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>
                        {p.formaPagamento}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        // Amarelo = em aberto (pre-venda ou pendente do
                        // agente), verde = faturado, vermelho = cancelado.
                        backgroundColor: p.status === 'Cancelada' ? 'rgba(239,68,68,0.2)' : isPedidoAberto(p.status) ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)',
                        color: p.status === 'Cancelada' ? '#ef4444' : isPedidoAberto(p.status) ? '#f59e0b' : '#10b981',
                        padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600
                      }}>
                        {p.status}
                      </span>
                    </td>
                    {conferenciaMercadoriaAtiva && (
                      <td style={{ padding: '16px' }}>
                        {p.statusConferencia ? (
                          <span style={{
                            backgroundColor: `${CONFERENCIA_STATUS_COLORS[p.statusConferencia] || '#6b7280'}20`,
                            color: CONFERENCIA_STATUS_COLORS[p.statusConferencia] || '#6b7280',
                            padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600
                          }}>
                            {CONFERENCIA_STATUS_LABELS[p.statusConferencia] || p.statusConferencia}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                        )}
                      </td>
                    )}
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valorTotal)}
                    </td>
                    <td style={{ padding: '16px', display: 'flex', justifyContent: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openTab(`/pedidos-venda/visualizar/${p.id}`)} className="icon-btn" title="Visualizar Pedido" style={{ color: '#3b82f6' }}>
                        <FileText size={18} />
                      </button>
                      {controlaFiscal && authorizedCupons[p.id] && authorizedCupons[p.id].status === 'authorized' ? (
                        <button
                          onClick={() => {
                            const cupom = authorizedCupons[p.id];
                            spedyService.openFiscalFile(cupom.spedyId, 'consumer', 'pdf')
                              .catch(err => showError('Erro ao abrir cupom fiscal', (err as Error).message));
                          }}
                          className="icon-btn"
                          title="Imprimir Cupom Fiscal (NFC-e)"
                          style={{ color: '#8b5cf6' }}
                        >
                          <Printer size={18} />
                        </button>
                      ) : (
                        <button onClick={() => navigate(`/pedidos-venda/print/${p.id}`)} className="icon-btn" title="Imprimir Recibo" style={{ color: '#10b981' }}>
                          <Printer size={18} />
                        </button>
                      )}
                      {p.status === 'Em Análise' && canEditPendenteVenda && (
                        <button onClick={() => handleRecusar(p)} className="icon-btn" title="Recusar Pedido Pendente" style={{ color: '#ef4444' }}>
                          <XCircle size={18} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
};

export default PedidoVendas;
