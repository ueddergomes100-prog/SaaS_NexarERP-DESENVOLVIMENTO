// Validacao de CPF/CNPJ (digito verificador) e formatacao pra exibicao.
// Compartilhado por Clientes e Fornecedores -- cadastro (ClienteForm.tsx,
// FornecedorForm.tsx) e a "lupa" de validacao nas listagens
// (ValidarDocumentoButton.tsx). Mesmo algoritmo de checksum do CNPJ usado
// no backend (server/utils/cnpjLookup.js) -- reimplementado aqui pra
// validar OFFLINE, sem round-trip, e sao poucas linhas.
//
// CPF nao tem consulta externa (nem aqui, nem no backend): a Receita
// Federal nao expõe dados de CPF por privacidade, so a Justica/orgaos
// autorizados tem acesso. O que da pra confirmar sozinho e' se os digitos
// verificadores batem -- confirma que o NUMERO e' bem formado, nao que
// pertence a uma pessoa real.

export const apenasDigitos = (valor: string): string => (valor || '').replace(/\D/g, '');

export type TipoDocumento = 'CPF' | 'CNPJ' | null;

export const tipoDocumento = (digitos: string): TipoDocumento => {
  if (digitos.length === 11) return 'CPF';
  if (digitos.length === 14) return 'CNPJ';
  return null;
};

/** Digito verificador de CPF (modulo 11). Rejeita sequencias com todos os
 * digitos iguais (000.000.000-00, 111.111.111-11...) -- matematicamente
 * passariam no calculo, mas nunca sao CPF valido de verdade. */
export const isCpfValido = (cpfBruto: string): boolean => {
  const cpf = apenasDigitos(cpfBruto);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  const calcDigito = (base: string, fatorInicial: number): number => {
    let soma = 0;
    let fator = fatorInicial;
    for (const digito of base) {
      soma += Number(digito) * fator;
      fator -= 1;
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const digito1 = calcDigito(cpf.slice(0, 9), 10);
  const digito2 = calcDigito(cpf.slice(0, 10), 11);
  return digito1 === Number(cpf[9]) && digito2 === Number(cpf[10]);
};

/** Digito verificador de CNPJ (modulo 11) -- mesmo algoritmo do backend
 * (server/utils/cnpjLookup.js:isValidCnpj), mantido em sincronia. */
export const isCnpjValido = (cnpjBruto: string): boolean => {
  const cnpj = apenasDigitos(cnpjBruto);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calcDigito = (base: string, pesos: number[]): number => {
    const soma = pesos.reduce((acc, peso, index) => acc + Number(base[index]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const digito1 = calcDigito(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digito2 = calcDigito(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digito1 === Number(cnpj[12]) && digito2 === Number(cnpj[13]);
};

/** Valida CPF (11 digitos) ou CNPJ (14 digitos) conforme o tamanho.
 * Documento em branco e' considerado valido -- campo opcional, "sem
 * documento" nao e' um documento invalido. */
export const isDocumentoValido = (documentoBruto: string): boolean => {
  const digitos = apenasDigitos(documentoBruto);
  if (!digitos) return true;
  const tipo = tipoDocumento(digitos);
  if (tipo === 'CPF') return isCpfValido(digitos);
  if (tipo === 'CNPJ') return isCnpjValido(digitos);
  return false;
};

/** Mensagem em portugues pronta pra tela quando o documento nao valida --
 * null quando esta tudo certo (em branco ou digitos batendo). */
export const mensagemDocumentoInvalido = (documentoBruto: string): string | null => {
  const digitos = apenasDigitos(documentoBruto);
  if (!digitos) return null;
  const tipo = tipoDocumento(digitos);
  if (!tipo) {
    return `Documento com ${digitos.length} dígito(s) -- CPF tem 11 e CNPJ tem 14. Confira o número digitado.`;
  }
  if (tipo === 'CPF' && !isCpfValido(digitos)) {
    return 'CPF inválido -- os dígitos verificadores não conferem. Confira o número digitado.';
  }
  if (tipo === 'CNPJ' && !isCnpjValido(digitos)) {
    return 'CNPJ inválido -- os dígitos verificadores não conferem. Confira o número digitado.';
  }
  return null;
};

export const formatarDocumento = (documentoBruto: string): string => {
  const digitos = apenasDigitos(documentoBruto);
  if (digitos.length === 11) return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digitos.length === 14) return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return documentoBruto;
};
