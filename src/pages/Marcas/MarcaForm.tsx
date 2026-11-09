import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Award, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { createAuditLog } from '../../services/logService';
import { diferencasEntre } from '../../utils/historicoAlteracoesDomain';

const MarcaForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const [formData, setFormData] = useState({ nome: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const { currentUser, tenantId } = useAuth();
  /** Marca como estava ao abrir: o "antes" do Histórico de alterações. */
  const marcaOriginalRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (isEditing && id) {
      const fetchDoc = async () => {
        try {
          const docSnap = await getDoc(doc(db, 'marcas', id));
          if (docSnap.exists()) {
            marcaOriginalRef.current = docSnap.data();
            setFormData(docSnap.data() as any);
          }
        } catch (error) {
          console.error(error);
        } finally {
          setIsFetching(false);
        }
      };
      fetchDoc();
    }
  }, [id, isEditing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: aplicarCaixaAltaCadastro(e.target, e.target.value) });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome) {
      showError('Campos incompletos', 'Nome da marca é obrigatório.');
      return;
    }
    if (!currentUser) return;

    setIsLoading(true);
    try {
      const dataToSave = { nome: formData.nome.toUpperCase().trim() };

      if (isEditing && id) {
        await updateDoc(doc(db, 'marcas', id), {
          ...dataToSave,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        // Historico de alteracoes (09/11/2026): so' quando algo mudou.
        const alteracoes = diferencasEntre(marcaOriginalRef.current, dataToSave, [{ campo: 'nome', rotulo: 'Nome' }]);
        if (alteracoes.length > 0) {
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'cadastros',
            acao: 'edicao',
            descricao: `Marca ${String(marcaOriginalRef.current?.nome || '')} renomeada para ${dataToSave.nome}.`,
            registroRelacionadoId: id,
            documentoTipo: 'marca',
            documentoNumero: `Marca ${dataToSave.nome}`,
            alteracoes,
            status: 'sucesso',
          });
        }
        showSuccess('Marca atualizada!');
      } else {
        const nova = await addDoc(collection(db, 'marcas'), {
          ...dataToSave,
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'cadastros',
          acao: 'criacao',
          descricao: `Marca ${dataToSave.nome} cadastrada.`,
          registroRelacionadoId: nova.id,
          documentoTipo: 'marca',
          documentoNumero: `Marca ${dataToSave.nome}`,
          status: 'sucesso',
        });
        showSuccess('Marca cadastrada!');
      }
      navigate('/marcas');
    } catch (error) {
      console.error(error);
      showError('Erro ao salvar', 'Ocorreu um erro ao salvar a marca.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/marcas')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Marca' : 'Nova Marca'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Marcas usadas no cadastro de produtos e matéria-prima</p>
          </div>
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}>
          {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
          {isLoading ? 'Salvando...' : 'Salvar Marca'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Award size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados da Marca</h3>
          </div>

          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome da Marca *</label>
            <input type="text" name="nome" value={formData.nome} onChange={handleChange} style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarcaForm;
