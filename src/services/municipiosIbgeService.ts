/**
 * Municipios de cada UF na API publica do IBGE (sem chave), guardados por UF
 * enquanto a pagina estiver aberta. A nota fiscal exige o codigo IBGE da cidade
 * do destinatario: o ViaCEP traz o codigo pelo CEP, e quando o CEP nao resolve
 * (CEP generico da cidade, como 36900-000) o codigo sai pelo NOME da cidade,
 * com acharCodigoIbge (utils/filialDomain). Vai so' a sigla da UF na consulta.
 */

import { fetchComTimeout } from '../utils/fetchComTimeout';

/** O IBGE responde em menos de 1 s; mais de 10 s e' instabilidade dele. */
const TEMPO_LIMITE_IBGE_MS = 10_000;

export interface MunicipioIbge {
  id: number;
  nome: string;
}

const municipiosPorUf = new Map<string, Promise<MunicipioIbge[]>>();

export const municipiosDaUf = (uf: string): Promise<MunicipioIbge[]> => {
  const chave = uf.toUpperCase();
  if (!municipiosPorUf.has(chave)) {
    const pedido = fetchComTimeout(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${chave}/municipios?orderBy=nome`, {}, TEMPO_LIMITE_IBGE_MS)
      .then(async (r) => {
        if (!r.ok) throw new Error('IBGE indisponível');
        return (await r.json()) as MunicipioIbge[];
      })
      .catch((erro) => { municipiosPorUf.delete(chave); throw erro; });
    municipiosPorUf.set(chave, pedido);
  }
  return municipiosPorUf.get(chave)!;
};
