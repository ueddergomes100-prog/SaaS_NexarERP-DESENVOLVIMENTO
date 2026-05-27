import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, User, Car, Clock, Wrench, Trash2 } from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, deleteDoc } from 'firebase/firestore';
import Swal from 'sweetalert2';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';

interface ClienteBasico { id: string; nome: string; telefone: string; }
interface VeiculoBasico { id: string; placa: string; modelo: string; clienteId: string; }
interface Agendamento {
  id: string;
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  clienteId: string;
  clienteNome: string;
  veiculo: string;
  servico: string;
  status: string;
}

const Agenda: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [clientesDisponiveis, setClientesDisponiveis] = useState<ClienteBasico[]>([]);
  const [veiculosDisponiveis, setVeiculosDisponiveis] = useState<VeiculoBasico[]>([]);
  const [veiculosDoCliente, setVeiculosDoCliente] = useState<VeiculoBasico[]>([]);
  const [isVeiculoDropdownOpen, setIsVeiculoDropdownOpen] = useState(false);
  
  // Form Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    data: new Date().toISOString().split('T')[0],
    hora: '09:00',
    clienteId: '',
    clienteNome: '',
    veiculo: '',
    servico: ''
  });
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const { currentUser, tenantId } = useAuth();
  const navigate = useNavigate();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Busca Clientes e Agendamentos
  useEffect(() => {
    if (!currentUser) return;

    // Buscar Clientes
    const qClientes = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
    const unsubscribeClientes = onSnapshot(qClientes, (snap) => {
      const cliData: ClienteBasico[] = [];
      snap.forEach(doc => cliData.push({ id: doc.id, nome: doc.data().nome, telefone: doc.data().telefone }));
      setClientesDisponiveis(cliData);
    });

    // Buscar Veículos
    const qVeiculos = query(collection(db, 'veiculos'), where('tenantId', '==', tenantId));
    const unsubscribeVeiculos = onSnapshot(qVeiculos, (snap) => {
      const vData: VeiculoBasico[] = [];
      snap.forEach(doc => vData.push({ id: doc.id, placa: doc.data().placa, modelo: doc.data().modelo, clienteId: doc.data().clienteId }));
      setVeiculosDisponiveis(vData);
    });

    // Buscar Agendamentos
    const qAgendamentos = query(collection(db, 'agendamentos'), where('tenantId', '==', tenantId));
    const unsubscribeAgendamentos = onSnapshot(qAgendamentos, (snap) => {
      const agData: Agendamento[] = [];
      snap.forEach(doc => agData.push({ id: doc.id, ...doc.data() } as Agendamento));
      setAgendamentos(agData);
    });

    return () => {
      unsubscribeClientes();
      unsubscribeVeiculos();
      unsubscribeAgendamentos();
    };
  }, [currentUser]);

  const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const handleSaveAgendamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clienteId || !formData.data || !formData.hora) {
      showError('Atenção', 'Selecione um cliente cadastrado, data e hora.');
      return;
    }

    if (!currentUser) return;
    setIsLoading(true);

    try {
      await addDoc(collection(db, 'agendamentos'), {
        ...formData,
        status: 'Agendado',
        tenantId,
        createdAt: serverTimestamp()
      });
      showSuccess('Agendamento criado com sucesso!');
      setIsModalOpen(false);
      setFormData({ ...formData, clienteId: '', clienteNome: '', veiculo: '', servico: '' });
    } catch (err) {
      console.error(err);
      showError('Erro', 'Não foi possível criar o agendamento.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAgendamentoClick = async (ag: Agendamento) => {
    const result = await NexusSwal.fire({
      title: 'Detalhes do Agendamento',
      html: `
        <div style="text-align: left; padding: 10px;">
          <p><strong>Hora:</strong> ${ag.hora}</p>
          <p><strong>Cliente:</strong> ${ag.clienteNome}</p>
          <p><strong>Veículo:</strong> ${ag.veiculo || 'Não informado'}</p>
          <p><strong>Serviço:</strong> ${ag.servico || 'Não informado'}</p>
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Fechar',
      confirmButtonColor: '#8b5cf6',
      denyButtonText: 'Excluir',
      denyButtonColor: '#ef4444',
      cancelButtonText: 'Cancelar',
      cancelButtonColor: '#3f3f46',
    });

    if (result.isDenied) {
      const confirm = await NexusSwal.fire({
        title: 'Tem certeza?',
        text: "Isso irá remover o agendamento da sua agenda permanentemente.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#3f3f46',
        confirmButtonText: 'Sim, excluir!',
        cancelButtonText: 'Cancelar'
      });
      
      if (confirm.isConfirmed) {
        try {
          await deleteDoc(doc(db, 'agendamentos', ag.id));
          showSuccess('Agendamento excluído com sucesso!');
        } catch (err) {
          console.error(err);
          showError('Erro', 'Não foi possível excluir o agendamento.');
        }
      }
    }
  };

  // Transforma array flat em mapa por dia do mês atual
  const agendamentosPorDia: Record<number, Agendamento[]> = {};
  agendamentos.forEach(ag => {
    const [agYear, agMonth, agDay] = ag.data.split('-').map(Number);
    if (agYear === year && (agMonth - 1) === month) {
      if (!agendamentosPorDia[agDay]) agendamentosPorDia[agDay] = [];
      agendamentosPorDia[agDay].push(ag);
    }
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarIcon size={28} color="var(--accent-purple)" />
            Agenda de Serviços
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Gerencie reservas, agenda e fluxo de atendimento</p>
        </div>
        <button className="btn-primary" onClick={() => setIsModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Novo Agendamento
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>
            {meses[month]} {year}
          </h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setCurrentDate(new Date(year, month - 1, 1))} style={{ padding: '8px' }}>
              <ChevronLeft size={20} />
            </button>
            <button className="btn-secondary" onClick={() => setCurrentDate(new Date())}>Hoje</button>
            <button className="btn-secondary" onClick={() => setCurrentDate(new Date(year, month + 1, 1))} style={{ padding: '8px' }}>
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
          {diasSemana.map((dia) => (
            <div key={dia} style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)', paddingBottom: '12px' }}>{dia}</div>
          ))}
          
          {days.map((day, idx) => {
            const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
            const hasAg = day && agendamentosPorDia[day];

            return (
              <div 
                key={idx} 
                style={{ 
                  minHeight: '120px', 
                  backgroundColor: isToday ? 'rgba(139, 92, 246, 0.1)' : 'var(--bg-tertiary)', 
                  border: isToday ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)', 
                  borderRadius: 'var(--radius-md)', 
                  padding: '8px',
                  display: 'flex', flexDirection: 'column', gap: '4px'
                }}
              >
                {day && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent-purple)' : 'white' }}>{day}</span>
                    </div>
                    {hasAg && hasAg.sort((a,b) => a.hora.localeCompare(b.hora)).map((ag) => (
                      <div 
                        key={ag.id} 
                        onClick={() => handleAgendamentoClick(ag)}
                        style={{ backgroundColor: 'var(--bg-secondary)', padding: '6px 8px', borderRadius: '4px', fontSize: '11px', borderLeft: '3px solid #10b981', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'filter 0.2s' }} 
                        onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.2)'}
                        onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                        title={`${ag.hora} - ${ag.clienteNome} (Clique para opções)`}
                      >
                        <strong style={{ display: 'block', color: 'var(--text-primary)' }}>{ag.hora} - {ag.veiculo || 'S/V'}</strong>
                        <span style={{ color: 'var(--text-muted)' }}>{ag.clienteNome}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '100%', maxWidth: '500px', padding: '24px', position: 'relative' }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={24} />
            </button>
            <h2 style={{ margin: '0 0 24px 0', fontSize: '20px' }}>Novo Agendamento</h2>
            
            <form onSubmit={handleSaveAgendamento} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label>Data</label>
                  <input type="date" value={formData.data} onChange={e => setFormData({...formData, data: e.target.value})} required />
                </div>
                <div className="input-group">
                  <label>Hora</label>
                  <input type="time" value={formData.hora} onChange={e => setFormData({...formData, hora: e.target.value})} required />
                </div>
              </div>

              <div className="input-group" style={{ position: 'relative' }} ref={dropdownRef}>
                <label>Vincular a um Cliente *</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    placeholder="Buscar cliente cadastrado..." 
                    value={formData.clienteNome} 
                    onChange={(e) => {
                      setFormData({ ...formData, clienteNome: e.target.value, clienteId: '' });
                      setIsClientDropdownOpen(true);
                    }} 
                    onFocus={() => setIsClientDropdownOpen(true)}
                    autoComplete="off" 
                    style={{ flex: 1 }}
                  />
                </div>
                {isClientDropdownOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto', zIndex: 50 }}>
                    {clientesDisponiveis
                      .filter(c => c.nome.toLowerCase().includes(formData.clienteNome.toLowerCase()))
                      .map(c => (
                        <div 
                          key={c.id} 
                          onClick={() => {
                            setIsClientDropdownOpen(false);
                            
                            const vDoCliente = veiculosDisponiveis.filter(v => v.clienteId === c.id);
                            if (vDoCliente.length === 1) {
                              const v = vDoCliente[0];
                              setFormData({ ...formData, clienteNome: c.nome, clienteId: c.id, veiculo: `${v.placa} - ${v.modelo}` });
                              setVeiculosDoCliente([]);
                              setIsVeiculoDropdownOpen(false);
                            } else if (vDoCliente.length > 1) {
                              setFormData({ ...formData, clienteNome: c.nome, clienteId: c.id });
                              setVeiculosDoCliente(vDoCliente);
                              setIsVeiculoDropdownOpen(true);
                            } else {
                              setFormData({ ...formData, clienteNome: c.nome, clienteId: c.id, veiculo: '' });
                              setVeiculosDoCliente([]);
                              setIsVeiculoDropdownOpen(false);
                            }
                          }}
                          style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                        >
                          <span style={{ fontWeight: 500, fontSize: '14px' }}>{c.nome}</span>
                        </div>
                      ))}
                      
                    {/* Botão fixo no dropdown para cadastrar novo */}
                    <div 
                      onClick={() => navigate('/clientes/novo')}
                      style={{ padding: '12px 16px', color: '#10b981', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}
                    >
                      <Plus size={16} /> Criar cadastro de cliente
                    </div>
                  </div>
                )}
              </div>

              {isVeiculoDropdownOpen && veiculosDoCliente.length > 1 && (
                <div style={{ padding: '16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px dashed #3b82f6', borderRadius: '8px' }}>
                  <p style={{ color: '#3b82f6', marginBottom: '12px', fontWeight: 'bold' }}>Selecione o veículo:</p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {veiculosDoCliente.map(v => (
                      <button 
                        key={v.id} 
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({...prev, veiculo: `${v.placa} - ${v.modelo}`}));
                          setIsVeiculoDropdownOpen(false);
                        }}
                        style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                      >
                        {v.placa} - {v.modelo}
                      </button>
                    ))}
                    <button 
                      type="button" 
                      onClick={() => setIsVeiculoDropdownOpen(false)} 
                      style={{ padding: '8px 16px', backgroundColor: 'transparent', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Outro / Não informar
                    </button>
                  </div>
                </div>
              )}

              <div className="input-group">
                <label>Veículo (Placa / Modelo)</label>
                <input type="text" placeholder="Ex: ABC-1234 Tracker" value={formData.veiculo} onChange={e => setFormData({...formData, veiculo: e.target.value})} />
              </div>

              <div className="input-group">
                <label>Serviço Pretendido</label>
                <input type="text" placeholder="Ex: Revisão, Troca de Óleo..." value={formData.servico} onChange={e => setFormData({...formData, servico: e.target.value})} />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isLoading || !formData.clienteId}>
                  {isLoading ? 'Salvando...' : 'Confirmar Agendamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agenda;
