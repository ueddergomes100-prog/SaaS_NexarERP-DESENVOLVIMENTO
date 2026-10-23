import { chamarServidor } from './apiServidor';
import type { ConfigCustos, LinhaDaSimulacao, ResumoDosCustos } from '../utils/custosDomain';

/**
 * CUSTOS E FORMACAO DE PRECO (23/10/2026) -- cliente HTTP de
 * server/services/custos.js. Regra em src/utils/custosDomain.ts.
 */

export interface DadosDosCustos {
  config: ConfigCustos;
  resumo: ResumoDosCustos;
  categorias: string[];
}

export const carregarCustos = () => chamarServidor<DadosDosCustos>('GET', 'custos');

export const salvarCustos = (config: ConfigCustos) => (
  chamarServidor<DadosDosCustos>('POST', 'custos', { ...config } as unknown as Record<string, unknown>, { falhou: 'Não foi possível salvar os custos. Tente de novo.' })
);

export const simularPrecos = () => chamarServidor<{ rateioPercentual: number | null; linhas: LinhaDaSimulacao[] }>('GET', 'custos/simulacao');
