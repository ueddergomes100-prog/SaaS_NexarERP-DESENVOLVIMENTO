import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, UserCog, AlertCircle } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, showWarning, NexusSwal } from '../../utils/alerts';
import {
  checarPrefixoDaEmpresa,
  checarUsername,
  normalizarUsername,
  type ChecagemPrefixo,
} from '../../utils/loginIdentidadeDomain';
import {
  CODIGO_VENDEDOR_DIGITOS,
  isPinVendedorFraco,
  isPinVendedorValido,
  MENSAGEM_CODIGO_INVALIDO,
  MENSAGEM_PIN_CURTO,
  MENSAGEM_PIN_FRACO,
  PIN_GESTOR_MIN_DIGITOS,
  MENSAGEM_PIN_INVALIDO,
  normalizarCodigoVendedor,
  mensagemCodigoDeOutroAtivo,
  nomeDoCadastroComCodigo,
  quemTemOCodigo,
  AJUDA_TAMANHO_PIN,
  PIN_VENDEDOR_MAX_DIGITOS,
  PIN_VENDEDOR_MIN_DIGITOS,
} from '../../utils/vendedorPinDomain';
import { definirPinVendedor, VendedorPinError } from '../../services/vendedorPinService';
import { alterarAcessoAppNoServidor, criarLoginNoServidor, redefinirSenhaAcesso, salvarFichaNoServidor, salvarPermissoesNoServidor, UsuarioAcessoError, vincularMotoristaNoServidor } from '../../services/usuarioAcessoService';
import { permissoesCopiadas, rotuloDoUsuarioParaCopiar, usuariosParaCopiar } from '../../utils/copiaDePermissoesDomain';
import { nivelAcessoEfetivo, permissoesEfetivasDoUsuario } from '../../utils/permissoesNovasDomain';
import { parseNivelAcesso } from '../../utils/visibilidadeVendasDomain';
import { permissaoForaDoPlano } from '../../utils/permissaoModuloDomain';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { isRegistroComLogin } from '../../utils/vendedorCadastroDomain';
import { PERMISSAO_ADMINISTRACAO } from '../../utils/permissoesNovasDomain';
import { hasTenantFullAccess } from '../../utils/roles';

const UsuarioForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const { tenantId, currentUser, grupo, userRole, isOwner, userPermissions, blockedModules } = useAuth();
  // Item 15 (fase Administracao, 25/11/2026): sem ser o dono/administrador, a ficha pede
  // "Admin: Equipe — alterar a ficha" e as senhas pedem "Admin: Equipe — trocar a senha".
  const gestorDaEquipe = hasTenantFullAccess(userRole, Boolean(isOwner));
  const podeFicha = !isEditing || gestorDaEquipe || userPermissions.includes(PERMISSAO_ADMINISTRACAO.equipeEditar);
  const podeSenha = gestorDaEquipe || userPermissions.includes(PERMISSAO_ADMINISTRACAO.equipeSenha);
  // Funcionario novo com as permissoes de outro (27/11/2026): "Duplicar" na lista abre com ?copiarDe=id.
  const podeCopiarPermissoes = gestorDaEquipe || userPermissions.includes(PERMISSAO_ADMINISTRACAO.equipePermissoes);
  const [searchParams] = useSearchParams();
  const [copiarDeId, setCopiarDeId] = useState(() => searchParams.get('copiarDe') || '');
  const [usuariosParaCopiarDe, setUsuariosParaCopiarDe] = useState<Array<Record<string, any> & { id: string }>>([]);
  useEffect(() => {
    if (isEditing || !podeCopiarPermissoes || !tenantId) return undefined;
    let ativo = true;
    getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId)))
      .then((snap) => {
        if (ativo) setUsuariosParaCopiarDe(usuariosParaCopiar(snap.docs.map((d) => ({ id: d.id, ...d.data() })), { donoId: tenantId }));
      })
      .catch((erro) => console.error('Novo usuário: não foi possível listar os usuários para copiar.', erro));
    return () => { ativo = false; };
  }, [isEditing, podeCopiarPermissoes, tenantId]);

  /**
   * Depois de criar o login: grava as permissoes e o nivel da origem pelo servidor (a mesma
   * rota da janela de permissoes, que confere quem pode dar o que) e liga o app se a origem
   * usa. Devolve a frase do que nao deu certo ('' quando deu tudo certo).
   */
  const copiarPermissoesParaNovo = async (novoId: string, appJaLigado: boolean): Promise<string> => {
    const origem = usuariosParaCopiarDe.find((u) => u.id === copiarDeId);
    if (!origem) return '';
    const nomeOrigem = String(origem.nome || 'o usuário escolhido');
    const daOrigem = permissoesEfetivasDoUsuario(origem.permissoes || [], origem.nivelAcesso, { semFiliais: !grupo, papel: origem.role });
    const podeMexer = (permissao: string) => !permissaoForaDoPlano(permissao, blockedModules) && (gestorDaEquipe || userPermissions.includes(permissao));
    const podeNivel = gestorDaEquipe || userPermissions.includes(PERMISSAO_ADMINISTRACAO.equipeNivel);
    try {
      await salvarPermissoesNoServidor(
        novoId,
        permissoesCopiadas({ atuais: [], daOrigem, podeMexer }),
        podeNivel ? parseNivelAcesso(nivelAcessoEfetivo(origem.nivelAcesso, origem.role, origem.permissoes)) : undefined,
      );
    } catch (erro) {
      return `As permissões de ${nomeOrigem} não foram copiadas: ${erro instanceof Error && erro.message ? erro.message : 'o servidor não respondeu.'} Abra as permissões do usuário novo e use "Copiar de outro usuário".`;
    }
    const podeApp = gestorDaEquipe || userPermissions.includes(PERMISSAO_ADMINISTRACAO.equipeApp);
    if (origem.acessoAppMobile === true && podeApp && !appJaLigado) {
      try {
        await alterarAcessoAppNoServidor(novoId, true);
      } catch (erro) {
        return `Permissões de ${nomeOrigem} copiadas, mas o aplicativo não foi liberado: ${erro instanceof Error && erro.message ? erro.message : 'tente de novo nas permissões do usuário.'}`;
      }
    }
    return '';
  };
  
  const [formData, setFormData] = useState({
    nome: '',
    username: '',
    senha: '',
    codigoVendedor: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  /** Resultado da checagem do CNPJ da empresa -- ver loginIdentidadeDomain.ts.
   *  `null` enquanto carrega. */
  const [checagemPrefixo, setChecagemPrefixo] = useState<ChecagemPrefixo | null>(null);
  const [pinVendedor, setPinVendedor] = useState('');
  // Bloco B de seguranca (25/11/2026): senha de 2 ou 3 digitos (so' vale no balcao) e papel de gestor (entra por codigo so' com 6+).
  const [pinCurto, setPinCurto] = useState(false);
  // Situacao da senha de vendedor (27/11/2026, Embala: "minha senha nao da"): a ficha
  // nao dizia se havia senha cadastrada. null = sem senha; Date = quando foi salva.
  const [pinDefinidoEm, setPinDefinidoEm] = useState<Date | null | undefined>(undefined);
  const [alvoEhGestor, setAlvoEhGestor] = useState(false);
  const [salvandoPin, setSalvandoPin] = useState(false);
  const [novaSenhaAcesso, setNovaSenhaAcesso] = useState('');
  const [salvandoSenhaAcesso, setSalvandoSenhaAcesso] = useState(false);
  // "Este funcionario e' motorista" (2026-09-23): marcar cria o cadastro de
  // motorista ja vinculado a este usuario (motoristas/{uid}), sem digitar tudo
  // de novo em Operacoes > Motoristas.
  const [ehMotorista, setEhMotorista] = useState(false);
  const [motoristaJaVinculado, setMotoristaJaVinculado] = useState(false);
  // Vinculo pelo motorista criado junto com o login (motoristas/{uid}): pode ser
  // trocado pelo motorista que ja' existia (29/10/2026, motorista em dobro na Sol Life).
  const [vinculoAutomatico, setVinculoAutomatico] = useState(false);
  const [dadosMotorista, setDadosMotorista] = useState({ telefone: '', cnh: '' });
  const [motoristasSemLogin, setMotoristasSemLogin] = useState<Array<{ id: string; nome: string }>>([]);
  const [motoristaEscolhido, setMotoristaEscolhido] = useState('');
  const [vinculando, setVinculando] = useState(false);

  // Motoristas sem login (cadastrados em Operacoes > Motoristas), para o botao "Vincular".
  React.useEffect(() => {
    if (!isEditing || !tenantId || (motoristaJaVinculado && !vinculoAutomatico)) return;
    getDocs(query(collection(db, 'motoristas'), where('tenantId', '==', tenantId)))
      .then((snap) => setMotoristasSemLogin(snap.docs
        .filter((d) => d.data().ativo !== false && !d.data().usuarioId && d.id !== id)
        .map((d) => ({ id: d.id, nome: String(d.data().nome || '') }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))))
      .catch((erro) => console.error('Erro ao ler os motoristas:', erro));
  }, [isEditing, tenantId, motoristaJaVinculado, vinculoAutomatico, id]);

  const vincularMotoristaExistente = async () => {
    if (!id || !motoristaEscolhido) return;
    setVinculando(true);
    try {
      const r = await vincularMotoristaNoServidor(id, motoristaEscolhido);
      setMotoristaJaVinculado(true);
      setVinculoAutomatico(false);
      setEhMotorista(true);
      if (r.duplicadoRemovido) showSuccess(`Vinculado ao motorista ${r.motoristaNome}. O cadastro repetido foi apagado e as rotas dele já aparecem no aplicativo deste usuário.`);
      else if (r.appLiberado) showSuccess(`Vinculado ao motorista ${r.motoristaNome}: as rotas dele já aparecem no aplicativo deste usuário.`);
      else showWarning(`Vinculado ao motorista ${r.motoristaNome}. O aplicativo não foi liberado: a empresa já usa as ${r.limiteApp} vagas do app contratadas.`);
    } catch (erro) {
      showError('Não foi possível vincular', erro instanceof Error && erro.message ? erro.message : 'Tente de novo em instantes.');
    } finally {
      setVinculando(false);
    }
  };

  React.useEffect(() => {
    if (isEditing && id) {
      const fetchUser = async () => {
        const userSnap = await getDoc(doc(db, 'usuarios', id));
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFormData({
            // Dono (24/11/2026): o cadastro dele guarda o nome em `nomeResponsavel`.
            nome: data.nome || data.nomeResponsavel || '',
            username: data.username || '',
            senha: '',
            codigoVendedor: data.codigoVendedor || ''
          });
          setPinCurto(data.pinCurto === true);
          setPinDefinidoEm(data.pinDefinidoEm && typeof data.pinDefinidoEm.toDate === 'function' ? data.pinDefinidoEm.toDate() : (data.pinDefinidoEm ? new Date() : null));
          setAlvoEhGestor(data.role === 'Master' || data.role === 'Admin');
        }
        // Ja e' motorista? O vinculo e' motoristas/{uid} (criado aqui) ou o
        // motorista ja' cadastrado vinculado depois (usuarios.motoristaId, 26/10/2026).
        try {
          const motoristaIdVinculado = userSnap.exists() ? String(userSnap.data().motoristaId || '') : '';
          const motoristaSnap = await getDoc(doc(db, 'motoristas', motoristaIdVinculado || id));
          if (motoristaSnap.exists() && motoristaSnap.data().tenantId === tenantId) {
            const m = motoristaSnap.data();
            setEhMotorista(true);
            setMotoristaJaVinculado(true);
            setVinculoAutomatico(!motoristaIdVinculado);
            setDadosMotorista({ telefone: m.telefone || '', cnh: m.cnh || '' });
          }
        } catch (erro) {
          console.error('Erro ao ler o vínculo de motorista:', erro);
        }
      };
      fetchUser();
    }
  }, [id, isEditing, tenantId]);

  // O prefixo do login do funcionario e' o CNPJ da empresa -- e SO ele.
  //
  // Antes havia dois fallbacks aqui (slug do nome da oficina, e os 4
  // primeiros caracteres do tenantId) para empresa sem CNPJ. Mas a tela de
  // login SEMPRE monta a chave com o CNPJ digitado: o funcionario criado sob
  // um prefixo alternativo era gravado com uma chave que o login nunca
  // conseguiria produzir, e simplesmente NUNCA entrava -- com uma mensagem
  // ("Usuário ou CNPJ não encontrado") que mandava procurar no lugar errado.
  //
  // Agora falha cedo, no cadastro, com instrucao de onde resolver.
  React.useEffect(() => {
    const fetchCnpjEmpresa = async () => {
      if (!tenantId) return;
      try {
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        setChecagemPrefixo(checarPrefixoDaEmpresa(configSnap.exists() ? configSnap.data().cnpj : ''));
      } catch (e) {
        console.error('Erro ao carregar o CNPJ da empresa:', e);
        setChecagemPrefixo(checarPrefixoDaEmpresa(''));
      }
    };
    fetchCnpjEmpresa();
  }, [tenantId]);

  /** Outro funcionario ATIVO ja' usa o codigo? Devolve a frase de erro, ou '' quando pode.
   *  Codigo so' no cadastro ativo (26/11/2026): o de um inativo sai dele ao salvar
   *  (o servidor tira e avisa). Dois ativos com o mesmo codigo carimbariam venda e
   *  comissao na pessoa errada -- e o backend recusa a validacao nesse caso. */
  const codigoDeOutroAtivo = async (codigo: string): Promise<string> => {
    if (!codigo || !tenantId) return '';
    const snap = await getDocs(query(
      collection(db, 'usuarios'),
      where('tenantId', '==', tenantId),
      where('codigoVendedor', '==', codigo),
    ));
    const { ativo } = quemTemOCodigo(snap.docs.map((d) => ({ id: d.id, ...d.data() })), codigo, id || null);
    return ativo ? mensagemCodigoDeOutroAtivo(codigo, nomeDoCadastroComCodigo(ativo)) : '';
  };

  /**
   * Grava o PIN pelo backend. Nao passa pelo Firestore: o hash mora numa
   * colecao que as rules negam pra todo mundo, e a comparacao acontece no
   * servidor -- um PIN curto validado no navegador nao valeria nada.
   */
  const handleSalvarPin = async () => {
    if (!id) return;
    if (!isPinVendedorValido(pinVendedor)) {
      showError('Senha inválida', MENSAGEM_PIN_INVALIDO);
      return;
    }
    const codigoAtual = normalizarCodigoVendedor(formData.codigoVendedor);
    if (!codigoAtual) {
      showError('Falta o código', 'Cadastre e salve o código do vendedor antes de definir a senha dele.');
      return;
    }
    if (isPinVendedorFraco(pinVendedor)) {
      const confirma = await NexusSwal.fire({
        title: 'Senha fácil de adivinhar',
        text: MENSAGEM_PIN_FRACO,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Usar mesmo assim',
        cancelButtonText: 'Escolher outra',
        reverseButtons: true,
      });
      if (!confirma.isConfirmed) return;
    }

    setSalvandoPin(true);
    try {
      await definirPinVendedor(id, pinVendedor);
      setPinVendedor('');
      setPinCurto(false);
      setPinDefinidoEm(new Date());
      showSuccess('Senha do vendedor salva!');
    } catch (error) {
      const mensagem = error instanceof VendedorPinError
        ? error.message
        : 'Não foi possível salvar a senha do vendedor.';
      showError('Erro ao salvar senha', mensagem);
    } finally {
      setSalvandoPin(false);
    }
  };

  /**
   * Troca a SENHA DE ACESSO (login no sistema) -- diferente da senha do
   * vendedor acima. So o Admin SDK troca a senha de outro usuario no
   * Firebase Auth, por isso passa pelo backend (usuarioAcessoService.ts).
   */
  const handleSalvarSenhaAcesso = async () => {
    if (!id) return;
    if (novaSenhaAcesso.length < 6) {
      showError('Senha inválida', 'A senha de acesso deve ter pelo menos 6 caracteres.');
      return;
    }

    setSalvandoSenhaAcesso(true);
    try {
      await redefinirSenhaAcesso(id, novaSenhaAcesso);
      setNovaSenhaAcesso('');
      showSuccess('Senha de acesso atualizada!');
    } catch (error) {
      const mensagem = error instanceof UsuarioAcessoError
        ? error.message
        : 'Não foi possível atualizar a senha de acesso.';
      showError('Erro ao salvar senha', mensagem);
    } finally {
      setSalvandoSenhaAcesso(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !currentUser) return;
    
    setIsLoading(true);

    if (isEditing && id) {
      try {
        const codigo = normalizarCodigoVendedor(formData.codigoVendedor);
        if (formData.codigoVendedor && !codigo) {
          showError('Código inválido', MENSAGEM_CODIGO_INVALIDO);
          return;
        }
        const erroDoCodigo = codigo ? await codigoDeOutroAtivo(codigo) : '';
        if (erroDoCodigo) {
          showError('Código já usado', erroDoCodigo);
          return;
        }

        // 26/10/2026: pelo servidor (o gerente da equipe tambem edita); o motorista
        // marcado aqui e' criado ou atualizado no mesmo passo, vinculado ao usuario.
        const r = await salvarFichaNoServidor({
          usuarioId: id,
          nome: formData.nome,
          ...(codigo ? { codigoVendedor: codigo } : {}),
          ...(ehMotorista ? { motorista: { telefone: dadosMotorista.telefone.trim(), cnh: dadosMotorista.cnh.trim() } } : {}),
        });
        if (r.motorista?.novo && !r.motorista.appLiberado) {
          showWarning(`Usuário atualizado e cadastrado como motorista (já aparece nas rotas). O aplicativo não foi liberado: a empresa já usa as ${r.motorista.limiteApp} vagas do app contratadas.`);
        } else if (r.avisoCodigo) {
          showWarning(`Usuário atualizado. ${r.avisoCodigo}`);
        } else {
          showSuccess('Usuário atualizado com sucesso!');
        }
        navigate('/usuarios');
      } catch (err) {
        console.error(err);
        showError('Não foi possível atualizar', err instanceof Error && err.message ? err.message : 'Não foi possível atualizar o usuário.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Validação de Limite de Usuários para a Empresa
    try {
      const qUsers = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const qSnap = await getDocs(qUsers);
      // So conta quem tem LOGIN. Vendedor de balcao mora na mesma colecao,
      // mas nao entra no sistema -- cobrar uma vaga do plano por ele faria
      // uma loja com 4 estacoes contratadas travar no 5o vendedor, que nem
      // consome acesso. Ver src/utils/vendedorCadastroDomain.ts.
      const currentCount = qSnap.docs.filter((documento) => isRegistroComLogin(documento.data())).length;

      // Obtém o limite configurado no documento do dono da oficina (tenantId).
      // Numa filial (2026-10-06), o plano e' do grupo: vale o da matriz.
      const ownerDoc = await getDoc(doc(db, 'usuarios', grupo?.matrizTenantId || tenantId));
      const limit = ownerDoc.exists() ? (ownerDoc.data().limiteUsuarios !== undefined ? ownerDoc.data().limiteUsuarios : 3) : 3;

      if (currentCount >= limit) {
        showError('Limite Atingido', `Sua empresa atingiu o limite de ${limit} usuários contratados. Entre em contato com o suporte para alterar o limite do seu plano.`);
        setIsLoading(false);
        return;
      }
    } catch (e) {
      console.error("Erro ao validar limite de usuários:", e);
    }

    // Sem CNPJ valido na empresa, o funcionario nasceria incapaz de logar --
    // bloqueia aqui, dizendo onde resolver, em vez de criar um usuario morto.
    const checagem = checagemPrefixo ?? checarPrefixoDaEmpresa('');
    if (!checagem.ok) {
      showError('Cadastro da empresa incompleto', checagem.motivo);
      setIsLoading(false);
      return;
    }

    const checagemUsuario = checarUsername(formData.username);
    if (!checagemUsuario.ok) {
      showError('Atenção', checagemUsuario.motivo);
      setIsLoading(false);
      return;
    }
    if (formData.senha.length < 6) {
      showError('Atenção', 'A senha deve ter pelo menos 6 caracteres.');
      setIsLoading(false);
      return;
    }

    const codigoVendedor = normalizarCodigoVendedor(formData.codigoVendedor);
    if (formData.codigoVendedor && !codigoVendedor) {
      showError('Código inválido', MENSAGEM_CODIGO_INVALIDO);
      setIsLoading(false);
      return;
    }
    const erroDoCodigoNovo = codigoVendedor ? await codigoDeOutroAtivo(codigoVendedor) : '';
    if (erroDoCodigoNovo) {
      showError('Código já usado', erroDoCodigoNovo);
      setIsLoading(false);
      return;
    }

    // A MESMA funcao que a tela de login usa pra montar a chave -- e' isso
    // que garante que criacao e login nunca mais divirjam.
    setIsLoading(true);

    try {
      // Limites do plano (19/10/2026): o servidor cria a conta, o cadastro e o
      // indice de login, conferindo o limite de usuarios contratado. Nivel de
      // acesso nasce no mais restrito e permissoes vazias, como sempre.
      // Motorista (26/10/2026): o servidor ja' cria o motorista vinculado, a
      // permissao de entregas no app e liga o app se o plano tiver vaga.
      const criado = await criarLoginNoServidor({
        nome: formData.nome,
        usuario: checagemUsuario.username,
        senha: formData.senha,
        ...(codigoVendedor ? { codigoVendedor } : {}),
        ...(ehMotorista ? { motorista: { telefone: dadosMotorista.telefone.trim(), cnh: dadosMotorista.cnh.trim() } } : {}),
      });

      const falhaDaCopia = copiarDeId ? await copiarPermissoesParaNovo(criado.uid, criado.appLiberado === true) : '';
      if (falhaDaCopia) {
        showWarning(`Usuário criado. ${falhaDaCopia}`);
      } else if (criado.motorista && !criado.appLiberado) {
        showWarning(`Usuário criado e cadastrado como motorista (já aparece nas rotas). O aplicativo não foi liberado: a empresa já usa as ${criado.limiteApp ?? ''} vagas do app contratadas. Libere uma vaga em Equipe e Acessos ou fale com o suporte para aumentar o plano.`);
      } else if (criado.avisoCodigo) {
        showWarning(`Usuário criado. ${criado.avisoCodigo}`);
      } else {
        const nomeDaOrigem = copiarDeId ? String(usuariosParaCopiarDe.find((u) => u.id === copiarDeId)?.nome || '') : '';
        showSuccess(criado.motorista ? 'Usuário criado como motorista: já aparece nas rotas e no aplicativo.' : nomeDaOrigem ? `Usuário criado com as permissões de ${nomeDaOrigem}.` : 'Usuário criado com sucesso!');
      }
      navigate('/usuarios');
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      showError(
        error instanceof UsuarioAcessoError && error.status === 409 ? 'Não foi possível criar' : 'Erro',
        error instanceof Error && error.message ? error.message : 'Não foi possível criar o usuário. Tente novamente.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/usuarios')} title="Voltar"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Usuário' : 'Novo Usuário'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>{isEditing ? 'Altere o nome, a senha de acesso ou os dados de vendedor' : 'Cadastre um funcionário para acessar o sistema'}</p>
          </div>
        </div>
      </div>

          {!isEditing && (
            <div className="card" style={{ marginBottom: '24px', backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              <div style={{ display: 'flex', gap: '12px', padding: '16px' }}>
                <AlertCircle size={24} color="#8b5cf6" style={{ flexShrink: 0 }} />
                <div>
                  <h4 style={{ color: '#8b5cf6', margin: '0 0 4px', fontSize: '14px' }}>Como seu funcionário fará o Login?</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Ele deverá informar o <strong>CNPJ da Empresa</strong> e o nome de usuário (ex: <strong style={{ color: 'var(--text-primary)' }}>{formData.username.trim().toLowerCase().replace(/\s+/g, '') || 'nome'}</strong>).
                  </p>
                </div>
              </div>
            </div>
          )}

      <form onSubmit={handleSubmit} className="card" style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '24px' }}>
        <div className="section-header" style={{ gridColumn: 'span 12', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
          <UserCog size={20} className="section-icon" />
          <h3>Dados de Acesso</h3>
        </div>

        <div className="input-group" style={{ gridColumn: 'span 6' }}>
          <label>Nome Completo do Funcionário *</label>
          <input 
            type="text"
            value={formData.nome}
            onChange={(e) => setFormData({...formData, nome: aplicarCaixaAltaCadastro(e.target, e.target.value)})}
            required
            style={{ width: '100%' }}
          />
        </div>


        {!isEditing && (
          <>
            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>Nome de Usuário para Login *</label>
              <input 
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({...formData, username: e.target.value})}
                required
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Na tela de login, ele informará o CNPJ da empresa (<strong>{checagemPrefixo?.cnpj || '—'}</strong>) e o Usuário: <strong>{normalizarUsername(formData.username) || 'joao'}</strong>
              </span>
            </div>

            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>Senha de Acesso *</label>
              <input 
                type="password" 
                title="Mínimo 6 caracteres"
                value={formData.senha}
                onChange={(e) => setFormData({...formData, senha: e.target.value})}
                required
                minLength={6}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        {isEditing && podeSenha && (
          <div className="input-group" style={{ gridColumn: 'span 6' }}>
            <label>Senha de Acesso (login no sistema)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="password"
                title="Nova senha (mín. 6 caracteres)"
                value={novaSenhaAcesso}
                onChange={(e) => setNovaSenhaAcesso(e.target.value)}
                minLength={6}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={salvandoSenhaAcesso || novaSenhaAcesso.length < 6}
                onClick={() => void handleSalvarSenhaAcesso()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {salvandoSenhaAcesso ? 'Salvando...' : 'Salvar senha'}
              </button>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              É a senha que ele usa pra entrar no sistema (junto com o CNPJ e o usuário) -- diferente da senha do vendedor abaixo, usada só na identificação da venda.
            </span>
          </div>
        )}

        {!isEditing && podeCopiarPermissoes && usuariosParaCopiarDe.length > 0 && (
          <div className="input-group" style={{ gridColumn: 'span 12' }}>
            <label htmlFor="copiar-permissoes-novo">Copiar permissões de</label>
            <select
              id="copiar-permissoes-novo"
              value={copiarDeId}
              onChange={(e) => setCopiarDeId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Nenhum (o usuário nasce sem permissões)</option>
              {usuariosParaCopiarDe.map((u) => (
                <option key={u.id} value={u.id}>{rotuloDoUsuarioParaCopiar(u)}</option>
              ))}
            </select>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              O usuário novo já nasce com as permissões, o nível de acesso e o aplicativo (se houver vaga) de quem você escolher. Nome, usuário, senha e código são os que você preencher aqui; as regras de comissão não são copiadas.
            </span>
          </div>
        )}

        {/* Identificacao do vendedor na venda: codigo publico + PIN secreto.
            O codigo mora no documento do usuario; o PIN vai pro backend e
            NUNCA passa pelo Firestore visivel ao cliente. */}
        <div className="input-group" style={{ gridColumn: 'span 6' }}>
          <label>Código do Vendedor ({CODIGO_VENDEDOR_DIGITOS} dígitos)</label>
          <input
            type="text"
            inputMode="numeric"
            value={formData.codigoVendedor}
            onChange={(e) => setFormData({ ...formData, codigoVendedor: e.target.value.replace(/\D/g, '').slice(0, CODIGO_VENDEDOR_DIGITOS) })}
            onBlur={(e) => {
              const normalizado = normalizarCodigoVendedor(e.target.value);
              if (normalizado) setFormData((atual) => ({ ...atual, codigoVendedor: normalizado }));
            }}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Usado no popup de identificação a cada venda, quando essa opção estiver ligada em Configurações da filial, e para <strong>entrar no sistema e na Frente de Caixa</strong> nos computadores ativados (código + senha, sem usuário e e-mail). Opcional — deixe vazio se este usuário não vende nem opera o caixa. Vendedor que <strong>não precisa entrar no sistema</strong> é cadastrado em Cadastros Auxiliares → Vendedores, e não ocupa vaga do plano.
          </span>
        </div>

        {isEditing && podeSenha && (
          <div className="input-group" style={{ gridColumn: 'span 6' }}>
            <label>Senha do Vendedor ({AJUDA_TAMANHO_PIN.toLowerCase()})</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="password"
                inputMode="numeric"
                title="Senha"
                value={pinVendedor}
                onChange={(e) => setPinVendedor(e.target.value.replace(/\D/g, '').slice(0, PIN_VENDEDOR_MAX_DIGITOS))}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={salvandoPin || !pinVendedor}
                onClick={() => void handleSalvarPin()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {salvandoPin ? 'Salvando...' : 'Salvar senha'}
              </button>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Cadastre aqui também quando o funcionário <strong>esquecer a senha</strong> — salvar uma nova substitui a antiga e destrava na hora quem estiver bloqueado por tentativas. A senha tem de {PIN_VENDEDOR_MIN_DIGITOS} a {PIN_VENDEDOR_MAX_DIGITOS} dígitos; <strong>dono e administrador</strong> só entram com código nos computadores ativados se a senha deles tiver {PIN_GESTOR_MIN_DIGITOS} dígitos ou mais.
            </span>
            {pinDefinidoEm === null && (
              <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600, marginTop: '4px' }}>
                Sem senha de vendedor: {formData.codigoVendedor ? `o código ${formData.codigoVendedor} não confirma venda nem entra no caixa` : 'informe o código e salve uma senha'} até salvar uma aqui. Não é a senha de login.
              </span>
            )}
            {pinDefinidoEm instanceof Date && (
              <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600, marginTop: '4px' }}>
                Senha de vendedor cadastrada em {pinDefinidoEm.toLocaleDateString('pt-BR')}. Na identificação da venda vale o código {formData.codigoVendedor || '—'} com esta senha, não a senha de login.
              </span>
            )}
            {pinCurto && (
              <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 600, marginTop: '4px' }}>{MENSAGEM_PIN_CURTO}</span>
            )}
            {alvoEhGestor && !pinCurto && (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Para entrar com código no computador do caixa, use {PIN_GESTOR_MIN_DIGITOS} dígitos ou mais.</span>
            )}
          </div>
        )}

        <div className="input-group" style={{ gridColumn: 'span 12', marginTop: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: motoristaJaVinculado ? 'default' : 'pointer', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={ehMotorista}
              disabled={motoristaJaVinculado}
              onChange={(e) => setEhMotorista(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--accent-purple)' }}
            />
            Este funcionário é motorista
          </label>
          {motoristaJaVinculado && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Já vinculado. Para tirar da lista de motoristas, use Operações → Motoristas.
            </span>
          )}
          {isEditing && (!motoristaJaVinculado || vinculoAutomatico) && motoristasSemLogin.length > 0 && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {vinculoAutomatico
                  ? 'Este motorista foi criado junto com o login. Se ele já existia em Operações → Motoristas, com as rotas dele, troque por ele:'
                  : 'Ou vincular a um motorista já cadastrado:'}
              </span>
              <select
                value={motoristaEscolhido}
                onChange={(e) => setMotoristaEscolhido(e.target.value)}
                aria-label="Motorista já cadastrado"
                title="Motoristas de Operações → Motoristas que ainda não têm login"
                style={{ minWidth: '220px' }}
              >
                <option value="">Escolha o motorista...</option>
                {motoristasSemLogin.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
              <button
                type="button"
                className="btn-secondary"
                disabled={!motoristaEscolhido || vinculando}
                onClick={() => void vincularMotoristaExistente()}
                title="As rotas deste motorista passam a aparecer no aplicativo deste usuário. O histórico de rotas e despesas do motorista continua igual."
              >
                {vinculando ? 'Vinculando...' : vinculoAutomatico ? 'Trocar por este' : 'Vincular'}
              </button>
            </div>
          )}
        </div>

        {ehMotorista && (
          <>
            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>Telefone do motorista</label>
              <input
                type="text"
                inputMode="tel"
                value={dadosMotorista.telefone}
                onChange={(e) => setDadosMotorista({ ...dadosMotorista, telefone: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>CNH</label>
              <input
                type="text"
                title="Número da habilitação"
                value={dadosMotorista.cnh}
                onChange={(e) => setDadosMotorista({ ...dadosMotorista, cnh: e.target.value })}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {isEditing
                  ? 'Ao salvar, esta pessoa já aparece na lista de motoristas das rotas.'
                  : 'Ao salvar, esta pessoa vai para Operações → Motoristas (vinculada a este usuário), aparece nas rotas e ganha o aplicativo com as entregas, se o plano tiver vaga no app.'}
              </span>
            </div>
          </>
        )}

        {!(copiarDeId && !isEditing) && (
        <div className="input-group" style={{ gridColumn: 'span 12', marginTop: '8px' }}>
          <div style={{ padding: '12px 16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 'var(--radius-md)', color: '#3b82f6', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserCog size={18} style={{ flexShrink: 0 }} />
            <span>As permissões de acesso deste usuário se configuram em <strong>Equipe &amp; Acessos</strong>, no botão de permissões (escudo) da linha dele{isEditing ? '' : ', depois de salvar — ou escolha acima "Copiar permissões de" para ele já nascer com as de outro usuário'}.</span>
          </div>
        </div>
        )}

        <div style={{ gridColumn: 'span 12', display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-color)' }}>
          <button type="button" className="btn-secondary" onClick={() => navigate('/usuarios')}>Cancelar</button>
          <button
            type="submit"
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            disabled={isLoading || !podeFicha}
            title={podeFicha ? undefined : 'Para alterar a ficha, peça a um responsável liberar "Admin: Equipe — alterar a ficha do funcionário" no seu cadastro de funcionário.'}
          >
            <Save size={20} />
            {isLoading ? 'Salvando...' : 'Salvar Funcionário'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default UsuarioForm;
