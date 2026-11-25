import React, { useEffect, useState } from 'react';
import { Search, ShoppingCart, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError } from '../../utils/alerts';
import { ehPedidoDoSistemaAnterior, mensagemPedidoDoSistemaAnterior } from '../../utils/importacaoPedidosAnterioresDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { dentroDoPeriodo } from '../../utils/filtroListaDomain';
import { CampoPeriodo } from '../../components/common/PainelFiltros';
import { useLinhasEmBlocos } from '../../hooks/useLinhasEmBlocos';
import MostrarMaisLinhas from '../../components/common/MostrarMaisLinhas';

export interface ItemVendaParaDevolucao {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  quantidadeJaDevolvida?: number;
  fatorConversao?: number;
  unidadeMedidaSigla?: string;
}

export interface PedidoParaDevolucao {
  id: string;
  numeroPedido: string;
  createdAt?: { seconds?: number };
  dataVenda?: string;
  clienteNome?: string;
  valorTotal: number;
  status: string;
  itens?: ItemVendaParaDevolucao[];
}

/** Velocidade (23/11/2026): a lista le os ultimos DIAS_PADRAO dias, ou desde o "De" quando ele e' mais antigo. */
const DIAS_PADRAO = 180;
const inicioPadrao = (): string => {
  const d = new Date(`${getDateInputInTimeZone()}T12:00:00`);
  d.setDate(d.getDate() - DIAS_PADRAO);
  return d.toISOString().slice(0, 10);
};

const podeDevolver = (p: PedidoParaDevolucao) => (p.itens || []).some((item) => (item.quantidade - (item.quantidadeJaDevolvida || 0)) > 0);

interface Props {
  onClose: () => void;
  onEscolher: (pedido: PedidoParaDevolucao) => void;
}

/**
 * "Fazer devolucao" (24/11/2026): digitar o numero do pedido ou escolher na
 * lista de pedidos finalizados (a lista que a tela de Devolucoes tinha antes).
 * Escolhido o pedido, a tela abre o DevolucaoVendaModal de sempre.
 */
