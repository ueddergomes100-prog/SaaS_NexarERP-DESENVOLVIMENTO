import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { CONFIG_DEVOLUCAO_APP_PADRAO, parseConfigDevolucaoApp, type ConfigDevolucaoApp } from '../utils/devolucaoVendaDomain';

/**
 * Devolucao pelo app Vendas (24/11/2026): as duas chaves da filial
 * (configuracoes/{filial}). So' o app usa: le o documento de configuracao da
 * filial, que o app ja' le de qualquer jeito. Falha de leitura = desligada
 * (o servidor confere de novo ao gravar).
 */
export const useConfigDevolucaoApp = (): ConfigDevolucaoApp => {
  const { tenantId } = useAuth();
  const [config, setConfig] = useState<ConfigDevolucaoApp>(CONFIG_DEVOLUCAO_APP_PADRAO);
  useEffect(() => {
    if (!tenantId) {
      setConfig(CONFIG_DEVOLUCAO_APP_PADRAO);
      return undefined;
    }
    return onSnapshot(
      doc(db, 'configuracoes', tenantId),
      (snap) => setConfig(parseConfigDevolucaoApp(snap.exists() ? snap.data() : undefined)),
      (erro) => {
        console.error('Erro ao ler a configuração de devolução do aplicativo:', erro);
        setConfig(CONFIG_DEVOLUCAO_APP_PADRAO);
      },
    );
  }, [tenantId]);
  return config;
};
