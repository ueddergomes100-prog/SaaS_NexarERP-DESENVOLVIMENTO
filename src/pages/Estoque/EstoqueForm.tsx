import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Package, DollarSign, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import './Estoque.css';

interface UnidadeMedida {
  id: string;
  sigla: string;
  nome: string;
  casasDecimais: number;
  permiteFracionado: boolean;
}

const EstoqueForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const [activeTab, setActiveTab] = useState<'geral' | 'precos' | 'estoque' | 'fiscal'>('geral');

  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    categoria: '',
    quantidade: '',
    estoqueMinimo: '',
    precoCusto: '',
    precoVenda: '',
    fornecedor: '',
    unidadeMedidaId: 'un',
    codigoBarras: '',
    ncm: '',
    cfop: '5102',
    csosn: '400',
    origem: '0'
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const [unidadesDB, setUnidadesDB] = useState<UnidadeMedida[]>([]);
  const { currentUser, tenantId } = useAuth();

  const fallbackUnidades: UnidadeMedida[] = [
    { id: 'un', sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false },
    { id: 'kg', sigla: 'KG', nome: 'QUILOGRAMA', casasDecimais: 3, permiteFracionado: true },
    { id: 'lts', sigla: 'LTS', nome: 'LITRO', casasDecimais: 2, permiteFracionado: true },
    { id: 'mt', sigla: 'MT', nome: 'METRO', casasDecimais: 2, permiteFracionado: true }
  ];

  const activeUnidades = unidadesDB.length > 0 ? unidadesDB : fallbackUnidades;

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        if (!currentUser) return;

        // Fetch Categorias
        const qCat = query(collection(db, 'categorias'), where('tenantId', '==', tenantId));
        const snapCat = await getDocs(qCat);
        const cats: string[] = [];
        snapCat.forEach(d => {
          if (d.data().tipo === 'Peça') cats.push(d.data().nome);
        });
        setCategoriasDB(cats);

        // Fetch Unidades
        const qUni = query(collection(db, 'unidades_medida'), where('tenantId', '==', tenantId));
        const snapUni = await getDocs(qUni);
        const unis: UnidadeMedida[] = [];
        snapUni.forEach(d => {
          const uData = d.data();
          unis.push({
            id: d.id,
            sigla: uData.sigla || '',
            nome: uData.nome || '',
            casasDecimais: Number(uData.casasDecimais || 0),
            permiteFracionado: Boolean(uData.permiteFracionado || false)
          });
        });
        setUnidadesDB(unis);

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'estoque', id));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              codigo: data.codigo || '',
              nome: data.nome || '',
              categoria: data.categoria || '',
              quantidade: String(data.quantidade || '0'),
              estoqueMinimo: String(data.estoqueMinimo || '0'),
              precoCusto: String(data.precoCusto || '0.00'),
              precoVenda: String(data.precoVenda || '0.00'),
              fornecedor: data.fornecedor || '',
              unidadeMedidaId: data.unidadeMedidaId || 'un',
              codigoBarras: data.codigoBarras || '',
              ncm: data.ncm || '',
              cfop: data.cfop || '5102',
              csosn: data.csosn || '400',
              origem: data.origem || '0'
            });
          }
        } else {
          // Gerar código sequencial para novo cadastro
          const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
          const snap = await getCountFromServer(q);
          const nextId = snap.data().count + 1;
          setFormData({
            codigo: String(nextId),
            nome: '',
            categoria: '',
            quantidade: '',
            estoqueMinimo: '',
            precoCusto: '',
            precoVenda: '',
            fornecedor: '',
            unidadeMedidaId: 'un',
            codigoBarras: '',
            ncm: '',
            cfop: '5102',
            csosn: '400',
            origem: '0'
          });
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, tenantId, currentUser]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome || !formData.codigo) {
      showError('Campos incompletos', 'Por favor, preencha o Código e o Nome da Peça.');
      return;
    }

    setIsLoading(true);

    try {
      const selectedUnit = activeUnidades.find(u => u.id === formData.unidadeMedidaId) || activeUnidades.find(u => u.sigla === 'UN') || activeUnidades[0];

      const pecaData = {
        ...formData,
        nome: formData.nome.toUpperCase().trim(),
        quantidade: Number(formData.quantidade) || 0,
        estoqueMinimo: Number(formData.estoqueMinimo) || 0,
        precoCusto: Number(formData.precoCusto) || 0,
        precoVenda: Number(formData.precoVenda) || 0,
        unidadeMedidaId: selectedUnit?.id || 'un',
        unidadeMedidaSigla: selectedUnit?.sigla || 'UN',
        unidadeMedidaCasasDecimais: selectedUnit ? Number(selectedUnit.casasDecimais) : 0,
        unidadeMedidaFracionado: selectedUnit ? Boolean(selectedUnit.permiteFracionado) : false
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'estoque', id), { ...pecaData, updatedAt: serverTimestamp() });
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId,
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'estoque',
            acao: 'edicao',
            descricao: `Peça ${pecaData.nome} editada. Quantidade: ${pecaData.quantidade} ${pecaData.unidadeMedidaSigla}. Preço de Venda: R$ ${pecaData.precoVenda.toFixed(2)}.`,
            registroRelacionadoId: id,
            status: 'sucesso'
          });
        } catch {
          // Ignorar erro de log de auditoria
        }
        showSuccess('Peça atualizada!');
      } else {
        if (!currentUser) return;
        const newDocRef = await addDoc(collection(db, 'estoque'), {
          ...pecaData,
          tenantId,
          createdAt: serverTimestamp()
        });
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId,
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'estoque',
            acao: 'criacao',
            descricao: `Peça ${pecaData.nome} cadastrada. Estoque Inicial: ${pecaData.quantidade} ${pecaData.unidadeMedidaSigla}. Preço de Venda: R$ ${pecaData.precoVenda.toFixed(2)}.`,
            registroRelacionadoId: newDocRef.id,
            status: 'sucesso'
          });
        } catch {
          // Ignorar erro de log de auditoria
        }
        showSuccess('Peça cadastrada!');
      }

      navigate('/estoque');
    } catch (error) {
      console.error('Erro ao salvar peça:', error);
      showError('Erro ao salvar', 'Erro ao salvar peça no estoque. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div className="estoque-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">Nova Peça</h1>
            <p className="page-subtitle">Cadastre um novo item no estoque</p>
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
          {isLoading ? 'Salvando...' : 'Salvar Peça'}
        </button>
      </div>

      {/* Abas Interativas */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', paddingBottom: '2px', flexWrap: 'wrap' }}>
        {(['geral', 'precos', 'estoque', 'fiscal'] as const).map((tab) => {
          const labels = {
            geral: 'Geral',
            precos: 'Preços e Custo',
            estoque: 'Estoque',
            fiscal: 'Fiscal (Tributação)'
          };
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none', border: 'none',
                padding: '10px 20px', cursor: 'pointer',
                color: activeTab === tab ? 'var(--accent-purple)' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '14px',
                borderBottom: activeTab === tab ? '3px solid var(--accent-purple)' : '3px solid transparent',
                transition: 'all 0.2s',
                marginBottom: '-3px'
              }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      <div className="form-container">
        {/* Aba Geral */}
        {activeTab === 'geral' && (
          <div className="card form-section" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="section-header">
              <Package size={20} className="section-icon" />
              <h3>Identificação da Peça</h3>
            </div>

            <div className="input-group">
              <label>Nome da Peça *</label>
              <input
                type="text"
                name="nome"
                placeholder="Ex: FILTRO DE ÓLEO"
                value={formData.nome}
                onChange={handleChange}
                required
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="grid-2-col">
              <div className="input-group">
                <label>Código / SKU *</label>
                <input
                  type="text"
                  name="codigo"
                  placeholder="Ex: FO-001"
                  value={formData.codigo}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="input-group">
                <label>Código de Barras (EAN)</label>
                <input
                  type="text"
                  name="codigoBarras"
                  placeholder="Ex: 7898011975539"
                  value={formData.codigoBarras}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="grid-2-col" style={{ marginTop: '16px' }}>
              <div className="input-group">
                <label>Categoria</label>
                <select
                  name="categoria"
                  value={formData.categoria}
                  onChange={handleChange}
                  className="form-select"
                >
                  <option value="">Selecione...</option>
                  {categoriasDB.map((cat, idx) => (
                    <option key={idx} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>Unidade de Medida</label>
                <select
                  name="unidadeMedidaId"
                  value={formData.unidadeMedidaId}
                  onChange={handleChange}
                  className="form-select"
                >
                  {activeUnidades.map((uni) => (
                    <option key={uni.id} value={uni.id}>{uni.sigla} - {uni.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="input-group" style={{ marginTop: '16px' }}>
              <label>Fornecedor (Opcional)</label>
              <input
                type="text"
                name="fornecedor"
                placeholder="Ex: Distribuidora XYZ"
                value={formData.fornecedor}
                onChange={handleChange}
              />
            </div>
          </div>
        )}

        {/* Aba Preços */}
        {activeTab === 'precos' && (
          <div className="card form-section" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="section-header">
              <DollarSign size={20} className="section-icon" />
              <h3>Valores de Compra e Venda</h3>
            </div>

            <div className="grid-2-col">
              <div className="input-group">
                <label>Preço de Custo (R$) *</label>
                <input
                  type="number"
                  name="precoCusto"
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  value={formData.precoCusto}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="input-group">
                <label>Preço de Venda (R$) *</label>
                <input
                  type="number"
                  name="precoVenda"
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  value={formData.precoVenda}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div style={{ padding: '16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <div>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>Margem de Lucro Bruto (Markup %):</span>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>Calculado automaticamente a partir do custo e venda</p>
              </div>
              <strong style={{ fontSize: '18px', color: (Number(formData.precoVenda) > Number(formData.precoCusto) && Number(formData.precoCusto) > 0) ? 'var(--status-green)' : 'var(--text-muted)' }}>
                {Number(formData.precoCusto) > 0
                  ? `${(((Number(formData.precoVenda) - Number(formData.precoCusto)) / Number(formData.precoCusto)) * 100).toFixed(1)}%`
                  : '0.0%'}
              </strong>
            </div>
          </div>
        )}

        {/* Aba Estoque */}
        {activeTab === 'estoque' && (
          <div className="card form-section" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="section-header">
              <Package size={20} className="section-icon" />
              <h3>Quantidade e Estoque de Segurança</h3>
            </div>

            <div className="grid-2-col">
              <div className="input-group">
                <label>Quantidade em Estoque</label>
                <input
                  type="number"
                  name="quantidade"
                  placeholder="0"
                  min="0"
                  value={formData.quantidade}
                  onChange={handleChange}
                  disabled={isEditing}
                  style={isEditing ? { backgroundColor: 'var(--bg-tertiary)', cursor: 'not-allowed', opacity: 0.7 } : {}}
                />
                {isEditing && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block', lineHeight: '1.4' }}>
                    O estoque de itens já cadastrados só pode ser alterado via Nota Fiscal de Entrada ou Movimentação Manual.
                  </span>
                )}
              </div>
              <div className="input-group">
                <label>Estoque Mínimo Ideal</label>
                <input
                  type="number"
                  name="estoqueMinimo"
                  placeholder="0"
                  min="0"
                  value={formData.estoqueMinimo}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>
        )}

        {/* Aba Fiscal */}
        {activeTab === 'fiscal' && (
          <div className="card form-section" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="section-header">
              <DollarSign size={20} className="section-icon" />
              <h3>Parâmetros Fiscais da Peça</h3>
            </div>

            <div className="grid-2-col">
              <div className="input-group">
                <label>NCM (Código Fiscal do Produto) *</label>
                <input
                  type="text"
                  name="ncm"
                  placeholder="Ex: 87082999"
                  value={formData.ncm}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="input-group">
                <label>CFOP Padrão (Saída) *</label>
                <input
                  type="text"
                  name="cfop"
                  placeholder="Ex: 5102"
                  value={formData.cfop}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="grid-2-col" style={{ marginTop: '16px' }}>
              <div className="input-group">
                <label>CSOSN (Simples Nacional) *</label>
                <input
                  type="text"
                  name="csosn"
                  placeholder="Ex: 400"
                  value={formData.csosn}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="input-group">
                <label>Origem da Mercadoria</label>
                <select
                  name="origem"
                  value={formData.origem}
                  onChange={handleChange}
                  className="form-select"
                >
                  <option value="0">0 - Nacional (Mercadoria de produção nacional)</option>
                  <option value="1">1 - Estrangeira (Importação direta)</option>
                  <option value="2">2 - Estrangeira (Adquirida no mercado interno)</option>
                  <option value="3">3 - Nacional (Importada, com processo produtivo nacional)</option>
                  <option value="4">4 - Nacional (Produção nacional com conteúdo importado &lt; 40%)</option>
                  <option value="5">5 - Nacional (Produção nacional com conteúdo importado &gt; 40%)</option>
                </select>
              </div>
            </div>

            <div style={{ padding: '16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginTop: '16px' }}>
              💡 <strong>Dica Fiscal:</strong> O NCM e o CFOP são obrigatórios para emissão de Notas Fiscais Eletrônicas (NF-e) e Cupons Fiscais (NFC-e) na Spedy. Em autopeças, é comum o uso do NCM 8708.29.99 e do CFOP 5102 para vendas normais.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EstoqueForm;
