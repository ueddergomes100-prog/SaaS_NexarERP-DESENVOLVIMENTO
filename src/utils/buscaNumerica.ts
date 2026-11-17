/**
 * Busca por numero (CPF/CNPJ, telefone, codigo) nas listas de cadastro
 * (17/11/2026, "busca o CPF esta sem funcionar"): o documento e' gravado so'
 * com digitos; quem digita pode usar pontos, traco, barra ou so' um pedaco.
 */

/** O texto e' so' numero (digitos com pontos, traco, barra, parenteses ou espaco)? */
export const ehBuscaNumerica = (termo: string): boolean => /\d/.test(termo) && /^[\d\s.\-/()]+$/.test(termo.trim());

/** Campo contem os digitos procurados? (CPF gravado sem pontos x digitado com pontos, e vice-versa) */
export const contemDigitos = (campo: unknown, termo: string): boolean => {
  // So' quando o texto e' numero: "rua 12" nao pode achar todo CPF com "12".
  if (!ehBuscaNumerica(termo)) return false;
  const procurado = termo.replace(/\D/g, '');
  return procurado !== '' && String(campo ?? '').replace(/\D/g, '').includes(procurado);
};
