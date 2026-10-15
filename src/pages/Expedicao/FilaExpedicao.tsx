import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Printer, Truck, ClipboardCheck, Lock } from 'lucide-react';
import { collection, query, onSnapshot, where, Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { assinarComReserva } from '../../services/consultaComReserva';
import { dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { StatusConferencia } from '../../utils/conferenciaDomain';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { useTravasAtivas } from '../../hooks/useTravaDeEdicao';
import { descreverTrava, mensagemDeBloqueio, type TravaDeEdicao } from '../../utils/travaEdicaoDomain';
import { NexusSwal } from '../../utils/alerts';

interface PedidoExpedicaoData {
  id: string;
  numeroPedido: string;
  clienteNome?: string;
  createdAt?: { seconds?: number };
  statusConferencia: StatusConferencia;
  /** Status do pedido em si (Pré-venda, Finalizada, Cancelada...). */
  status?: string;
  tenantId: string;
  vendedorId?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
  /** 'troca' = reposicao sem cobranca (colecao `trocas`); ausente = pedido/pre-venda. */
  tipo?: 'troca';
}

// Mesmos rotulos/cores de PedidoVendas.tsx (coluna "Conferência") -- mantidos
// em arquivos separados de proposito, cada tela e' independente (mesmo
// espirito de STATUS_LABELS/STATUS_COLORS duplicados entre
// OrdensProducaoList.tsx e OrdemProducaoForm.tsx).
const STATUS_LABELS: Record<StatusConferencia, string> = {
  aguardando: 'Aguardando Conferência',
  em_conferencia: 'Em Conferência',
  conferido: 'Conferido',
  divergente: 'Divergente',
};

const STATUS_COLORS: Record<StatusConferencia, string> = {
  aguardando: '#f59e0b',
  em_conferencia: '#3b82f6',
  conferido: '#10b981',
  divergente: '#ef4444',
};

const STATUS_FILTER_ORDER: StatusConferencia[] = ['aguardando', 'em_conferencia', 'divergente', 'conferido'];

/** Ainda tem o que fazer: aparece sempre, de qualquer data. */
const STATUS_CONFERENCIA_PENDENTE: StatusConferencia[] = ['aguardando', 'em_conferencia', 'divergente'];

/**
 * Escuta, de uma colecao, o que esta na fila (otimizacao de leituras,
 * 2026-10-14 -- antes: TODOS os pedidos e TODAS as trocas da empresa,
 * filtrados aqui): os pendentes de conferencia, de qualquer data, e os
 * CONFERIDOS desde `inicio` pela data da conferencia (null = todos).
 */
const escutarFila = (
  colecao: 'pedidos_venda' | 'trocas',
  tenantId: string,
  inicio: Date | null,
  aoReceber: (docs: QueryDocumentSnapshot<DocumentData>[]) => void,
  aoFalhar: (erro: unknown) => void,
) => {
  const daEmpresa = query(collection(db, colecao), where('tenantId', '==', tenantId));
  const conferidos = query(daEmpresa, where('statusConferencia', '==', 'conferido'));
  let pendentes: QueryDocumentSnapshot<DocumentData>[] = [];
  let feitos: QueryDocumentSnapshot<DocumentData>[] = [];
  const publicar = () => {
    const porId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
    [...feitos, ...pendentes].forEach((d) => porId.set(d.id, d));
    aoReceber(Array.from(porId.values()));
  };
  const pararPendentes = onSnapshot(query(daEmpresa, where('statusConferencia', 'in', STATUS_CONFERENCIA_PENDENTE)), (snap) => {
    pendentes = snap.docs;
    publicar();
  }, aoFalhar);
  const pararConferidos = inicio
    ? assinarComReserva(
      query(conferidos, where('conferidoEm', '>=', Timestamp.fromDate(inicio))),
      conferidos,
      `Fila de expedição (${colecao} conferidos)`,
      (snap) => {
        // Mesmo corte da consulta enxuta, para a reserva (sem indice) mostrar o mesmo.
        feitos = snap.docs.filter((d) => {
          const em = d.data().conferidoEm;
          return Boolean(em?.toDate && em.toDate() >= inicio);
        });
        publicar();
      },
      aoFalhar,
    )
    : onSnapshot(conferidos, (snap) => {
      feitos = snap.docs;
      publicar();
    }, aoFalhar);
  return () => {
    pararPendentes();
    pararConferidos();
  };
};

const FilaExpedicao: React.FC = () => {
  const { linha } = useLinhaSelecionavel();
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  // Trava de edicao (15/10/2026): conferencia aberta por outra pessoa fica cinza e nao abre.
  const travas = useTravasAtivas('conferencia');
  const avisarEmEdicao = (trava: TravaDeEdicao) => {
    void NexusSwal.fire({ title: 'Em edição por outra pessoa', text: mensagemDeBloqueio('conferencia', trava), icon: 'info', confirmButtonText: 'Entendi' });
  };
  const [pedidos, setPedidos] = useState<PedidoExpedicaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusConferencia | 'todos'>('todos');

  // Trocas na MESMA fila (pedido do dono, 2026-09-24): as duas listas chegam por
  // ouvintes separados e sao juntadas aqui, ordenadas pela data.
  const [pedidosDaFila, setPedidosDaFila] = useState<PedidoExpedicaoData[]>([]);
  const [trocasDaFila, setTrocasDaFila] = useState<PedidoExpedicaoData[]>([]);
  // Conferidos: deste mes (pela data da conferencia), ou de todo o periodo
  // quando a pessoa pede. Pendentes aparecem sempre (ver escutarFila).
  const [conferidosDeTodoPeriodo, setConferidosDeTodoPeriodo] = useState(false);
  const inicioDoMes = `${getDateInputInTimeZone().slice(0, 7)}-01`;

  useEffect(() => {
    if (!currentUser || !tenantId) return undefined;
    const inicio = conferidosDeTodoPeriodo ? null : dateInputToUtcStart(inicioDoMes);
    return escutarFila('trocas', tenantId, inicio, (docs) => {
      const lista: PedidoExpedicaoData[] = [];
      docs.forEach((docSnap) => {
        const dados = docSnap.data();
        // So troca que ja nasceu na fila (empresa com conferencia ligada) e que ainda tem o que separar.
        if (!dados.statusConferencia || dados.status === 'Recusada' || dados.status === 'Cancelada') return;
        lista.push({
          id: docSnap.id,
          numeroPedido: String(dados.numeroTroca || ''),
          clienteNome: dados.clienteNome,
          createdAt: dados.createdAt,
          statusConferencia: dados.statusConferencia,
          status: dados.status,
          tenantId: dados.tenantId,
          vendedorId: dados.vendedorId,
          usuarioResponsavelId: dados.usuarioResponsavelId,
          criadoPor: dados.criadoPor,
          tipo: 'troca',
        });
      });
      setTrocasDaFila(lista);
    }, (error) => {
      console.error('Erro ao buscar trocas da fila de expedição:', error);
    });
  }, [currentUser, tenantId, conferidosDeTodoPeriodo, inicioDoMes]);

  useEffect(() => {
    const juntas = [...pedidosDaFila, ...filtrarVendasVisiveis(trocasDaFila, vendasVisiveisDeUsuarioId)];
    juntas.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    setPedidos(juntas);
  }, [pedidosDaFila, trocasDaFila, vendasVisiveisDeUsuarioId]);

  useEffect(() => {
    if (!currentUser || !tenantId) return undefined;

    // Pedido sem statusConferencia (empresa nunca ligou a chave, ou venda
    // anterior ao modulo) nao entra em nenhuma das duas consultas.
    const inicio = conferidosDeTodoPeriodo ? null : dateInputToUtcStart(inicioDoMes);
    return escutarFila('pedidos_venda', tenantId, inicio, (docs) => {
      const data: PedidoExpedicaoData[] = [];
      docs.forEach((docSnap) => {
        const item = { id: docSnap.id, ...docSnap.data() } as PedidoExpedicaoData;
        // Pedido ou pre-venda cancelado sai da fila -- nao ha mercadoria a
        // separar. Filtrado aqui (e nao so' ao cancelar) pra tambem limpar
        // os que ja foram cancelados antes.
        if (item.statusConferencia && item.status !== 'Cancelada') data.push(item);
      });
      // A fila tambem respeita a visibilidade de vendas. ATENCAO ao ligar
      // as duas configs juntas: se quem separa a mercadoria estiver como
      // nivel 'funcionario', a fila dele fica vazia -- o separador precisa
      // ser nivel 'administracao' pra enxergar os pedidos da equipe.
      setPedidosDaFila(filtrarVendasVisiveis(data, vendasVisiveisDeUsuarioId));
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar fila de expedição:', error);
      setLoading(false);
    });
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId, conferidosDeTodoPeriodo, inicioDoMes]);

  const filteredPedidos = pedidos.filter((p) => {
    if (statusFilter !== 'todos' && p.statusConferencia !== statusFilter) return false;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (p.numeroPedido && p.numeroPedido.toLowerCase().includes(term)) ||
      (p.clienteNome && p.clienteNome.toLowerCase().includes(term))
    );
  });

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Fila de Expedição</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Pedidos aguardando separação e conferência de mercadoria</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        <button
          onClick={() => setStatusFilter('todos')}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: statusFilter === 'todos' ? 'var(--accent-purple)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: '13px',
          }}
        >
          Todos
        </button>
        {STATUS_FILTER_ORDER.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === status ? STATUS_COLORS[status] : 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '13px',
            }}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      {(statusFilter === 'todos' || statusFilter === 'conferido') && (
        <p style={{ margin: '-16px 0 0', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {conferidosDeTodoPeriodo ? 'Conferidos de todo o período.' : 'Pendentes de qualquer data; conferidos, só os deste mês.'}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setConferidosDeTodoPeriodo((atual) => !atual)}
            style={{ padding: '4px 10px', fontSize: '12px' }}
          >
            {conferidosDeTodoPeriodo ? 'Ver só os conferidos deste mês' : 'Ver conferidos de todo o período'}
          </button>
        </p>
      )}

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número do pedido ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando fila de expedição...</td>
                </tr>
              ) : filteredPedidos.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Truck size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>
                      {searchTerm
                        ? `Nenhum resultado encontrado para "${searchTerm}".`
                        : statusFilter !== 'todos'
                          ? `Nenhum pedido com status "${STATUS_LABELS[statusFilter]}".`
                          : 'Nenhum pedido aguardando expedição.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPedidos.map((p) => {
                  const ehTroca = p.tipo === 'troca';
                  const caminhoConferencia = ehTroca ? `/operacoes/conferencia/troca/${p.id}` : `/operacoes/conferencia/${p.id}`;
                  const caminhoMinuta = ehTroca ? `/vendas/trocas/${p.id}/minuta` : `/operacoes/expedicao/minuta/${p.id}`;
                  const travaDaLinha = travas.get(p.id);
                  const abrirConferencia = () => (travaDaLinha ? avisarEmEdicao(travaDaLinha) : navigate(caminhoConferencia));
                  return (
                  <tr key={`${p.tipo || 'pedido'}-${p.id}`} {...linha(`${p.tipo || 'pedido'}-${p.id}`, abrirConferencia)} style={travaDaLinha ? { opacity: 0.55 } : undefined} title={travaDaLinha ? descreverTrava(travaDaLinha) : undefined}>
                    <td className="font-medium">
                      #{p.numeroPedido}
                      {ehTroca && <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, color: '#fff', backgroundColor: '#8b5cf6' }}>TROCA</span>}
                    </td>
                    <td>{p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                    <td>{p.clienteNome || 'Consumidor Final'}</td>
                    <td>
                      <span style={{ padding: '4px 10px', borderRadius: '14px', fontSize: '12px', fontWeight: 700, color: '#fff', backgroundColor: STATUS_COLORS[p.statusConferencia] }}>
                        {STATUS_LABELS[p.statusConferencia]}
                      </span>
                      {travaDaLinha && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                          <Lock size={13} /> {descreverTrava(travaDaLinha)}
                        </div>
                      )}
                    </td>
                    <td {...semAbrirLinha} style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <button
                        onClick={abrirConferencia}
                        className="icon-btn"
                        title={travaDaLinha ? descreverTrava(travaDaLinha) : p.statusConferencia === 'aguardando' ? 'Abrir Conferência' : 'Continuar/Reabrir Conferência'}
                        style={{ color: travaDaLinha ? 'var(--text-muted)' : '#3b82f6' }}
                      >
                        {travaDaLinha ? <Lock size={18} /> : <ClipboardCheck size={18} />}
                      </button>
                      <button
                        onClick={() => navigate(caminhoMinuta)}
                        className="icon-btn"
                        title="Reimprimir Minuta"
                        style={{ color: '#14b8a6' }}
                      >
                        <Printer size={18} />
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FilaExpedicao;
