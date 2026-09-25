import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Loader2, Pencil, Plus, Power, Search, Truck, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import FiltroSituacao, { passaNaSituacao, SITUACAO_PADRAO, type Situacao } from '../../components/common/FiltroSituacao';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { TIPOS_DE_VEICULO, erroDoVeiculo, formatarPlaca, normalizarPlaca, type VeiculoDaFrota } from '../../utils/frotaDomain';

/**
 * FROTA PROPRIA (2026-09-25): os veiculos da EMPRESA -- caminhao de entrega,
 * carro, moto. Nao confundir com Cadastros > Veiculos, que e' o veiculo do
 * CLIENTE (Ordem de Servico). Cada despesa do Contas a Pagar pode apontar para
 * um veiculo daqui, e o relatorio de Custo por Veiculo soma isso.
 *
 * Modal em vez de tela propria, no molde de Motoristas: sao poucos campos.
 */

interface MotoristaOpcao {
  id: string;
  nome: string;
  ativo?: boolean;
}

const FORM_VAZIO = { placa: '', modelo: '', marca: '', ano: '', tipo: 'Caminhão', motoristaPadraoId: '', kmAtual: '', observacao: '' };

const campoStyle: React.CSSProperties = { padding: '11px 13px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' };
const rotuloStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)' };

