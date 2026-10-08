/**
 * TEMA DO SISTEMA (escuro, claro, automatico) -- 2026-10-08.
 *
 * Ate' aqui o desktop tinha so' escuro/claro (botao na TopBar) e o app
 * Vendas era sempre escuro. Agora a preferencia e' uma so' para o sistema e o
 * app (mesma chave no localStorage, mesma origem), com a terceira opcao
 * "automatico": segue o tema do aparelho (prefers-color-scheme) e troca
 * sozinho quando o aparelho troca.
 *
 * Este arquivo e' a parte pura (sem DOM): valores, rotulos e a regra de qual
 * tema vale. Quem aplica na pagina e' utils/tema.ts.
 */

export type PreferenciaTema = 'dark' | 'light' | 'auto';
export type TemaEfetivo = 'dark' | 'light';

export const CHAVE_TEMA = 'nexus_theme';

export const PREFERENCIAS_TEMA: readonly PreferenciaTema[] = ['dark', 'light', 'auto'];

export const ROTULO_TEMA: Record<PreferenciaTema, string> = {
  dark: 'Escuro',
  light: 'Claro',
  auto: 'Automático',
};

export const DESCRICAO_TEMA: Record<PreferenciaTema, string> = {
  dark: 'Fundo escuro o tempo todo.',
  light: 'Fundo claro o tempo todo.',
  auto: 'Segue o tema do aparelho e troca sozinho.',
};

/** O que esta' guardado pode ser lixo (versao antiga, edicao a mao): cai no escuro. */
export const lerPreferenciaTema = (valor: unknown): PreferenciaTema => (
  valor === 'light' || valor === 'auto' ? valor : 'dark'
);

/** Qual tema vale na tela agora. */
export const temaEfetivo = (preferencia: PreferenciaTema, aparelhoEscuro: boolean): TemaEfetivo => (
  preferencia === 'auto' ? (aparelhoEscuro ? 'dark' : 'light') : preferencia
);

/** O botao da TopBar roda escuro -> claro -> automatico -> escuro. */
export const proximaPreferenciaTema = (atual: PreferenciaTema): PreferenciaTema => (
  atual === 'dark' ? 'light' : atual === 'light' ? 'auto' : 'dark'
);

/** Dica do botao: diz o que esta' valendo e o que o clique faz. */
export const tituloDoBotaoDeTema = (atual: PreferenciaTema, aparelhoEscuro: boolean): string => {
  const valendo = atual === 'auto'
    ? `Tema automático (agora ${temaEfetivo(atual, aparelhoEscuro) === 'dark' ? 'escuro' : 'claro'}, igual ao aparelho)`
    : `Tema ${ROTULO_TEMA[atual].toLowerCase()}`;
  return `${valendo} — clique para ${ROTULO_TEMA[proximaPreferenciaTema(atual)].toLowerCase()}`;
};
