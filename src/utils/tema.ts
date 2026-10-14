import { CHAVE_TEMA, lerPreferenciaTema, preferenciaPadraoDoCaminho, temaEfetivo, type PreferenciaTema, type TemaEfetivo } from './temaDomain';

/*
 * APLICA O TEMA NA PAGINA (2026-10-08). Ver temaDomain.ts.
 *
 * O CSS enxerga uma coisa so': `body.light-theme` (index.css). Aqui a
 * preferencia (escuro/claro/automatico) vira essa classe, e no automatico a
 * pagina acompanha o aparelho pelo evento de prefers-color-scheme.
 *
 * O index.html e o vendedor.html tem um script inline que faz o mesmo antes
 * de o React montar, para a tela nao piscar escura e depois clarear.
 */

export const EVENTO_TEMA = 'nexus-tema';

const consulta = (): MediaQueryList | null => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
);

export const aparelhoEstaEscuro = (): boolean => consulta()?.matches ?? true;

/** Sem escolha guardada: desktop escuro, app Vendas (/vendedor) claro. Ver temaDomain.ts. */
const preferenciaPadrao = (): PreferenciaTema => (
  typeof window !== 'undefined' ? preferenciaPadraoDoCaminho(window.location.pathname) : 'dark'
);

export const lerPreferenciaSalva = (): PreferenciaTema => {
  try {
    return lerPreferenciaTema(localStorage.getItem(CHAVE_TEMA), preferenciaPadrao());
  } catch {
    return preferenciaPadrao();
  }
};

const aplicarClasse = (tema: TemaEfetivo) => {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('light-theme', tema === 'light');
};

export const aplicarTema = (preferencia: PreferenciaTema): TemaEfetivo => {
  const tema = temaEfetivo(preferencia, aparelhoEstaEscuro());
  aplicarClasse(tema);
  return tema;
};

/** Guarda, aplica e avisa quem estiver mostrando a preferencia (TopBar, Perfil do app). */
export const salvarPreferenciaTema = (preferencia: PreferenciaTema): void => {
  try {
    localStorage.setItem(CHAVE_TEMA, preferencia);
  } catch {
    /* navegador sem localStorage: vale so' ate' recarregar */
  }
  aplicarTema(preferencia);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: preferencia }));
};

let iniciado = false;

/** Chamado uma vez na entrada do sistema (main.tsx): aplica e passa a seguir o aparelho no automatico. */
export const iniciarTema = (): void => {
  if (iniciado) return;
  iniciado = true;
  aplicarTema(lerPreferenciaSalva());
  const mq = consulta();
  if (!mq) return;
  const aoMudar = () => { if (lerPreferenciaSalva() === 'auto') aplicarTema('auto'); };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', aoMudar);
  else mq.addListener(aoMudar);
};
