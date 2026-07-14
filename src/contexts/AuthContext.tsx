import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { getIdTokenResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import Swal from 'sweetalert2';
import { auth, db } from '../services/firebase';
import { clearStoredSessionId, getStoredSessionId, setStoredSessionId } from '../utils/session';
import {
  buildActiveSessionWarningHtml,
  endSessionOnBackend,
  getCurrentSessionPath,
  type ActiveSessionInfo
} from '../utils/sessionInfo';
import { isPlatformAdminRole, normalizeUserRole, type UserRole } from '../utils/roles';
import { activeTenantStorageKey, loadTenantOptions, type TenantOption } from '../utils/platformTenants';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  userRole: UserRole | null;
  userPermissions: string[];
  tenantId: string | null;
  blockedModules: string[];
  isOwner: boolean;
  isPlatformAdmin: boolean;
  tenantOptions: TenantOption[];
  selectedTenant: TenantOption | null;
  setActiveTenantId: (tenantId: string) => void;
  needsTenantSelection: boolean;
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

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const isOnboardingIncomplete = (data: Record<string, unknown>, role: UserRole) => {
  if (isPlatformAdminRole(role)) {
    return false;
  }

  const hasOnboardingFlags =
    'onboardingStatus' in data ||
    'cnpjValidado' in data ||
    'emailVerificado' in data ||
    'telefoneVerificado' in data;

  if (!hasOnboardingFlags) {
    return false;
  }

  return data.onboardingStatus !== 'active' ||
    data.cnpjValidado !== true ||
    data.emailVerificado !== true ||
    data.telefoneVerificado !== true;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [blockedModules, setBlockedModules] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantOption | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionCloseTokenRef = useRef('');

  const setActiveTenantId = useCallback((nextTenantId: string) => {
    const nextTenant = tenantOptions.find(option => option.id === nextTenantId) || null;
    if (!currentUser || !nextTenant) {
      return;
    }

    localStorage.setItem(activeTenantStorageKey(currentUser.uid), nextTenant.id);
    setSelectedTenant(nextTenant);
    setTenantId(nextTenant.id);
    setBlockedModules([]);
    setIsOwner(false);
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
        setTenantId(null);
        setBlockedModules([]);
        setIsOwner(false);
        setTenantOptions([]);
        setSelectedTenant(null);
        clearStoredSessionId();
      };

      const applyPlatformAdminState = async (user: User, role: UserRole) => {
        const options = await loadTenantOptions();
        const storedTenantId = localStorage.getItem(activeTenantStorageKey(user.uid));
        const activeTenant = options.find(option => option.id === storedTenantId) || null;

        setUserRole(role);
        setUserPermissions([]);
        setTenantOptions(options);
        setSelectedTenant(activeTenant);
        setTenantId(activeTenant?.id || null);
        setBlockedModules([]);
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

            if (serverSession) {
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

            const finalTenant = typeof data.tenantId === 'string' && data.tenantId ? data.tenantId : user.uid;
            const finalPermissions = toStringArray(data.permissoes);
            let finalBlockedModules: string[] = [];

            if (user.uid === finalTenant) {
              finalBlockedModules = toStringArray(data.modulosBloqueados);
            } else {
              try {
                const ownerDoc = await getDoc(doc(db, 'usuarios', finalTenant));
                if (ownerDoc.exists()) {
                  finalBlockedModules = toStringArray(ownerDoc.data().modulosBloqueados);
                }
              } catch (error) {
                console.error('Erro ao buscar modulos bloqueados do dono:', error);
              }
            }

            setUserRole(finalRole);
            setUserPermissions(finalPermissions);
            setTenantOptions([]);
            setSelectedTenant(null);
            setTenantId(finalTenant);
            setBlockedModules(finalBlockedModules);
            setIsOwner(user.uid === finalTenant);
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
        setTenantId(null);
        setBlockedModules([]);
        setIsOwner(false);
        setTenantOptions([]);
        setSelectedTenant(null);
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

  useEffect(() => {
    if (!currentUser) {
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
    if (currentUser && tenantId) {
      try {
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

        const { createAuditLog } = await import('../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'autenticacao',
          acao: 'logout',
          descricao: 'Usuario realizou logout.',
          status: 'sucesso'
        });
      } catch (error) {
        console.error('Erro ao registrar log de logout:', error);
      }
    }
    clearStoredSessionId();
    sessionCloseTokenRef.current = '';
    return signOut(auth);
  };

  const isPlatformAdmin = isPlatformAdminRole(userRole);
  const needsTenantSelection = isPlatformAdmin && !tenantId;

  return (
    <AuthContext.Provider value={{ currentUser, loading, logout, userRole, userPermissions, tenantId, blockedModules, isOwner, isPlatformAdmin, tenantOptions, selectedTenant, setActiveTenantId, needsTenantSelection }}>
      {children}
    </AuthContext.Provider>
  );
};
