import { useEffect } from 'react';
import { TECLA_DE_SALVAR, escolherBotaoDeSalvar } from '../../utils/atalhoSalvarDomain';
import { acharTopo } from './useFaixaDoTopo';

/*
 * F6 SALVA (18/11/2026) -- a regra e o porque estao em atalhoSalvarDomain.ts.
 *
 * Um ouvinte so', na area logada (chamado uma vez no AppLayout): acha o botao
 * de salvar da tela que esta' na frente e clica nele. Nenhuma tela precisa
 * registrar o atalho, e tela nova de cadastro ja' nasce com ele.
 *
 * "A tela que esta' na frente": se ha' uma janela aberta por cima (modal), o
 * F6 vale para ELA; senao, para a pagina da aba ativa. Com um alerta aberto, o
 * F6 nao acha botao de salvar e nao faz nada -- nunca salva o que esta' por
 * baixo de uma janela.
 */

const SELETOR_FORA_DO_ATALHO = '[data-atalho-salvar="nao"]';

/** A pagina da aba ativa (as outras abas seguem montadas, mas escondidas). */
const paginaAtiva = (): HTMLElement | null => (
  Array.from(document.querySelectorAll<HTMLElement>('.app-layout-wrapper .page-content'))
    .find((pagina) => pagina.getClientRects().length > 0) ?? null
);

/** A janela aberta por cima da tela (o que esta' no meio da vista e e' "fixed"), se houver. */
const janelaDeCima = (): HTMLElement | null => {
  let atual = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  while (atual && atual !== document.body && atual !== document.documentElement) {
    if (getComputedStyle(atual).position === 'fixed') return atual as HTMLElement;
    atual = atual.parentElement;
  }
  return null;
};

const visivel = (el: HTMLElement): boolean => el.getClientRects().length > 0;

/** O botao de salvar da tela que esta' na frente, ou null. */
export const acharBotaoDeSalvar = (): HTMLButtonElement | null => {
  const janela = janelaDeCima();
  const pagina = janela ? null : paginaAtiva();
  const contexto = janela ?? pagina;
  if (!contexto) return null;
  // Tela que guarda o F6 para outra coisa (Pedido de Venda e OS: Pagamento).
  if (contexto.closest(SELETOR_FORA_DO_ATALHO)) return null;

  const topo = pagina ? acharTopo(pagina) : null;
  const botoes = Array.from(contexto.querySelectorAll<HTMLButtonElement>('button'))
    .filter((botao) => visivel(botao) && !botao.closest(SELETOR_FORA_DO_ATALHO));
  const escolhido = escolherBotaoDeSalvar(botoes.map((botao) => ({
    texto: botao.textContent || '',
    noCabecalho: !!topo && topo.contains(botao),
    enviaFormulario: botao.type === 'submit' && !!botao.form,
    temIconeSalvar: !!botao.querySelector('svg[class*="lucide-save"]'),
    marca: botao.getAttribute('data-atalho-salvar'),
  })));
  return escolhido >= 0 ? botoes[escolhido] : null;
};

export const useAtalhoSalvar = (): void => {
  useEffect(() => {
    const aoApertar = (evento: KeyboardEvent) => {
      if (evento.key !== TECLA_DE_SALVAR) return;
      if (evento.ctrlKey || evento.altKey || evento.metaKey || evento.shiftKey) return;
      const botao = acharBotaoDeSalvar();
      // Sem botao de salvar na frente: o F6 segue para o que a tela ja' fazia (lista: "Novo").
      if (!botao) return;

      // Achou: o F6 e' do salvar. Nao deixa cair em outro atalho da tela nem no do navegador.
      evento.preventDefault();
      evento.stopPropagation();
      // Tecla segurada nao salva duas vezes; botao desabilitado (salvando, cadastro inativo) nao salva.
      if (evento.repeat || botao.disabled) return;

      // Igual a clicar com o mouse: o campo em que a pessoa estava digitando perde o foco
      // primeiro (e' na saida que varios campos fecham o valor) e so' depois vem o clique.
      botao.focus();
      window.setTimeout(() => {
        if (botao.isConnected && !botao.disabled) botao.click();
      }, 0);
    };

    // Na captura da janela: antes dos atalhos da propria tela, que ouvem na subida.
    window.addEventListener('keydown', aoApertar, true);
    return () => window.removeEventListener('keydown', aoApertar, true);
  }, []);
};
