import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Factory, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useReservedRawMaterialStock } from '../../hooks/useReservedRawMaterialStock';
import { computeEstoquePrevisto } from '../../utils/producaoDomain';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 16px',
  color: 'var(--text-primary)',
  width: '100%'
};

const MateriaPrimaForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    categoria: '',
    unidade: 'UN',
    quantidade: '0',
    estoqueMinimo: '0',
    precoCusto: '0',
    fornecedor: '',
    lote: '',
    validade: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  // Decoupled de isFetching (que so controla o spinner de tela cheia, e
  // no modo "novo" ja comeca `false` mesmo com uma busca assincrona em
  // andamento pro codigo automatico) -- marca quando o carregamento
  // inicial de verdade terminou, pra so entao capturar o snapshot que
  // decide se a aba esta "suja".
  const [formReady, setFormReady] = useState(false);
  const initialSnapshotRef = useRef<string | null>(null);
  const { currentUser, tenantId } = useAuth();
  const { reservedMap } = useReservedRawMaterialStock(tenantId);
  const reservado = isEditing && id ? (reservedMap.get(id) || 0) : 0;
  const quantidadeAtual = Number(formData.quantidade) || 0;
  const estoquePrevisto = computeEstoquePrevisto(quantidadeAtual, reservado);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!tenantId) return;
      try {
        const qCat = query(collection(db, 'categorias'), where('tenantId', '==', tenantId));
        const snapCat = await getDocs(qCat);
        const cats: string[] = [];
        snapCat.forEach(d => {
          if (d.data().tipo === 'Matéria-Prima') cats.push(d.data().nome);
        });
        setCategoriasDB(cats);

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'materias_primas', id));
          if (docSnap.exists()) {
            const data = docSnap.data() as any;
            setFormData(prev => ({
              ...prev,
              ...data,
              quantidade: String(data.quantidade ?? 0),
              estoqueMinimo: String(data.estoqueMinimo ?? 0),
              precoCusto: String(data.precoCusto ?? 0),
            }));
          }
        } else {
          const q = query(collection(db, 'materias_primas'), where('tenantId', '==', tenantId));
          const snap = await getCountFromServer(q);
          const nextId = snap.data().count + 1;
          setFormData(prev => ({ ...prev, codigo: String(nextId) }));
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
        setFormReady(true);
      }
    };
    fetchInitialData();
  }, [id, isEditing, tenantId]);

  const [isDirty, setIsDirty] = useState(false);
  useEffect(() => {
    if (!formReady) return;
    if (initialSnapshotRef.current === null) {
      initialSnapshotRef.current = JSON.stringify(formData);
      setIsDirty(false);
    } else {
      setIsDirty(JSON.stringify(formData) !== initialSnapshotRef.current);
    }
  }, [formReady, formData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name } = e.target;
    // Caixa alta na digitacao: o que se ve e o que se grava.
    // textarea, select, e-mail, senha e chave ficam de fora --
    // ver aplicarCaixaAltaCadastro.
    const value = aplicarCaixaAltaCadastro(e.target, e.target.value);
    setFormData({ ...formData, [name]: value });
  };

  /** Devolve true/false (sucesso) -- usado tanto pelo clique do botao
   * quanto pelo useUnsavedChangesGuard (fechar aba -> "Salvar e fechar"). */
  const saveMateriaPrima = async (): Promise<boolean> => {
    if (!formData.nome) {
      showError('Campos incompletos', 'Por favor, preencha o Nome da matéria-prima.');
      return false;
    }

    if (!currentUser) return false;
    setIsLoading(true);

    try {
      const dataToSave = {
        codigo: formData.codigo,
        nome: formData.nome.toUpperCase().trim(),
        categoria: formData.categoria.toUpperCase().trim(),
        unidade: formData.unidade.toUpperCase().trim() || 'UN',
        quantidade: Number(formData.quantidade) || 0,
        estoqueMinimo: Number(formData.estoqueMinimo) || 0,
        precoCusto: Number(formData.precoCusto) || 0,
        fornecedor: formData.fornecedor.toUpperCase().trim(),
        lote: formData.lote.trim(),
        validade: formData.validade,
        tenantId
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'materias_primas', id), {
          ...dataToSave,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Matéria-prima atualizada!');
      } else {
        await addDoc(collection(db, 'materias_primas'), {
          ...dataToSave,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Matéria-prima cadastrada!');
      }
      initialSnapshotRef.current = JSON.stringify(formData);
      setIsDirty(false);
      navigate('/materias-primas');
      return true;
    } catch (error) {
      console.error('Erro ao salvar matéria-prima:', error);
      showError('Erro ao salvar', 'Verifique sua conexão e tente novamente.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  useUnsavedChangesGuard(isDirty, saveMateriaPrima);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMateriaPrima();
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/materias-primas')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Matéria-Prima' : 'Nova Matéria-Prima'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Estoque separado, usado como insumo em ordens de produção</p>
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={isLoading}
          style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}
        >
          {isLoading ? (
            <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} />
          ) : (
            <Save size={18} style={{ marginRight: 8 }} />
          )}
          {isLoading ? 'Salvando...' : 'Salvar Matéria-Prima'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Factory size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados da Matéria-Prima</h3>
          </div>

          {isEditing && reservado > 0 && (
            <div style={{ display: 'flex', gap: '24px', padding: '14px 18px', backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>Reservado (produção em andamento)</label>
                <strong style={{ color: '#8b5cf6' }}>{reservado} {formData.unidade || 'UN'}</strong>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>Estoque Previsto</label>
                <strong style={{ color: '#8b5cf6' }}>{estoquePrevisto} {formData.unidade || 'UN'}</strong>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
            <div className="input-group">
              <label>Código *</label>
              <input type="text" name="codigo" value={formData.codigo} onChange={handleChange} style={inputStyle} />
            </div>
            <div className="input-group">
              <label>Nome *</label>
              <input type="text" name="nome" placeholder="Ex: CHAPA DE AÇO 2MM" value={formData.nome} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Categoria</label>
              <input type="text" name="categoria" list="categorias-materia-prima" placeholder="Ex: METAIS" value={formData.categoria} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
              <datalist id="categorias-materia-prima">
                {categoriasDB.map((cat, idx) => <option key={idx} value={cat} />)}
              </datalist>
            </div>
            <div className="input-group">
              <label>Unidade de Medida</label>
              <input type="text" name="unidade" placeholder="KG, L, UN, M..." value={formData.unidade} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Quantidade em Estoque</label>
              <input type="number" name="quantidade" step="any" min="0" value={formData.quantidade} onChange={handleChange} style={inputStyle} />
            </div>
            <div className="input-group">
              <label>Estoque Mínimo</label>
              <input type="number" name="estoqueMinimo" step="any" min="0" value={formData.estoqueMinimo} onChange={handleChange} style={inputStyle} />
            </div>
            <div className="input-group">
              <label>Custo Unitário (R$)</label>
              <input type="number" name="precoCusto" step="0.01" min="0" value={formData.precoCusto} onChange={handleChange} style={inputStyle} />
            </div>
          </div>

          <div className="input-group">
            <label>Fornecedor (texto livre)</label>
            <input type="text" name="fornecedor" placeholder="Ex: METALÚRGICA SUL LTDA" value={formData.fornecedor} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Lote</label>
              <input type="text" name="lote" placeholder="Ex: L2026-08" value={formData.lote} onChange={handleChange} style={inputStyle} />
            </div>
            <div className="input-group">
              <label>Validade</label>
              <input type="date" name="validade" value={formData.validade} onChange={handleChange} style={inputStyle} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MateriaPrimaForm;
