/**
 * BOTAO "INSTALAR" DOS APPS (17/11/2026, pedido do dono: a Frente de Caixa
 * tem de poder ser instalada separada do sistema completo).
 *
 * O Chrome/Edge avisa que a pagina pode virar app pelo evento
 * `beforeinstallprompt`, que dispara cedo, antes de qualquer tela montar.
 * Este modulo guarda o evento (importado no main.tsx) para a tela de
 * instalacao mostrar um botao que abre a janela de instalacao do navegador --
 * do manifest DESTA pagina (caixa.html instala o "Hennder Caixa", index.html o
 * sistema). Safari e Firefox nao tem o evento: a tela mostra o passo a passo.
 */
interface EventoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pedido: EventoDeInstalacao | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((ouvinte) => ouvinte());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    pedido = evento as EventoDeInstalacao;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    pedido = null;
    avisar();
  });
}

/** O navegador ofereceu instalar esta pagina como app? */
export const podeInstalarAgora = (): boolean => pedido !== null;

/** Abre a janela de instalacao do navegador. Devolve true se a pessoa aceitou. */
export const pedirInstalacao = async (): Promise<boolean> => {
  if (!pedido) return false;
  const atual = pedido;
  await atual.prompt();
  const { outcome } = await atual.userChoice;
  pedido = null;
  avisar();
  return outcome === 'accepted';
};

/** Avisa quando muda a possibilidade de instalar (para a tela re-renderizar). */
export const acompanharPedidoDeInstalacao = (aoMudar: () => void): (() => void) => {
  ouvintes.add(aoMudar);
  return () => { ouvintes.delete(aoMudar); };
};
