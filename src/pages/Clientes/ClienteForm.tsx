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
import { erroDoDescontoPadraoCliente, parseDescontoPadraoCliente } from '../../utils/descontoDomain';
import { spedyService, type SpedyCity } from '../../services/spedyService';
import AvisoCadastroInativo from '../../components/common/AvisoCadastroInativo';

const ClienteForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    fantasia: '',
    telefone: '',
    celular: '',
    email: '',
    emailNfe: '',
    documento: '',
    // Inscricao Estadual (pessoa juridica) ou RG (pessoa fisica) -- mesmo
    // campo unico do cadastro antigo migrado na importacao em massa
    // (Sol Natus, 2026-09-14). Nao valida formato: IE varia por estado.
    identidade: '',
    endereco: '',
    bairro: '',
    numero: '',
    cep: '',
    cidade: '',
    estado: '',
    codigoIbge: '',
    referencia: '',
    // Endereco de cobranca e de entrega: so existem quando diferem do
    // principal (boa parte dos clientes importados nao tem os dois --
    // campo em branco significa "usa o principal mesmo").
    enderecoCobranca: '',
    numeroCobranca: '',
    bairroCobranca: '',
    cidadeCobranca: '',
    estadoCobranca: '',
    cepCobranca: '',
    enderecoEntrega: '',
    numeroEntrega: '',
    bairroEntrega: '',
    cidadeEntrega: '',
    estadoEntrega: '',
    cepEntrega: '',
    referenciaEntrega: '',
    limiteDeCredito: '',
    /** Desconto que este cliente ja tem direito, em %. Ver descontoDomain. */
    descontoPadraoPercentual: '',
  });

  // Dado historico da importacao (data da ultima compra no sistema
  // anterior) -- so leitura, nunca editado aqui. Guardado fora do
  // formData porque nao faz parte do que o Salvar grava de volta.
  const [dtUltimaCompraSistemaAntigo, setDtUltimaCompraSistemaAntigo] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  /** Cliente que ja' estava inativo ao abrir: so' consulta (firestore.rules). */
  const [inativo, setInativo] = useState(false);
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

  const [isCepCobrancaSearching, setIsCepCobrancaSearching] = useState(false);
  const [cepCobrancaSearchError, setCepCobrancaSearchError] = useState('');
  const [isCepEntregaSearching, setIsCepEntregaSearching] = useState(false);
  const [cepEntregaSearchError, setCepEntregaSearchError] = useState('');

  // Mesma busca do endereco principal (buscarEnderecoPorCep), generalizada
  // pros dois enderecos extras -- cobranca e entrega nao mandam codigo
  // IBGE pra nenhum lugar hoje (so o endereco PRINCIPAL vai na NF-e), entao
  // nao precisa resolver/guardar IBGE aqui.
  const buscarEnderecoGenerico = async (
    cepValor: string,
    aplicar: (dados: { endereco: string; bairro: string; cidade: string; estado: string }) => void,
    setBuscando: (valor: boolean) => void,
    setErro: (valor: string) => void,
  ) => {
    const cepLimpo = cepValor.replace(/\D/g, '');
    if (cepLimpo.length !== 8) {
      if (cepLimpo.length > 0) setErro('CEP precisa ter 8 dígitos.');
      return;
    }
    setBuscando(true);
    setErro('');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await response.json();
      if (data.erro) {
        setErro('CEP não encontrado. Confira o número ou preencha o endereço manualmente.');
        return;
      }
      aplicar({ endereco: data.logradouro || '', bairro: data.bairro || '', cidade: data.localidade || '', estado: data.uf || '' });
    } catch (error) {
      console.error('Erro ao buscar CEP:', error);
      setErro('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
    } finally {
      setBuscando(false);
    }
  };

  const buscarEnderecoCobrancaPorCep = () => buscarEnderecoGenerico(
    formData.cepCobranca,
    (d) => setFormData((prev) => ({
      ...prev,
      enderecoCobranca: d.endereco || prev.enderecoCobranca,
      bairroCobranca: d.bairro || prev.bairroCobranca,
      cidadeCobranca: d.cidade || prev.cidadeCobranca,
      estadoCobranca: d.estado || prev.estadoCobranca,
    })),
    setIsCepCobrancaSearching,
    setCepCobrancaSearchError,
  );

  const buscarEnderecoEntregaPorCep = () => buscarEnderecoGenerico(
    formData.cepEntrega,
    (d) => setFormData((prev) => ({
      ...prev,
      enderecoEntrega: d.endereco || prev.enderecoEntrega,
      bairroEntrega: d.bairro || prev.bairroEntrega,
      cidadeEntrega: d.cidade || prev.cidadeEntrega,
      estadoEntrega: d.estado || prev.estadoEntrega,
    })),
    setIsCepEntregaSearching,
    setCepEntregaSearchError,
  );

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
              descontoPadraoPercentual: Number(data.descontoPadraoPercentual) > 0
                ? String(data.descontoPadraoPercentual)
                : '',
              limiteDeCredito: data.limiteDeCredito === null || data.limiteDeCredito === undefined
                ? ''
                : String(data.limiteDeCredito),
            }));
            setDtUltimaCompraSistemaAntigo(data.dtUltimaCompraSistemaAntigo || '');
            setInativo(data.ativo === false);
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
    if (inativo) {
      showError('Cliente inativo', 'Este cliente está inativo e não pode ser alterado. Para alterar, reative-o na lista de Clientes.');
      return;
    }
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

      const erroDesconto = erroDoDescontoPadraoCliente(formData.descontoPadraoPercentual);
      if (erroDesconto) {
        showError('Desconto padrão inválido', erroDesconto);
        setIsLoading(false);
        return;
      }

      const limiteDeCreditoParsed = formData.limiteDeCredito.trim() === ''
        ? null
        : Number(formData.limiteDeCredito);

      const dataToSave = {
        ...formData,
        nome: formData.nome.toUpperCase().trim(),
        limiteDeCredito: Number.isFinite(limiteDeCreditoParsed) ? limiteDeCreditoParsed : null,
        // Numero, nao texto: e' assim que a venda le. Campo em branco vira 0
        // (== sem desconto proprio), nunca undefined (regra 3 do CLAUDE.md).
        descontoPadraoPercentual: parseDescontoPadraoCliente(formData.descontoPadraoPercentual),
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
          disabled={isLoading || inativo}
          title={inativo ? 'Cliente inativo: reative-o na lista para alterar' : undefined}
          style={{ opacity: (isLoading || inativo) ? 0.5 : 1, display: 'flex', alignItems: 'center' }}
        >
          {isLoading ? (
            <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} />
          ) : (
            <Save size={18} style={{ marginRight: 8 }} />
          )}
          {isLoading ? 'Salvando...' : 'Salvar Cliente'}
        </button>
      </div>

      {inativo && <AvisoCadastroInativo tipo="Cliente" lista="Clientes" />}

      {/* fieldset: com o cliente inativo, trava todos os campos de uma vez. */}
      <fieldset disabled={inativo} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <User size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados Pessoais</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
            <div className="input-group">
              <label>Código do Cliente *</label>
              <input type="text" name="codigo" value={formData.codigo} readOnly required style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
              <span className="field-hint">Gerado automaticamente pelo sistema a cada novo cliente. Não pode ser alterado manualmente.</span>
            </div>
            <div className="input-group">
              <label>Nome Completo *</label>
              <input type="text" name="nome" placeholder="Ex: JOÃO DA SILVA" value={formData.nome} onChange={handleChange} style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Nome Fantasia</label>
              <input type="text" name="fantasia" placeholder="Ex: MERCEARIA DO JOÃO" value={formData.fantasia} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Inscrição Estadual / RG</label>
              <input type="text" name="identidade" placeholder="Isento, se não houver" value={formData.identidade} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '20px', alignItems: 'start' }}>
            <div className="input-group">
              <label>Telefone Fixo</label>
              <input type="text" name="telefone" placeholder="(00) 0000-0000" value={formData.telefone} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Celular / WhatsApp</label>
              <input type="text" name="celular" placeholder="(00) 00000-0000" value={formData.celular} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '20px', alignItems: 'start' }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>E-mail</label>
              <input type="email" name="email" placeholder="joao@email.com" value={formData.email} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>E-mail para Nota Fiscal</label>
              <input type="email" name="emailNfe" placeholder="Deixe em branco pra usar o e-mail acima" value={formData.emailNfe} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          {dtUltimaCompraSistemaAntigo && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              Última compra no sistema anterior: {dtUltimaCompraSistemaAntigo}
            </p>
          )}

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

          <div className="input-group">
            <label>Ponto de Referência</label>
            <input type="text" name="referencia" placeholder="Ex: Próximo à praça" value={formData.referencia} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginTop: '12px' }}>
            <MapPin size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Endereço de Cobrança</h3>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '-12px 0 0' }}>Só preencha se for diferente do endereço acima.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', alignItems: 'start' }}>
            <div className="input-group">
              <label>CEP</label>
              <input type="text" name="cepCobranca" placeholder="36900-000" value={formData.cepCobranca} onChange={handleChange} onBlur={buscarEnderecoCobrancaPorCep} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
              {isCepCobrancaSearching && <small style={{ color: 'var(--text-muted)' }}>Buscando endereço...</small>}
              {!isCepCobrancaSearching && cepCobrancaSearchError && <small style={{ color: '#ef4444' }}>{cepCobrancaSearchError}</small>}
            </div>
            <div className="input-group">
              <label>Rua / Logradouro</label>
              <input type="text" name="enderecoCobranca" placeholder="Av. Central" value={formData.enderecoCobranca} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Número</label>
              <input type="text" name="numeroCobranca" placeholder="123" value={formData.numeroCobranca} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Bairro</label>
              <input type="text" name="bairroCobranca" placeholder="Centro" value={formData.bairroCobranca} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Cidade / UF</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" name="cidadeCobranca" placeholder="Cidade" value={formData.cidadeCobranca} onChange={handleChange} style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
                <input type="text" name="estadoCobranca" placeholder="UF" maxLength={2} value={formData.estadoCobranca} onChange={handleChange} style={{ width: '64px', textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginTop: '12px' }}>
            <MapPin size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Endereço de Entrega</h3>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '-12px 0 0' }}>Só preencha se for diferente do endereço acima. Usado na Minuta de Entrega.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', alignItems: 'start' }}>
            <div className="input-group">
              <label>CEP</label>
              <input type="text" name="cepEntrega" placeholder="36900-000" value={formData.cepEntrega} onChange={handleChange} onBlur={buscarEnderecoEntregaPorCep} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
              {isCepEntregaSearching && <small style={{ color: 'var(--text-muted)' }}>Buscando endereço...</small>}
              {!isCepEntregaSearching && cepEntregaSearchError && <small style={{ color: '#ef4444' }}>{cepEntregaSearchError}</small>}
            </div>
            <div className="input-group">
              <label>Rua / Logradouro</label>
              <input type="text" name="enderecoEntrega" placeholder="Av. Central" value={formData.enderecoEntrega} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Número</label>
              <input type="text" name="numeroEntrega" placeholder="123" value={formData.numeroEntrega} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Bairro</label>
              <input type="text" name="bairroEntrega" placeholder="Centro" value={formData.bairroEntrega} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Cidade / UF</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" name="cidadeEntrega" placeholder="Cidade" value={formData.cidadeEntrega} onChange={handleChange} style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
                <input type="text" name="estadoEntrega" placeholder="UF" maxLength={2} value={formData.estadoEntrega} onChange={handleChange} style={{ width: '64px', textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>
          <div className="input-group">
            <label>Ponto de Referência (Entrega)</label>
            <input type="text" name="referenciaEntrega" placeholder="Ex: Portão azul, fundos do mercado" value={formData.referenciaEntrega} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginTop: '12px' }}>
            <CreditCard size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Financeiro</h3>
          </div>

          <div className="input-group">
            <label>Desconto padrão deste cliente (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              name="descontoPadraoPercentual"
              placeholder="0"
              value={formData.descontoPadraoPercentual}
              onChange={handleChange}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)', width: '100%' }}
            />
            <small style={{ color: 'var(--text-muted)' }}>
              Preenchido aqui, o desconto <strong>já vem aplicado</strong> na venda, na OS e no orçamento deste cliente, sem
              pedir senha — é uma autorização sua, dada no cadastro. Acima desse percentual, valem os limites de desconto de
              Configurações. O desconto máximo do <strong>produto</strong> continua mandando. Deixe em branco se este cliente
              não tem desconto fixo.
            </small>
          </div>

          <div className="input-group">
            <label>Limite de Crédito (R$)</label>
            <input type="number" min="0" step="0.01" name="limiteDeCredito" placeholder="0,00" value={formData.limiteDeCredito} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            <small style={{ color: 'var(--text-muted)' }}>Só é exigido se o sistema estiver configurado pra trabalhar com limite de crédito (Configurações). Deixe em branco pra não permitir venda a prazo a este cliente.</small>
          </div>

        </div>
      </div>
      </fieldset>
    </div>
  );
};

export default ClienteForm;
