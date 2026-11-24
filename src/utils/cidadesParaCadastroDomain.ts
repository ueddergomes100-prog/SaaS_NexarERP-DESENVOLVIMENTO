import { normalizarNomeCidade } from './filialDomain';

/**
 * CIDADE NO CADASTRO (empresa e cliente): lista da Spedy + lista do IBGE
 * (24/11/2026, pedido do dono -- cliente de Simonesia/MG).
 *
 * O campo de cidade buscava SO' na lista da Spedy de cidades integradas para
 * NOTA DE SERVICO (GET /v1/service-invoices/cities). Cidade fora dessa lista
 * (Simonesia/MG, IBGE 3167608) nao aparecia, e sem a cidade a empresa nao
 * cadastrava -- embora NF-e e NFC-e precisem so' do codigo IBGE, que existe
 * para todo municipio do pais.
 *
 * Agora a busca junta as duas: primeiro as cidades da Spedy (emitem NFS-e),
 * depois as do IBGE que nao estao nelas (servem para NF-e/NFC-e; NFS-e
 * depende de a Spedy integrar a cidade).
 *
 * Regra pura: as telas buscam as listas e chamam aqui.
 */

export interface CidadeParaCadastro {
  /** Codigo IBGE, 7 digitos. */
  code: string;
  name: string;
  /** Sigla da UF, maiuscula. */
  state: string;
  /** Esta' na lista da Spedy de cidades que emitem nota de servico. */
  nfseNaSpedy: boolean;
}

export interface MunicipioIbgeNivelado {
  'municipio-id': number | string;
  'municipio-nome': string;
  'UF-sigla': string;
}

export const LIMITE_DE_CIDADES_NA_BUSCA = 30;

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/** "SIMONESIA/MG" e "simonésia" casam; a busca aceita pedaco do nome. */
const casa = (nomeDaCidade: string, termo: string): boolean => normalizarNomeCidade(nomeDaCidade).includes(normalizarNomeCidade(termo));

/** Comeca com o termo vem antes de so' conter; depois em ordem alfabetica. */
const ordenarPeloTermo = (termo: string) => {
  const alvo = normalizarNomeCidade(termo);
  return (a: CidadeParaCadastro, b: CidadeParaCadastro): number => {
    const ia = normalizarNomeCidade(a.name).startsWith(alvo) ? 0 : 1;
    const ib = normalizarNomeCidade(b.name).startsWith(alvo) ? 0 : 1;
    return ia - ib || a.name.localeCompare(b.name, 'pt-BR') || a.state.localeCompare(b.state);
  };
};

/**
 * Junta a lista da Spedy (pode vir vazia, ou nem vir quando a Spedy falhou) com
 * a do IBGE. Cidade repetida (mesmo codigo IBGE) fica so' uma vez, marcada como
 * da Spedy. Codigo que nao tem 7 digitos e' descartado: sem ele nao ha' nota.
 */
export const juntarCidadesParaCadastro = (
  termo: string,
  daSpedy: ReadonlyArray<{ code?: string | null; name?: string | null; state?: string | null }>,
  doIbge: ReadonlyArray<MunicipioIbgeNivelado>,
  limite = LIMITE_DE_CIDADES_NA_BUSCA,
): CidadeParaCadastro[] => {
  if (normalizarNomeCidade(termo).length < 3) return [];
  const spedy: CidadeParaCadastro[] = [];
  const codigos = new Set<string>();
  daSpedy.forEach((c) => {
    const code = soDigitos(c.code);
    if (code.length !== 7 || codigos.has(code) || !casa(String(c.name || ''), termo)) return;
    codigos.add(code);
    spedy.push({ code, name: String(c.name || '').trim(), state: String(c.state || '').trim().toUpperCase(), nfseNaSpedy: true });
  });
  const ibge: CidadeParaCadastro[] = [];
  doIbge.forEach((m) => {
    const code = soDigitos(m['municipio-id']);
    if (code.length !== 7 || codigos.has(code) || !casa(m['municipio-nome'], termo)) return;
    codigos.add(code);
    ibge.push({ code, name: String(m['municipio-nome'] || '').trim(), state: String(m['UF-sigla'] || '').trim().toUpperCase(), nfseNaSpedy: false });
  });
  return [...spedy.sort(ordenarPeloTermo(termo)), ...ibge.sort(ordenarPeloTermo(termo))].slice(0, limite);
};

/**
 * Cidade da empresa pelo cartao do CNPJ (Receita: municipio, UF e, as vezes, o
 * IBGE). Primeiro a da Spedy pelo codigo ou pelo nome NA MESMA UF; senao a do
 * IBGE. Nunca "qualquer cidade da UF": antes, empresa de Simonesia saia com
 * outra cidade de MG sem ninguem perceber. Nao achou = null (a pessoa escolhe).
 */
export const cidadeDaEmpresaPeloCnpj = (
  dados: { municipio?: string; uf?: string; codigoMunicipioIbge?: string },
  daSpedy: ReadonlyArray<{ code?: string | null; name?: string | null; state?: string | null }>,
  doIbge: ReadonlyArray<MunicipioIbgeNivelado>,
): CidadeParaCadastro | null => {
  const uf = String(dados.uf || '').trim().toUpperCase();
  const nome = normalizarNomeCidade(dados.municipio);
  const codigo = soDigitos(dados.codigoMunicipioIbge);
  if (!uf || (!nome && codigo.length !== 7)) return null;
  const mesma = (code: unknown, name: unknown, state: unknown) => (
    codigo.length === 7
      ? soDigitos(code) === codigo
      : String(state || '').trim().toUpperCase() === uf && normalizarNomeCidade(name) === nome
  );
  const spedy = daSpedy.find((c) => mesma(c.code, c.name, c.state));
  if (spedy && soDigitos(spedy.code).length === 7) {
    return { code: soDigitos(spedy.code), name: String(spedy.name || dados.municipio || '').trim(), state: String(spedy.state || uf).toUpperCase(), nfseNaSpedy: true };
  }
  const ibge = doIbge.find((m) => mesma(m['municipio-id'], m['municipio-nome'], m['UF-sigla']));
  if (ibge) return { code: soDigitos(ibge['municipio-id']), name: String(ibge['municipio-nome']).trim(), state: String(ibge['UF-sigla']).toUpperCase(), nfseNaSpedy: false };
  return null;
};

/** Aviso que aparece quando a cidade escolhida nao emite NFS-e pela Spedy. */
export const AVISO_CIDADE_SEM_NFSE = 'Esta cidade ainda não emite nota de serviço (NFS-e) pela Spedy. NF-e e NFC-e funcionam normalmente com ela.';
