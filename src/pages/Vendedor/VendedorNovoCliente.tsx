import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Save, Search } from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { getProximoCodigoCliente } from '../../utils/clienteCodigo';
import { buscarClienteDuplicadoPorDocumento } from '../../utils/clienteDuplicadoCheck';
import { apenasDigitos, isCnpjValido } from '../../utils/documentoValidacao';
import { documentoService } from '../../services/documentoService';
import { consultarCep } from '../../services/cepService';
import {
  avisosClienteMobile,
  formularioClienteVazio,
  mascaraCep,
  mascaraDocumento,
  mascaraTelefone,
  montarClienteParaGravar,
  tipoPessoaDoDocumento,
  validarClienteMobile,
  type FormularioClienteMobile,
} from '../../utils/clienteCadastroMobileDomain';
import type { VendedorNovoClienteNavState } from './vendedorNavState';
import { podeCadastrarClienteNoApp } from './vendedorPermissoes';
import VendedorHeader from './VendedorHeader';

// 16px e' o minimo que impede o Safari do iOS de dar zoom sozinho ao focar
// o campo -- ver vendedorMobile.css.
const estiloCampo: React.CSSProperties = {
  width: '100%', height: '48px', borderRadius: '14px', border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '0 14px', fontSize: '16px',
  boxSizing: 'border-box',
};

const estiloRotulo: React.CSSProperties = {
  fontSize: '12.5px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block',
};

const Campo: React.FC<{ rotulo: string; dica?: string; children: React.ReactNode }> = ({ rotulo, dica, children }) => (
  <label style={{ display: 'block' }}>
    <span style={estiloRotulo}>{rotulo}</span>
    {children}
    {dica && <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '5px' }}>{dica}</span>}
  </label>
);

/**
 * Cadastro de cliente pelo celular, ja' com tudo que a nota fiscal pede
 * (documento, nome, endereco completo com numero, IBGE pelo CEP e, pra
 * pessoa juridica, a IE). O vendedor digita so' os numeros; a tela formata
 * sozinha. Regras em src/utils/clienteCadastroMobileDomain.ts.
 */
