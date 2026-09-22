import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, Printer } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { isPedidoAberto } from '../../utils/preVendaDomain';
import { cancelarPedidoExterno } from '../../services/vendedorExternoVendaService';
import VendedorHeader from './VendedorHeader';
import { rotuloNotaFiscalPedido } from '../../utils/pedidoVendedorDomain';

/**
 * Pedido ja enviado pra base: so' leitura. Editar acontece no rascunho,
 * antes de enviar (VendedorRascunhos.tsx) -- depois disso quem mexe e' a
 * loja, na Conferencia. Daqui da pra imprimir e, com permissao, cancelar
 * enquanto ainda for pre-venda.
 */

interface ItemPedido {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
  unidadeMedidaSigla?: string;
}

interface PedidoDetalhe {
  id: string;
  numeroPedido: string;
  status: string;
  statusConferencia?: string;
  clienteNome: string;
  observacao?: string;
  /** O que o vendedor marcou: COM (true) ou SEM (false) nota fiscal; ausente = nao informado. */
  comNotaFiscal?: boolean;
  dataVenda?: string;
  itens: ItemPedido[];
  valorTotalItens: number;
  valorTotalDescontos: number;
  frete: number;
  encargos: number;
  valorTotal: number;
  pagamentos: Array<{ formaPagamento: string; valor: number }>;
}

const ROTULO_CONFERENCIA: Record<string, string> = {
  aguardando: 'Aguardando conferência da loja',
  em_conferencia: 'Loja conferindo agora',
  conferido: 'Conferido pela loja',
  divergente: 'Conferência com divergência',
};

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const cardStyle: React.CSSProperties = {
  padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
};

const tituloSecao: React.CSSProperties = {
  fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px',
};

const linhaTotal = (rotulo: string, valor: string, destaque = false) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: destaque ? '16px' : '13px', fontWeight: destaque ? 800 : 500, color: destaque ? 'var(--text-primary)' : 'var(--text-secondary)', marginTop: destaque ? '6px' : '3px' }}>
    <span>{rotulo}</span>
    <span>{valor}</span>
  </div>
);

