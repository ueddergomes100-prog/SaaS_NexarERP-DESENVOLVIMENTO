/**
 * CALENDARIO DE DATA DO SISTEMA INTEIRO (pedido do dono, 15/10/2026: depois
 * das caixas de selecao, "a data tambem").
 *
 * O calendario que abre num <input type="date"> e' desenhado pelo navegador
 * e nao aceita CSS: no tema claro ele aparecia cinza-escuro, quadrado. Aqui,
 * no computador, o clique no campo abre um calendario do Hennder no lugar
 * dele (cartao, dia escolhido em violeta, "hoje" marcado, meses e anos
 * clicaveis). No celular (toque) continua o calendario do proprio aparelho,
 * que ja' e' o melhor para o dedo.
 *
 * So' visual: o campo continua o mesmo <input type="date"> (da' para digitar
 * a data como sempre; min/max/required valem; o valor chega a' tela pelos
 * mesmos eventos input/change de quando a pessoa digita). Nenhuma tela
 * precisou mudar. Contas do calendario em calendarioDomain.ts.
 */

import {
  DIAS_DA_SEMANA,
  MESES,
  anoForaDosLimites,
  anosDaPagina,
  foraDosLimites,
  gradeDoMes,
  hojeIso,
  lerIso,
  mesForaDosLimites,
  rotuloDoDia,
  rotuloDoMes,
  somarMeses,
  type MesAno,
} from './calendarioDomain';

type Visao = 'dias' | 'meses' | 'anos';

interface Aberto {
  input: HTMLInputElement;
  painel: HTMLDivElement;
  visao: Visao;
  mesAno: MesAno;
  observador: MutationObserver;
}

let aberto: Aberto | null = null;

const ICONE = {
  anterior: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  proximo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  abrir: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};

const ehCampoDeData = (alvo: EventTarget | null): alvo is HTMLInputElement =>
  alvo instanceof HTMLInputElement && alvo.type === 'date';

