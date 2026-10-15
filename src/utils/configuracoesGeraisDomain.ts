/**
 * CONFIGURACOES GERAIS x CONFIGURACOES DA FILIAL (pedido do dono, 15/10/2026).
 *
 * Cada filial tem o proprio documento `configuracoes/{filial}` e o sistema le
 * sempre o da filial ativa. A maior parte e' da loja (venda, estoque,
 * pagamento, documentos, numeracao, nota fiscal) e fica em "Configuracoes da
 * filial". Estes campos, porem, mexem com o que e' COMPARTILHADO entre as
 * filiais (cadastro de produto e de cliente, limite de credito do grupo,
 * transferencia entre elas, categorias do resumo do grupo) e por isso tem um
 * valor so' para o grupo inteiro: aparecem so' em "Configuracoes Gerais" e o
 * servidor grava o mesmo valor em todas as filiais de uma vez
 * (POST /api/filiais/configuracoes-gerais). A tela da filial nunca grava
 * estes campos -- e' o que impede uma filial de ficar diferente das outras.
 *
 * Na mudanca (decisao do dono, 15/10/2026), vale o valor da MATRIZ; no plano
 * de contas, nenhuma categoria se perde: a lista geral junta a da matriz com
 * as que so' alguma filial tinha (Painel da Plataforma > Manutencao).
 */

import { parseModoValidacaoCliente, type ModoValidacaoCliente } from './clienteValidacaoDomain';
import { TRIBUTACAO_TRANSFERENCIA_OPCOES, parseTributacaoTransferencia, type TributacaoTransferencia } from './notaTransferenciaDomain';

export const CAMPOS_GERAIS = [
  'planoContasReceitas',
  'planoContasDespesas',
  'validarCadastroProduto',
  'modoValidacaoCliente',
  'trabalhaComLimiteCredito',
  'transferenciaSemNota',
  'transferenciaNfeTributacao',
] as const;

export type CampoGeral = typeof CAMPOS_GERAIS[number];

export interface ConfiguracoesGerais {
  planoContasReceitas: string[];
  planoContasDespesas: string[];
  validarCadastroProduto: boolean;
  modoValidacaoCliente: ModoValidacaoCliente;
  trabalhaComLimiteCredito: boolean;
  transferenciaSemNota: boolean;
  transferenciaNfeTributacao: TributacaoTransferencia;
}

export const LIMITE_DE_CATEGORIAS = 200;
export const LIMITE_DO_NOME_DA_CATEGORIA = 60;

const MODOS_VALIDACAO_CLIENTE: ModoValidacaoCliente[] = ['permitir', 'bloquear', 'perguntar'];
const TRIBUTACOES = TRIBUTACAO_TRANSFERENCIA_OPCOES.map((o) => o.value);

const nomeDaCategoria = (valor: unknown) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '');

/** Junta listas de categorias sem repetir (maiusculas/minusculas e espacos nao contam), na ordem em que aparecem. */
export const juntarCategorias = (...listas: unknown[]): string[] => {
  const vistas = new Set<string>();
  const juntas: string[] = [];
  for (const lista of listas) {
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      const nome = nomeDaCategoria(item);
      const chave = nome.toLocaleLowerCase('pt-BR');
      if (!nome || vistas.has(chave)) continue;
      vistas.add(chave);
      juntas.push(nome);
    }
  }
  return juntas;
};

type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

const lerCategorias = (valor: unknown, rotulo: string): Leitura<string[]> => {
  if (!Array.isArray(valor)) {
    return { ok: false, erro: `A lista de categorias de ${rotulo} chegou incompleta. Recarregue a tela e tente de novo.` };
  }
  const longa = valor.map(nomeDaCategoria).find((nome) => nome.length > LIMITE_DO_NOME_DA_CATEGORIA);
  if (longa) {
    return { ok: false, erro: `A categoria "${longa.slice(0, 30)}..." passa de ${LIMITE_DO_NOME_DA_CATEGORIA} letras. Use um nome mais curto.` };
  }
  const lista = juntarCategorias(valor);
  if (lista.length > LIMITE_DE_CATEGORIAS) {
    return { ok: false, erro: `O plano de contas aceita até ${LIMITE_DE_CATEGORIAS} categorias de ${rotulo}. Junte as parecidas antes de salvar.` };
  }
  return { ok: true, valor: lista };
};

const lerSimNao = (valor: unknown, rotulo: string): Leitura<boolean> => (
  typeof valor === 'boolean'
    ? { ok: true, valor }
    : { ok: false, erro: `A opção "${rotulo}" chegou sem valor. Recarregue a tela e tente de novo.` }
);

