import React, { useEffect, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { X, UserPlus } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError } from '../../utils/alerts';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { getProximoCodigoCliente } from '../../utils/clienteCodigo';
import { mensagemDocumentoInvalido } from '../../utils/documentoValidacao';
import { buscarClienteDuplicadoPorDocumento } from '../../utils/clienteDuplicadoCheck';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { createAuditLog } from '../../services/logService';
import { mascaraTelefone } from '../../utils/clienteCadastroMobileDomain';
import { apenasDigitos } from '../../utils/documentoValidacao';
import { camposDeNascimentoParaGravar, erroDaDataDeNascimento } from '../../utils/aniversarioClienteDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';

export interface ClienteCadastradoRapido {
  id: string;
  codigo: string;
  nome: string;
  telefone: string;
  documento: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
}

interface CadastroRapidoClienteModalProps {
  open: boolean;
  /** Pre-preenche o nome (ex: veio da tela de venda perguntando "deseja
   * cadastrar o cliente [NOME]?"). */
  nomeInicial?: string;
  onClose: () => void;
  onCriado: (cliente: ClienteCadastradoRapido) => void;
}

/**
 * Popup de cadastro rapido de cliente, aberto direto das telas de venda
 * (PDV, Pedido de Venda, OS, Orcamento) -- os campos essenciais pedidos pelo
 * usuario, no mesmo nome de campo do cadastro completo (endereco, numero,
 * bairro, cidade). Quem precisar de mais (limite de credito, e-mail...)
 * edita o cadastro completo depois em Clientes.
 *
 * 21/11/2026: apelido e data de nascimento (o sistema avisa no dia do
 * aniversario, ver aniversarioClienteDomain.ts) e o celular formatado
 * enquanto digita, "(33) 99847-6541", como no cadastro completo.
 */
const CadastroRapidoClienteModal: React.FC<CadastroRapidoClienteModalProps> = ({
  open,
  nomeInicial,
  onClose,
  onCriado,
}) => {
  const { currentUser, tenantId } = useAuth();
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [numero, setNumero] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [telefone, setTelefone] = useState('');
  const [documento, setDocumento] = useState('');
  const [apelido, setApelido] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(nomeInicial?.trim() || '');
    setEndereco('');
    setNumero('');
    setBairro('');
    setCidade('');
    setTelefone('');
    setDocumento('');
    setApelido('');
    setDataNascimento('');
  }, [open, nomeInicial]);

  if (!open) return null;

  const handleSalvar = async () => {
    const nomeLimpo = nome.toUpperCase().trim();
    if (!nomeLimpo) {
      showError('Campo obrigatório', 'Informe o nome do cliente.');
      return;
    }
    const digitosDoCelular = apenasDigitos(telefone);
    if (digitosDoCelular && digitosDoCelular.length < 10) {
      showError('Celular incompleto', 'O celular precisa do DDD e do número (10 ou 11 números). Complete ou deixe em branco.');
      return;
    }
    const erroNascimento = erroDaDataDeNascimento(dataNascimento, getDateInputInTimeZone());
    if (erroNascimento) {
      showError('Data de nascimento', erroNascimento);
      return;
    }
    const erroDocumento = mensagemDocumentoInvalido(documento);
    if (erroDocumento) {
      showError('Documento inválido', erroDocumento);
      return;
    }
    if (!currentUser || !tenantId) return;

    setIsSaving(true);
    try {
      if (documento) {
        const duplicado = await buscarClienteDuplicadoPorDocumento(tenantId, documento);
        if (duplicado) {
          showError('CPF/CNPJ já cadastrado', `Este documento já está cadastrado para o cliente "${duplicado.nome}". Busque o cliente existente em vez de cadastrar de novo.`);
          setIsSaving(false);
          return;
        }
      }
      const codigo = await getProximoCodigoCliente(tenantId);
      const novoClienteRef = await addDoc(collection(db, 'clientes'), {
        codigo,
        nome: nomeLimpo,
        apelido: apelido.toUpperCase().trim(),
        ...camposDeNascimentoParaGravar(dataNascimento),
        endereco: endereco.trim(),
        numero: numero.trim(),
        bairro: bairro.trim(),
        cidade: cidade.trim(),
        telefone: telefone.trim(),
        documento,
        tenantId,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || currentUser.uid,
        modulo: 'cadastros',
        acao: 'criacao',
        descricao: `Cliente ${nomeLimpo} cadastrado pelo cadastro rápido${codigo ? ` (código ${codigo})` : ''}.`,
        registroRelacionadoId: novoClienteRef.id,
        documentoTipo: 'cliente',
        documentoNumero: `Cliente ${nomeLimpo}`,
        status: 'sucesso',
      });
      onCriado({
        id: novoClienteRef.id,
        codigo,
        nome: nomeLimpo,
        telefone: telefone.trim(),
        documento,
        endereco: endereco.trim(),
        numero: numero.trim(),
        bairro: bairro.trim(),
        cidade: cidade.trim(),
      });
      onClose();
    } catch (error) {
      console.error('Erro ao cadastrar cliente:', error);
      showError('Erro ao salvar', 'Verifique sua conexão e tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDocumentoChange = (value: string) => {
    const onlyNums = value.replace(/\D/g, '');
    if (onlyNums.length <= 14) setDocumento(onlyNums);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div className="card" style={{
        backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '680px', overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <UserPlus size={20} color="#8b5cf6" />
            Cadastrar Cliente
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome *</label>
            <input
              type="text"
              autoFocus
              value={nome}
              onChange={(e) => setNome(aplicarCaixaAltaCadastro(e.target, e.target.value))}
              style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Apelido</label>
              <input
                type="text"
                value={apelido}
                maxLength={60}
                title="Como o cliente é chamado. A busca de cliente também procura pelo apelido."
                onChange={(e) => setApelido(aplicarCaixaAltaCadastro(e.target, e.target.value))}
                style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data de nascimento</label>
              <input
                type="date"
                value={dataNascimento}
                max={getDateInputInTimeZone()}
                title="No dia do aniversário o sistema avisa no sino do topo"
                onChange={(e) => setDataNascimento(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Endereço</label>
              <input
                type="text"
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Número</label>
              <input
                type="text"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Bairro</label>
              <input
                type="text"
                value={bairro}
                onChange={(e) => setBairro(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Cidade</label>
              <input
                type="text"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Celular</label>
              <input
                type="text"
                inputMode="tel"
                value={telefone}
                onChange={(e) => setTelefone(mascaraTelefone(e.target.value))}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CPF</label>
              <input
                type="text"
                value={documento}
                onChange={(e) => handleDocumentoChange(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSalvar()}
            disabled={isSaving}
            style={{ opacity: isSaving ? 0.6 : 1 }}
          >
            {isSaving ? 'Salvando...' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CadastroRapidoClienteModal;
