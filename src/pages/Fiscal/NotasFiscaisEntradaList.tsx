import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, History, Inbox, Loader2, Package, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, documentId, onSnapshot, query, where, getDocs, type Timestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateInputPtBr } from '../../utils/dateTime';
import type { NotaFiscalEntradaItemRecord, NotaFiscalEntradaStatus } from '../../utils/entradaNfeDomain';

interface NotaFiscalEntradaDoc {
  id: string;
  numeroNF: string;
  dataEmissao: string;
  valorTotal: number;
  fornecedorId: string;
  fornecedorNome: string;
  fornecedorCnpj: string;
  status: NotaFiscalEntradaStatus;
  itens: NotaFiscalEntradaItemRecord[];
  titulosPagarIds: string[];
  createdAt?: Timestamp;
}

interface TituloPagar {
  id: string;
  descricao: string;
  data: string;
  valor: number;
  status: string;
}

const currency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const STATUS_LABEL: Record<NotaFiscalEntradaStatus, string> = {
  ativa: 'Ativa',
  excluida: 'Excluída',
};

const STATUS_COLOR: Record<NotaFiscalEntradaStatus, string> = {
  ativa: '#10b981',
  excluida: '#ef4444',
};

const TIPO_ITEM_LABEL: Record<NotaFiscalEntradaItemRecord['tipo'], string> = {
  revenda: 'Revenda',
  materia_prima: 'Matéria-Prima',
};

const NotasFiscaisEntradaList: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [notas, setNotas] = useState<NotaFiscalEntradaDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [notaSelecionada, setNotaSelecionada] = useState<NotaFiscalEntradaDoc | null>(null);
  const [titulos, setTitulos] = useState<TituloPagar[]>([]);
  const [carregandoTitulos, setCarregandoTitulos] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const q = query(collection(db, 'notas_fiscais_entrada'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snap) => {
      const data: NotaFiscalEntradaDoc[] = [];
      snap.forEach((d) => data.push({ id: d.id, ...d.data() } as NotaFiscalEntradaDoc));
      data.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setNotas(data);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar notas de entrada:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenantId]);

  const notasFiltradas = useMemo(() => {
    if (!searchTerm.trim()) return notas;
    const termo = searchTerm.toLowerCase();
    return notas.filter((nota) =>
      nota.numeroNF.toLowerCase().includes(termo) ||
      nota.fornecedorNome.toLowerCase().includes(termo)
    );
  }, [notas, searchTerm]);

  const handleVerDetalhes = async (nota: NotaFiscalEntradaDoc) => {
    setNotaSelecionada(nota);
    setTitulos([]);

    if (nota.titulosPagarIds.length === 0) return;

    setCarregandoTitulos(true);
    try {
      // 'in' do Firestore aceita ate 30 valores -- numero de duplicatas de
      // uma unica nota nunca chega perto disso na pratica.
      const q = query(collection(db, 'transacoes'), where(documentId(), 'in', nota.titulosPagarIds.slice(0, 30)));
      const snap = await getDocs(q);
      const data: TituloPagar[] = [];
      snap.forEach((d) => {
        const t = d.data();
        data.push({ id: d.id, descricao: t.descricao || '', data: t.data || '', valor: Number(t.valor || 0), status: t.status || '' });
      });
      data.sort((a, b) => a.data.localeCompare(b.data));
      setTitulos(data);
    } catch (error) {
      console.error('Erro ao buscar títulos da nota:', error);
    } finally {
      setCarregandoTitulos(false);
    }
  };

  const handleFecharDetalhes = () => {
    setNotaSelecionada(null);
    setTitulos([]);
  };

  return (
    <div className="os-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn back-btn" onClick={() => navigate('/fiscal/entrada-nfe')} title="Voltar para Entrada de XML">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '24px', margin: 0 }}>
            <History size={28} color="var(--accent-purple)" />
            Histórico de Entradas de NF-e
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Notas fiscais de entrada já importadas, com os itens e títulos de Contas a Pagar gerados por cada uma.
          </p>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número da NF ou fornecedor..."
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
                <th>Data de Emissão</th>
                <th>Nº NF-e</th>
                <th>Fornecedor</th>
                <th style={{ textAlign: 'center' }}>Itens</th>
                <th style={{ textAlign: 'right' }}>Valor Total</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando histórico...</td>
                </tr>
              ) : notasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Inbox size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>{searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : 'Nenhuma nota de entrada importada ainda.'}</p>
                  </td>
                </tr>
              ) : (
                notasFiltradas.map((nota) => (
                  <tr key={nota.id}>
                    <td>{formatDateInputPtBr(nota.dataEmissao)}</td>
                    <td className="font-medium">{nota.numeroNF}</td>
                    <td>{nota.fornecedorNome}</td>
                    <td style={{ textAlign: 'center' }}>{nota.itens.length}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{currency(nota.valorTotal)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, backgroundColor: `${STATUS_COLOR[nota.status]}1a`, color: STATUS_COLOR[nota.status] }}>
                        {STATUS_LABEL[nota.status]}
                      </span>
                    </td>
                    <td>
                      <button className="icon-btn" title="Ver detalhes" onClick={() => handleVerDetalhes(nota)}>
                        <FileText size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {notaSelecionada && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }} onClick={handleFecharDetalhes}>
          <div className="card" style={{ width: '100%', maxWidth: '720px', maxHeight: '85vh', overflowY: 'auto', padding: '28px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileText size={22} color="var(--accent-purple)" />
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px' }}>NF-e {notaSelecionada.numeroNF}</h2>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>{notaSelecionada.fornecedorNome}</p>
                </div>
              </div>
              <button className="icon-btn" onClick={handleFecharDetalhes} title="Fechar">
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Data de Emissão</label>
                <strong style={{ fontSize: '14px' }}>{formatDateInputPtBr(notaSelecionada.dataEmissao)}</strong>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Valor Total</label>
                <strong style={{ fontSize: '14px' }}>{currency(notaSelecionada.valorTotal)}</strong>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block' }}>Status</label>
                <strong style={{ fontSize: '14px', color: STATUS_COLOR[notaSelecionada.status] }}>{STATUS_LABEL[notaSelecionada.status]}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Package size={16} color="var(--accent-purple)" />
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Itens ({notaSelecionada.itens.length})</h3>
            </div>
            <div className="table-wrapper" style={{ marginBottom: '24px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: 'center' }}>Qtd.</th>
                    <th style={{ textAlign: 'right' }}>Vlr. Unit.</th>
                    <th style={{ textAlign: 'center' }}>Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {notaSelecionada.itens.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.descricaoXml}</td>
                      <td>{TIPO_ITEM_LABEL[item.tipo]}</td>
                      <td style={{ textAlign: 'center' }}>{item.quantidade}</td>
                      <td style={{ textAlign: 'right' }}>{currency(item.valorUnitario)}</td>
                      <td style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>{item.novo ? 'Novo' : 'Mesclado'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <FileText size={16} color="var(--accent-purple)" />
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Títulos em Contas a Pagar ({notaSelecionada.titulosPagarIds.length})</h3>
            </div>
            {carregandoTitulos ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <Loader2 size={16} className="spin-icon" /> Carregando títulos...
              </div>
            ) : titulos.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nenhum título encontrado.</p>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vencimento</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {titulos.map((titulo) => (
                      <tr key={titulo.id}>
                        <td>{formatDateInputPtBr(titulo.data)}</td>
                        <td style={{ textAlign: 'right' }}>{currency(titulo.valor)}</td>
                        <td style={{ textAlign: 'center' }}>{titulo.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotasFiscaisEntradaList;
