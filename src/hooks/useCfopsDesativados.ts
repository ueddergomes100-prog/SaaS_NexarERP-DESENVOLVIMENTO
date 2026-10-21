import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { lerCfopsDesativados } from '../utils/cfopDomain';

/**
 * CFOPs que a empresa desativou (Fiscal › Tabelas Fiscais), ao vivo de
 * `configuracoes/{filial}.cfopsDesativados`. O servidor grava o mesmo valor em
 * todas as filiais do grupo. Ver cfopDomain.ts.
 */
export const useCfopsDesativados = (): { desativados: string[]; carregado: boolean } => {
  const { tenantId } = useAuth();
  const [desativados, setDesativados] = useState<string[]>([]);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const parar = onSnapshot(doc(db, 'configuracoes', tenantId), (snap) => {
      setDesativados(lerCfopsDesativados(snap.exists() ? snap.data().cfopsDesativados : undefined));
      setCarregado(true);
    }, () => {
      setDesativados([]);
      setCarregado(true);
    });
    return () => parar();
  }, [tenantId]);

  return { desativados, carregado };
};
