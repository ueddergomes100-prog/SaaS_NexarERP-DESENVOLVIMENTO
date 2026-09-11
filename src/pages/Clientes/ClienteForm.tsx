import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, User, Loader2, MapPin, CreditCard, CheckCircle } from 'lucide-react';
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { getProximoCodigoCliente } from '../../utils/clienteCodigo';
import { mensagemDocumentoInvalido } from '../../utils/documentoValidacao';
import { buscarClienteDuplicadoPorDocumento } from '../../utils/clienteDuplicadoCheck';
import BuscarDocumentoButton from '../../components/common/BuscarDocumentoButton';
import type { ConsultaCnpjResultado, ConsultaCpfResultado } from '../../services/documentoService';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { spedyService, type SpedyCity } from '../../services/spedyService';

const ClienteForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    telefone: '',
    email: '',
    documento: '',
    endereco: '',
    bairro: '',
    numero: '',
    cep: '',
    cidade: '',
    estado: '',
    codigoIbge: '',
    limiteDeCredito: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const { currentUser, tenantId } = useAuth();

  // Busca ao vivo de cidades pra pegar o codigo IBGE -- mesmo mecanismo de
  // Configuracoes.tsx (cidade da empresa), reaproveitado aqui porque a
  // NF-e de produto manda o endereco do CLIENTE completo na XML (ver
  // fiscalDomain.ts/NFE.tsx), e sem codigo IBGE a Spedy rejeita a nota
  // (SPD003) -- antes deste campo, nao existia como o usuario preencher
  // isso no cadastro de cliente.
  const [cidadeSearchTerm, setCidadeSearchTerm] = useState('');
  const [cidadeSearchResults, setCidadeSearchResults] = useState<SpedyCity[]>([]);
  const [isCidadeSearching, setIsCidadeSearching] = useState(false);
  const [showCidadeDropdown, setShowCidadeDropdown] = useState(false);

  useEffect(() => {
    if (cidadeSearchTerm.trim().length < 3) {
      setCidadeSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsCidadeSearching(true);
      try {
        const result = await spedyService.searchServiceInvoiceCities('', 'sandbox', cidadeSearchTerm.trim());
        setCidadeSearchResults(result.items || []);
      } catch (error) {
        console.error('Erro ao buscar cidades:', error);
        setCidadeSearchResults([]);
      } finally {
        setIsCidadeSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [cidadeSearchTerm]);

  const handleSelectCidade = (cidade: SpedyCity) => {
    setFormData(prev => ({
      ...prev,
      cidade: cidade.name || prev.cidade,
      estado: cidade.state || prev.estado,
      codigoIbge: cidade.code || '',
    }));
    setCidadeSearchTerm('');
    setCidadeSearchResults([]);
    setShowCidadeDropdown(false);
  };

  const [isCepSearching, setIsCepSearching] = useState(false);
  const [cepSearchError, setCepSearchError] = useState('');

  // Busca o endereco completo pelo CEP (ViaCEP -- publico, sem chave, e ja
  // devolve o codigo IBGE da cidade direto, sem depender da Spedy estar
  // configurada). Preenche rua/bairro/cidade/estado/codigoIbge de uma vez
  // -- numero continua manual, o CEP nao sabe o numero da casa.
  const buscarEnderecoPorCep = async () => {
    const cepLimpo = formData.cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) {
      if (cepLimpo.length > 0) setCepSearchError('CEP precisa ter 8 dígitos.');
      return;
    }
    setIsCepSearching(true);
    setCepSearchError('');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await response.json();
      if (data.erro) {
        setCepSearchError('CEP não encontrado. Confira o número ou preencha o endereço manualmente.');
        return;
      }
      setFormData(prev => ({
        ...prev,
        endereco: data.logradouro || prev.endereco,
        bairro: data.bairro || prev.bairro,
        cidade: data.localidade || prev.cidade,
        estado: data.uf || prev.estado,
        codigoIbge: data.ibge || prev.codigoIbge,
      }));
      setCidadeSearchTerm('');
    } catch (error) {
      console.error('Erro ao buscar CEP:', error);
      setCepSearchError('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
    } finally {
      setIsCepSearching(false);
    }
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!tenantId) return;
      try {
        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'clientes', id));
          if (docSnap.exists()) {
            const data = docSnap.data() as any;
            if (data.isPadrao) {
              showError('Bloqueado', 'O Consumidor Final é um padrão do sistema e não pode ser editado.');
              navigate('/clientes');
              return;
            }
            setFormData(prev => ({
              ...prev,
              ...data,
              // limiteDeCredito grava null no Firestore quando fica em branco
              // (ver handleSave) -- o input e' controlado como texto, entao
              // precisa voltar pra string aqui, senao o .trim() do proximo
              // save quebra em cima de null.
              limiteDeCredito: data.limiteDeCredito === null || data.limiteDeCredito === undefined
                ? ''
                : String(data.limiteDeCredito),
            }));
          }
        } else {
          const proximoCodigo = await getProximoCodigoCliente(tenantId);
          setFormData(prev => ({ ...prev, codigo: proximoCodigo }));
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, tenantId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name } = e.target;
    // Caixa alta na digitacao: o que se ve e o que se grava.
    // textarea, select, e-mail, senha e chave ficam de fora --
    // ver aplicarCaixaAltaCadastro.
    const value = aplicarCaixaAltaCadastro(e.target, e.target.value);
    
    // Validação específica para CPF/CNPJ (apenas números)
    if (name === 'documento') {
      const onlyNums = value.replace(/\D/g, '');
      if (onlyNums.length <= 14) {
        setFormData({ ...formData, [name]: onlyNums });
      }
      return;
    }

    setFormData({ ...formData, [name]: value });
  };

  const preencherDeCnpj = (dados: ConsultaCnpjResultado) => {
    setFormData((prev) => ({
      ...prev,
      nome: (dados.razaoSocial || prev.nome).toUpperCase(),
      endereco: dados.logradouro || prev.endereco,
      numero: dados.numero || prev.numero,
      bairro: dados.bairro || prev.bairro,
      cidade: dados.municipio || prev.cidade,
      estado: dados.uf || prev.estado,
      telefone: prev.telefone || dados.telefone || prev.telefone,
      email: prev.email || dados.email || prev.email,
    }));
  };

  const preencherDeCpf = (dados: ConsultaCpfResultado) => {
    setFormData((prev) => ({ ...prev, nome: (dados.nome || prev.nome).toUpperCase() }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome) {
      showError('Campos incompletos', 'Por favor, preencha o Nome do Cliente.');
      return;
    }

    const erroDocumento = mensagemDocumentoInvalido(formData.documento);
    if (erroDocumento) {
      showError('Documento Inválido', erroDocumento);
      return;
    }

    if (!currentUser || !tenantId) return;
    setIsLoading(true);

    try {
      if (formData.documento) {
        const duplicado = await buscarClienteDuplicadoPorDocumento(tenantId, formData.documento, isEditing ? id : undefined);
        if (duplicado) {
          showError('CPF/CNPJ já cadastrado', `Este documento já está cadastrado para o cliente "${duplicado.nome}". Edite o cadastro existente em vez de criar um novo, ou corrija o número digitado.`);
          setIsLoading(false);
          return;
        }
      }

      const limiteDeCreditoParsed = formData.limiteDeCredito.trim() === ''
        ? null
        : Number(formData.limiteDeCredito);

      const dataToSave = {
        ...formData,
        nome: formData.nome.toUpperCase().trim(),
        limiteDeCredito: Number.isFinite(limiteDeCreditoParsed) ? limiteDeCreditoParsed : null,
        tenantId
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'clientes', id), {
          ...dataToSave,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Cliente atualizado!');
      } else {
        await addDoc(collection(db, 'clientes'), {
          ...dataToSave,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Cliente cadastrado!');
      }
      navigate('/clientes');
    } catch (error) {
      console.error('Erro ao salvar cliente:', error);
      showError('Erro ao salvar', 'Verifique sua conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/clientes')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Cliente' : 'Novo Cliente'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Cadastre um novo cliente no sistema</p>
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
          {isLoading ? 'Salvando...' : 'Salvar Cliente'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <User size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados Pessoais</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
            <div className="input-group">
              <label>Código do Cliente *</label>
              <input type="text" name="codigo" value={formData.codigo} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Nome Completo *</label>
              <input type="text" name="nome" placeholder="Ex: JOÃO DA SILVA" value={formData.nome} onChange={handleChange} style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '20px', alignItems: 'start' }}>
            <div className="input-group">
              <label>Telefone / WhatsApp</label>
              <input type="text" name="telefone" placeholder="(00) 00000-0000" value={formData.telefone} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>CPF / CNPJ (Apenas números)</label>
              <input type="text" name="documento" placeholder="00000000000" value={formData.documento} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
              {formData.documento.length >= 11 && (
                mensagemDocumentoInvalido(formData.documento)
                  ? <small style={{ color: '#ef4444' }}>{mensagemDocumentoInvalido(formData.documento)}</small>
                  : <small style={{ color: '#10b981' }}>Dígitos verificadores válidos.</small>
              )}
            </div>
            <BuscarDocumentoButton documento={formData.documento} onEncontrarCnpj={preencherDeCnpj} onEncontrarCpf={preencherDeCpf} />
          </div>

          <div className="input-group">
            <label>E-mail</label>
            <input type="email" name="email" placeholder="joao@email.com" value={formData.email} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginTop: '12px' }}>
            <MapPin size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Endereço</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', alignItems: 'start' }}>
            <div className="input-group">
              <label>CEP</label>
              <input
                type="text"
                name="cep"
                placeholder="36900-000"
                value={formData.cep}
                onChange={handleChange}
                onBlur={buscarEnderecoPorCep}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
              {isCepSearching && <small style={{ color: 'var(--text-muted)' }}>Buscando endereço...</small>}
              {!isCepSearching && cepSearchError && <small style={{ color: '#ef4444' }}>{cepSearchError}</small>}
              {!isCepSearching && !cepSearchError && <small style={{ color: 'var(--text-muted)' }}>Digite o CEP e saia do campo pra preencher o endereço automaticamente.</small>}
            </div>
            <div className="input-group">
              <label>Rua / Logradouro</label>
              <input type="text" name="endereco" placeholder="Av. Central" value={formData.endereco} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Número</label>
              <input type="text" name="numero" placeholder="123" value={formData.numero} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Bairro</label>
              <input type="text" name="bairro" placeholder="Centro" value={formData.bairro} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div className="input-group" style={{ position: 'relative' }}>
            <label>Cidade</label>
            {formData.cidade && formData.codigoIbge && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                <CheckCircle size={16} style={{ color: '#10b981' }} />
                {formData.cidade} / {formData.estado} (IBGE {formData.codigoIbge})
              </div>
            )}
            <input
              type="text"
              placeholder="Digite o nome da cidade pra buscar (ex: Manhuaçu)"
              value={cidadeSearchTerm || formData.cidade}
              onChange={(e) => { setCidadeSearchTerm(e.target.value); setFormData(prev => ({ ...prev, codigoIbge: '' })); setShowCidadeDropdown(true); }}
              onFocus={(e) => { e.target.select(); setShowCidadeDropdown(true); }}
              onBlur={() => setTimeout(() => setShowCidadeDropdown(false), 150)}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
            />
            {isCidadeSearching && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Buscando...</p>}
            {showCidadeDropdown && cidadeSearchResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
                {cidadeSearchResults.map((cidade, index) => (
                  <button
                    key={`${cidade.code}-${index}`}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectCidade(cidade); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px' }}
                  >
                    {cidade.name} / {cidade.state}
                  </button>
                ))}
              </div>
            )}
            <small style={{ color: 'var(--text-muted)' }}>Já vem preenchida ao buscar o CEP acima. Use esta busca só se não tiver o CEP em mãos -- necessária com código IBGE pra emitir NF-e de produto pra este cliente.</small>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginTop: '12px' }}>
            <CreditCard size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Financeiro</h3>
          </div>

          <div className="input-group">
            <label>Limite de Crédito (R$)</label>
            <input type="number" min="0" step="0.01" name="limiteDeCredito" placeholder="0,00" value={formData.limiteDeCredito} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            <small style={{ color: 'var(--text-muted)' }}>Só é exigido se o sistema estiver configurado pra trabalhar com limite de crédito (Configurações). Deixe em branco pra não permitir venda a prazo a este cliente.</small>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ClienteForm;
