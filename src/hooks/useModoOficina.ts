import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  CONFIG_MAQUINAS_PESADAS_PADRAO,
  modoDaConfiguracao,
  parseConfigMaquinasPesadas,
  rotulosOficina,
  type ConfigMaquinasPesadas,
  type ModoOficina,
  type RotulosOficina,
} from '../utils/oficinaDomain';

/**
 * Modo da oficina (veiculos ou maquinas pesadas) lido ao vivo de
 * `configuracoes/{tenant}.maquinasPesadas`, com os rotulos prontos. Serve
 * para OS, Veiculos/Equipamentos, Orcamento e listas. Ver oficinaDomain.ts.
 */
export const useModoOficina = (): { modo: ModoOficina; rotulos: RotulosOficina; configMaquinas: ConfigMaquinasPesadas; carregado: boolean } => {
  const { tenantId } = useAuth();
  const [configMaquinas, setConfigMaquinas] = useState<ConfigMaquinasPesadas>(CONFIG_MAQUINAS_PESADAS_PADRAO);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const parar = onSnapshot(doc(db, 'configuracoes', tenantId), (snap) => {
      setConfigMaquinas(parseConfigMaquinasPesadas(snap.exists() ? snap.data().maquinasPesadas : undefined));
      setCarregado(true);
    }, () => {
      setConfigMaquinas(CONFIG_MAQUINAS_PESADAS_PADRAO);
      setCarregado(true);
    });
    return () => parar();
  }, [tenantId]);

  const modo = modoDaConfiguracao(configMaquinas);
  return { modo, rotulos: rotulosOficina(modo), configMaquinas, carregado };
};
