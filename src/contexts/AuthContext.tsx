import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { getIdTokenResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, getDoc, limit, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import Swal from 'sweetalert2';
import { auth, db } from '../services/firebase';
import { clearStoredSessionId, getStoredSessionId, setStoredSessionId } from '../utils/session';
import { permissoesEfetivas } from '../utils/permissoesAppDomain';
import { modulosBloqueadosEfetivos } from '../utils/moduleCatalog';
import { DEFAULT_CONFIG_CASHBACK, parseConfigCashback, type ConfigCashback } from '../utils/cashbackDomain';
import {
  buildActiveSessionWarningHtml,
  endSessionOnBackend,
  getCurrentSessionPath,
  type ActiveSessionInfo
} from '../utils/sessionInfo';
import { isPlatformAdminRole, isTenantManagerRole, normalizeUserRole, type UserRole } from '../utils/roles';
import { ehAppDoCaixa } from '../utils/frenteDeCaixaDomain';
import { activeTenantStorageKey, loadTenantOptions, type TenantOption } from '../utils/platformTenants';
import {
  DEFAULT_NIVEL_ACESSO,
  DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO,
  parseNivelAcesso,
  parseRestringirVendasPorUsuario,
  somenteVendasProprias as calcSomenteVendasProprias,
  type NivelAcesso,
} from '../utils/visibilidadeVendasDomain';
import {
  DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR,
  parseExigirIdentificacaoVendedor,
} from '../utils/vendedorPinDomain';
import { DEFAULT_LIBERACAO_ESCOLHER_VENDEDOR, parseLiberacaoEscolherVendedor } from '../utils/liberacaoRemotaDomain';
import { DEFAULT_TRABALHA_COM_ENTREGA_FUTURA, parseTrabalhaComEntregaFutura } from '../utils/entregaFuturaDomain';
import { DEFAULT_CONTROLA_FISCAL, parseControlaFiscal } from '../utils/fiscalDomain';
import { DEFAULT_HABILITAR_TELA_PRECIFICACAO } from '../utils/precificacaoDomain';
import {
  DEFAULT_AGENTE_DIGITAL_ATIVO,
  DEFAULT_TRABALHA_COM_PRE_VENDA,
  parseAgenteDigitalAtivo,
  parseTrabalhaComPreVenda,
} from '../utils/preVendaDomain';
import { DEFAULT_MODO_ROTA_PRE_VENDA, parseModoRotaPreVenda, type ModoRotaPreVenda } from '../utils/rotaPreVendaDomain';
import { DEFAULT_VALORES_NA_MINUTA_DO_APP, parseValoresNaMinutaDoApp, type ValoresNaMinutaDoApp } from '../utils/minutaDomain';
import { DEFAULT_CONFIG_BONIFICACAO, parseConfigBonificacao, type ConfigBonificacao } from '../utils/bonificacaoDomain';
import { DEFAULT_CONFERENCIA_MERCADORIA } from '../utils/conferenciaDomain';
import { ehGestorDoGrupo, filiaisDoUsuario, lerGrupo, podeUsarOutrasFiliais, type FilialDoGrupo, type GrupoEmpresarial, lerLimiteFiliais } from '../utils/filialDomain';
import { entrarNaFilial } from '../services/filialService';
import { DEFAULT_TRABALHA_COM_CONDICIONAL, parseTrabalhaComCondicional } from '../utils/condicionalDomain';
import { DEFAULT_LOTE_AVISAR_VENCIDO, DEFAULT_LOTE_MODO_SAIDA, parseLoteAvisarVencido, parseLoteModoSaida, type ModoSaidaLote } from '../utils/loteDomain';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  userRole: UserRole | null;
  userPermissions: string[];
  tenantId: string | null;
  blockedModules: string[];
  isOwner: boolean;
  /** Filiais (2026-10-06): a filial "casa" do usuario. `tenantId` e' a filial
   *  em que ele esta trabalhando agora (a ativa). Ver src/utils/filialDomain.ts. */
  homeTenantId: string | null;
  /** Grupo de filiais da empresa (null quando ela nao tem filiais). */
  grupo: GrupoEmpresarial | null;
  /** Filiais liberadas no plano da empresa casa (usuarios/{dono}.limiteFiliais). 0 = menu Filiais escondido. */
  limiteFiliais: number;
  /** Filiais em que o usuario pode entrar (ativas). */
  filiaisDoUsuario: FilialDoGrupo[];
  /** A filial em que o usuario esta agora (null sem grupo). */
  filialAtual: FilialDoGrupo | null;
  /** Pode trocar de filial (dono/admin, ou permissao "Utiliza outras filiais") e tem mais de uma. */
  podeTrocarFilial: boolean;
  /** Dono ou administrador: cadastra e altera filiais. */
  ehGestorDasFiliais: boolean;
  /** Pede ao servidor para entrar na filial. Quem chama fecha as abas e recarrega. */
  trocarFilial: (tenantId: string) => Promise<void>;
  isPlatformAdmin: boolean;
  tenantOptions: TenantOption[];
  selectedTenant: TenantOption | null;
  /** Retorna false quando o tenant pedido nao existe nas opcoes carregadas
   *  -- quem chama PRECISA checar antes de navegar pro ERP, senao o usuario
   *  cai na empresa anterior sem perceber (risco de mexer no cliente errado). */
  setActiveTenantId: (tenantId: string) => boolean;
  needsTenantSelection: boolean;
  /** Nivel de acesso do usuario dentro da empresa (Modulo de visibilidade
   *  de vendas). Governa SO a visibilidade de venda -- nao substitui as
   *  permissoes de modulo. Ver src/utils/visibilidadeVendasDomain.ts. */
  nivelAcesso: NivelAcesso;
  /** Config da empresa: "nao visualizar vendas de outro usuario". */
  restringirVendasPorUsuario: boolean;
  /** Config da empresa: "exigir identificacao do vendedor a cada venda". E'
   *  a marca de que a empresa trabalha em balcao compartilhado -- ver
   *  src/utils/vendedorCadastroDomain.ts. */
  exigirIdentificacaoVendedor: boolean;
  /** Config da empresa (22/10/2026): na liberacao de desconto pelo celular,
   *  a estacao compartilhada escolhe na lista o vendedor que esta' pedindo. */
  liberacaoEscolherVendedor: boolean;
  /** Config da empresa: false quando ela NAO emite documento fiscal por aqui.
   *  Esconde o menu Fiscal, o botao de NFC-e no fim da venda e o de imprimir
   *  cupom na lista. Ver DEFAULT_CONTROLA_FISCAL em fiscalDomain.ts. */
  controlaFiscal: boolean;
  /** Config da empresa: true quando a Devolucao de Venda deve ter tela/menu
   *  proprios (busca o pedido) em vez do botao dentro da tela do pedido.
   *  Mutuamente exclusivo com o botao inline -- ver PedidoVendaForm.tsx. */
  devolucaoBotaoSeparado: boolean;
  /** Config da empresa: liga a tela de Precificacao (precos em lote) no
   *  menu. Nasce desligada -- ver DEFAULT_HABILITAR_TELA_PRECIFICACAO em
   *  precificacaoDomain.ts. */
  habilitarTelaPrecificacao: boolean;
  /** Config da empresa: "trabalha com pré-venda" -- ver DEFAULT_TRABALHA_COM_PRE_VENDA
   *  em preVendaDomain.ts. Governa se a aba "Pré-vendas" aparece na
   *  listagem de Pedidos de Venda. */
  trabalhaComPreVenda: boolean;
  /** Config da filial (23/10/2026): venda para entrega futura (tela Expedição › Entregas futuras). */
  trabalhaComEntregaFutura: boolean;
  /** Config da filial: pergunta a rota de entrega ao gravar a pre-venda e
   *  quando o pedido entra nela (rotaPreVendaDomain.ts). 'nao' = como sempre. */
  modoRotaPreVenda: ModoRotaPreVenda;
  /** Minuta do App Vendas com ou sem precos (30/10/2026), por filial. */
  valoresNaMinutaDoApp: ValoresNaMinutaDoApp;
  /** Bonificacao no pedido (30/10/2026), por filial: ligada e limite %. */
  configBonificacao: ConfigBonificacao;
  /** Config da empresa: "Trabalha com condicional" -- ver condicionalDomain.ts. Sem ela o
   *  menu Condicional some e o servidor recusa criar condicional. */
  trabalhaComCondicional: boolean;
  /** Config da empresa: "Permitir venda sem estoque" (`venderSemEstoque`).
   *  O app do vendedor externo segue a mesma regra das demais telas de venda. */
  permiteVendaSemEstoque: boolean;
  /** Configuracoes Gerais: "Loja utiliza grade de produtos" (gradeProdutosDomain.ts).
   *  Liga o menu Cadastros Auxiliares > Grades e a grade no cadastro do produto. */
  usaGradeDeProdutos: boolean;
  /** Configuracoes Gerais: cashback (cashbackDomain.ts) -- modelo, padrao, validade e faixas. */
  configCashback: ConfigCashback;
  /** Config da empresa: Conferência de mercadoria (Módulo 12) ligada.
   *  Governa se a pré-venda nasce com `statusConferencia: 'aguardando'` e
   *  entra na Fila de Expedição -- tanto na tela de Pedido de Venda quanto
   *  na pré-venda criada pelo app do vendedor externo. */
  conferenciaMercadoriaAtiva: boolean;
  /** Lote e Validade: como o lote e' escolhido na saida, e se lote vencido avisa. */
  loteModoSaida: ModoSaidaLote;
  loteAvisarVencido: boolean;
  /** Config da empresa: recebe pedido pelo agente digital (WhatsApp) --
   *  ver DEFAULT_AGENTE_DIGITAL_ATIVO em preVendaDomain.ts. Governa se a
   *  aba "Pendentes" aparece na listagem de Pedidos de Venda. */
  agenteDigitalAtivo: boolean;
  /** Existe pelo menos um vendedor SEM LOGIN cadastrado nesta empresa. Serve
   *  so pra decidir se o menu "Vendedores" aparece: o cadastro nao pode
   *  sumir da vista quando alguem desmarca o checkbox por engano. */
  temVendedorCadastrado: boolean;
  /** true quando ESTE usuario so pode ver as proprias vendas. */
  somenteVendasProprias: boolean;
  /** Id pra filtrar vendas, ou null quando o usuario ve todas. Passe
   *  direto pra filtrarVendasVisiveis() -- ela ja trata o null. */
  vendasVisiveisDeUsuarioId: string | null;
  /** Este login (Usuario ou Vendedor de balcao) tem acesso ao aplicativo
   *  mobile do vendedor externo liberado. Ver acessoMobileDomain.ts. */
  acessoAppMobile: boolean;
  /** Nome de verdade do login (campo `nome` do doc usuarios/{uid}), nao o
   *  e-mail sintetico (`{cnpj}-{usuario}@nexar.app`) que auth.currentUser
   *  carrega pra login de Funcionario. */
  userNome: string;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

const getTokenRole = async (user: User): Promise<UserRole | null> => {
  try {
    const token = await getIdTokenResult(user);
    if (token.claims.nexarAdmin === true || token.claims.role === 'NexarAdmin') {
      return 'NexarAdmin';
    }
    if (token.claims.superAdmin === true || token.claims.role === 'SuperAdmin') {
      return 'SuperAdmin';
    }
    return normalizeUserRole(token.claims.role, 'Funcionario');
  } catch (error) {
    console.error('Erro ao carregar claims do usuario:', error);
    return null;
  }
};

// Mesmo conteudo -> devolve a MESMA lista (mesma referencia). O perfil
// (usuarios/{uid}) muda a cada 30 s por causa do sinal de sessao; recriar o
// array a cada disparo fazia todo efeito que depende de permissoes (TopBar,
// Sidebar...) desfazer e refazer as escutas, relendo colecoes inteiras do
// servidor a cada 30 s (otimizacao de leituras, 2026-10-14).
const manterSeIgual = <T,>(nova: T[]) => (atual: T[]): T[] => (
  atual.length === nova.length && atual.every((valor, indice) => valor === nova[indice]) ? atual : nova
);

// O plano (modulos bloqueados, limite de filiais) vem do documento do DONO.
// Antes era relido a cada disparo do perfil (a cada 30 s para quem nao e' o
// dono); agora vale por 5 min -- mudanca de plano chega em ate' 5 min.
const VALIDADE_PLANO_DO_DONO_MS = 5 * 60 * 1000;
// Mesma ideia para a lista de empresas do admin da plataforma (le os usuarios
// de TODAS as empresas).
const VALIDADE_EMPRESAS_DA_PLATAFORMA_MS = 5 * 60 * 1000;

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const isOnboardingIncomplete = (data: Record<string, unknown>, role: UserRole) => {
  if (isPlatformAdminRole(role)) {
    return false;
  }

  // Telefone e' coletado no cadastro (contato/WhatsApp) mas NAO exige mais
  // codigo de verificacao (2026-08-27, dependia de Twilio configurado em
  // producao) -- por isso telefoneVerificado nao entra mais aqui. So
  // e-mail continua sendo canal de confianca do cadastro.
  const hasOnboardingFlags =
    'onboardingStatus' in data ||
    'cnpjValidado' in data ||
    'emailVerificado' in data;

  if (!hasOnboardingFlags) {
    return false;
  }

  return data.onboardingStatus !== 'active' ||
    data.cnpjValidado !== true ||
    data.emailVerificado !== true;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [homeTenantId, setHomeTenantId] = useState<string | null>(null);
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<GrupoEmpresarial | null>(null);
  const [blockedModules, setBlockedModules] = useState<string[]>([]);
  const [limiteFiliais, setLimiteFiliais] = useState(0);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantOption | null>(null);
  const [nivelAcesso, setNivelAcesso] = useState<NivelAcesso>(DEFAULT_NIVEL_ACESSO);
  const [restringirVendasPorUsuario, setRestringirVendasPorUsuario] = useState(DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO);
  const [exigirIdentificacaoVendedor, setExigirIdentificacaoVendedor] = useState(DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR);
  const [liberacaoEscolherVendedor, setLiberacaoEscolherVendedor] = useState(DEFAULT_LIBERACAO_ESCOLHER_VENDEDOR);
  const [controlaFiscal, setControlaFiscal] = useState(DEFAULT_CONTROLA_FISCAL);
  const [devolucaoBotaoSeparado, setDevolucaoBotaoSeparado] = useState(false);
  const [habilitarTelaPrecificacao, setHabilitarTelaPrecificacao] = useState(DEFAULT_HABILITAR_TELA_PRECIFICACAO);
  const [trabalhaComPreVenda, setTrabalhaComPreVenda] = useState(DEFAULT_TRABALHA_COM_PRE_VENDA);
  const [trabalhaComEntregaFutura, setTrabalhaComEntregaFutura] = useState(DEFAULT_TRABALHA_COM_ENTREGA_FUTURA);
  const [modoRotaPreVenda, setModoRotaPreVenda] = useState<ModoRotaPreVenda>(DEFAULT_MODO_ROTA_PRE_VENDA);
  const [valoresNaMinutaDoApp, setValoresNaMinutaDoApp] = useState<ValoresNaMinutaDoApp>(DEFAULT_VALORES_NA_MINUTA_DO_APP);
  const [configBonificacao, setConfigBonificacao] = useState<ConfigBonificacao>(DEFAULT_CONFIG_BONIFICACAO);
  const [trabalhaComCondicional, setTrabalhaComCondicional] = useState(DEFAULT_TRABALHA_COM_CONDICIONAL);
  const [permiteVendaSemEstoque, setPermiteVendaSemEstoque] = useState(false);
  const [usaGradeDeProdutos, setUsaGradeDeProdutos] = useState(false);
  const [configCashback, setConfigCashback] = useState<ConfigCashback>(DEFAULT_CONFIG_CASHBACK);
  const [conferenciaMercadoriaAtiva, setConferenciaMercadoriaAtiva] = useState(DEFAULT_CONFERENCIA_MERCADORIA);
  const [loteModoSaida, setLoteModoSaida] = useState<ModoSaidaLote>(DEFAULT_LOTE_MODO_SAIDA);
  const [loteAvisarVencido, setLoteAvisarVencido] = useState(DEFAULT_LOTE_AVISAR_VENCIDO);
  const [agenteDigitalAtivo, setAgenteDigitalAtivo] = useState(DEFAULT_AGENTE_DIGITAL_ATIVO);
  const [temVendedorCadastrado, setTemVendedorCadastrado] = useState(false);
  const [acessoAppMobile, setAcessoAppMobile] = useState(false);
  const [userNome, setUserNome] = useState('');
  const [loading, setLoading] = useState(true);
  const sessionCloseTokenRef = useRef('');
  const planoDoDonoRef = useRef<{ homeTenant: string; lidoEmMs: number; bloqueados: string[]; limite: number } | null>(null);
  const empresasDaPlataformaRef = useRef<{ uid: string; lidoEmMs: number; opcoes: TenantOption[] } | null>(null);

  const setActiveTenantId = useCallback((nextTenantId: string): boolean => {
    const nextTenant = tenantOptions.find(option => option.id === nextTenantId) || null;
    if (!currentUser || !nextTenant) {
      return false;
    }

    localStorage.setItem(activeTenantStorageKey(currentUser.uid), nextTenant.id);
    setSelectedTenant(nextTenant);
    setTenantId(nextTenant.id);
    setBlockedModules([]);
    setIsOwner(false);
    return true;
  }, [currentUser, tenantOptions]);

  useEffect(() => {
    const handleActiveTenantSelected = (event: Event) => {
      const nextTenantId = (event as CustomEvent<string>).detail;
      if (typeof nextTenantId === 'string' && nextTenantId) {
        setActiveTenantId(nextTenantId);
      }
    };

    window.addEventListener('nexus-active-tenant-selected', handleActiveTenantSelected);
    return () => window.removeEventListener('nexus-active-tenant-selected', handleActiveTenantSelected);
  }, [setActiveTenantId]);

  useEffect(() => {
    let unsubscribeUserSnapshot: (() => void) | null = null;

      const clearUserState = () => {
        setCurrentUser(null);
        setUserRole(null);
        setUserPermissions([]);
        setNivelAcesso(DEFAULT_NIVEL_ACESSO);
        setTenantId(null);
        setHomeTenantId(null);
        setBlockedModules([]);
        setIsOwner(false);
        setTenantOptions([]);
        setSelectedTenant(null);
        setAcessoAppMobile(false);
        setUserNome('');
        planoDoDonoRef.current = null;
        empresasDaPlataformaRef.current = null;
        clearStoredSessionId();
      };

      const applyPlatformAdminState = async (user: User, role: UserRole) => {
        const guardadas = empresasDaPlataformaRef.current;
        let options: TenantOption[];
        if (guardadas && guardadas.uid === user.uid && Date.now() - guardadas.lidoEmMs < VALIDADE_EMPRESAS_DA_PLATAFORMA_MS) {
          options = guardadas.opcoes;
        } else {
          options = await loadTenantOptions();
          empresasDaPlataformaRef.current = { uid: user.uid, lidoEmMs: Date.now(), opcoes: options };
        }
        const storedTenantId = localStorage.getItem(activeTenantStorageKey(user.uid));
        const activeTenant = options.find(option => option.id === storedTenantId) || null;

        setUserRole(role);
        setUserPermissions(manterSeIgual<string>([]));
        setNivelAcesso('gerente');
        setTenantOptions(manterSeIgual(options));
        setSelectedTenant(activeTenant);
        setTenantId(activeTenant?.id || null);
        setHomeTenantId(null);
        setBlockedModules(manterSeIgual<string>([]));
        setIsOwner(false);
        setLoading(false);
      };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeUserSnapshot) {
        unsubscribeUserSnapshot();
        unsubscribeUserSnapshot = null;
      }

      setCurrentUser(user);

      if (user) {
        try {
          const tokenRole = await getTokenRole(user);

          unsubscribeUserSnapshot = onSnapshot(doc(db, 'usuarios', user.uid), async (userSnap) => {
            if (!userSnap.exists()) {
              if (isPlatformAdminRole(tokenRole)) {
                await applyPlatformAdminState(user, tokenRole as UserRole);
                return;
              }

              clearUserState();
              if (unsubscribeUserSnapshot) {
                unsubscribeUserSnapshot();
                unsubscribeUserSnapshot = null;
              }
              await signOut(auth);
              Swal.fire({
                title: 'Acesso nao autorizado',
                text: 'Nao encontramos um perfil ativo para este usuario. Fale com o administrador.',
                icon: 'error',
                confirmButtonColor: '#8b5cf6'
              });
              setLoading(false);
              return;
            }

            const data = userSnap.data() as Record<string, unknown>;
            const currentLocalSession = getStoredSessionId();
            const serverSession = typeof data.activeSessionId === 'string' ? data.activeSessionId : '';
            const activeSession = (data.activeSession as ActiveSessionInfo | undefined) || null;

            // O app da Frente de Caixa (/caixa, 19/10/2026) fica fora da sessao
            // unica: nao adota nem derruba a sessao do sistema aberto em outra aba.
            if (serverSession && !ehAppDoCaixa(window.location.pathname)) {
              if (!currentLocalSession) {
                setStoredSessionId(serverSession);
              } else if (serverSession !== currentLocalSession) {
                clearStoredSessionId();
                if (unsubscribeUserSnapshot) {
                  unsubscribeUserSnapshot();
                  unsubscribeUserSnapshot = null;
                }
                await signOut(auth);
                Swal.fire({
                  title: 'Sessao encerrada',
                  html: buildActiveSessionWarningHtml(activeSession),
                  icon: 'warning',
                  confirmButtonColor: '#8b5cf6'
                });
                return;
              }
            }

            const profileFallback = user.uid === data.tenantId ? 'Master' : 'Funcionario';
            const finalRole = isPlatformAdminRole(tokenRole)
              ? tokenRole as UserRole
              : normalizeUserRole(data.role, profileFallback);

            if (isPlatformAdminRole(finalRole)) {
              await applyPlatformAdminState(user, finalRole);
              return;
            }

            if (isOnboardingIncomplete(data, finalRole)) {
              clearUserState();
              if (unsubscribeUserSnapshot) {
                unsubscribeUserSnapshot();
                unsubscribeUserSnapshot = null;
              }
              await signOut(auth);
              Swal.fire({
                title: 'Cadastro em validacao',
                text: 'Este cadastro ainda nao concluiu a validacao obrigatoria de CNPJ, e-mail e telefone.',
                icon: 'warning',
                confirmButtonColor: '#8b5cf6'
              });
              setLoading(false);
              return;
            }

            // Cadastro de vendedor de balcao (sem login) so' entra pelo app, com
            // o codigo e a senha dele (token com isVendedorBalcao). Login de
            // e-mail ligado a um cadastro desses seria uma vaga fora do plano
            // (19/10/2026; as firestore.rules recusam do mesmo jeito).
            if (data.tipoRegistro === 'vendedor') {
              const claims = (await getIdTokenResult(user)).claims;
              if (claims.isVendedorBalcao !== true) {
                clearUserState();
                if (unsubscribeUserSnapshot) {
                  unsubscribeUserSnapshot();
                  unsubscribeUserSnapshot = null;
                }
                await signOut(auth);
                Swal.fire({
                  title: 'Acesso não autorizado',
                  text: 'Este cadastro é de vendedor de balcão: ele entra só pelo aplicativo, com o código e a senha de vendedor. Para usar o sistema, o administrador precisa criar um login em Equipe & Acessos.',
                  icon: 'warning',
                  confirmButtonColor: '#8b5cf6'
                });
                setLoading(false);
                return;
              }
            }

            // Funcionario inativado em Equipe & Acessos (UsuariosList.tsx) --
            // derruba a sessao ao vivo, nao so na proxima tela. O dono/gestor
            // nunca cai aqui: a tela nem mostra o botao de inativar pra
            // Master/Admin, so pra Funcionario/Mecanico/Vendedor com login.
            if (data.status === 'Inativo' && !isTenantManagerRole(finalRole)) {
              clearUserState();
              if (unsubscribeUserSnapshot) {
                unsubscribeUserSnapshot();
                unsubscribeUserSnapshot = null;
              }
              await signOut(auth);
              Swal.fire({
                title: 'Acesso desativado',
                text: 'Seu usuario foi inativado pelo administrador da empresa. Fale com ele para reativar o acesso.',
                icon: 'warning',
                confirmButtonColor: '#8b5cf6'
              });
              setLoading(false);
              return;
            }

            // Filial "casa" do usuario e a filial em que ele esta trabalhando
            // (filialAtiva, gravada so' pelo servidor ao trocar de filial). As
            // firestore.rules usam a mesma regra em currentTenantId().
            const homeTenant = typeof data.tenantId === 'string' && data.tenantId ? data.tenantId : user.uid;
            const finalTenant = typeof data.filialAtiva === 'string' && data.filialAtiva ? data.filialAtiva : homeTenant;
            // Permissoes do app (26/10/2026): quem nunca teve o app gravado conta com as
            // chaves novas do app (ninguem perde acesso) -- permissoesAppDomain.ts.
            const finalPermissions = permissoesEfetivas(toStringArray(data.permissoes));
            setAcessoAppMobile(data.acessoAppMobile === true);
            setUserNome(typeof data.nome === 'string' && data.nome ? data.nome : (typeof data.nomeResponsavel === 'string' ? data.nomeResponsavel : ''));
            let finalBlockedModules: string[] = [];
            let limiteFiliaisDoPlano = 0;

            // Modulos do plano: do dono da empresa CASA (na filial, o grupo
            // sobrepoe -- ver o efeito do grupo). Ler usuarios/{filial} dava
            // permissao negada: a filial nao tem usuario proprio.
            if (user.uid === homeTenant) {
              finalBlockedModules = toStringArray(data.modulosBloqueados);
              limiteFiliaisDoPlano = lerLimiteFiliais(data.limiteFiliais);
            } else {
              const guardado = planoDoDonoRef.current?.homeTenant === homeTenant ? planoDoDonoRef.current : null;
              if (guardado && Date.now() - guardado.lidoEmMs < VALIDADE_PLANO_DO_DONO_MS) {
                finalBlockedModules = guardado.bloqueados;
                limiteFiliaisDoPlano = guardado.limite;
              } else {
                try {
                  const ownerDoc = await getDoc(doc(db, 'usuarios', homeTenant));
                  if (ownerDoc.exists()) {
                    finalBlockedModules = toStringArray(ownerDoc.data().modulosBloqueados);
                    limiteFiliaisDoPlano = lerLimiteFiliais(ownerDoc.data().limiteFiliais);
                  }
                  planoDoDonoRef.current = { homeTenant, lidoEmMs: Date.now(), bloqueados: finalBlockedModules, limite: limiteFiliaisDoPlano };
                } catch (error) {
                  console.error('Erro ao buscar modulos bloqueados do dono:', error);
                  // Falha de rede nao libera modulo: fica o ultimo plano lido.
                  if (guardado) {
                    finalBlockedModules = guardado.bloqueados;
                    limiteFiliaisDoPlano = guardado.limite;
                  }
                }
              }
            }

            setUserRole(finalRole);
            setUserPermissions(manterSeIgual(finalPermissions));
            setNivelAcesso(parseNivelAcesso(data.nivelAcesso));
            setTenantOptions(manterSeIgual<TenantOption>([]));
            setSelectedTenant(null);
            setTenantId(finalTenant);
            setHomeTenantId(homeTenant);
            setBlockedModules(manterSeIgual(finalBlockedModules));
            setLimiteFiliais(limiteFiliaisDoPlano);
            // Dono = quem abriu a conta (a casa dele e' o uid), em qualquer filial.
            setIsOwner(user.uid === homeTenant);
            setLoading(false);
          }, (error) => {
            console.error('Erro no listener de usuario:', error);
            clearUserState();
            signOut(auth).catch(() => {});
            setLoading(false);
          });
        } catch (error) {
          console.error('Erro ao buscar perfil do usuario:', error);
          clearUserState();
          await signOut(auth).catch(() => {});
          setLoading(false);
        }
      } else {
        setUserRole(null);
        setUserPermissions([]);
        setNivelAcesso(DEFAULT_NIVEL_ACESSO);
        setTenantId(null);
        setHomeTenantId(null);
        setBlockedModules([]);
        setIsOwner(false);
        setTenantOptions([]);
        setSelectedTenant(null);
        setAcessoAppMobile(false);
        setUserNome('');
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserSnapshot) {
        unsubscribeUserSnapshot();
      }
    };
  }, []);

  // Config "nao visualizar vendas de outro usuario" da empresa ativa.
  // Fica aqui, e nao em cada tela, por dois motivos: e' regra de
  // visibilidade usada por ~15 telas (Vendas, Dashboard, Financeiro,
  // Fiscal, Expedicao, relatorios), e precisa ser ao vivo -- o dono
  // desliga a restricao e o funcionario passa a ver tudo sem relogar.
  useEffect(() => {
    if (!tenantId) {
      setRestringirVendasPorUsuario(DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO);
      setExigirIdentificacaoVendedor(DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR);
      setControlaFiscal(DEFAULT_CONTROLA_FISCAL);
      setDevolucaoBotaoSeparado(false);
      setTrabalhaComPreVenda(DEFAULT_TRABALHA_COM_PRE_VENDA);
      setModoRotaPreVenda(DEFAULT_MODO_ROTA_PRE_VENDA);
      setValoresNaMinutaDoApp(DEFAULT_VALORES_NA_MINUTA_DO_APP);
      setConfigBonificacao(DEFAULT_CONFIG_BONIFICACAO);
      setTrabalhaComCondicional(DEFAULT_TRABALHA_COM_CONDICIONAL);
      setPermiteVendaSemEstoque(false);
      setUsaGradeDeProdutos(false);
      setConfigCashback(DEFAULT_CONFIG_CASHBACK);
      setAgenteDigitalAtivo(DEFAULT_AGENTE_DIGITAL_ATIVO);
      setConferenciaMercadoriaAtiva(DEFAULT_CONFERENCIA_MERCADORIA);
      setLoteModoSaida(DEFAULT_LOTE_MODO_SAIDA);
      setLoteAvisarVencido(DEFAULT_LOTE_AVISAR_VENCIDO);
      setGrupoId(null);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, 'configuracoes', tenantId), (snap) => {
      // Filiais: o grupo da empresa (so' o servidor grava esse campo).
      const grupoDaEmpresa = snap.exists() ? snap.data().grupoId : null;
      setGrupoId(typeof grupoDaEmpresa === 'string' && grupoDaEmpresa ? grupoDaEmpresa : null);
      setRestringirVendasPorUsuario(
        parseRestringirVendasPorUsuario(snap.exists() ? snap.data().restringirVendasPorUsuario : undefined),
      );
      // Mesma leitura, mesmo listener: as duas configs vivem no mesmo
      // documento e mudam juntas na tela de Configuracoes.
      setExigirIdentificacaoVendedor(
        parseExigirIdentificacaoVendedor(snap.exists() ? snap.data().exigirIdentificacaoVendedor : undefined),
      );
      setLiberacaoEscolherVendedor(
        parseLiberacaoEscolherVendedor(snap.exists() ? snap.data().liberacaoEscolherVendedor : undefined),
      );
      // Mesma leitura: a empresa que nao emite nota nao pode ver botao de
      // nota, e isso muda ao vivo quando o dono desmarca em Configuracoes.
      setControlaFiscal(parseControlaFiscal(snap.exists() ? snap.data().controlaFiscal : undefined));
      // Mesma leitura: decide se a Devolucao de Venda vira tela/menu
      // separados ou continua so como botao dentro do pedido.
      setDevolucaoBotaoSeparado(Boolean(snap.exists() && snap.data().devolucaoBotaoSeparado === true));
      // Mesma leitura: liga a tela de Precificacao no menu (nasce desligada).
      setHabilitarTelaPrecificacao(Boolean(snap.exists() && snap.data().habilitarTelaPrecificacao === true));
      // Mesma leitura: governam as abas "Pré-vendas" e "Pendentes" na
      // listagem de Pedidos de Venda (PedidoVendas.tsx).
      setTrabalhaComPreVenda(parseTrabalhaComPreVenda(snap.exists() ? snap.data().trabalhaComPreVenda : undefined));
      setTrabalhaComEntregaFutura(parseTrabalhaComEntregaFutura(snap.exists() ? snap.data().trabalhaComEntregaFutura : undefined));
      // Mesma leitura: rota de entrega na pre-venda (21/10/2026), por filial.
      setModoRotaPreVenda(parseModoRotaPreVenda(snap.exists() ? snap.data().rotaNaPreVenda : undefined));
      setValoresNaMinutaDoApp(parseValoresNaMinutaDoApp(snap.exists() ? snap.data().appMinutaValores : undefined));
      setConfigBonificacao(parseConfigBonificacao(snap.exists() ? snap.data().bonificacao : undefined));
      setTrabalhaComCondicional(parseTrabalhaComCondicional(snap.exists() ? snap.data().trabalhaComCondicional : undefined));
      setAgenteDigitalAtivo(parseAgenteDigitalAtivo(snap.exists() ? snap.data().agenteDigitalAtivo : undefined));
      setPermiteVendaSemEstoque(snap.exists() && snap.data().venderSemEstoque === true);
      // Mesma leitura: a grade de produtos nasce desligada, como toda chave nova.
      setUsaGradeDeProdutos(snap.exists() && snap.data().usaGradeDeProdutos === true);
      setConfigCashback(parseConfigCashback(snap.exists() ? snap.data().cashback : undefined));
      // Mesma leitura: governa se a pre-venda (computador OU app do
      // vendedor externo) nasce 'aguardando' conferencia -- ver
      // criarPreVendaExterna em vendedorExternoVendaService.ts.
      setConferenciaMercadoriaAtiva(snap.exists() && snap.data().conferenciaMercadoria === true);
      setLoteModoSaida(parseLoteModoSaida(snap.exists() ? snap.data().loteModoSaida : undefined));
      setLoteAvisarVencido(parseLoteAvisarVencido(snap.exists() ? snap.data().loteAvisarVencido : undefined));
    }, (error) => {
      // Falha de leitura MANTEM o valor atual de proposito. Cair pro
      // default (false) aqui abriria as vendas de todo mundo pro
      // funcionario restrito por causa de uma queda de rede.
      console.error('Erro ao carregar a configuracao de visibilidade de vendas:', error);
    });

    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    // O app da Frente de Caixa nao tem sessao unica para manter viva nem encerrar.
    if (!currentUser || ehAppDoCaixa(window.location.pathname)) {
      sessionCloseTokenRef.current = '';
      return;
    }

    let cancelled = false;
    const userRef = doc(db, 'usuarios', currentUser.uid);

    const sendHeartbeat = async () => {
      const sessionId = getStoredSessionId();
      if (!sessionId) {
        return;
      }

      try {
        const token = await currentUser.getIdToken();
        if (!cancelled) {
          sessionCloseTokenRef.current = token;
        }

        await runTransaction(db, async (transaction) => {
          const userSnap = await transaction.get(userRef);
          if (!userSnap.exists() || userSnap.data().activeSessionId !== sessionId) {
            return;
          }

          transaction.update(userRef, {
            'activeSession.lastSeenAt': serverTimestamp(),
            'activeSession.lastSeenClientAt': new Date().toISOString(),
            'activeSession.lastPath': getCurrentSessionPath()
          });
        });
      } catch (error) {
        console.warn('Nao foi possivel atualizar a atividade da sessao:', error);
      }
    };

    const closeSession = () => {
      const sessionId = getStoredSessionId();
      const token = sessionCloseTokenRef.current;
      if (sessionId && token) {
        endSessionOnBackend(sessionId, token);
      }
    };

    void sendHeartbeat();
    const heartbeatInterval = window.setInterval(() => {
      void sendHeartbeat();
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', closeSession);
    window.addEventListener('beforeunload', closeSession);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', closeSession);
      window.removeEventListener('beforeunload', closeSession);
    };
  }, [currentUser]);

  const logout = async () => {
    // Sair do app da Frente de Caixa nao encerra a sessao do sistema (que pode
    // estar aberto em outra aba, com a mesma pessoa) nem apaga as abas dele.
    const noAppDoCaixa = ehAppDoCaixa(window.location.pathname);
    if (currentUser && tenantId) {
      try {
        if (!noAppDoCaixa) {
          const localSessionId = getStoredSessionId();
          const userRef = doc(db, 'usuarios', currentUser.uid);
          await runTransaction(db, async (transaction) => {
            const userSnap = await transaction.get(userRef);
            if (!userSnap.exists()) {
              return;
            }

            const activeSessionId = userSnap.data().activeSessionId;
            if (localSessionId && activeSessionId && activeSessionId !== localSessionId) {
              return;
            }

            transaction.update(userRef, {
              activeSessionId: null,
              'activeSession.endedAt': serverTimestamp(),
              'activeSession.closedBy': 'logout',
              lastSessionEndedAt: serverTimestamp()
            });
          });
        }

        const { createAuditLog } = await import('../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'autenticacao',
          acao: 'logout',
          descricao: noAppDoCaixa ? 'Usuario saiu da Frente de Caixa.' : 'Usuario realizou logout.',
          status: 'sucesso'
        });
      } catch (error) {
        console.error('Erro ao registrar log de logout:', error);
      }
    }
    if (!noAppDoCaixa) {
      clearStoredSessionId();
      localStorage.removeItem('nexus_tabs_v1');
    }
    sessionCloseTokenRef.current = '';
    return signOut(auth);
  };

  // Existe vendedor sem login cadastrado? Decide so a visibilidade do menu
  // "Cadastros Auxiliares > Vendedores". Consulta SO' os registros de
  // vendedor (tipoRegistro 'vendedor', ver vendedorCadastroDomain), com
  // limit(1): eles nao tem login, entao nunca recebem o sinal de sessao.
  // Antes escutava todos os usuarios da empresa, e cada sinal de 30 s de
  // cada pessoa logada virava uma leitura em cada tela aberta (2026-10-14).
  // So' igualdades: nao precisa de indice composto.
  useEffect(() => {
    if (!tenantId) {
      setTemVendedorCadastrado(false);
      return;
    }

    const unsubscribe = onSnapshot(
      query(collection(db, 'usuarios'), where('tenantId', '==', tenantId), where('tipoRegistro', '==', 'vendedor'), limit(1)),
      (snap) => setTemVendedorCadastrado(!snap.empty),
      (error) => {
        // Falha de leitura nao esconde o menu: sumir com o cadastro por
        // causa de uma queda de rede vale um chamado de suporte.
        console.error('Erro ao verificar vendedores cadastrados:', error);
      },
    );

    return () => unsubscribe();
  }, [tenantId]);

  // Grupo de filiais da empresa ativa, ao vivo (o dono cadastra ou renomeia
  // uma filial e o seletor do topo ja' mostra).
  useEffect(() => {
    if (!grupoId) {
      setGrupo(null);
      return undefined;
    }
    const unsubscribe = onSnapshot(
      doc(db, 'grupos', grupoId),
      (snap) => setGrupo(snap.exists() ? lerGrupo(snap.id, snap.data()) : null),
      (error) => console.error('Erro ao carregar as filiais da empresa:', error),
    );
    return () => unsubscribe();
  }, [grupoId]);

  const usuarioDasFiliais = useMemo(
    () => ({ uid: currentUser?.uid || '', role: userRole, permissoes: userPermissions, tenantId: homeTenantId }),
    [currentUser, userRole, userPermissions, homeTenantId],
  );
  const filiaisDoUsuarioAtual = useMemo(() => filiaisDoUsuario(grupo, usuarioDasFiliais), [grupo, usuarioDasFiliais]);
  const filialAtual = useMemo(() => grupo?.filiais.find((f) => f.tenantId === tenantId) ?? null, [grupo, tenantId]);
  const podeTrocarFilial = podeUsarOutrasFiliais(grupo, usuarioDasFiliais) && filiaisDoUsuarioAtual.length > 1;
  // Sem grupo ainda, quem pode criar a primeira filial e' o dono/administrador da empresa.
  const ehGestorDasFiliais = grupo ? ehGestorDoGrupo(grupo, usuarioDasFiliais) : isTenantManagerRole(userRole);
  // O plano (modulos) e' do grupo: fora da matriz, valem os bloqueios dela.
  // Modulo filho de pai bloqueado (28/10/2026) conta como bloqueado -- MODULO_PAI.
  const modulosDoPlano = grupo && tenantId && tenantId !== grupo.matrizTenantId ? grupo.modulosBloqueados : blockedModules;
  const blockedModulesEfetivos = useMemo(() => modulosBloqueadosEfetivos(modulosDoPlano), [modulosDoPlano]);
  const trocarFilial = useCallback(async (destino: string) => {
    await entrarNaFilial(destino);
  }, []);

  const isPlatformAdmin = isPlatformAdminRole(userRole);
  const needsTenantSelection = isPlatformAdmin && !tenantId;

  const restrictedToOwnSales = calcSomenteVendasProprias({
    restricaoAtiva: restringirVendasPorUsuario,
    nivelAcesso,
    role: userRole,
    isOwner,
    // No balcao compartilhado quem esta logado e' a ESTACAO, nao a pessoa --
    // filtrar por uid ali esconde da estacao a venda que ela acabou de fazer.
    // Ver somenteVendasProprias.
    identificacaoVendedorAtiva: exigirIdentificacaoVendedor,
  });
  const vendasVisiveisDeUsuarioId = restrictedToOwnSales ? (currentUser?.uid ?? null) : null;

  return (
    <AuthContext.Provider value={{ currentUser, loading, logout, userRole, userPermissions, tenantId, blockedModules: blockedModulesEfetivos, isOwner, homeTenantId, grupo, limiteFiliais, filiaisDoUsuario: filiaisDoUsuarioAtual, filialAtual, podeTrocarFilial, ehGestorDasFiliais, trocarFilial, isPlatformAdmin, tenantOptions, selectedTenant, setActiveTenantId, needsTenantSelection, nivelAcesso, restringirVendasPorUsuario, exigirIdentificacaoVendedor, liberacaoEscolherVendedor, controlaFiscal, devolucaoBotaoSeparado, habilitarTelaPrecificacao, trabalhaComPreVenda, trabalhaComEntregaFutura, modoRotaPreVenda, valoresNaMinutaDoApp, configBonificacao, trabalhaComCondicional, permiteVendaSemEstoque, usaGradeDeProdutos, configCashback, conferenciaMercadoriaAtiva, loteModoSaida, loteAvisarVencido, agenteDigitalAtivo, temVendedorCadastrado, somenteVendasProprias: restrictedToOwnSales, vendasVisiveisDeUsuarioId, acessoAppMobile, userNome }}>
      {children}
    </AuthContext.Provider>
  );
};
