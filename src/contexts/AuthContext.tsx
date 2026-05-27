import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { doc, getDoc, setDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import Swal from 'sweetalert2';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  userRole: 'Admin' | 'Funcionario' | 'SuperAdmin' | null;
  userPermissions: string[];
  tenantId: string | null;
  blockedModules: string[];
  isOwner: boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<'Admin' | 'Funcionario' | 'SuperAdmin' | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [blockedModules, setBlockedModules] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeUserSnapshot: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeUserSnapshot) {
        unsubscribeUserSnapshot();
        unsubscribeUserSnapshot = null;
      }

      setCurrentUser(user);
      
      if (user) {
        try {
          // Inicia escuta em tempo real para obter perfil e sessões do usuário
          unsubscribeUserSnapshot = onSnapshot(doc(db, 'usuarios', user.uid), async (userSnap) => {
            if (userSnap.exists()) {
              const data = userSnap.data();
              
              // Validação de Sessão Única
              const currentLocalSession = localStorage.getItem('nexus_session_id');
              const serverSession = data.activeSessionId;
              
              if (serverSession) {
                if (!currentLocalSession) {
                  // Sincroniza sessão se local estiver vazia (ex: recarregou ou limpou cache)
                  localStorage.setItem('nexus_session_id', serverSession);
                } else if (serverSession !== currentLocalSession) {
                  // Sessão foi derrubada por outra conexão
                  localStorage.removeItem('nexus_session_id');
                  if (unsubscribeUserSnapshot) {
                    unsubscribeUserSnapshot();
                    unsubscribeUserSnapshot = null;
                  }
                  await signOut(auth);
                  Swal.fire({
                    title: 'Sessão Encerrada',
                    text: 'Esta conta foi conectada em outro dispositivo. Esta sessão foi finalizada.',
                    icon: 'warning',
                    confirmButtonColor: '#8b5cf6'
                  });
                  return;
                }
              }

              let finalRole = data.role || 'Admin';
              const finalTenant = data.tenantId || user.uid;
              const finalPermissions = data.permissoes || [];
              let finalBlockedModules: string[] = [];

              if (user.uid === finalTenant) {
                finalBlockedModules = data.modulosBloqueados || [];
              } else {
                try {
                  const ownerDoc = await getDoc(doc(db, 'usuarios', finalTenant));
                  if (ownerDoc.exists()) {
                    finalBlockedModules = ownerDoc.data().modulosBloqueados || [];
                  }
                } catch (e) {
                  console.error("Erro ao buscar modulos bloqueados do dono", e);
                }
              }

              // Hardcode para o dono do SaaS não precisar mexer no Firebase
              const emailLower = user.email?.toLowerCase();
              if (emailLower === 'ueddergomes@outlook.com' || emailLower === 'ueddergomes100@gmail.com') {
                finalRole = 'SuperAdmin';
              }

              setUserRole(finalRole as any);
              setUserPermissions(finalPermissions);
              setTenantId(finalTenant);
              setBlockedModules(finalBlockedModules);
              setIsOwner(user.uid === finalTenant);
            } else {
              // Salva base silenciosamente
              const baseProfile = {
                role: 'Admin',
                tenantId: user.uid,
                email: user.email,
                createdAt: new Date()
              };
              await setDoc(doc(db, 'usuarios', user.uid), baseProfile, { merge: true });

              setUserRole('Admin');
              setUserPermissions([]);
              setTenantId(user.uid);
              setBlockedModules([]);
              setIsOwner(true);
            }
            setLoading(false);
          }, (err) => {
            console.error("Erro no listener de usuário:", err);
            setLoading(false);
          });

        } catch (error) {
          console.error("Erro ao buscar perfil do usuário", error);
          setUserRole('Admin');
          setUserPermissions([]);
          setTenantId(user.uid);
          setBlockedModules([]);
          setIsOwner(true);
          setLoading(false);
        }
      } else {
        setUserRole(null);
        setUserPermissions([]);
        setTenantId(null);
        setBlockedModules([]);
        setIsOwner(false);
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

  const logout = async () => {
    if (currentUser && tenantId) {
      try {
        // Limpa o activeSessionId no Firestore ao deslogar
        await updateDoc(doc(db, 'usuarios', currentUser.uid), {
          activeSessionId: null
        });
        
        localStorage.removeItem('nexus_session_id');

        const { createAuditLog } = await import('../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'autenticacao',
          acao: 'logout',
          descricao: 'Usuário realizou logout.',
          status: 'sucesso'
        });
      } catch (err) {
        console.error('Erro ao registrar log de logout:', err);
      }
    }
    return signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ currentUser, loading, logout, userRole, userPermissions, tenantId, blockedModules, isOwner }}>
      {children}
    </AuthContext.Provider>
  );
};