const VendedorNovoCliente: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const estado = (location.state as VendedorNovoClienteNavState | null) || null;
  const { tenantId, currentUser, userPermissions } = useAuth();

  const [form, setForm] = useState<FormularioClienteMobile>(formularioClienteVazio);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [avisoCep, setAvisoCep] = useState('');
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const ultimoCepConsultado = useRef('');

  const tipoPessoa = tipoPessoaDoDocumento(form.documento);
  const digitosDoc = apenasDigitos(form.documento);
  const cnpjConsultavel = digitosDoc.length === 14 && isCnpjValido(digitosDoc);

  const alterar = <K extends keyof FormularioClienteMobile>(campo: K, valor: FormularioClienteMobile[K]) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  // CEP completo (8 numeros) -> busca sozinho e preenche rua, bairro, cidade,
  // estado e o codigo IBGE (que a nota fiscal exige).
  useEffect(() => {
    const cep = apenasDigitos(form.cep);
    if (cep.length !== 8 || cep === ultimoCepConsultado.current) return;
    ultimoCepConsultado.current = cep;
    let cancelado = false;
    setBuscandoCep(true);
    setAvisoCep('');
    consultarCep(cep).then((endereco) => {
      if (cancelado) return;
      if (!endereco.encontrado) {
        setAvisoCep('CEP não encontrado. Confira os números ou preencha o endereço à mão.');
        setForm((atual) => ({ ...atual, codigoIbge: '' }));
        return;
      }
      setForm((atual) => ({
        ...atual,
        endereco: endereco.logradouro || atual.endereco,
        bairro: endereco.bairro || atual.bairro,
        cidade: endereco.cidade,
        estado: endereco.uf,
        codigoIbge: endereco.ibge,
      }));
    }).catch((erro) => {
      if (cancelado) return;
      setAvisoCep(erro instanceof Error ? erro.message : 'Não foi possível consultar o CEP agora.');
    }).finally(() => {
      if (!cancelado) setBuscandoCep(false);
    });
    return () => { cancelado = true; };
  }, [form.cep]);

  if (!podeCadastrarClienteNoApp(userPermissions)) {
    return <Navigate to="/vendedor" replace />;
  }

  const buscarCnpj = async () => {
    setBuscandoCnpj(true);
    try {
      const dados = await documentoService.consultarCnpj(digitosDoc);
      if (!dados.encontrado) {
        showWarning('CNPJ não encontrado', 'Os números conferem, mas não achei esse cadastro na Receita Federal. Preencha à mão.');
        return;
      }
      setForm((atual) => ({
        ...atual,
        nome: (dados.razaoSocial || atual.nome).toUpperCase(),
        fantasia: (dados.nomeFantasia || atual.fantasia).toUpperCase(),
        endereco: dados.logradouro || atual.endereco,
        numero: dados.numero || atual.numero,
        bairro: dados.bairro || atual.bairro,
        cidade: dados.municipio || atual.cidade,
        estado: dados.uf || atual.estado,
        telefone: atual.telefone || mascaraTelefone(dados.telefone || ''),
        email: atual.email || (dados.email || '').toLowerCase(),
      }));
      showWarning('Dados da Receita Federal preenchidos', 'Confira tudo. Falta o CEP (que traz o código da cidade) e a Inscrição Estadual.');
    } catch (erro) {
      showError('Não foi possível consultar o CNPJ', erro instanceof Error ? erro.message : 'Preencha os dados à mão.');
    } finally {
      setBuscandoCnpj(false);
    }
  };

  const salvar = async () => {
    if (salvando || !tenantId || !currentUser) return;

    const erros = validarClienteMobile(form);
    if (erros.length > 0) {
      showError(
        erros.length === 1 ? 'Falta um dado' : `Faltam ${erros.length} dados`,
        erros.map((e) => `• ${e}`).join('\n'),
      );
      return;
    }

    setSalvando(true);
    try {
      const duplicado = await buscarClienteDuplicadoPorDocumento(tenantId, form.documento);
      if (duplicado) {
        showError(
          'CPF/CNPJ já cadastrado',
          `Este documento já está cadastrado para "${duplicado.nome}". Busque esse cliente na lista em vez de criar outro, ou corrija o número digitado.`,
        );
        return;
      }

      const codigo = await getProximoCodigoCliente(tenantId);
      const dados = montarClienteParaGravar(form, { codigo, tenantId, vendedorId: currentUser.uid });
      const ref = await addDoc(collection(db, 'clientes'), {
        ...dados,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });

      showSuccess('Cliente cadastrado!');
      const avisos = avisosClienteMobile(form);
      if (avisos.length > 0) showWarning(avisos.join(' '));

      // Veio de um pedido/orcamento: volta pra ele ja' com o cliente escolhido.
      if (estado?.retornarPara === 'pedido') {
        navigate('/vendedor/pedido/novo', { replace: true, state: { clientePreSelecionado: { id: ref.id, nome: dados.nome } } });
      } else if (estado?.retornarPara === 'orcamento') {
        navigate('/vendedor/orcamento/novo', { replace: true, state: { clientePreSelecionado: { id: ref.id, nome: dados.nome } } });
      } else if (estado?.retornarPara === 'troca') {
        navigate('/vendedor/troca/nova', { replace: true, state: { clientePreSelecionado: { id: ref.id, nome: dados.nome } } });
      } else {
        navigate('/vendedor/cliente', { replace: true });
      }
    } catch (erro) {
      console.error('Erro ao cadastrar cliente pelo app do vendedor:', erro);
      showError('Não foi possível cadastrar', 'Verifique a internet e tente de novo. Se continuar, avise o suporte.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Novo Cliente" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Preencha tudo que a nota fiscal precisa. Digite só os números: o sistema coloca pontos, traços e barra sozinho.
        </p>

        <Campo rotulo="CPF ou CNPJ *">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              style={estiloCampo}
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00 ou 00.000.000/0000-00"
              value={form.documento}
              onChange={(e) => alterar('documento', mascaraDocumento(e.target.value))}
            />
            {cnpjConsultavel && (
              <button
                type="button"
                onClick={() => void buscarCnpj()}
                disabled={buscandoCnpj}
                aria-label="Buscar dados do CNPJ na Receita Federal"
                style={{ width: '48px', height: '48px', borderRadius: '14px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-elevated)', color: 'var(--brand-400)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
              >
                {buscandoCnpj ? <Loader2 size={18} className="spin-icon" /> : <Search size={18} />}
              </button>
            )}
          </div>
          {tipoPessoa && (
            <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '5px' }}>
              {tipoPessoa === 'PJ' ? 'Pessoa jurídica (CNPJ)' : 'Pessoa física (CPF)'}
              {cnpjConsultavel ? ' — toque na lupa para preencher pela Receita Federal.' : ''}
            </span>
          )}
        </Campo>

        <Campo rotulo={tipoPessoa === 'PJ' ? 'Razão social *' : 'Nome completo *'}>
          <input style={{ ...estiloCampo, textTransform: 'uppercase' }} autoComplete="off" value={form.nome} onChange={(e) => alterar('nome', e.target.value.toUpperCase())} />
        </Campo>

        {tipoPessoa === 'PJ' && (
          <>
            <Campo rotulo="Nome fantasia">
              <input style={{ ...estiloCampo, textTransform: 'uppercase' }} autoComplete="off" value={form.fantasia} onChange={(e) => alterar('fantasia', e.target.value.toUpperCase())} />
            </Campo>
            <Campo rotulo="Inscrição Estadual *" dica='Só os números da IE. Se a empresa for isenta, escreva ISENTO.'>
              <input style={{ ...estiloCampo, textTransform: 'uppercase' }} autoComplete="off" value={form.identidade} onChange={(e) => alterar('identidade', e.target.value.toUpperCase())} />
            </Campo>
          </>
        )}

        <Campo rotulo="CEP *" dica={buscandoCep ? 'Buscando o endereço...' : avisoCep || 'Preenche rua, bairro, cidade e estado sozinho.'}>
          <input
            style={estiloCampo}
            inputMode="numeric"
            autoComplete="off"
            placeholder="00000-000"
            value={form.cep}
            onChange={(e) => alterar('cep', mascaraCep(e.target.value))}
          />
        </Campo>

        <Campo rotulo="Endereço (rua) *">
          <input style={{ ...estiloCampo, textTransform: 'uppercase' }} autoComplete="off" value={form.endereco} onChange={(e) => alterar('endereco', e.target.value.toUpperCase())} />
        </Campo>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ width: '120px', flexShrink: 0 }}>
            <Campo rotulo="Número *">
              <input style={{ ...estiloCampo, textTransform: 'uppercase' }} autoComplete="off" placeholder="S/N" value={form.numero} onChange={(e) => alterar('numero', e.target.value.toUpperCase())} />
            </Campo>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Campo rotulo="Bairro *">
              <input style={{ ...estiloCampo, textTransform: 'uppercase' }} autoComplete="off" value={form.bairro} onChange={(e) => alterar('bairro', e.target.value.toUpperCase())} />
            </Campo>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Campo rotulo="Cidade *">
              <input style={{ ...estiloCampo, textTransform: 'uppercase' }} autoComplete="off" value={form.cidade} onChange={(e) => alterar('cidade', e.target.value.toUpperCase())} />
            </Campo>
          </div>
          <div style={{ width: '84px', flexShrink: 0 }}>
            <Campo rotulo="UF *">
              <input style={{ ...estiloCampo, textTransform: 'uppercase', textAlign: 'center' }} maxLength={2} autoComplete="off" value={form.estado} onChange={(e) => alterar('estado', e.target.value.toUpperCase())} />
            </Campo>
          </div>
        </div>

        <Campo rotulo="Telefone / WhatsApp">
          <input
            style={estiloCampo}
            inputMode="tel"
            autoComplete="off"
            placeholder="(00) 00000-0000"
            value={form.telefone}
            onChange={(e) => alterar('telefone', mascaraTelefone(e.target.value))}
          />
        </Campo>

        <Campo rotulo="E-mail (opcional)" dica="Só para enviar a nota fiscal ao cliente. Pode deixar em branco.">
          <input
            style={estiloCampo}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            value={form.email}
            onChange={(e) => alterar('email', e.target.value.toLowerCase())}
          />
        </Campo>
      </div>

      <div style={{ padding: '16px 20px calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando}
          style={{
            width: '100%', height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#fff',
            cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.7 : 1,
            background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
          }}
        >
          {salvando ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} />}
          {salvando ? 'Salvando...' : 'Salvar cliente'}
        </button>
      </div>
    </div>
  );
};

export default VendedorNovoCliente;
