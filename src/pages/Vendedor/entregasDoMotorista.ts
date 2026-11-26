import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { hasTenantFullAccess } from '../../utils/roles';

/*
 * QUEM VE QUAL ROTA NO APP (28/10/2026, pedido do dono): igual as vendas do
 * app, cada motorista ve so' as rotas dele. O dono ve todas; os outros com a
 * permissao "App: Entregas -- ver as rotas de todos os motoristas" (troca do
 * administrador, 25/11/2026: o administrador ve pela permissao, que ele tem
 * enquanto o dono nao salvar as dele). Rota de outro motorista aberta pelo
 * link tambem fica fechada.
 */

export const PERMISSAO_ENTREGAS_TODAS = 'operacoes.entregas_app_todas';

/** O dono, ou quem tem a permissao, ve as rotas de todos os motoristas. */
export const veTodasAsRotas = (userRole: unknown, isOwner: boolean, permissoes: readonly string[] = []): boolean => (
  hasTenantFullAccess(userRole, isOwner) || permissoes.includes(PERMISSAO_ENTREGAS_TODAS)
);

/**
 * A rota e' deste motorista: o motorista dela e' o proprio login ou o cadastro
 * de motorista vinculado a ele (usuarios/{uid}.motoristaId, 26/10/2026).
 */
export const rotaEhDoMotorista = (motoristaDaRota: string | undefined, uid: string | undefined, motoristaVinculado: string): boolean => {
  const motorista = String(motoristaDaRota || '');
  if (!motorista) return false;
  return motorista === uid || (Boolean(motoristaVinculado) && motorista === motoristaVinculado);
};

/** Cadastro de motorista vinculado ao login; `carregado` evita fechar a rota antes de saber. */
export const useMotoristaVinculado = (uid: string | undefined) => {
  const [estado, setEstado] = useState({ uid: '', motoristaId: '', carregado: false });
  useEffect(() => {
    if (!uid) return;
    let ativo = true;
    getDoc(doc(db, 'usuarios', uid))
      .then((s) => { if (ativo) setEstado({ uid, motoristaId: s.exists() ? String(s.data().motoristaId || '') : '', carregado: true }); })
      .catch(() => { if (ativo) setEstado({ uid, motoristaId: '', carregado: true }); });
    return () => { ativo = false; };
  }, [uid]);
  const doLoginAtual = estado.uid === uid;
  return { motoristaVinculado: doLoginAtual ? estado.motoristaId : '', carregado: doLoginAtual && estado.carregado };
};
