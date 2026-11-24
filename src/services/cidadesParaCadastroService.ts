import { fetchComTimeout } from '../utils/fetchComTimeout';
import { spedyService } from './spedyService';
import {
  cidadeDaEmpresaPeloCnpj,
  juntarCidadesParaCadastro,
  type CidadeParaCadastro,
  type MunicipioIbgeNivelado,
} from '../utils/cidadesParaCadastroDomain';

/**
 * Busca de cidade para o cadastro da empresa e do cliente (24/11/2026): lista
 * da Spedy (cidades que emitem NFS-e) + lista completa do IBGE (API publica,
 * sem chave; ~120 KB compactado, guardada enquanto a pagina estiver aberta).
 * Regra em utils/cidadesParaCadastroDomain.ts.
 */

const TEMPO_LIMITE_IBGE_MS = 15_000;
let municipiosDoBrasil: Promise<MunicipioIbgeNivelado[]> | null = null;

export const todosOsMunicipios = (): Promise<MunicipioIbgeNivelado[]> => {
  if (!municipiosDoBrasil) {
    municipiosDoBrasil = fetchComTimeout('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado', {}, TEMPO_LIMITE_IBGE_MS)
      .then(async (r) => {
        if (!r.ok) throw new Error('IBGE indisponível');
        return (await r.json()) as MunicipioIbgeNivelado[];
      })
      .catch((erro) => { municipiosDoBrasil = null; throw erro; });
  }
  return municipiosDoBrasil;
};

/**
 * As duas listas em paralelo; uma falhar nao derruba a outra. Erro so' quando
 * as duas falham (mensagem em portugues para a tela).
 */
export const buscarCidadesParaCadastro = async (termo: string): Promise<CidadeParaCadastro[]> => {
  const [spedy, ibge] = await Promise.allSettled([
    spedyService.searchServiceInvoiceCities('', 'sandbox', termo),
    todosOsMunicipios(),
  ]);
  if (spedy.status === 'rejected' && ibge.status === 'rejected') {
    console.error('Busca de cidade: Spedy e IBGE falharam.', spedy.reason, ibge.reason);
    throw new Error('Não foi possível buscar as cidades agora. Confira a internet e tente de novo.');
  }
  if (spedy.status === 'rejected') console.warn('Busca de cidade: a Spedy não respondeu; seguindo só com o IBGE.', spedy.reason);
  if (ibge.status === 'rejected') console.warn('Busca de cidade: o IBGE não respondeu; seguindo só com a Spedy.', ibge.reason);
  return juntarCidadesParaCadastro(
    termo,
    spedy.status === 'fulfilled' ? spedy.value.items || [] : [],
    ibge.status === 'fulfilled' ? ibge.value : [],
  );
};

/** Cidade da empresa pelo cartao do CNPJ: Spedy e, se ela nao tiver, IBGE. Nao achou = null. */
export const buscarCidadeDaEmpresaPeloCnpj = async (dados: { municipio?: string; uf?: string; codigoMunicipioIbge?: string }): Promise<CidadeParaCadastro | null> => {
  if (!dados.municipio || !dados.uf) return null;
  const [spedy, ibge] = await Promise.allSettled([
    spedyService.searchServiceInvoiceCities('', 'sandbox', dados.municipio),
    todosOsMunicipios(),
  ]);
  return cidadeDaEmpresaPeloCnpj(
    dados,
    spedy.status === 'fulfilled' ? spedy.value.items || [] : [],
    ibge.status === 'fulfilled' ? ibge.value : [],
  );
};