const EscolherPedidoDevolucaoModal: React.FC<Props> = ({ onClose, onEscolher }) => {
  const { tenantId } = useAuth();
  const [numero, setNumero] = useState('');
  const [buscandoNumero, setBuscandoNumero] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoParaDevolucao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');

  const padrao = inicioPadrao();
  const inicioDaConsulta = /^\d{4}-\d{2}-\d{2}$/.test(periodoDe) && periodoDe < padrao ? periodoDe : padrao;

  useEffect(() => {
    if (!tenantId) return undefined;
    const q = query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId),
      where('status', '==', 'Finalizada'),
      where('dataVenda', '>=', inicioDaConsulta),
    );
    return onSnapshot(q, (snapshot) => {
      const lista: PedidoParaDevolucao[] = [];
      // Venda importada do sistema anterior nao se devolve aqui (o estoque e o financeiro dela ficaram la).
      snapshot.forEach((d) => { if (!ehPedidoDoSistemaAnterior(d.data())) lista.push({ id: d.id, ...d.data() } as PedidoParaDevolucao); });
      lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setPedidos(lista);
      setCarregando(false);
    }, (erro) => {
      console.error('Erro ao carregar pedidos para devolução:', erro);
      setCarregando(false);
    });
  }, [tenantId, inicioDaConsulta]);

  /** Relido na hora: a lista pode estar velha (outra devolucao no meio). */
  const escolher = async (id: string) => {
    try {
      const snap = await getDoc(doc(db, 'pedidos_venda', id));
      if (!snap.exists() || snap.data().tenantId !== tenantId) {
        showError('Pedido não encontrado', 'Ele não existe mais. Atualize a lista.');
        return;
      }
      const p = { id: snap.id, ...snap.data() } as PedidoParaDevolucao;
      if (ehPedidoDoSistemaAnterior(snap.data())) {
        showError('Pedido do sistema anterior', mensagemPedidoDoSistemaAnterior('devolvida'));
        return;
      }
      if (p.status !== 'Finalizada') {
        showError('Pedido não finalizado', `O pedido #${p.numeroPedido} está "${p.status}". Só venda finalizada recebe devolução.`);
        return;
      }
      if (!podeDevolver(p)) {
        showError('Nada a devolver', `Todos os itens do pedido #${p.numeroPedido} já foram devolvidos.`);
        return;
      }
      onEscolher(p);
    } catch (erro) {
      console.error('Erro ao abrir o pedido:', erro);
      showError('Não foi possível abrir o pedido', 'Verifique a conexão e tente de novo.');
    }
  };

  const buscarPeloNumero = async () => {
    const digitado = numero.trim().replace(/^#/, '');
    if (!digitado || !tenantId || buscandoNumero) return;
    setBuscandoNumero(true);
    try {
      // O numero e' gravado com zeros a esquerda ("0154"): tenta como digitado e com 4 digitos.
      const candidatos = [...new Set([digitado, /^\d+$/.test(digitado) ? digitado.padStart(4, '0') : digitado])];
      const snap = await getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('numeroPedido', 'in', candidatos)));
      const achado = snap.docs[0] || null;
      if (!achado) {
        showError('Pedido não encontrado', `Não há pedido de venda com o número ${digitado}. Confira o número ou escolha na lista.`);
        return;
      }
      await escolher(achado.id);
    } catch (erro) {
      console.error('Erro ao buscar o pedido pelo número:', erro);
      showError('Não foi possível buscar o pedido', 'Verifique a conexão e tente de novo.');
    } finally {
      setBuscandoNumero(false);
    }
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = pedidos.filter((p) => (
    (!termo || p.numeroPedido?.toLowerCase().includes(termo) || p.clienteNome?.toLowerCase().includes(termo))
    && dentroDoPeriodo(p.createdAt, periodoDe, periodoAte)
  ));
  const blocos = useLinhasEmBlocos(filtrados);

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '860px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Fazer devolução</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden', flex: 1 }}>
          <form
            onSubmit={(e) => { e.preventDefault(); void buscarPeloNumero(); }}
            style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="numero-pedido-devolucao" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nº do pedido</label>
              <input
                id="numero-pedido-devolucao"
                type="text"
                inputMode="numeric"
                autoFocus
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                style={{ width: '160px', padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={!numero.trim() || buscandoNumero}>
              {buscandoNumero ? 'Buscando...' : 'Abrir'}
            </button>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', paddingBottom: '10px' }}>ou escolha na lista abaixo</span>
          </form>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="search-bar" style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
              <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Buscar…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                style={{ width: '100%', padding: '10px 14px 10px 42px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
              />
            </div>
            <CampoPeriodo rotulo="Data da venda" de={periodoDe} ate={periodoAte} onChangeDe={setPeriodoDe} onChangeAte={setPeriodoAte} />
          </div>

          <div style={{ overflow: 'auto', flex: 1, minHeight: '200px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 12px' }}>Nº Pedido</th>
                  <th style={{ padding: '10px 12px' }}>Data</th>
                  <th style={{ padding: '10px 12px' }}>Cliente</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: '32px' }}>Carregando pedidos...</td></tr>
                ) : filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <ShoppingCart size={40} style={{ margin: '0 auto 12px', opacity: 0.2 }} />
                      <p style={{ margin: 0 }}>Nenhum pedido finalizado encontrado.</p>
                    </td>
                  </tr>
                ) : blocos.visiveis.map((p) => {
                  const livre = podeDevolver(p);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => { if (livre) void escolher(p.id); }}
                      title={livre ? 'Devolver itens deste pedido' : 'Todos os itens deste pedido já foram devolvidos'}
                      style={{ borderBottom: '1px solid var(--border-color)', cursor: livre ? 'pointer' : 'not-allowed', opacity: livre ? 1 : 0.5 }}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>#{p.numeroPedido}</td>
                      <td style={{ padding: '10px 12px' }}>{p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                      <td style={{ padding: '10px 12px' }}>{p.clienteNome}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(p.valorTotal || 0))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <MostrarMaisLinhas blocos={blocos} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default EscolherPedidoDevolucaoModal;
