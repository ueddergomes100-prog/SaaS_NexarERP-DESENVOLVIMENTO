import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  userRole: 'Admin' | 'Funcionario' | 'SuperAdmin' | null;
  userPermissions: string[];
  tenantId: string | null;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<'Admin' | 'Funcionario' | 'SuperAdmin' | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      
      if (user) {
        try {
          // Busca o perfil do usuário para descobrir a role e o tenantId
          const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
          
          let finalRole = 'Admin';
          let finalTenant = user.uid;
          let finalPermissions: string[] = [];

          if (userDoc.exists()) {
            const data = userDoc.data();
            finalRole = data.role || 'Admin';
            finalTenant = data.tenantId || user.uid;
            finalPermissions = data.permissoes || [];
          } else {
            // Salva silenciosamente o doc base
            await setDoc(doc(db, 'usuarios', user.uid), {
              role: 'Admin',
              tenantId: user.uid,
              email: user.email,
              createdAt: new Date()
            }, { merge: true });
          }

          // Hardcode para o dono do SaaS não precisar mexer no Firebase
          const emailLower = user.email?.toLowerCase();
          if (emailLower === 'ueddergomes@outlook.com' || emailLower === 'ueddergomes100@gmail.com') {
            finalRole = 'SuperAdmin';
          }

          setUserRole(finalRole as any);
          setUserPermissions(finalPermissions);
          setTenantId(finalTenant);
          
        } catch (error) {
          console.error("Erro ao buscar perfil do usuário", error);
          setUserRole('Admin');
          setUserPermissions([]);
          setTenantId(user.uid);
        }
      } else {
        setUserRole(null);
        setUserPermissions([]);
        setTenantId(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    if (currentUser && tenantId) {
      try {
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
    <AuthContext.Provider value={{ currentUser, loading, logout, userRole, userPermissions, tenantId }}>
      {children}
    </AuthContext.Provider>
  );
};
