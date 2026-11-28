/*
 * Dialogos de "Dar Baixa" (forma + data) e de estorno (motivo), compartilhados
 * por Contas a Pagar e Contas a Receber. Regras em baixaFinanceiraDomain.ts.
 */
import { NexusSwal } from './alerts';
import { getDateInputInTimeZone } from './dateTime';
import { validarDataBaixa, validarMotivoEstorno } from './baixaFinanceiraDomain';
import {
  centavosDoCampo,
  erroDosAjustes,
  ROTULO_PERMISSAO_DESCONTO_NA_BAIXA,
  textoDoCampo,
  type AjustesDaBaixa,
} from './ajustesDaBaixaDomain';
import { erroDoValorRecebido, principalDaBaixa, separarValorRecebido, totalParaQuitar } from './baixaParcialDomain';
import { permissionLabelMap } from './permissionCatalog';
import { PERMISSAO_FINANCEIRO } from './permissoesNovasDomain';

/** Rotulos das permissoes de juros/multa e data anterior (item 15), como no cadastro do funcionario. */
const ROTULO_JUROS_MULTA = permissionLabelMap[PERMISSAO_FINANCEIRO.baixaJurosMulta] || 'Financeiro: alterar juros e multa na baixa';
const ROTULO_DATA_ANTERIOR = permissionLabelMap[PERMISSAO_FINANCEIRO.baixaDataAnterior] || 'Financeiro: dar baixa com data anterior a hoje';

const escaparHtml = (texto: string) => texto
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ESTILO_CAMPO = 'width:100%;margin:6px 0 0;box-sizing:border-box;';
const ESTILO_ROTULO = 'display:block;text-align:left;font-size:13px;margin-top:14px;color:var(--text-secondary);';

export interface DadosBaixa {
  forma: string;
  /** yyyy-mm-dd */
  data: string;
  /** Juros, multa e desconto (centavos; 0 = nenhum). Receber e Pagar (15/10/2026). */
  ajustes: AjustesDaBaixa;
  /**
   * Quanto entrou/saiu de fato (centavos). Menos que o total = pagamento
   * PARCIAL (16/10/2026): a conta fica em aberto com o resto.
   */
  valorRecebidoCentavos: number;
  /** Banco escolhido na mesma janela (so' quando a forma pede banco). */
  bancoId?: string;
  /** Numero do cheque (so' na forma do campo `cheque`, e so' se a pessoa digitou). */
  numeroCheque?: string;
  /** Forma que EMITE em vez de dar baixa (Boleto): o vencimento escolhido na mesma janela. */
  vencimentoBoleto?: string;
}

/**
 * Forma que nao da' baixa, emite (Boleto, 24/11/2026 -- "o cliente pergunta:
 * uai, mas vai dar baixa agora?"). Escolhida, a janela troca o titulo e o botao
 * para "Emitir boleto", esconde juros/data/valor (nao se aplicam) e pede o
 * vencimento ali mesmo, em vez de uma segunda janela.
 */
export interface FormaQueEmite {
  forma: string;
  titulo: string;
  textoConfirmar: string;
  /** Explica que a conta nao e' baixada agora. */
  texto: string;
  vencimentoSugerido: string;
  vencimentoMinimo: string;
  /** '' = valido. */
  validarVencimento: (vencimento: string) => string;
}

/**
 * Banco na mesma janela da baixa (23/11/2026, pedido do dono na Embala Minas:
 * "no recebimento pix tem que informar em qual banco foi, cade?"). Antes o
 * banco vinha numa segunda janela depois de confirmar, e parecia nao existir.
 */
export interface EscolhaDeBancoNaBaixa {
  bancos: Array<{ id: string; nome: string }>;
  /** Formas que exigem o banco (o campo so' aparece nelas). */
  formas: string[];
  /** Pergunta mostrada para a forma escolhida (ex.: "Em qual banco caiu?"). */
  rotulo: (forma: string) => string;
  /** Banco ja' escolhido ao abrir (ex.: o banco do cheque emitido). A pessoa pode trocar. */
  bancoInicial?: string;
  /**
   * Formas em que o banco aparece mas NAO e' obrigatorio (28/11/2026, pedido do
   * dono: cheque recebido "nao precisa solicitar o banco, ter opcao de
   * indefinido"). Vazio = "Indefinido": o banco e' escolhido ao compensar.
   */
  formasOpcionais?: string[];
}

