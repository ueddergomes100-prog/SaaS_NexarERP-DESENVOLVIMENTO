/**
 * PEDIDO DO VENDEDOR EXTERNO: CONFIRMACAO DO CLIENTE, OBSERVACAO E NOTA FISCAL
 * (2026-09-21).
 *
 * No app do vendedor, tocar num cliente da busca nao seleciona direto: abre um
 * pop-up com os dados dele (nome, documento, telefone e endereco completo) e o
 * vendedor confirma ou cancela -- evita vender pro homonimo errado. Ao montar o
 * pedido ele tambem escreve uma observacao e marca se o pedido e' COM ou SEM
 * nota fiscal; essa marca vai pra retaguarda no proprio pedido/pre-venda
 * (`comNotaFiscal`), pra loja saber na hora se aquela venda vai gerar nota.
 *
 * So' regra pura aqui (sem tela, sem Firestore).
 */

import { apenasDigitos } from './documentoValidacao';

// ---------------------------------------------------------------------------
// Endereco do cliente
// ---------------------------------------------------------------------------

export interface EnderecoCliente {
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}

const limpo = (v: unknown): string => String(v ?? '').trim();

const formatarCep = (cep: unknown): string => {
  const d = apenasDigitos(String(cep ?? ''));
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/**
 * Endereco em linhas pra mostrar no pop-up:
 *   RUA A, 10 - CENTRO
 *   MANHUACU - MG
 *   CEP 36940-000
 * Pedaco que falta simplesmente nao aparece (sem "undefined", sem virgula solta).
 */
export const enderecoEmLinhas = (e: EnderecoCliente): string[] => {
  const rua = [limpo(e.endereco), limpo(e.numero)].filter(Boolean).join(', ');
  const linha1 = [rua, limpo(e.bairro)].filter(Boolean).join(' - ');
  const linha2 = [limpo(e.cidade), limpo(e.estado).toUpperCase()].filter(Boolean).join(' - ');
  const cep = formatarCep(e.cep);
  const linha3 = cep ? `CEP ${cep}` : '';
  return [linha1, linha2, linha3].filter(Boolean);
};

/** O que falta no cadastro pra ser um endereco completo (o que a nota fiscal exige). */
export const camposDeEnderecoQueFaltam = (e: EnderecoCliente): string[] => {
  const faltando: string[] = [];
  if (!limpo(e.endereco)) faltando.push('rua');
  if (!limpo(e.numero)) faltando.push('número');
  if (!limpo(e.bairro)) faltando.push('bairro');
  if (!limpo(e.cidade)) faltando.push('cidade');
  if (limpo(e.estado).length !== 2) faltando.push('estado');
  if (apenasDigitos(String(e.cep ?? '')).length !== 8) faltando.push('CEP');
  return faltando;
};

// ---------------------------------------------------------------------------
// Nota fiscal do pedido
// ---------------------------------------------------------------------------

/** O que o vendedor marcou na tela: as duas caixas sao mutuamente exclusivas. */
export type EscolhaNotaFiscal = 'com' | 'sem';

/** Valor gravado no pedido (`comNotaFiscal`). */
export const comNotaFiscalDaEscolha = (escolha: EscolhaNotaFiscal): boolean => escolha === 'com';

export const escolhaDaNotaFiscal = (comNotaFiscal: boolean): EscolhaNotaFiscal => (comNotaFiscal ? 'com' : 'sem');

/**
 * Faltou marcar? A pergunta so' existe pra empresa que controla nota fiscal;
 * nas outras nao ha o que marcar. Nao se assume "sem nota" por padrao: pedido
 * sem resposta e' cliente que queria nota e ficou sem.
 */
export const erroDaEscolhaNotaFiscal = (escolha: EscolhaNotaFiscal | null | undefined, perguntar: boolean): string | null => (
  perguntar && !escolha
    ? 'Marque se o pedido é COM nota fiscal ou SEM nota fiscal.'
    : null
);

export type TomNotaFiscal = 'com' | 'sem';

export interface RotuloNotaFiscal {
  texto: string;
  tom: TomNotaFiscal;
}

/**
 * Como a retaguarda mostra a marca do pedido. `undefined`/`null` = o pedido
 * nao informa (venda de balcao, pedido antigo): nao mostra nada, pra nao
 * parecer que alguem disse "sem nota".
 */
export const rotuloNotaFiscalPedido = (comNotaFiscal: unknown): RotuloNotaFiscal | null => {
  if (comNotaFiscal === true) return { texto: 'COM NOTA FISCAL', tom: 'com' };
  if (comNotaFiscal === false) return { texto: 'SEM NOTA FISCAL', tom: 'sem' };
  return null;
};

// ---------------------------------------------------------------------------
// Observacao
// ---------------------------------------------------------------------------

/** Mesmo limite do campo Observacao do pedido na retaguarda (sai na minuta). */
export const OBSERVACAO_PEDIDO_MAX = 200;

/** Tira quebra de linha e espaco repetido (a minuta imprime numa linha so') e corta no limite. */
export const normalizarObservacaoPedido = (texto: string): string => (
  String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, OBSERVACAO_PEDIDO_MAX)
);
