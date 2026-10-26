import { chamarServidor } from './apiServidor';

/**
 * PRODUCAO PELO SERVIDOR (26/10/2026) -- cliente de server/routes/producao.routes.js.
 * As caixas (taras) da pesagem ficam na configuracao da filial e so' o servidor grava.
 */
export const salvarTarasNoServidor = (taras: Array<{ id?: string; nome: string; pesoKg: string | number }>) => (
  chamarServidor<{ taras: Array<{ id: string; nome: string; pesoKg: number; ativa: boolean }> }>(
    'POST', 'producao/taras', { taras }, { falhou: 'Não foi possível salvar as caixas. Tente de novo.' },
  )
);