/** Grava como se a pessoa tivesse digitado: o React e o HTML dos alertas recebem igual. */
function definirValor(input: HTMLInputElement, iso: string) {
  const gravar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (gravar) gravar.call(input, iso);
  else input.value = iso;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function mesAnoInicial(input: HTMLInputElement): MesAno {
  const valor = lerIso(input.value);
  if (valor) return { ano: valor.ano, mes: valor.mes };
  const hoje = lerIso(hojeIso())!;
  const base = { ano: hoje.ano, mes: hoje.mes };
  // Hoje fora do min/max: abre no limite mais proximo, nao num mes todo apagado.
  if (mesForaDosLimites(base, input.min, input.max)) {
    const limite = lerIso(input.min && hojeIso() < input.min ? input.min : input.max);
    if (limite) return { ano: limite.ano, mes: limite.mes };
  }
  return base;
}

function botao(acao: string, conteudo: string, extra: { classe?: string; rotulo?: string; desligado?: boolean; dados?: string } = {}) {
  return `<button type="button" tabindex="-1" data-acao="${acao}"${extra.dados || ''}`
    + `${extra.classe ? ` class="${extra.classe}"` : ''}`
    + `${extra.rotulo ? ` aria-label="${extra.rotulo}"` : ''}`
    + `${extra.desligado ? ' disabled' : ''}>${conteudo}</button>`;
}

function htmlDosDias(estado: Aberto): string {
  const { input, mesAno } = estado;
  const hoje = hojeIso();
  const semana = DIAS_DA_SEMANA.map((d) => `<span>${d}</span>`).join('');
  const dias = gradeDoMes(mesAno).map((d) => {
    const classes = ['hd-cal-dia'];
    if (!d.doMes) classes.push('fora');
    if (d.iso === hoje) classes.push('hoje');
    if (d.iso === input.value) classes.push('escolhido');
    return botao('dia', String(d.dia), {
      classe: classes.join(' '),
      rotulo: rotuloDoDia(d.iso),
      desligado: foraDosLimites(d.iso, input.min, input.max),
      dados: ` data-iso="${d.iso}"${d.iso === input.value ? ' aria-pressed="true"' : ''}`,
    });
  }).join('');
  return `<div class="hd-cal-semana" aria-hidden="true">${semana}</div><div class="hd-cal-dias">${dias}</div>`;
}

function htmlDosMeses(estado: Aberto): string {
  const { input, mesAno } = estado;
  const escolhido = lerIso(input.value);
  const hoje = lerIso(hojeIso())!;
  const meses = MESES.map((nome, i) => {
    const mes = i + 1;
    const classes = ['hd-cal-celula'];
    if (hoje.ano === mesAno.ano && hoje.mes === mes) classes.push('hoje');
    if (escolhido && escolhido.ano === mesAno.ano && escolhido.mes === mes) classes.push('escolhido');
    return botao('mes', nome.slice(0, 3), {
      classe: classes.join(' '),
      rotulo: rotuloDoMes({ ano: mesAno.ano, mes }),
      desligado: mesForaDosLimites({ ano: mesAno.ano, mes }, input.min, input.max),
      dados: ` data-mes="${mes}"`,
    });
  }).join('');
  return `<div class="hd-cal-grade3">${meses}</div>`;
}

function htmlDosAnos(estado: Aberto): string {
  const { input, mesAno } = estado;
  const escolhido = lerIso(input.value);
  const anoDeHoje = lerIso(hojeIso())!.ano;
  const pagina = anosDaPagina(mesAno.ano);
  const anos = pagina.map((ano, i) => {
    const classes = ['hd-cal-celula'];
    if (i === 0 || i === pagina.length - 1) classes.push('fora');
    if (ano === anoDeHoje) classes.push('hoje');
    if (escolhido && escolhido.ano === ano) classes.push('escolhido');
    return botao('ano', String(ano), {
      classe: classes.join(' '),
      desligado: anoForaDosLimites(ano, input.min, input.max),
      dados: ` data-ano="${ano}"`,
    });
  }).join('');
  return `<div class="hd-cal-grade3">${anos}</div>`;
}

function renderizar(estado: Aberto) {
  const { input, painel, visao, mesAno } = estado;
  const pagina = anosDaPagina(mesAno.ano);
  const mesPorExtenso = rotuloDoMes(mesAno);
  const titulo = visao === 'dias'
    ? mesPorExtenso.charAt(0).toUpperCase() + mesPorExtenso.slice(1)
    : visao === 'meses' ? String(mesAno.ano) : `${pagina[1]} – ${pagina[pagina.length - 2]}`;
  const rotulosDasSetas = visao === 'dias'
    ? ['Mês anterior', 'Próximo mês']
    : visao === 'meses' ? ['Ano anterior', 'Próximo ano'] : ['Anos anteriores', 'Próximos anos'];
  const corpo = visao === 'dias' ? htmlDosDias(estado) : visao === 'meses' ? htmlDosMeses(estado) : htmlDosAnos(estado);
  const hoje = hojeIso();
  const rodape = [
    input.required ? '<span></span>' : botao('limpar', 'Limpar', { classe: 'hd-cal-limpar' }),
    botao('hoje', 'Hoje', { classe: 'hd-cal-hoje', desligado: foraDosLimites(hoje, input.min, input.max) }),
  ].join('');

  painel.innerHTML = `<div class="hd-cal-topo">`
    + (visao === 'anos'
      ? `<span class="hd-cal-titulo">${titulo}</span>`
      : botao('visao', `<span>${titulo}</span>${ICONE.abrir}`, {
        classe: 'hd-cal-titulo',
        rotulo: visao === 'dias' ? 'Escolher mês e ano' : 'Escolher ano',
      }))
    + `<div class="hd-cal-setas">${botao('anterior', ICONE.anterior, { rotulo: rotulosDasSetas[0] })}`
    + `${botao('proximo', ICONE.proximo, { rotulo: rotulosDasSetas[1] })}</div></div>`
    + `<div class="hd-cal-corpo hd-cal-visao-${visao}">${corpo}</div>`
    + `<div class="hd-cal-rodape">${rodape}</div>`;
}

function posicionar() {
  if (!aberto) return;
  const { input, painel } = aberto;
  const r = input.getBoundingClientRect();
  if (!input.isConnected || (r.width === 0 && r.height === 0)) {
    fechar();
    return;
  }
  const largura = painel.offsetWidth;
  const altura = painel.offsetHeight;
  const folga = 8;
  let topo = r.bottom + 6;
  // Sem espaco embaixo: abre para cima do campo.
  if (topo + altura > window.innerHeight - folga && r.top - 6 - altura >= folga) topo = r.top - 6 - altura;
  let esquerda = Math.min(r.left, window.innerWidth - largura - folga);
  esquerda = Math.max(folga, esquerda);
  painel.style.top = `${Math.max(folga, topo)}px`;
  painel.style.left = `${esquerda}px`;
}

function fechar() {
  if (!aberto) return;
  const { input, painel, observador } = aberto;
  aberto = null;
  observador.disconnect();
  input.removeAttribute('data-calendario-aberto');
  input.removeEventListener('input', aoDigitar);
  input.removeEventListener('blur', fechar);
  try {
    if (painel.matches(':popover-open')) painel.hidePopover();
  } catch {
    // navegador sem popover: so' remove
  }
  painel.remove();
}

/** Digitou a data no campo: o calendario acompanha. */
function aoDigitar() {
  if (!aberto) return;
  const valor = lerIso(aberto.input.value);
  if (valor) aberto.mesAno = { ano: valor.ano, mes: valor.mes };
  aberto.visao = 'dias';
  renderizar(aberto);
  posicionar();
}

function navegar(delta: number) {
  if (!aberto) return;
  const passo = aberto.visao === 'dias' ? 1 : aberto.visao === 'meses' ? 12 : 120;
  aberto.mesAno = somarMeses(aberto.mesAno, delta * passo);
}

function aoClicarNoPainel(evento: MouseEvent) {
  evento.stopPropagation();
  if (!aberto) return;
  const alvo = (evento.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-acao]');
  if (!alvo || alvo.disabled) return;
  const estado = aberto;
  switch (alvo.dataset.acao) {
    case 'dia':
      definirValor(estado.input, alvo.dataset.iso || '');
      fechar();
      return;
    case 'hoje':
      definirValor(estado.input, hojeIso());
      fechar();
      return;
    case 'limpar':
      definirValor(estado.input, '');
      fechar();
      return;
    case 'anterior':
      navegar(-1);
      break;
    case 'proximo':
      navegar(1);
      break;
    case 'visao':
      estado.visao = estado.visao === 'dias' ? 'meses' : 'anos';
      break;
    case 'mes':
      estado.mesAno = { ano: estado.mesAno.ano, mes: Number(alvo.dataset.mes) };
      estado.visao = 'dias';
      break;
    case 'ano':
      estado.mesAno = { ano: Number(alvo.dataset.ano), mes: estado.mesAno.mes };
      estado.visao = 'meses';
      break;
    default:
      return;
  }
  renderizar(estado);
  posicionar();
}

function abrir(input: HTMLInputElement) {
  fechar();
  const painel = document.createElement('div');
  painel.className = 'hd-calendario';
  painel.setAttribute('role', 'dialog');
  painel.setAttribute('aria-label', 'Escolher data');
  // Camada de cima do navegador: fica acima de janela de alerta e de tabela com rolagem.
  const temPopover = typeof painel.showPopover === 'function';
  if (temPopover) painel.setAttribute('popover', 'manual');

  // O clique no calendario nao tira o foco do campo nem conta como "clique
  // fora" para menus e janelas da tela.
  painel.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  painel.addEventListener('pointerdown', (e) => e.stopPropagation());
  painel.addEventListener('click', aoClicarNoPainel);

  const observador = new MutationObserver(() => {
    if (aberto && !aberto.input.isConnected) fechar();
  });
  aberto = { input, painel, visao: 'dias', mesAno: mesAnoInicial(input), observador };
  renderizar(aberto);
  document.body.appendChild(painel);
  if (temPopover) painel.showPopover();
  observador.observe(document.body, { childList: true, subtree: true });
  input.setAttribute('data-calendario-aberto', '');
  input.addEventListener('input', aoDigitar);
  input.addEventListener('blur', fechar);
  posicionar();
}

/** Clique em cima do icone do calendario (lado direito do campo). */
function cliqueNoIcone(input: HTMLInputElement, evento: MouseEvent): boolean {
  const r = input.getBoundingClientRect();
  const estilo = getComputedStyle(input);
  const direita = r.right - parseFloat(estilo.paddingRight || '0') - parseFloat(estilo.borderRightWidth || '0');
  return evento.clientX >= direita - 26;
}

let iniciado = false;

export function iniciarSeletorDeData() {
  if (iniciado || typeof document === 'undefined') return;
  iniciado = true;

  document.addEventListener('click', (evento) => {
    const input = evento.target;
    if (!ehCampoDeData(input) || input.disabled || input.readOnly) return;
    // Toque (celular/tablet): fica o calendario do aparelho.
    if ((evento as PointerEvent).pointerType === 'touch') return;
    evento.preventDefault(); // nao abre o calendario cinza do navegador
    if (aberto?.input === input) {
      if (cliqueNoIcone(input, evento)) fechar();
      return;
    }
    abrir(input);
  }, true);

  // Clique fora do campo e do calendario fecha (sem impedir o clique de seguir).
  document.addEventListener('mousedown', (evento) => {
    if (!aberto) return;
    const alvo = evento.target as Node | null;
    if (alvo && (aberto.painel.contains(alvo) || alvo === aberto.input)) return;
    fechar();
  }, true);

  window.addEventListener('keydown', (evento) => {
    if (aberto && evento.key === 'Escape') {
      // Fecha so' o calendario: a janela em volta (ex.: Dar Baixa) continua aberta.
      evento.preventDefault();
      evento.stopImmediatePropagation();
      fechar();
      return;
    }
    // Alt+seta para baixo no campo de data: abre o calendario do Hennder.
    if (evento.altKey && evento.key === 'ArrowDown' && ehCampoDeData(evento.target)) {
      const input = evento.target;
      if (input.disabled || input.readOnly) return;
      evento.preventDefault();
      if (aberto?.input === input) fechar();
      else abrir(input);
    }
  }, true);

  window.addEventListener('resize', posicionar);
  window.addEventListener('scroll', posicionar, { capture: true, passive: true });
}
