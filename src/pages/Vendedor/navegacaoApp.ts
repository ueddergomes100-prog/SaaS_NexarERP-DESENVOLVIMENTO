import { useLocation, useNavigate, type NavigateOptions } from 'react-router-dom';

/*
 * VOLTAR DO APP (bug de 13/10/2026, video do dono).
 *
 * O Voltar ficava em laco entre a lista de OS e a OS: o detalhe "voltava"
 * EMPILHANDO a lista de novo (navigate('/vendedor/os')), e o Voltar da lista
 * so' voltava uma tela no historico -- que era o detalhe. Lista -> OS ->
 * lista -> OS... sem fim.
 *
 * Regra agora: o Voltar do cabecalho sempre SOBE para a tela de cima (o
 * "pai"), sem empilhar:
 *  - quem entrou numa tela leva junto de onde veio (`comOrigem`);
 *  - se a tela anterior no historico e' o pai, o Voltar volta no historico
 *    (igual ao botao do celular, historico limpo);
 *  - se nao e' (abriu por link, ou chegou de outro caminho), vai para o pai
 *    SUBSTITUINDO a tela atual -- nunca empilha.
 */

export interface EstadoDeOrigem {
  de?: string;
}

/** Opcoes de navegacao "para dentro": registra de onde a pessoa veio. */
export const comOrigem = (de: string, extra: NavigateOptions = {}): NavigateOptions => ({ ...extra, state: { de } });

/** Parte pura do Voltar: volta no historico so' quando a tela anterior e' o pai. */
export const acaoDoVoltar = (estado: unknown, pai: string): 'historico' | 'substituir' => (
  (estado as EstadoDeOrigem | null)?.de === pai ? 'historico' : 'substituir'
);

export const useVoltarPara = (): ((pai: string) => void) => {
  const navigate = useNavigate();
  const location = useLocation();
  return (pai: string) => {
    if (acaoDoVoltar(location.state, pai) === 'historico') navigate(-1);
    else navigate(pai, { replace: true });
  };
};
