import { chamarServidor } from './apiServidor';
import type { ContaNoAcerto, SituacaoDoAcerto } from '../utils/acertoFornecedorDomain';

/**
 * ACERTO COM FORNECEDOR (24/11/2026) -- cliente HTTP de
 * server/services/acertoFornecedor.js. Regra em utils/acertoFornecedorDomain.ts.
 */

export interface ContaDoAcertoFeito {
  transacaoId: string;
  descricao: string;
  valorCentavos: number;
  /** Quanto ficou em aberto na conta depois do acerto. */
  restanteCentavos: number;
  fornecedorNome?: string;
}

export interface AcertoFeito {
  id: string;
  status: SituacaoDoAcerto;
  /** yyyy-mm-dd */
  data: string;
  totalCentavos: number;
  clienteNome: string;
  fornecedores: string[];
  observacao: string;
  receber: ContaDoAcertoFeito[];
  pagar: ContaDoAcertoFeito[];
  criadoPorNome: string;
  criadoEmIso: string;
  motivoDoEstorno: string;
}

export const listarAcertosComFornecedor = async (): Promise<AcertoFeito[]> => (
  (await chamarServidor<{ acertos: AcertoFeito[] }>('GET', 'financeiro/acerto-fornecedor')).acertos
);

export const registrarAcertoComFornecedor = (corpo: {
  idAcerto: string;
  receber: ContaNoAcerto[];
  pagar: ContaNoAcerto[];
  data: string;
  observacao: string;
}) => chamarServidor<{ ok: true; acerto: AcertoFeito; repetido: boolean }>('POST', 'financeiro/acerto-fornecedor', { ...corpo });

export const desfazerAcertoComFornecedor = (acertoId: string, motivo: string) => (
  chamarServidor<{ ok: true; acerto: AcertoFeito }>('POST', 'financeiro/acerto-fornecedor/desfazer', { acertoId, motivo })
);
