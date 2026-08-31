/**
 * CAIXA ALTA DE VERDADE NO QUE O USUARIO PREENCHE.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTAVA ERRADO
 * ---------------------------------------------------------------------------
 *
 * Desde 2026-07-29 os campos apareciam em CAIXA ALTA por CSS
 * (`text-transform: uppercase` em index.css). Mas `text-transform` muda so o
 * que aparece: quem digitava "joao silva" via "JOAO SILVA" na tela e o banco
 * gravava "joao silva". A padronizacao era so de fachada.
 *
 * O estrago aparecia longe do formulario: relatorio, exportacao e nota fiscal
 * leem o banco direto, sem o CSS -- e ali sai a mistura real, "joao silva" ao
 * lado de "MARIA SOUZA". Foi essa a reclamacao que chegou do cliente: digita e
 * ve maiusculo, imprime e sai diferente.
 *
 * Agora a caixa alta acontece na DIGITACAO, entao o que se ve e o que se
 * grava -- e o relatorio sai igual a tela sem depender de CSS nenhum.
 *
 * ---------------------------------------------------------------------------
 * O QUE FICA DE FORA, E POR QUE
 * ---------------------------------------------------------------------------
 *
 * 1. **Texto longo (textarea).** Decisao do cliente (2026-08-31): observacao,
 *    defeito relatado e relatorio tecnico saem como foram escritos, com
 *    maiuscula e minuscula. Paragrafo inteiro em caixa alta cansa de ler, e o
 *    combinado e que o papel mostre exatamente o que esta na tela.
 *
 * 2. **Campos onde a caixa do valor E o valor:** e-mail, senha, endereco de
 *    site e chave de integracao. Maiuscula ali nao e feio, e errado -- chave
 *    de API e senha sao sensiveis a caixa, e e-mail em caixa alta parece erro
 *    de digitacao pra quem le.
 *
 * 3. **Campos que nao sao texto:** numero, data, hora, cor, arquivo. Nao ha
 *    letra pra transformar, e mexer neles so arriscaria quebrar a mascara.
 *
 * 4. **`select`.** O valor de um select NAO e texto digitado, e um codigo que
 *    o sistema compara consigo mesmo: 'Finalizada', 'exata', 'percentual'.
 *    Gravar 'FINALIZADA' quebraria toda comparacao de status, filtro de lista
 *    e regra de negocio que le esse campo. O que aparece em caixa alta na tela
 *    e o rotulo da opcao, por CSS -- isso continua.
 */

/** Tipos de input que nao carregam texto livre -- ou carregam texto onde a
 *  caixa importa (e-mail, senha, URL). */
const TIPOS_FORA_DA_CAIXA_ALTA = new Set([
  'email',
  'url',
  'password',
  'number',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
  'color',
  'file',
  'range',
  'checkbox',
  'radio',
]);

/** Campos que carregam segredo ou endereco, mesmo declarados como texto --
 *  a tela mostra a chave da Spedy num input comum quando o olho esta aberto. */
const NOMES_FORA_DA_CAIXA_ALTA = new Set([
  'email',
  'emailContato',
  'emailFinanceiro',
  'senha',
  'password',
  'confirmarSenha',
  'site',
  'website',
  'url',
  'logo',
  'spedyApiKey',
  'apiKey',
  'token',
  'chave',
  'chaveAcesso',
  'webhook',
  'instagram',
  'facebook',
]);

export interface CampoDigitado {
  /** 'INPUT' | 'TEXTAREA' | 'SELECT' -- vem de `e.target.tagName`. */
  tagName?: string;
  type?: string;
  name?: string;
}

/**
 * Este campo mantem a caixa que a pessoa digitou?
 *
 * A regra principal e o TIPO do elemento, nao uma lista de nomes: `textarea`
 * e texto longo por definicao, e nenhuma lista de nomes de campo fica
 * completa -- sempre entra um campo novo que ninguem lembrou de cadastrar.
 */
export const mantemCaixaDigitada = (campo: CampoDigitado): boolean => {
  const tag = String(campo.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;

  const tipo = String(campo.type || '').toLowerCase();
  if (TIPOS_FORA_DA_CAIXA_ALTA.has(tipo)) return true;

  return NOMES_FORA_DA_CAIXA_ALTA.has(String(campo.name || ''));
};

/**
 * Valor pronto pra gravar. NAO faz trim: cortar espaco enquanto a pessoa
 * digita impede de escrever "JOAO " antes do sobrenome. O trim continua onde
 * ja estava, no salvar.
 */
export const aplicarCaixaAltaCadastro = (campo: CampoDigitado, valor: string): string => (
  mantemCaixaDigitada(campo) ? valor : String(valor ?? '').toUpperCase()
);
