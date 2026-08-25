/**
 * Identificacao do vendedor na venda: codigo de 2 digitos + PIN de 4 digitos.
 *
 * ---------------------------------------------------------------------------
 * PRA QUE SERVE
 * ---------------------------------------------------------------------------
 *
 * Cenario real do cliente: 10 computadores com o sistema aberto na tela de
 * Pedido de Venda o dia inteiro, cada um logado na propria conta de estacao
 * (`balcao01`, `balcao02`, ...). A cada venda, um popup pede codigo e PIN do
 * VENDEDOR -- a venda e a comissao ficam no nome dele, e a estacao continua
 * logada. Terminou a venda, o sistema esquece: a proxima pede de novo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O PIN NAO E' A SENHA DO FIREBASE AUTH
 * ---------------------------------------------------------------------------
 *
 * O Firebase Auth exige senha de 6+ caracteres, e o PIN aqui tem 4 digitos.
 * Entao o PIN e' um segredo PROPRIO, guardado fora do alcance do navegador e
 * validado no backend (Admin SDK). Duas consequencias que valem lembrar:
 *
 *  - o navegador NUNCA ve o hash do PIN. Se visse, 10.000 combinacoes caem em
 *    milissegundos -- e ai o PIN nao valeria nada;
 *  - o codigo de 2 digitos e' PUBLICO por natureza (todo mundo ve o do
 *    colega). Toda a seguranca fica no PIN + no controle de tentativas do
 *    lado servidor.
 *
 * Este modulo tem so as regras PURAS de formato, compartilhadas entre a tela
 * (validacao imediata, sem ida ao servidor) e as mensagens. A validacao que
 * vale e' sempre a do backend.
 */

export const CODIGO_VENDEDOR_DIGITOS = 2;
export const PIN_VENDEDOR_DIGITOS = 4;

/** Teto de funcionarios com codigo por empresa: 00 a 99. */
export const MAX_VENDEDORES_COM_CODIGO = 10 ** CODIGO_VENDEDOR_DIGITOS;

const somenteDigitos = (valor: unknown): string => String(valor ?? '').replace(/\D/g, '');

/**
 * Normaliza o codigo digitado pra forma canonica de 2 digitos.
 * "7" e "07" sao o MESMO vendedor -- quem digita rapido no balcao nao vai
 * lembrar do zero a esquerda, e dois cadastros distintos "7" e "07" seriam
 * uma armadilha. Devolve '' quando nao da pra normalizar.
 */
export const normalizarCodigoVendedor = (valor: unknown): string => {
  const digitos = somenteDigitos(valor);
  if (!digitos || digitos.length > CODIGO_VENDEDOR_DIGITOS) return '';
  return digitos.padStart(CODIGO_VENDEDOR_DIGITOS, '0');
};

export const isCodigoVendedorValido = (valor: unknown): boolean =>
  normalizarCodigoVendedor(valor) !== '';

/** PIN e' exatamente N digitos -- nem mais, nem menos, nada alem de digito. */
export const isPinVendedorValido = (valor: unknown): boolean => {
  const bruto = String(valor ?? '');
  return new RegExp(`^\\d{${PIN_VENDEDOR_DIGITOS}}$`).test(bruto);
};

/**
 * PIN obvio demais. Nao BLOQUEIA (a decisao e' do dono da empresa), mas a
 * tela avisa: com 4 digitos e um codigo publico, "1234" e "0000" entregam a
 * conta pro primeiro colega curioso.
 */
export const isPinVendedorFraco = (valor: unknown): boolean => {
  if (!isPinVendedorValido(valor)) return false;
  const pin = String(valor);
  const todosIguais = /^(\d)\1+$/.test(pin);
  const crescente = '0123456789'.includes(pin);
  const decrescente = '9876543210'.includes(pin);
  return todosIguais || crescente || decrescente;
};

/** Mensagens de erro prontas, em portugues, pra tela nao inventar cada uma. */
export const MENSAGEM_CODIGO_INVALIDO =
  `O código do vendedor tem ${CODIGO_VENDEDOR_DIGITOS} dígitos (de 00 a 99). Confira o código com o responsável.`;

export const MENSAGEM_PIN_INVALIDO =
  `A senha do vendedor tem ${PIN_VENDEDOR_DIGITOS} dígitos numéricos.`;

export const MENSAGEM_PIN_FRACO =
  'Esta senha é fácil de adivinhar (como 1234 ou 0000). Como o código do vendedor é visível para os colegas, prefira uma combinação menos óbvia.';

/** Config do tenant: exige identificar o vendedor a cada venda.
 *  Desligado por padrao -- ligar mudaria o fluxo de quem ja vende hoje. */
export const DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR = false;

export const parseExigirIdentificacaoVendedor = (valor: unknown): boolean => valor === true;

export interface VendedorIdentificado {
  vendedorId: string;
  vendedorNome: string;
  codigo: string;
}