const VendedorPedidoDetalhe: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, currentUser, userPermissions } = useAuth();
  const [pedido, setPedido] = useState<PedidoDetalhe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!id || !tenantId || !currentUser) return;
    let cancelado = false;

    getDoc(doc(db, 'pedidos_venda', id)).then((snap) => {
      if (cancelado) return;
      const data = snap.exists() ? snap.data() : null;
      // O app mostra so' o que e' do proprio vendedor.
      if (!data || data.tenantId !== tenantId || data.vendedorId !== currentUser.uid) {
        setNaoEncontrado(true);
        setCarregando(false);
        return;
      }
      setPedido({
        id: snap.id,
        numeroPedido: data.numeroPedido || '',
        status: data.status || '',
        statusConferencia: data.statusConferencia,
        clienteNome: data.clienteNome || '',
        observacao: data.observacao || '',
        ...(typeof data.comNotaFiscal === 'boolean' ? { comNotaFiscal: data.comNotaFiscal } : {}),
        dataVenda: data.dataVenda,
        itens: Array.isArray(data.itens) ? data.itens : [],
        valorTotalItens: Number(data.valorTotalItens || 0),
        valorTotalDescontos: Number(data.valorTotalDescontos || 0),
        frete: Number(data.frete || 0),
        encargos: Number(data.encargos || 0),
        valorTotal: Number(data.valorTotal || 0),
        pagamentos: Array.isArray(data.pagamentos) ? data.pagamentos : [],
      });
      setCarregando(false);
    }).catch(() => {
      if (cancelado) return;
      showError('Não foi possível abrir o pedido', 'Verifique a internet e tente de novo.');
      setCarregando(false);
    });

    return () => { cancelado = true; };
  }, [id, tenantId, currentUser, recarga]);

  const podeCancelar = !!pedido
    && isPedidoAberto(pedido.status)
    && userPermissions.includes('vendas.pre_venda_cancelar');

  const handleCancelar = async () => {
    if (!pedido || !currentUser || cancelando) return;
    const confirmacao = await NexusSwal.fire({
      title: `Cancelar a pré-venda #${pedido.numeroPedido}?`,
      text: pedido.statusConferencia === 'em_conferencia'
        ? 'A loja está conferindo este pedido agora. Cancelando, o estoque reservado volta a ficar disponível e a conferência perde o sentido — avise a loja.'
        : 'O estoque reservado volta a ficar disponível para venda. O pedido fica registrado como cancelado.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, cancelar',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      reverseButtons: true,
    });
    if (!confirmacao.isConfirmed) return;

    setCancelando(true);
    try {
      await cancelarPedidoExterno({ usuarioId: currentUser.uid, pedidoId: pedido.id, vendedorId: currentUser.uid });
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'cancelamento',
          descricao: `Pré-venda #${pedido.numeroPedido} cancelada pelo aplicativo do vendedor externo. Estoque reservado liberado.`,
          registroRelacionadoId: pedido.id,
          vendedorId: currentUser.uid,
          status: 'sucesso',
        });
      } catch (err) {
        console.error('Erro ao registrar log de cancelamento da pré-venda:', err);
      }
      showSuccess('Pedido cancelado e estoque liberado.');
      setRecarga((n) => n + 1);
    } catch (error) {
      showError('Não foi possível cancelar', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setCancelando(false);
    }
  };

  const titulo = pedido ? `Pedido #${pedido.numeroPedido}` : 'Pedido';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader
        titulo={titulo}
        acao={pedido && (
          <button
            type="button"
            aria-label="Imprimir"
            onClick={() => navigate(`/vendedor/pedido/${pedido.id}/imprimir`)}
            style={{
              width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Printer size={18} />
          </button>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : naoEncontrado || !pedido ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
            Pedido não encontrado.
          </div>
        ) : (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{pedido.clienteNome || 'Sem cliente'}</div>
              <div style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {pedido.status}{pedido.dataVenda ? ` · ${pedido.dataVenda.split('-').reverse().join('/')}` : ''}
              </div>
              {rotuloNotaFiscalPedido(pedido.comNotaFiscal) && (
                <div style={{ marginTop: '8px' }}>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700,
                    backgroundColor: pedido.comNotaFiscal ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.18)',
                    color: pedido.comNotaFiscal ? '#10b981' : 'var(--text-muted)',
                  }}>
                    {rotuloNotaFiscalPedido(pedido.comNotaFiscal)?.texto}
                  </span>
                </div>
              )}
              {pedido.observacao && (
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.4, wordBreak: 'break-word' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Obs.:</strong> {pedido.observacao}
                </div>
              )}
              {pedido.statusConferencia && ROTULO_CONFERENCIA[pedido.statusConferencia] && (
                <div style={{ fontSize: '13.5px', color: 'var(--brand-400)', marginTop: '6px', fontWeight: 600 }}>
                  {ROTULO_CONFERENCIA[pedido.statusConferencia]}
                </div>
              )}
            </div>

            <div style={cardStyle}>
              <div style={tituloSecao}>Itens</div>
              {pedido.itens.length === 0 ? (
                <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Nenhum item.</div>
              ) : pedido.itens.map((item, index) => (
                <div key={`${item.id}-${index}`} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderTop: index === 0 ? 'none' : '1px solid var(--border-color)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.nome}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {item.quantidade} {item.unidadeMedidaSigla || 'UN'} × {formatarMoeda(Number(item.precoUnitario || 0))}
                    </div>
                  </div>
                  <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(Number(item.subtotal || 0))}</div>
                </div>
              ))}
            </div>

            <div style={cardStyle}>
              <div style={tituloSecao}>Totais</div>
              {linhaTotal('Itens', formatarMoeda(pedido.valorTotalItens))}
              {pedido.valorTotalDescontos > 0 && linhaTotal('Descontos', `- ${formatarMoeda(pedido.valorTotalDescontos)}`)}
              {pedido.frete > 0 && linhaTotal('Frete', formatarMoeda(pedido.frete))}
              {pedido.encargos > 0 && linhaTotal('Encargos', formatarMoeda(pedido.encargos))}
              {linhaTotal('Total', formatarMoeda(pedido.valorTotal), true)}
            </div>

            {pedido.pagamentos.length > 0 && (
              <div style={cardStyle}>
                <div style={tituloSecao}>Pagamento</div>
                {pedido.pagamentos.map((pagamento, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-secondary)', marginTop: index === 0 ? 0 : '4px' }}>
                    <span>{pagamento.formaPagamento}</span>
                    <span>{formatarMoeda(Number(pagamento.valor || 0))}</span>
                  </div>
                ))}
              </div>
            )}

            {podeCancelar && (
              <button
                type="button"
                onClick={() => void handleCancelar()}
                disabled={cancelando}
                style={{
                  marginTop: '4px', height: '48px', borderRadius: '14px', border: '1px solid rgba(239,68,68,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700,
                  color: '#f87171', cursor: cancelando ? 'default' : 'pointer', backgroundColor: 'rgba(239,68,68,0.10)',
                  opacity: cancelando ? 0.7 : 1,
                }}
              >
                <Ban size={18} />
                {cancelando ? 'Cancelando...' : 'Cancelar pedido'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default VendedorPedidoDetalhe;
