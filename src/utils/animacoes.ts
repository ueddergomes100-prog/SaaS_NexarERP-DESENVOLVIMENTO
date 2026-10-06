import type { AnimationItem, LottiePlayer } from 'lottie-web';

/*
 * ANIMACOES LOTTIE (2026-10-06). Os arquivos de src/assets/lotties/ sao
 * gerados por scripts/gerar-lotties.mjs, nas cores da marca.
 *
 * Tres regras, porque isto e' um sistema de trabalho:
 *  1. Nada aqui entra no pacote inicial. O player (lottie_light, so' SVG) e
 *     cada .json sao carregados sob demanda e ficam em cache. O sistema nao
 *     abre mais devagar por causa das animacoes.
 *  2. Quem marcou "reduzir movimento" no Windows/Mac nao ve animacao
 *     nenhuma: as telas caem no icone estatico de sempre.
 *  3. Animacao de feedback nunca bloqueia o proximo clique -- ela mora dentro
 *     do aviso que ja existia (toast/pop-up), nao e' uma etapa a mais.
 */

export type AnimacaoNome = 'sucesso' | 'erro' | 'aviso' | 'excluir' | 'carregando' | 'vazio';

const ARQUIVOS: Record<AnimacaoNome, () => Promise<{ default: unknown }>> = {
  sucesso: () => import('../assets/lotties/sucesso.json'),
  erro: () => import('../assets/lotties/erro.json'),
  aviso: () => import('../assets/lotties/aviso.json'),
  excluir: () => import('../assets/lotties/excluir.json'),
  carregando: () => import('../assets/lotties/carregando.json'),
  vazio: () => import('../assets/lotties/vazio.json'),
};

let player: Promise<LottiePlayer> | null = null;

/** O player e' um so' para o sistema inteiro (~45 KB comprimido), carregado na primeira animacao. */
export const carregarPlayer = (): Promise<LottiePlayer> => {
  if (!player) {
    player = import('lottie-web/build/player/lottie_light')
      .then((modulo) => ((modulo as { default?: LottiePlayer }).default ?? (modulo as unknown as LottiePlayer)))
      .catch((erro) => { player = null; throw erro; });
  }
  return player;
};

const dados = new Map<AnimacaoNome, Promise<unknown>>();

const carregarDados = (nome: AnimacaoNome): Promise<unknown> => {
  let pendente = dados.get(nome);
  if (!pendente) {
    pendente = ARQUIVOS[nome]().then((m) => m.default).catch((erro) => { dados.delete(nome); throw erro; });
    dados.set(nome, pendente);
  }
  return pendente;
};

export const prefereMenosMovimento = (): boolean => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

export interface OpcoesDeAnimacao {
  loop?: boolean;
  /** 1 = velocidade normal. */
  velocidade?: number;
  aoTerminar?: () => void;
}

/**
 * Toca uma animacao dentro de `container` (que e' esvaziado antes). Devolve o
 * item para quem quiser parar/destruir, ou null se nao deu (sem movimento,
 * container desmontado, falha de rede) -- a tela segue sem animacao, nunca
 * quebra por causa dela.
 */
export const tocarAnimacao = async (
  container: HTMLElement,
  nome: AnimacaoNome,
  opcoes: OpcoesDeAnimacao = {},
): Promise<AnimationItem | null> => {
  if (prefereMenosMovimento()) return null;
  try {
    const [lottie, animationData] = await Promise.all([carregarPlayer(), carregarDados(nome)]);
    if (!container.isConnected) return null;
    container.replaceChildren();
    const item = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: opcoes.loop ?? false,
      autoplay: true,
      // O player anota coisas dentro do objeto: cada instancia recebe a sua copia.
      animationData: JSON.parse(JSON.stringify(animationData)),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    });
    if (opcoes.velocidade) item.setSpeed(opcoes.velocidade);
    if (opcoes.aoTerminar) item.addEventListener('complete', opcoes.aoTerminar);
    return item;
  } catch (erro) {
    console.error(`[Animação] não foi possível carregar "${nome}":`, erro);
    return null;
  }
};

/**
 * Aquece o player e as animacoes de feedback num momento ocioso (depois do
 * splash), para o primeiro "Salvo!" do dia ja' aparecer animado.
 */
export const preaquecerAnimacoes = (nomes: AnimacaoNome[] = ['sucesso', 'erro', 'aviso', 'excluir']): void => {
  if (prefereMenosMovimento()) return;
  const rodar = () => {
    void carregarPlayer().catch(() => undefined);
    nomes.forEach((nome) => { void carregarDados(nome).catch(() => undefined); });
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(rodar, { timeout: 3000 });
  else setTimeout(rodar, 1500);
};