/** Confere o que a tela mandou salvar. Mensagem em portugues quando algo nao serve. */
export const lerConfiguracoesGerais = (corpo: unknown): { ok: true; valores: ConfiguracoesGerais } | { ok: false; erro: string } => {
  const dados = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const receitas = lerCategorias(dados.planoContasReceitas, 'receita');
  if (!receitas.ok) return { ok: false, erro: receitas.erro };
  const despesas = lerCategorias(dados.planoContasDespesas, 'despesa');
  if (!despesas.ok) return { ok: false, erro: despesas.erro };
  const validarProduto = lerSimNao(dados.validarCadastroProduto, 'Validar cadastro de produto');
  if (!validarProduto.ok) return { ok: false, erro: validarProduto.erro };
  const limiteCredito = lerSimNao(dados.trabalhaComLimiteCredito, 'Trabalha com limite de crédito');
  if (!limiteCredito.ok) return { ok: false, erro: limiteCredito.erro };
  const semNota = lerSimNao(dados.transferenciaSemNota, 'Permitir transferência sem nota');
  if (!semNota.ok) return { ok: false, erro: semNota.erro };
  if (!MODOS_VALIDACAO_CLIENTE.includes(dados.modoValidacaoCliente as ModoValidacaoCliente)) {
    return { ok: false, erro: 'Escolha o que fazer com cliente não cadastrado: permitir, bloquear ou perguntar.' };
  }
  if (!TRIBUTACOES.includes(dados.transferenciaNfeTributacao as TributacaoTransferencia)) {
    return { ok: false, erro: 'Escolha a tributação da nota de transferência entre as opções da lista.' };
  }
  return {
    ok: true,
    valores: {
      planoContasReceitas: receitas.valor,
      planoContasDespesas: despesas.valor,
      validarCadastroProduto: validarProduto.valor,
      modoValidacaoCliente: dados.modoValidacaoCliente as ModoValidacaoCliente,
      trabalhaComLimiteCredito: limiteCredito.valor,
      transferenciaSemNota: semNota.valor,
      transferenciaNfeTributacao: dados.transferenciaNfeTributacao as TributacaoTransferencia,
    },
  };
};

/** Tira os campos gerais do que a tela da filial grava: eles so' mudam por Configuracoes Gerais. */
export const semCamposGerais = <T extends Record<string, unknown>>(dados: T): Omit<T, CampoGeral> => {
  const copia: Record<string, unknown> = { ...dados };
  for (const campo of CAMPOS_GERAIS) delete copia[campo];
  return copia as Omit<T, CampoGeral>;
};

/** Como cada campo geral e' lido pelo sistema (mesmos padroes das telas que os usam). */
const lerCampoDoDocumento = (campo: CampoGeral, valor: unknown): unknown => {
  switch (campo) {
    case 'planoContasReceitas':
    case 'planoContasDespesas':
      return juntarCategorias(valor);
    case 'modoValidacaoCliente':
      return parseModoValidacaoCliente(valor);
    case 'transferenciaNfeTributacao':
      return parseTributacaoTransferencia(valor);
    default:
      return valor === true;
  }
};

/**
 * Unificacao (15/10/2026): o valor que todas as filiais do grupo passam a ter.
 * Vale o da matriz; campo que a matriz nunca gravou fica de fora (cada filial
 * segue com o seu). Plano de contas: o da matriz primeiro e, depois, as
 * categorias que so' alguma filial tinha -- nada se perde.
 */
export const valoresUnificados = (
  matriz: Record<string, unknown>,
  filiais: Array<Record<string, unknown>>,
): Partial<Record<CampoGeral, unknown>> => {
  const valores: Partial<Record<CampoGeral, unknown>> = {};
  for (const campo of CAMPOS_GERAIS) {
    if (campo === 'planoContasReceitas' || campo === 'planoContasDespesas') {
      const listas = [matriz[campo], ...filiais.map((f) => f[campo])];
      if (listas.some(Array.isArray)) valores[campo] = juntarCategorias(...listas);
      continue;
    }
    if (matriz[campo] !== undefined) valores[campo] = lerCampoDoDocumento(campo, matriz[campo]);
  }
  return valores;
};

/** Campos em que a filial esta diferente do valor unificado (vazio = nada a gravar nela). */
export const camposDiferentes = (
  config: Record<string, unknown>,
  unificados: Partial<Record<CampoGeral, unknown>>,
): CampoGeral[] => (
  CAMPOS_GERAIS.filter((campo) => (
    campo in unificados
    && (config[campo] === undefined
      || JSON.stringify(lerCampoDoDocumento(campo, config[campo])) !== JSON.stringify(unificados[campo]))
  ))
);

export const ROTULO_DO_CAMPO_GERAL: Record<CampoGeral, string> = {
  planoContasReceitas: 'categorias de receita',
  planoContasDespesas: 'categorias de despesa',
  validarCadastroProduto: 'validar cadastro de produto',
  modoValidacaoCliente: 'cliente não cadastrado',
  trabalhaComLimiteCredito: 'limite de crédito',
  transferenciaSemNota: 'transferência sem nota',
  transferenciaNfeTributacao: 'tributação da transferência',
};