export const ROTULO_BANCO_INDEFINIDO = 'Indefinido (escolher ao compensar)';

/**
 * Numero do cheque na mesma janela (Contas a Pagar, 24/11/2026): aparece so'
 * na forma indicada e e' opcional.
 */
export interface NumeroDoChequeNaBaixa {
  forma: string;
  inicial?: string;
}

/** Sugestao de juros e multa para titulo em atraso (parametrosVendaDomain.acrescimoPorAtraso). */
export interface SugestaoDeAcrescimo {
  jurosCentavos: number;
  multaCentavos: number;
  detalhe: string;
}

const reaisDoDialogo = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

// Juros, multa e desconto pequenos no topo (pedido do dono, 16/10/2026).
const ESTILO_MINI_ROTULO = 'display:block;text-align:left;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--text-muted);margin-bottom:3px;';
const ESTILO_MINI_CAMPO = 'width:100%;height:32px;margin:0;padding:4px 8px;font-size:13px;box-sizing:border-box;text-align:right;';

/**
 * "Dar Baixa": forma, data e o valor que entrou/saiu agora, com juros, multa
 * e desconto em uma linha pequena no topo. A data comeca em hoje e nao aceita
 * futuro (validarDataBaixa). O valor ja' vem com o total: menos = pagamento
 * parcial (baixaParcialDomain.ts). Devolve null se a pessoa cancelar.
 */
