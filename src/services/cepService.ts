/**
 * Consulta de CEP (ViaCEP -- publico, sem chave). Devolve o endereco e o
 * codigo IBGE da cidade, que a nota fiscal exige no destinatario. Compartilhado
 * pelos cadastros novos; o cadastro do computador ainda tem a sua copia
 * (ClienteForm.tsx) e nao foi mexido.
 */

export interface EnderecoPorCep {
  encontrado: boolean;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  ibge: string;
}

export class CepIndisponivelError extends Error {
  constructor() {
    super('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
    this.name = 'CepIndisponivelError';
  }
}

export const consultarCep = async (cepBruto: string): Promise<EnderecoPorCep> => {
  const cep = cepBruto.replace(/\D/g, '');
  if (cep.length !== 8) {
    return { encontrado: false, logradouro: '', bairro: '', cidade: '', uf: '', ibge: '' };
  }
  let dados: { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string; ibge?: string };
  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!resposta.ok) throw new CepIndisponivelError();
    dados = await resposta.json();
  } catch {
    throw new CepIndisponivelError();
  }
  if (dados.erro) {
    return { encontrado: false, logradouro: '', bairro: '', cidade: '', uf: '', ibge: '' };
  }
  return {
    encontrado: true,
    logradouro: dados.logradouro || '',
    bairro: dados.bairro || '',
    cidade: dados.localidade || '',
    uf: dados.uf || '',
    ibge: dados.ibge || '',
  };
};
