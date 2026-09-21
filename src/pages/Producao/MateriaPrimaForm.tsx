import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Factory, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { getProximoCodigoMateriaPrima } from '../../utils/materiaPrimaCodigo';
import { useReservedRawMaterialStock } from '../../hooks/useReservedRawMaterialStock';
import { chaveComponente, computeEstoquePrevisto } from '../../utils/producaoDomain';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import CampoComSugestoes from '../../components/common/CampoComSugestoes';

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
    marca: '',
    referencia: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  /** Cadastro inativo abre so' pra consulta -- ver o aviso na tela. */
  const [inativo, setInativo] = useState(false);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const [marcasDB, setMarcasDB] = useState<string[]>([]);
  const [unidadesDB, setUnidadesDB] = useState<string[]>([]);
  const [fornecedoresDB, setFornecedoresDB] = useState<string[]>([]);
  // Decoupled de isFetching (que so controla o spinner de tela cheia, e
  // no modo "novo" ja comeca `false` mesmo com uma busca assincrona em
  // andamento pro codigo automatico) -- marca quando o carregamento
  // inicial de verdade terminou, pra so entao capturar o snapshot que
  // decide se a aba esta "suja".
  const [formReady, setFormReady] = useState(false);
  const initialSnapshotRef = useRef<string | null>(null);
  const { currentUser, tenantId } = useAuth();
  const { reservedMap } = useReservedRawMaterialStock(tenantId);
  const reservado = isEditing && id ? (reservedMap.get(chaveComponente('materia_prima', id)) || 0) : 0;
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

        // Try proprio: marca e' so' sugestao do campo. Ver o comentario em
        // EstoqueForm.tsx -- esta mesma consulta derrubou o cadastro inteiro
        // em producao quando a colecao `marcas` ainda nao tinha permissao.
        try {
          const qMarca = query(collection(db, 'marcas'), where('tenantId', '==', tenantId));
          const snapMarca = await getDocs(qMarca);
          setMarcasDB(snapMarca.docs.map(d => d.data().nome).filter(Boolean));
        } catch (marcaError) {
          console.error('Erro ao carregar as marcas (sugestão do campo Marca):', marcaError);
          setMarcasDB([]);
        }

        // Unidades e fornecedores tambem sao so' sugestao: cada consulta no
        // seu try, pra uma falha nao derrubar o formulario.
        try {
          const snapUni = await getDocs(query(collection(db, 'unidades_medida'), where('tenantId', '==', tenantId)));
          setUnidadesDB(snapUni.docs.filter(d => d.data().ativo !== false).map(d => d.data().sigla).filter(Boolean));
        } catch (unidadeError) {
          console.error('Erro ao carregar as unidades (sugestão do campo Unidade):', unidadeError);
          setUnidadesDB([]);
        }
        try {
          const snapForn = await getDocs(query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId)));
          setFornecedoresDB(snapForn.docs.filter(d => d.data().ativo !== false).map(d => d.data().nome).filter(Boolean));
        } catch (fornecedorError) {
          console.error('Erro ao carregar os fornecedores (sugestão do campo Fornecedor):', fornecedorError);
          setFornecedoresDB([]);
        }

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'materias_primas', id));
          if (docSnap.exists()) {
            const data = docSnap.data() as any;
            setInativo(data.ativo === false);
            setFormData(prev => ({
              ...prev,
              ...data,
              quantidade: String(data.quantidade ?? 0),
              estoqueMinimo: String(data.estoqueMinimo ?? 0),
              precoCusto: String(data.precoCusto ?? 0),
            }));
          }
        } else if (tenantId) {
          const proximoCodigo = await getProximoCodigoMateriaPrima(tenantId);
          setFormData(prev => ({ ...prev, codigo: proximoCodigo }));
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
    // CADASTRO INATIVO NAO SE ALTERA. Inativo e' item fora de uso -- mexer
    // nele (principalmente no saldo) sem reativar abre um caminho paralelo
    // pra mudar estoque que ninguem ve. Os campos ja' ficam travados na
    // tela; esta checagem cobre o "Salvar e fechar" da aba.
    if (inativo) {
      showError('Matéria-prima inativa', 'Esta matéria-prima está inativa e não pode ser alterada. Para alterar, reative-a na lista de Matéria-Prima.');
      return false;
    }
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
        marca: formData.marca.toUpperCase().trim(),
        referencia: formData.referencia.toUpperCase().trim(),
        tenantId
      };

      if (isEditing && id) {
        // Na edicao o saldo NAO vai no payload: ele so' muda por producao,
        // nota de entrada ou Ajuste de Estoque. Mandar o valor lido ao abrir a
        // tela sobrescreveria uma producao feita enquanto ela estava aberta.
        const { quantidade: _saldo, ...dataToSaveSemSaldo } = dataToSave;
        await updateDoc(doc(db, 'materias_primas', id), {
          ...dataToSaveSemSaldo,
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
          disabled={isLoading || inativo}
          title={inativo ? 'Matéria-prima inativa: reative-a na lista para alterar' : undefined}
          style={{ opacity: (isLoading || inativo) ? 0.5 : 1, display: 'flex', alignItems: 'center' }}
        >
          {isLoading ? (
            <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} />
          ) : (
            <Save size={18} style={{ marginRight: 8 }} />
          )}
          {isLoading ? 'Salvando...' : 'Salvar Matéria-Prima'}
        </button>
      </div>

      {inativo && (
        <div style={{ maxWidth: '800px', padding: '14px 18px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', color: 'var(--text-primary)', fontSize: '14px' }}>
          <strong style={{ color: '#f59e0b' }}>Matéria-prima inativa — somente consulta.</strong>{' '}
          Para alterar qualquer dado, reative-a na lista de Matéria-Prima (botão de ativar da linha).
        </div>
      )}

      {/* fieldset desabilita todos os campos de uma vez quando inativo */}
      <fieldset disabled={inativo} style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
              <input type="text" name="codigo" value={formData.codigo} readOnly required style={inputStyle} />
              <span className="field-hint">Gerado automaticamente pelo sistema a cada nova matéria-prima. Não pode ser alterado manualmente.</span>
            </div>
            <div className="input-group">
              <label>Nome *</label>
              <input type="text" name="nome" placeholder="Ex: CHAPA DE AÇO 2MM" value={formData.nome} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Categoria</label>
              <CampoComSugestoes type="text" name="categoria" opcoes={categoriasDB} placeholder="Ex: METAIS" value={formData.categoria} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
            </div>
            <div className="input-group">
              <label>Unidade de Medida</label>
              <CampoComSugestoes type="text" name="unidade" opcoes={unidadesDB} placeholder="KG, L, UN, M..." value={formData.unidade} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Marca</label>
              <CampoComSugestoes type="text" name="marca" opcoes={marcasDB} placeholder="Ex: SOLNATUS" value={formData.marca} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
            </div>
            <div className="input-group">
              <label>Referência</label>
              <input type="text" name="referencia" placeholder="Referência do sistema antigo (opcional)" value={formData.referencia} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Quantidade em Estoque</label>
              <input type="number" name="quantidade" step="any" min="0" value={formData.quantidade} onChange={handleChange} style={inputStyle} disabled={isEditing} />
              {isEditing && (
                <span className="field-hint">
                  O saldo muda por produção, nota de entrada ou pelo{' '}
                  <button type="button" className="link-button" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary, #3b82f6)', textDecoration: 'underline' }} onClick={() => navigate(`/estoque/ajuste?produtoId=${id}`)}>
                    Ajuste de Estoque
                  </button>.
                </span>
              )}
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
            <label>Fornecedor</label>
            <CampoComSugestoes type="text" name="fornecedor" opcoes={fornecedoresDB} placeholder="Ex: METALÚRGICA SUL LTDA" value={formData.fornecedor} onChange={handleChange} style={{ ...inputStyle, textTransform: 'uppercase' }} />
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
      </fieldset>
    </div>
  );
};

export default MateriaPrimaForm;