const FrotaList: React.FC = () => {
  const { currentUser, tenantId } = useAuth();
  const { linha } = useLinhaSelecionavel();
  const [veiculos, setVeiculos] = useState<VeiculoDaFrota[]>([]);
  const [motoristas, setMotoristas] = useState<MotoristaOpcao[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao>(SITUACAO_PADRAO);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);

  useEffect(() => {
    if (!tenantId) return undefined;
    const pararFrota = onSnapshot(query(collection(db, 'frota'), where('tenantId', '==', tenantId)), (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() } as VeiculoDaFrota));
      lista.sort((a, b) => String(a.modelo || '').localeCompare(String(b.modelo || ''), 'pt-BR'));
      setVeiculos(lista);
      setLoading(false);
    }, (erro) => {
      console.error('Erro ao buscar a frota:', erro);
      setLoading(false);
    });
    const pararMotoristas = onSnapshot(query(collection(db, 'motoristas'), where('tenantId', '==', tenantId)), (snap) => {
      setMotoristas(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MotoristaOpcao)).filter((m) => m.ativo !== false));
    }, (erro) => console.error('Erro ao buscar motoristas:', erro));
    return () => { pararFrota(); pararMotoristas(); };
  }, [tenantId]);

  const abrirNovo = () => {
    setForm(FORM_VAZIO);
    setEditandoId(null);
    setModalAberto(true);
  };

  const abrirEdicao = (veiculo: VeiculoDaFrota) => {
    if (veiculo.ativo === false) {
      showError('Veículo inativo', `${veiculo.modelo} está inativo e não pode ser alterado. Reative-o na lista para editar.`);
      return;
    }
    setForm({
      placa: formatarPlaca(veiculo.placa || ''),
      modelo: veiculo.modelo || '',
      marca: veiculo.marca || '',
      ano: veiculo.ano ? String(veiculo.ano) : '',
      tipo: veiculo.tipo || 'Outro',
      motoristaPadraoId: veiculo.motoristaPadraoId || '',
      kmAtual: veiculo.kmAtual !== undefined ? String(veiculo.kmAtual) : '',
      observacao: veiculo.observacao || '',
    });
    setEditandoId(veiculo.id);
    setModalAberto(true);
  };

  const salvar = async () => {
    if (!currentUser || !tenantId) return;
    const problema = erroDoVeiculo(form, veiculos, editandoId);
    if (problema) {
      showError('Confira o veículo', problema);
      return;
    }
    setSalvando(true);
    try {
      const motorista = motoristas.find((m) => m.id === form.motoristaPadraoId);
      const km = form.kmAtual.trim() ? Number(form.kmAtual.replace(',', '.')) : null;
      const dados = {
        placa: normalizarPlaca(form.placa),
        modelo: form.modelo.toUpperCase().trim(),
        marca: form.marca.toUpperCase().trim(),
        ano: form.ano.trim() ? Number(form.ano) : null,
        tipo: form.tipo,
        motoristaPadraoId: motorista?.id || '',
        motoristaPadraoNome: motorista?.nome || '',
        kmAtual: km,
        observacao: form.observacao.trim(),
        tenantId,
      };
      if (editandoId) {
        await updateDoc(doc(db, 'frota', editandoId), { ...dados, ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()) });
        showSuccess('Veículo atualizado!');
      } else {
        await addDoc(collection(db, 'frota'), { ...dados, ativo: true, createdAt: serverTimestamp(), ...buildDocumentMetadata(currentUser.uid, serverTimestamp()) });
        showSuccess('Veículo cadastrado na frota!');
      }
      setModalAberto(false);
    } catch (erro) {
      console.error('Erro ao salvar veículo da frota:', erro);
      showError('Erro ao salvar', 'Não foi possível salvar o veículo. Verifique sua conexão e tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarSituacao = async (veiculo: VeiculoDaFrota) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'frota', veiculo.id), { ativo: veiculo.ativo === false, ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()) });
      showSuccess(veiculo.ativo === false ? 'Veículo reativado!' : 'Veículo inativado!');
    } catch (erro) {
      console.error('Erro ao mudar a situação do veículo:', erro);
      showError('Erro', 'Não foi possível mudar a situação deste veículo.');
    }
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = veiculos
    .filter((v) => passaNaSituacao(v.ativo !== false, situacao))
    .filter((v) => !termo || `${v.modelo} ${v.marca || ''} ${normalizarPlaca(v.placa)} ${v.motoristaPadraoNome || ''}`.toLowerCase().includes(termo));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Truck size={26} color="var(--accent-purple)" />
            Frota
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Veículos da empresa. As despesas (combustível, manutenção, IPVA, seguro...) são ligadas a eles no Contas a Pagar, e o relatório de Custo por Veículo soma tudo.
          </p>
        </div>
        <button className="btn-primary" onClick={abrirNovo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Novo Veículo
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar por modelo, placa ou motorista..." value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...campoStyle, width: '100%', padding: '10px 14px 10px 42px' }} />
          </div>
          <FiltroSituacao valor={situacao} onChange={setSituacao} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Veículo</th>
                <th style={{ padding: '14px' }}>Placa</th>
                <th style={{ padding: '14px' }}>Tipo</th>
                <th style={{ padding: '14px' }}>Motorista padrão</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>KM</th>
                <th style={{ padding: '14px' }}>Situação</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '30px' }}>Carregando a frota...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <Truck size={44} style={{ margin: '0 auto 14px', opacity: 0.25 }} />
                    <div>{veiculos.length === 0 ? 'Nenhum veículo cadastrado na frota ainda.' : 'Nenhum veículo com esses filtros.'}</div>
                  </td>
                </tr>
              ) : filtrados.map((v) => (
                <tr key={v.id} {...linha(v.id, () => abrirEdicao(v))} style={{ borderBottom: '1px solid var(--border-color)', opacity: v.ativo === false ? 0.55 : 1 }}>
                  <td style={{ padding: '14px', fontWeight: 600 }}>{v.modelo}{v.marca ? ` · ${v.marca}` : ''}{v.ano ? ` (${v.ano})` : ''}</td>
                  <td style={{ padding: '14px', fontFamily: 'monospace' }}>{formatarPlaca(v.placa)}</td>
                  <td style={{ padding: '14px' }}>{v.tipo || '-'}</td>
                  <td style={{ padding: '14px' }}>{v.motoristaPadraoNome || '-'}</td>
                  <td style={{ padding: '14px', textAlign: 'right' }}>{v.kmAtual !== undefined && v.kmAtual !== null ? Number(v.kmAtual).toLocaleString('pt-BR') : '-'}</td>
                  <td style={{ padding: '14px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', backgroundColor: v.ativo === false ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)', color: v.ativo === false ? '#ef4444' : '#10b981' }}>
                      {v.ativo === false ? 'Inativo' : 'Ativo'}
                    </span>
                  </td>
                  <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                    <button className="icon-btn" title="Editar" onClick={() => abrirEdicao(v)} style={{ color: '#f59e0b' }}><Pencil size={16} /></button>
                    <button className="icon-btn" title={v.ativo === false ? 'Reativar' : 'Inativar'} onClick={() => void alternarSituacao(v)} style={{ color: v.ativo === false ? '#10b981' : '#ef4444' }}><Power size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalAberto && (
        <div onClick={() => setModalAberto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '620px', maxHeight: '92vh', overflowY: 'auto', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Truck size={20} color="var(--accent-purple)" />
                {editandoId ? 'Editar Veículo da Frota' : 'Novo Veículo da Frota'}
              </h2>
              <button onClick={() => setModalAberto(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} aria-label="Fechar"><X size={22} /></button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Placa *</label>
                  <input type="text" value={form.placa} onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })} placeholder="ABC-1D23" maxLength={8} style={{ ...campoStyle, textTransform: 'uppercase', fontFamily: 'monospace' }} />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Modelo *</label>
                  <input type="text" value={form.modelo} onChange={(e) => setForm({ ...form, modelo: aplicarCaixaAltaCadastro(e.target, e.target.value) })} placeholder="Ex: VW DELIVERY 9.170" style={{ ...campoStyle, textTransform: 'uppercase' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Marca</label>
                  <input type="text" value={form.marca} onChange={(e) => setForm({ ...form, marca: aplicarCaixaAltaCadastro(e.target, e.target.value) })} style={{ ...campoStyle, textTransform: 'uppercase' }} />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Ano</label>
                  <input type="text" inputMode="numeric" value={form.ano} onChange={(e) => setForm({ ...form, ano: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2021" style={campoStyle} />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="form-select" style={campoStyle}>
                    {TIPOS_DE_VEICULO.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Motorista padrão</label>
                  <select value={form.motoristaPadraoId} onChange={(e) => setForm({ ...form, motoristaPadraoId: e.target.value })} className="form-select" style={campoStyle}>
                    <option value="">Nenhum</option>
                    {motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>KM atual</label>
                  <input type="text" inputMode="decimal" value={form.kmAtual} onChange={(e) => setForm({ ...form, kmAtual: e.target.value })} placeholder="0" style={campoStyle} />
                </div>
              </div>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={rotuloStyle}>Observação</label>
                <textarea value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} rows={2} placeholder="Opcional" style={{ ...campoStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn-secondary" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              <button className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {salvando ? <Loader2 size={17} className="spin-icon" /> : <Plus size={17} />}
                {salvando ? 'Salvando...' : 'Salvar Veículo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FrotaList;
