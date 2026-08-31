/**
 * Identificacao do vendedor na venda: codigo de 2 digitos + PIN de 2 a 10
 * digitos.
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
 * O Firebase Auth exige senha de 6+ caracteres, e o PIN aqui pode ter tao
 * pouco quanto 2 digitos.
 * Entao o PIN e' um segredo PROPRIO, guardado fora do alcance do navegador e
 * validado no backend (Admin SDK). Duas consequencias que valem lembrar:
 *
 *  - o navegador NUNCA ve o hash do PIN. Se visse, as combinacoes (100 num PIN
 *    de 2 digitos, 10.000 num de 4) caem em milissegundos -- e ai o PIN nao
 *    valeria nada;
 *  - o codigo de 2 digitos e' PUBLICO por natureza (todo mundo ve o do
 *    colega). Toda a seguranca fica no PIN + no controle de tentativas do
 *    lado servidor.
 *
 * Este modulo tem so as regras PURAS de formato, compartilhadas entre a tela
 * (validacao imediata, sem ida ao servidor) e as mensagens. A validacao que
 * vale e' sempre a do backend.
 */

import { hasTenantFullAccess } from './roles';

export const CODIGO_VENDEDOR_DIGITOS = 2;

/**
 * Faixa de tamanho do PIN (decisao de produto, 2026-08-31): a empresa escolhe
 * quantos digitos usar, de 2 a 10. O que ja esta cadastrado com 4 continua
 * valendo -- o backend guarda o hash, nao o tamanho, entao nao ha migracao.
 *
 * O piso de 2 e' uma escolha de conveniencia do balcao, nao de seguranca: com
 * 2 digitos sao 100 combinacoes. Quem segura o estrago e' o limite de
 * tentativas do backend (5 erros bloqueiam o vendedor por 5 minutos), nao o
 * tamanho do PIN -- por isso a tela avisa quando o PIN esta curto demais
 * (ver `isPinVendedorFraco`).
 */
export const PIN_VENDEDOR_MIN_DIGITOS = 2;
export const PIN_VENDEDOR_MAX_DIGITOS = 10;

/** Tamanho abaixo do qual a tela avisa que o PIN e' facil de adivinhar.
 *  Nao bloqueia -- a decisao continua sendo do dono da empresa. */
const PIN_VENDEDOR_DIGITOS_SEGUROS = 4;

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

/** PIN e' de MIN a MAX digitos -- nada alem de digito, sem espaco nem letra. */
export const isPinVendedorValido = (valor: unknown): boolean => {
  const bruto = String(valor ?? '');
  return new RegExp(`^\\d{${PIN_VENDEDOR_MIN_DIGITOS},${PIN_VENDEDOR_MAX_DIGITOS}}$`).test(bruto);
};

/**
 * PIN obvio demais. Nao BLOQUEIA (a decisao e' do dono da empresa), mas a
 * tela avisa: com poucos digitos e um codigo publico, "12", "1234" e "0000"
 * entregam a conta pro primeiro colega curioso.
 */
export const isPinVendedorFraco = (valor: unknown): boolean => {
  if (!isPinVendedorValido(valor)) return false;
  const pin = String(valor);
  if (pin.length < PIN_VENDEDOR_DIGITOS_SEGUROS) return true;
  const todosIguais = /^(\d)\1+$/.test(pin);
  const crescente = '0123456789'.includes(pin);
  const decrescente = '9876543210'.includes(pin);
  return todosIguais || crescente || decrescente;
};

/** Mensagens de erro prontas, em portugues, pra tela nao inventar cada uma. */
export const MENSAGEM_CODIGO_INVALIDO =
  `O código do vendedor tem ${CODIGO_VENDEDOR_DIGITOS} dígitos (de 00 a 99). Confira o código com o responsável.`;

export const MENSAGEM_PIN_INVALIDO =
  `A senha do vendedor tem de ${PIN_VENDEDOR_MIN_DIGITOS} a ${PIN_VENDEDOR_MAX_DIGITOS} dígitos numéricos.`;

export const MENSAGEM_PIN_FRACO =
  'Esta senha é fácil de adivinhar (curta demais, ou uma sequência como 1234 e 0000). Como o código do vendedor é visível para os colegas, prefira uma senha mais longa e menos óbvia.';

/** Texto curto de ajuda, pro campo de senha em cada tela dizer o mesmo. */
export const AJUDA_TAMANHO_PIN =
  `De ${PIN_VENDEDOR_MIN_DIGITOS} a ${PIN_VENDEDOR_MAX_DIGITOS} dígitos`;

/** Config do tenant: exige identificar o vendedor a cada venda.
 *  Desligado por padrao -- ligar mudaria o fluxo de quem ja vende hoje. */
export const DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR = false;

export const parseExigirIdentificacaoVendedor = (valor: unknown): boolean => valor === true;

export interface VendedorIdentificado {
  vendedorId: string;
  vendedorNome: string;
  codigo: string;
}

/**
 * A lista geral de "Pedidos de Venda" fica escondida da TELA (nao do
 * Firestore) pra quem nao tem acesso total, quando a empresa liga "Exigir
 * identificacao do vendedor a cada venda"?
 *
 * Por que esconder: no balcao compartilhado, cada venda e' gravada sob o
 * UID da ESTACAO (balcao01...), nao do vendedor real -- a lista geral
 * misturaria venda de todo mundo sem dizer "quem vendeu o que" de um jeito
 * confiavel pra quem nao e' gestor. Quem tem acesso total (dono, Master,
 * Admin, SuperAdmin -- hasTenantFullAccess) continua vendo tudo, igual
 * hoje; o funcionario comum passa a usar "Minhas Vendas" (MinhasVendas.tsx),
 * que se identifica pelo mesmo PIN e mostra so as vendas dele.
 *
 * IMPORTANTE: isto e' uma barreira de FLUXO/TELA, nao blindagem de
 * Firestore. As regras continuam permitindo a query por tenantId pra
 * qualquer autenticado do tenant, igual antes -- esconder a lista aqui e'
 * so gestao de UX, nao seguranca de dado. Escopo aceito nesta fatia;
 * blindagem de verdade (regras + reescrita de query) fica pra outra
 * fatia, se um dia for necessaria.
 */
export const listaGeralDeVendasEscondidaParaFuncionario = (args: {
  exigirIdentificacaoVendedor: boolean;
  role: unknown;
  isOwner: boolean;
}): boolean => {
  if (!args.exigirIdentificacaoVendedor) return false;
  return !hasTenantFullAccess(args.role, args.isOwner);
};
