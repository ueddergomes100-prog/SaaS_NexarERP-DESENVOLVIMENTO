/**
 * BUSCA GLOBAL DO TOPO (TopBar) — o que perguntar ao banco. Regra pura.
 *
 * Antes a busca baixava os 80 primeiros documentos de OS, clientes e produtos
 * (240 leituras a cada pausa na digitação) e procurava "contém" só entre eles:
 * em empresa com mais de 80 cadastros, quase tudo ficava de fora. Agora cada
 * consulta vai direto ao que interessa, com limite pequeno, no cadastro inteiro
 * (2026-10-14):
 *  - nome que COMEÇA com o termo (clientes, produtos, cliente da OS) — os nomes
 *    são gravados em maiúsculas;
 *  - código exato: código do produto, código de barras, número da OS, placa e
 *    CPF/CNPJ, nos formatos em que costumam estar gravados.
 */

export const LIMITE_POR_CONSULTA = 5;

export interface ConsultasDaBusca {
  /** Prefixo em maiúsculas para nome (vazio = não consultar por nome). */
  prefixoNome: string;
  /** Valores para `estoque.codigo` (texto e número). */
  codigosProduto: Array<string | number>;
  /** Valor para `estoque.codigoBarras` (só dígitos, 8+). */
  codigoBarras: string | null;
  /** Valores para `ordens_de_servico.numeroOS` (gravado com 2 dígitos no mínimo). */
  numerosOS: string[];
  /** Valores para `ordens_de_servico.placa`. */
  placas: string[];
  /** Valores para `clientes.documento` (só dígitos e com máscara). */
  documentos: string[];
}

const unicos = <T,>(lista: T[]): T[] => [...new Set(lista)].slice(0, 10); // 'in' aceita até 10 (folga)

const mascaraCpf = (d: string) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
const mascaraCnpj = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;

export const consultasDaBusca = (termo: string): ConsultasDaBusca => {
  const texto = termo.trim();
  const maiusculo = texto.toUpperCase();
  const digitos = texto.replace(/\D/g, '');
  const soDigitos = digitos.length > 0 && digitos === texto;
  const alfanumerico = maiusculo.replace(/[^A-Z0-9]/g, '');

  const codigosProduto: Array<string | number> = [];
  if (texto && !/\s/.test(texto)) {
    codigosProduto.push(texto);
    if (maiusculo !== texto) codigosProduto.push(maiusculo);
    if (soDigitos && Number.isSafeInteger(Number(digitos))) codigosProduto.push(Number(digitos));
  }

  const numerosOS: string[] = [];
  if (soDigitos && digitos.length <= 9) {
    const semZeros = String(Number(digitos));
    numerosOS.push(digitos, semZeros, semZeros.padStart(2, '0'));
  }

  // Placa: 7 caracteres (ABC1234 / ABC1D23), com ou sem hífen.
  const placas: string[] = [];
  if (/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(alfanumerico)) {
    placas.push(alfanumerico, `${alfanumerico.slice(0, 3)}-${alfanumerico.slice(3)}`);
  }

  const documentos: string[] = [];
  if (digitos.length === 11) documentos.push(digitos, mascaraCpf(digitos));
  if (digitos.length === 14) documentos.push(digitos, mascaraCnpj(digitos));

  return {
    prefixoNome: maiusculo.length >= 2 ? maiusculo : '',
    codigosProduto: unicos(codigosProduto),
    codigoBarras: soDigitos && digitos.length >= 8 ? digitos : null,
    numerosOS: unicos(numerosOS),
    placas: unicos(placas),
    documentos: unicos(documentos),
  };
};

/** Limite superior do intervalo "começa com" (o caractere  fica depois de qualquer letra). */
export const fimDoPrefixo = (prefixo: string) => `${prefixo}`;
