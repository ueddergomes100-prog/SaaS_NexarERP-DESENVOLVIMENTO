import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { IdCard, Loader2, Pencil, Plus, Power, Search, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import FiltroSituacao, { passaNaSituacao, SITUACAO_PADRAO, type Situacao } from '../../components/common/FiltroSituacao';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';

/**
 * CADASTRO DE MOTORISTAS (2026-09-21).
 *
 * Quem dirige a rota. Cadastro curto de proposito: nome, telefone, CNH e
 * observacao -- e' o que a loja precisa pra saber de quem e' a despesa. O
 * veiculo NAO mora aqui: e' texto livre na rota, porque o mesmo motorista
 * troca de caminhao, e o modulo Veiculos existente e' de oficina (vinculado
 * a cliente), outro dominio.
 *
 * Modal em vez de tela propria: sao quatro campos, e abrir uma rota so' pra
 * isso seria dar duas voltas pra cadastrar um nome.
 */

interface Motorista {
  id: string;
  nome: string;
  telefone?: string;
  cnh?: string;
  observacao?: string;
  ativo?: boolean;
}

const MotoristasList: React.FC = () => {
  const { currentUser, tenantId } = useAuth();
  const { linha } = useLinhaSelecionavel();
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao>(SITUACAO_PADRAO);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: '', telefone: '', cnh: '', observacao: '' });

  useEffect(() => {
    if (!tenantId) return undefined;
    const q = query(collection(db, 'motoristas'), where('tenantId', '==', tenantId));
    const parar = onSnapshot(q, (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Motorista));
      lista.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
      setMotoristas(lista);
      setLoading(false);
    }, (erro) => {
      console.error('Erro ao buscar motoristas:', erro);
      setLoading(false);
    });
    return () => parar();
  }, [tenantId]);

  const abrirNovo = () => {
    setForm({ nome: '', telefone: '', cnh: '', observacao: '' });
    setEditandoId(null);
    setModalAberto(true);
  };

  const abrirEdicao = (motorista: Motorista) => {
    if (motorista.ativo === false) {
      showError('Motorista inativo', `${motorista.nome} está inativo e não pode ser alterado. Reative-o na lista para editar.`);
      return;
    }
    setForm({
      nome: motorista.nome || '',
      telefone: motorista.telefone || '',
      cnh: motorista.cnh || '',
      observacao: motorista.observacao || '',
    });
    setEditandoId(motorista.id);
    setModalAberto(true);
  };

  const salvar = async () => {
    if (!currentUser || !tenantId) return;
    if (!form.nome.trim()) {
      showError('Nome obrigatório', 'Informe o nome do motorista.');
      return;
    }
    setSalvando(true);
    try {
      const dados = {
        nome: form.nome.toUpperCase().trim(),
        telefone: form.telefone.trim(),
        cnh: form.cnh.trim(),
        observacao: form.observacao.trim(),
        tenantId,
      };
      if (editandoId) {
        await updateDoc(doc(db, 'motoristas', editandoId), {
          ...dados,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Motorista atualizado!');
      } else {
        await addDoc(collection(db, 'motoristas'), {
          ...dados,
          ativo: true,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Motorista cadastrado!');
      }
      setModalAberto(false);
    } catch (erro) {
      console.error('Erro ao salvar motorista:', erro);
      showError('Erro ao salvar', 'Não foi possível salvar o motorista. Verifique sua conexão e tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarSituacao = async (motorista: Motorista) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'motoristas', motorista.id), {
        ativo: motorista.ativo === false,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
      });
      showSuccess(motorista.ativo === false ? 'Motorista reativado!' : 'Motorista inativado!');
    } catch (erro) {
      console.error('Erro ao mudar a situação do motorista:', erro);
      showError('Erro', 'Não foi possível mudar a situação deste motorista.');
    }
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = motoristas
    .filter((m) => passaNaSituacao(m.ativo !== false, situacao))
    .filter((m) => !termo || String(m.nome || '').toLowerCase().includes(termo) || String(m.telefone || '').includes(termo));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <IdCard size={26} color="var(--accent-purple)" />
            Motoristas
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Quem dirige as rotas. As despesas da viagem são lançadas em Rotas, por motorista e por dia.
          </p>
        </div>
        <button className="btn-primary" onClick={abrirNovo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Novo Motorista
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por nome ou telefone..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px 10px 42px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <FiltroSituacao valor={situacao} onChange={setSituacao} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Nome</th>
                <th style={{ padding: '14px' }}>Telefone</th>
                <th style={{ padding: '14px' }}>CNH</th>
                <th style={{ padding: '14px' }}>Situação</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '30px' }}>Carregando motoristas...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <IdCard size={44} style={{ margin: '0 auto 14px', opacity: 0.25 }} />
                    <div>{motoristas.length === 0 ? 'Nenhum motorista cadastrado ainda.' : 'Nenhum motorista com esses filtros.'}</div>
                  </td>
                </tr>
              ) : filtrados.map((m) => (
                <tr key={m.id} {...linha(m.id, () => abrirEdicao(m))} style={{ borderBottom: '1px solid var(--border-color)', opacity: m.ativo === false ? 0.55 : 1 }}>
                  <td style={{ padding: '14px', fontWeight: 600 }}>{m.nome}</td>
                  <td style={{ padding: '14px' }}>{m.telefone || '-'}</td>
                  <td style={{ padding: '14px' }}>{m.cnh || '-'}</td>
                  <td style={{ padding: '14px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', backgroundColor: m.ativo === false ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)', color: m.ativo === false ? '#ef4444' : '#10b981' }}>
                      {m.ativo === false ? 'Inativo' : 'Ativo'}
                    </span>
                  </td>
                  <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                    <button className="icon-btn" title="Editar" onClick={() => abrirEdicao(m)} style={{ color: '#f59e0b' }}><Pencil size={16} /></button>
                    <button className="icon-btn" title={m.ativo === false ? 'Reativar' : 'Inativar'} onClick={() => void alternarSituacao(m)} style={{ color: m.ativo === false ? '#10b981' : '#ef4444' }}><Power size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalAberto && (
        <div onClick={() => setModalAberto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '520px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IdCard size={20} color="var(--accent-purple)" />
                {editandoId ? 'Editar Motorista' : 'Novo Motorista'}
              </h2>
              <button onClick={() => setModalAberto(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome *</label>
                <input type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: JOÃO DA SILVA" style={{ textTransform: 'uppercase', padding: '11px 13px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Telefone</label>
                  <input type="text" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(00) 00000-0000" style={{ padding: '11px 13px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CNH</label>
                  <input type="text" value={form.cnh} onChange={(e) => setForm({ ...form, cnh: e.target.value })} placeholder="Número da habilitação" style={{ padding: '11px 13px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Observação</label>
                <textarea value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} rows={2} placeholder="Opcional" style={{ padding: '11px 13px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn-secondary" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              <button className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {salvando ? <Loader2 size={17} className="spin-icon" /> : <Plus size={17} />}
                {salvando ? 'Salvando...' : 'Salvar Motorista'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MotoristasList;
