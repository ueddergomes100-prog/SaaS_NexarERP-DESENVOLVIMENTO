import { CHAVE_PREFERENCIA_COMPACTO, lerPreferenciaCompacto, telaCompacta, type PreferenciaCompacto } from './modoCompactoDomain';

/*
 * Liga/desliga o modo compacto na pagina (28/11/2026). Uma vez, em main.tsx:
 * marca `data-compacto` no <html> conforme a largura da janela e a
 * preferencia do Perfil; o estilo esta' em src/styles/modoCompacto.css.
 */

const EVENTO = 'hennder:tamanho-da-tela';

export const lerPreferenciaGuardada = (): PreferenciaCompacto => {
  try { return lerPreferenciaCompacto(window.localStorage.getItem(CHAVE_PREFERENCIA_COMPACTO)); } catch { return 'auto'; }
};

const aplicar = () => {
  const compacta = telaCompacta(lerPreferenciaGuardada(), window.innerWidth);
  if (compacta) document.documentElement.setAttribute('data-compacto', '1');
  else document.documentElement.removeAttribute('data-compacto');
};

export const guardarPreferenciaCompacto = (preferencia: PreferenciaCompacto) => {
  try { window.localStorage.setItem(CHAVE_PREFERENCIA_COMPACTO, preferencia); } catch { /* so' preferencia deste computador */ }
  aplicar();
  window.dispatchEvent(new Event(EVENTO));
};

export const iniciarModoCompacto = () => {
  aplicar();
  let quadro = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(quadro);
    quadro = requestAnimationFrame(aplicar);
  });
};