export const pedirDadosBaixa = async (args: {
  titulo: string;
  texto: string;
  formas: string[];
  /** Texto mostrado no lugar do nome da forma (o valor continua o nome). */
  rotulosDasFormas?: Record<string, string>;
  formaInicial?: string;
  rotuloForma: string;
  /** Frase quando confirma sem escolher a forma. Ex.: "Escolha como foi pago." */
  mensagemSemForma: string;
  rotuloData: string;
  textoConfirmar: string;
  /** O que falta da conta (centavos). */
  valorCentavos: number;
  /** "Valor recebido agora" / "Valor pago agora". */
  rotuloValor: string;
  /** Contas a Pagar: textos com "pago". */
  pagar?: boolean;
  /** Titulo em atraso com juros/multa configurados na filial: ja' vem preenchido (da' para mudar). */
  sugestao?: SugestaoDeAcrescimo | null;
  /** Sem a permissao propria o Desconto fica bloqueado, com o aviso. */
  podeDescontar: boolean;
  /**
   * Item 15 (25/11/2026): sem "alterar juros e multa na baixa", Juros e Multa
   * ficam travados: no Receber, no PADRAO DA FILIAL (a sugestao) -- decisao do
   * dono: nenhum funcionario deixa de cobrar; o servidor confere. Sem sugestao
   * (Contas a Pagar), em branco. Ausente = pode.
   */
  podeJurosMulta?: boolean;
  /** Recalcula o padrao da filial quando a data da baixa muda (juros ate' a data paga). */
  sugestaoNaData?: (data: string) => SugestaoDeAcrescimo | null;
  /** Item 15: sem "dar baixa com data anterior a hoje", a data fica em hoje. Ausente = pode. */
  podeDataAnterior?: boolean;
  /** Dica pequena (ex.: onde configurar as % de juros e multa). */
  dica?: string;
  /** Formas que nao levam juros/multa/desconto nem parcial (cheque aguarda compensacao; boleto so' emite). */
  formasSemAjuste?: string[];
  /** Motivo de a conta nao aceitar pagamento parcial ('' / ausente = aceita). */
  bloqueioParcial?: string;
  /** Escolha do banco na propria janela, para as formas que pedem banco. */
  banco?: EscolhaDeBancoNaBaixa;
  /** Forma que emite em vez de dar baixa (Boleto). */
  emissao?: FormaQueEmite;
  /** Campo opcional "Nº do cheque", so' na forma indicada. */
  cheque?: NumeroDoChequeNaBaixa;
}): Promise<DadosBaixa | null> => {
  const hoje = getDateInputInTimeZone();
  const saldo = Math.max(0, Math.round(args.valorCentavos));
  const opcoes = args.formas
    .map((forma) => `<option value="${escaparHtml(forma)}"${forma === args.formaInicial ? ' selected' : ''}>${escaparHtml(args.rotulosDasFormas?.[forma] || forma)}</option>`)
    .join('');
  const podeJurosMulta = args.podeJurosMulta !== false;
  const podeDataAnterior = args.podeDataAnterior !== false;
  // Sem a permissao de juros/multa, a sugestao da filial entra TRAVADA (padrao da filial).
  const sugestao = args.sugestao || null;
  let sugestaoJuros = sugestao?.jurosCentavos || 0;
  let sugestaoMulta = sugestao?.multaCentavos || 0;
  const totalInicial = totalParaQuitar(saldo, { jurosCentavos: sugestaoJuros, multaCentavos: sugestaoMulta, descontoCentavos: 0 });
  const notas = [
    sugestao ? `Juros e multa pelas % da filial (${sugestao.detalhe}).` : '',
    !podeJurosMulta && sugestao ? `Juros e multa ficam no padrão da filial: só quem tem a permissão "${ROTULO_JUROS_MULTA}" pode alterar.` : '',
    !podeJurosMulta && !sugestao ? `Juros e multa: só com a permissão "${ROTULO_JUROS_MULTA}". Para lançar, peça ao responsável liberar no seu cadastro de funcionário.` : '',
    !args.podeDescontar ? `Desconto: só com a permissão "${ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}".` : '',
    podeJurosMulta ? args.dica || '' : '',
  ].filter(Boolean);
  const miniCampo = (id: string, rotulo: string, valor: number, bloqueioPorPermissao = '') => `
    <div style="flex:1;min-width:0;">
      <label for="${id}" style="${ESTILO_MINI_ROTULO}">${rotulo}</label>
      <input id="${id}" type="text" inputmode="decimal" class="swal2-input" value="${textoDoCampo(valor)}" style="${ESTILO_MINI_CAMPO}" aria-label="${rotulo} em reais"${bloqueioPorPermissao ? ` disabled title="${escaparHtml(`Precisa da permissão ${bloqueioPorPermissao}`)}"` : ''} />
    </div>`;

  const lerCentavos = (id: string) => centavosDoCampo((document.getElementById(id) as HTMLInputElement | null)?.value || '');
  const escrever = (id: string, centavos: number) => {
    const campo = document.getElementById(id) as HTMLInputElement | null;
    if (campo) campo.value = textoDoCampo(centavos);
  };

  const resultado = await NexusSwal.fire({
    title: args.titulo,
    icon: 'question',
    html: `
      <div id="baixa-texto" style="text-align:left;font-size:13.5px;color:var(--text-secondary);">${escaparHtml(args.texto)}</div>
      <div id="baixa-ajustes" style="display:flex;gap:8px;margin-top:12px;padding:8px 10px;border-radius:8px;background:var(--bg-tertiary);">
        ${miniCampo('baixa-juros', 'Juros', sugestaoJuros, podeJurosMulta ? '' : ROTULO_JUROS_MULTA)}
        ${miniCampo('baixa-multa', 'Multa', sugestaoMulta, podeJurosMulta ? '' : ROTULO_JUROS_MULTA)}
        ${miniCampo('baixa-desconto', 'Desconto', 0, args.podeDescontar ? '' : ROTULO_PERMISSAO_DESCONTO_NA_BAIXA)}
      </div>
      ${notas.length ? `<div id="baixa-notas" style="text-align:left;font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.4;">${notas.map(escaparHtml).join(' ')}</div>` : ''}
      <label for="baixa-forma" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloForma)}</label>
      <select id="baixa-forma" class="swal2-select" style="${ESTILO_CAMPO}">
        <option value="">Selecione...</option>${opcoes}
      </select>
      ${args.banco ? `<div id="baixa-banco-bloco" style="display:none;">
        <label id="baixa-banco-rotulo" for="baixa-banco" style="${ESTILO_ROTULO}"></label>
        ${args.banco.bancos.length > 0 || (args.banco.formasOpcionais || []).length > 0
          ? `<select id="baixa-banco" class="swal2-select" style="${ESTILO_CAMPO}"><option value="">Selecione o banco...</option>${args.banco.bancos
            .map((b) => `<option value="${escaparHtml(b.id)}"${b.id === args.banco?.bancoInicial ? ' selected' : ''}>${escaparHtml(b.nome)}</option>`).join('')}</select>`
          : `<div style="text-align:left;font-size:13px;color:#ef4444;margin-top:6px;">Nenhum banco ativo. Cadastre em Cadastros Auxiliares › Bancos.</div>`}
      </div>` : ''}
      ${args.emissao ? `<div id="baixa-bloco-emissao" style="display:none;">
        <label for="baixa-vencimento-boleto" style="${ESTILO_ROTULO}">Vencimento do boleto</label>
        <input id="baixa-vencimento-boleto" type="date" class="swal2-input" min="${args.emissao.vencimentoMinimo}" value="${args.emissao.vencimentoSugerido}" style="${ESTILO_CAMPO}" />
        <div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">${escaparHtml(args.emissao.texto)}</div>
      </div>` : ''}
      <div id="baixa-campos-baixa">
      ${args.cheque ? `<div id="baixa-cheque-bloco" style="display:none;">
        <label for="baixa-cheque" style="${ESTILO_ROTULO}">Nº do cheque (opcional)</label>
        <input id="baixa-cheque" type="text" maxlength="30" class="swal2-input" value="${escaparHtml(args.cheque.inicial || '')}" style="${ESTILO_CAMPO}" />
      </div>` : ''}
      <label for="baixa-data" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloData)}</label>
      <input id="baixa-data" type="date" class="swal2-input" value="${hoje}" max="${hoje}"${podeDataAnterior ? '' : ` min="${hoje}" disabled title="${escaparHtml(`Precisa da permissão ${ROTULO_DATA_ANTERIOR}`)}"`} style="${ESTILO_CAMPO}" />
      <div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">
        ${podeDataAnterior
    ? 'Foi pago em outro dia? Troque a data acima. Ela vale para o Fluxo de Caixa e os relatórios.'
    : escaparHtml(`A baixa fica com a data de hoje. Dar baixa com data anterior precisa da permissão "${ROTULO_DATA_ANTERIOR}": peça ao responsável liberar no seu cadastro de funcionário.`)}
      </div>
      <label for="baixa-valor" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloValor)} (R$)</label>
      <input id="baixa-valor" type="text" inputmode="decimal" class="swal2-input" value="${textoDoCampo(totalInicial)}" style="${ESTILO_CAMPO};font-size:18px;font-weight:700;text-align:right;" aria-label="${escaparHtml(args.rotuloValor)} em reais" />
      <div id="baixa-resumo" style="text-align:left;font-size:13px;margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--bg-tertiary);color:var(--text-primary);line-height:1.45;"></div>
      </div>`,
    didOpen: () => {
      // O valor acompanha juros/multa/desconto ate' a pessoa mexer nele. Mexendo
      // no valor (parcial), juros e multa calculados ficam proporcionais a parte
      // paga, ate' a pessoa mexer neles (decisao do dono, 16/10/2026).
      let valorMexido = false;
      let ajustesMexidos = false;
      const resumo = () => {
        const caixa = document.getElementById('baixa-resumo');
        if (!caixa) return;
        const juros = lerCentavos('baixa-juros');
        const multa = lerCentavos('baixa-multa');
        const desconto = lerCentavos('baixa-desconto');
        const recebido = lerCentavos('baixa-valor');
        if (juros === null || multa === null || desconto === null || recebido === null) {
          caixa.textContent = 'Confira os valores digitados (em reais, com vírgula: 12,50).';
          return;
        }
        const ajustes = { jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto };
        const principal = principalDaBaixa(recebido, ajustes);
        const detalhe = juros + multa + desconto > 0
          ? `<div style="font-size:11.5px;color:var(--text-muted);">Da conta: ${reaisDoDialogo(Math.max(0, principal))}${juros + multa > 0 ? ` · juros e multa: ${reaisDoDialogo(juros + multa)}` : ''}${desconto > 0 ? ` · desconto: ${reaisDoDialogo(desconto)}` : ''}</div>`
          : '';
        if (principal >= saldo) {
          caixa.innerHTML = `<strong>Quita a conta.</strong>${detalhe}`;
        } else if (principal > 0) {
          const aviso = args.bloqueioParcial ? `<div style="color:#ef4444;font-size:12px;margin-top:2px;">${escaparHtml(args.bloqueioParcial)}</div>` : '';
          caixa.innerHTML = `<strong>${args.pagar ? 'Pagamento' : 'Recebimento'} parcial:</strong> fica em aberto <strong>${reaisDoDialogo(saldo - principal)}</strong>.${detalhe}${aviso}`;
        } else {
          caixa.innerHTML = `<span style="color:#ef4444;">O valor não cobre os juros e a multa.</span>${detalhe}`;
        }
      };
      const aoMexerNosAjustes = (evento: Event) => {
        if ((evento.target as HTMLElement).id !== 'baixa-desconto') ajustesMexidos = true;
        if (!valorMexido) {
          const juros = lerCentavos('baixa-juros') ?? 0;
          const multa = lerCentavos('baixa-multa') ?? 0;
          const desconto = lerCentavos('baixa-desconto') ?? 0;
          escrever('baixa-valor', totalParaQuitar(saldo, { jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto }));
        }
        resumo();
      };
      const aoMexerNoValor = () => {
        valorMexido = true;
        const recebido = lerCentavos('baixa-valor');
        // Juros/multa travados no padrao (sem a permissao): o valor recebido nao os diminui.
        if (sugestao && podeJurosMulta && !ajustesMexidos && recebido !== null) {
          const partes = separarValorRecebido(saldo, recebido, { jurosCentavos: sugestaoJuros, multaCentavos: sugestaoMulta }, lerCentavos('baixa-desconto') ?? 0);
          escrever('baixa-juros', partes.jurosCentavos);
          escrever('baixa-multa', partes.multaCentavos);
        }
        resumo();
      };
      ['baixa-juros', 'baixa-multa', 'baixa-desconto'].forEach((id) => document.getElementById(id)?.addEventListener('input', aoMexerNosAjustes));
      document.getElementById('baixa-valor')?.addEventListener('input', aoMexerNoValor);
      // Sem a permissao de juros/multa: mudou a data da baixa, o padrao da filial e' recalculado (juros ate' a data paga).
      if (!podeJurosMulta && args.sugestaoNaData) {
        const recalcular = () => {
          const data = (document.getElementById('baixa-data') as HTMLInputElement | null)?.value || '';
          const nova = data ? args.sugestaoNaData?.(data) : null;
          sugestaoJuros = nova?.jurosCentavos || 0;
          sugestaoMulta = nova?.multaCentavos || 0;
          escrever('baixa-juros', sugestaoJuros);
          escrever('baixa-multa', sugestaoMulta);
          if (!valorMexido) {
            escrever('baixa-valor', totalParaQuitar(saldo, { jurosCentavos: sugestaoJuros, multaCentavos: sugestaoMulta, descontoCentavos: lerCentavos('baixa-desconto') ?? 0 }));
          }
          resumo();
        };
        document.getElementById('baixa-data')?.addEventListener('change', recalcular);
      }
      resumo();
      // Banco aparece logo abaixo da forma, so' nas formas que pedem banco.
      const mostrarBanco = () => {
        const bloco = document.getElementById('baixa-banco-bloco');
        if (!bloco || !args.banco) return;
        const forma = (document.getElementById('baixa-forma') as HTMLSelectElement | null)?.value || '';
        const opcional = (args.banco.formasOpcionais || []).includes(forma);
        const pede = args.banco.formas.includes(forma) || opcional;
        bloco.style.display = pede ? 'block' : 'none';
        const primeira = (document.getElementById('baixa-banco') as HTMLSelectElement | null)?.options[0];
        if (primeira) primeira.textContent = opcional ? ROTULO_BANCO_INDEFINIDO : 'Selecione o banco...';
        const rotulo = document.getElementById('baixa-banco-rotulo');
        if (rotulo && pede) rotulo.textContent = args.banco.rotulo(forma);
      };
      document.getElementById('baixa-forma')?.addEventListener('change', mostrarBanco);
      mostrarBanco();
      // Boleto: a janela vira "Emitir boleto" (nao e' baixa).
      const tituloOriginal = NexusSwal.getTitle()?.textContent || args.titulo;
      const botaoOriginal = args.textoConfirmar;
      const mostrarModo = () => {
        if (!args.emissao) return;
        const forma = (document.getElementById('baixa-forma') as HTMLSelectElement | null)?.value || '';
        const emite = forma === args.emissao.forma;
        const exibir = (id: string, sim: boolean, como = 'block') => {
          const el = document.getElementById(id);
          if (el) el.style.display = sim ? como : 'none';
        };
        exibir('baixa-bloco-emissao', emite);
        exibir('baixa-campos-baixa', !emite);
        exibir('baixa-ajustes', !emite, 'flex');
        exibir('baixa-notas', !emite);
        exibir('baixa-texto', !emite);
        const titulo = NexusSwal.getTitle();
        if (titulo) titulo.textContent = emite ? args.emissao.titulo : tituloOriginal;
        const rotulo = document.querySelector('label[for="baixa-forma"]');
        if (rotulo) rotulo.textContent = emite ? 'Como o cliente vai pagar?' : args.rotuloForma;
        const botao = NexusSwal.getConfirmButton();
        if (botao) botao.textContent = emite ? args.emissao.textoConfirmar : botaoOriginal;
        NexusSwal.resetValidationMessage();
      };
      document.getElementById('baixa-forma')?.addEventListener('change', mostrarModo);
      mostrarModo();
      // Numero do cheque: so' na forma Cheque (Contas a Pagar).
      const mostrarCheque = () => {
        const bloco = document.getElementById('baixa-cheque-bloco');
        if (!bloco || !args.cheque) return;
        const forma = (document.getElementById('baixa-forma') as HTMLSelectElement | null)?.value || '';
        bloco.style.display = forma === args.cheque.forma ? 'block' : 'none';
      };
      document.getElementById('baixa-forma')?.addEventListener('change', mostrarCheque);
      mostrarCheque();
      // Comeca pela forma (juros/multa/desconto sao o caso menos comum).
      (document.getElementById('baixa-forma') as HTMLSelectElement | null)?.focus();
    },
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: args.textoConfirmar,
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const forma = (document.getElementById('baixa-forma') as HTMLSelectElement | null)?.value || '';
      const data = (document.getElementById('baixa-data') as HTMLInputElement | null)?.value || '';
      if (!forma) {
        NexusSwal.showValidationMessage(args.mensagemSemForma);
        return false;
      }
      if (args.emissao && forma === args.emissao.forma) {
        const vencimento = (document.getElementById('baixa-vencimento-boleto') as HTMLInputElement | null)?.value || '';
        const erroVencimento = args.emissao.validarVencimento(vencimento);
        if (erroVencimento) {
          NexusSwal.showValidationMessage(erroVencimento);
          return false;
        }
        return { forma, data: hoje, ajustes: { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 }, valorRecebidoCentavos: saldo, vencimentoBoleto: vencimento } as DadosBaixa;
      }
      let bancoId = '';
      if ((args.banco?.formasOpcionais || []).includes(forma)) {
        // Cheque: banco opcional; em branco = indefinido (escolhido ao compensar).
        bancoId = (document.getElementById('baixa-banco') as HTMLSelectElement | null)?.value || '';
      } else if (args.banco?.formas.includes(forma)) {
        if (args.banco.bancos.length === 0) {
          NexusSwal.showValidationMessage('Nenhum banco ativo. Cadastre um banco em Cadastros Auxiliares › Bancos antes de confirmar.');
          return false;
        }
        bancoId = (document.getElementById('baixa-banco') as HTMLSelectElement | null)?.value || '';
        if (!bancoId) {
          NexusSwal.showValidationMessage(`${args.banco.rotulo(forma)} Escolha o banco antes de confirmar.`);
          return false;
        }
      }
      const numeroCheque = args.cheque && forma === args.cheque.forma
        ? ((document.getElementById('baixa-cheque') as HTMLInputElement | null)?.value || '').trim()
        : '';
      if (numeroCheque && !/^[A-Za-z0-9./ -]{1,30}$/.test(numeroCheque)) {
        NexusSwal.showValidationMessage('Nº do cheque: use só números e letras (até 30), ou deixe em branco.');
        return false;
      }
      const comBanco = { ...(bancoId ? { bancoId } : {}), ...(numeroCheque ? { numeroCheque } : {}) };
      const erroData = validarDataBaixa(data, hoje);
      if (erroData) {
        NexusSwal.showValidationMessage(erroData);
        return false;
      }
      if (!podeDataAnterior && data !== hoje) {
        NexusSwal.showValidationMessage(`A baixa precisa ficar com a data de hoje: dar baixa com data anterior precisa da permissão "${ROTULO_DATA_ANTERIOR}".`);
        return false;
      }
      const campos: Array<[string, string]> = [['baixa-juros', 'Juros'], ['baixa-multa', 'Multa'], ['baixa-desconto', 'Desconto'], ['baixa-valor', args.rotuloValor]];
      const valores: number[] = [];
      for (const [id, rotulo] of campos) {
        const centavos = lerCentavos(id);
        if (centavos === null) {
          NexusSwal.showValidationMessage(`${rotulo}: informe um valor em reais (ex.: 12,50)${id === 'baixa-valor' ? '' : ' ou deixe em branco'}.`);
          return false;
        }
        valores.push(centavos);
      }
      const ajustes: AjustesDaBaixa = { jurosCentavos: valores[0], multaCentavos: valores[1], descontoCentavos: valores[2] };
      const recebido = valores[3];
      if (!podeJurosMulta && (ajustes.jurosCentavos !== sugestaoJuros || ajustes.multaCentavos !== sugestaoMulta)) {
        NexusSwal.showValidationMessage(`Juros e multa ficam no padrão da filial. Para alterar, peça ao responsável liberar "${ROTULO_JUROS_MULTA}" no seu cadastro de funcionário.`);
        return false;
      }
      if ((args.formasSemAjuste || []).includes(forma)) {
        // Cheque/boleto: sem ajuste e sem parcial. O que veio calculado e
        // ninguem mexeu sai calado (como antes); o resto e' avisado.
        const soOCalculado = valores[0] === sugestaoJuros && valores[1] === sugestaoMulta && valores[2] === 0
          && recebido === totalParaQuitar(saldo, ajustes);
        if (!soOCalculado) {
          const nome = forma.toLowerCase().startsWith('boleto') ? 'boleto' : forma.toLowerCase();
          NexusSwal.showValidationMessage(`Em ${nome}, a conta é baixada pelo valor inteiro, sem juros, multa ou desconto. Deixe os três campos em branco e o valor como veio.`);
          return false;
        }
        return { forma, data, ajustes: { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 }, valorRecebidoCentavos: saldo, ...comBanco } as DadosBaixa;
      }
      const erroAjustes = erroDosAjustes(saldo, ajustes, { podeDescontar: args.podeDescontar });
      if (erroAjustes) {
        NexusSwal.showValidationMessage(erroAjustes);
        return false;
      }
      const erroValor = erroDoValorRecebido(saldo, recebido, ajustes, { bloqueioParcial: args.bloqueioParcial || undefined, pagar: args.pagar });
      if (erroValor) {
        NexusSwal.showValidationMessage(erroValor);
        return false;
      }
      return { forma, data, ajustes, valorRecebidoCentavos: recebido, ...comBanco } as DadosBaixa;
    },
  });

  return resultado.isConfirmed ? (resultado.value as DadosBaixa) : null;
};

/** Confirma o estorno e exige o motivo. Devolve o motivo, ou null se cancelar. */
export const pedirMotivoEstorno = async (args: { titulo: string; texto: string }): Promise<string | null> => {
  const resultado = await NexusSwal.fire({
    title: args.titulo,
    icon: 'warning',
    html: `<div style="text-align:left;font-size:14px;color:var(--text-secondary);">${escaparHtml(args.texto)}</div>`,
    input: 'textarea',
    inputLabel: 'Motivo do estorno',
    showCancelButton: true,
    confirmButtonColor: '#f59e0b',
    confirmButtonText: 'Sim, estornar',
    cancelButtonText: 'Cancelar',
    preConfirm: (motivo: string) => {
      const erro = validarMotivoEstorno(motivo);
      if (erro) {
        NexusSwal.showValidationMessage(erro);
        return false;
      }
      return motivo.trim();
    },
  });
  return resultado.isConfirmed ? String(resultado.value) : null;
};
