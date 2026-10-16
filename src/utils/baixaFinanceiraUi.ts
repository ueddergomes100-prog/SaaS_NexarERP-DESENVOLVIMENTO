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
  /** Dica pequena (ex.: onde configurar as % de juros e multa). */
  dica?: string;
  /** Formas que nao levam juros/multa/desconto nem parcial (cheque aguarda compensacao; boleto so' emite). */
  formasSemAjuste?: string[];
  /** Motivo de a conta nao aceitar pagamento parcial ('' / ausente = aceita). */
  bloqueioParcial?: string;
}): Promise<DadosBaixa | null> => {
  const hoje = getDateInputInTimeZone();
  const saldo = Math.max(0, Math.round(args.valorCentavos));
  const opcoes = args.formas
    .map((forma) => `<option value="${escaparHtml(forma)}"${forma === args.formaInicial ? ' selected' : ''}>${escaparHtml(args.rotulosDasFormas?.[forma] || forma)}</option>`)
    .join('');
  const sugestaoJuros = args.sugestao?.jurosCentavos || 0;
  const sugestaoMulta = args.sugestao?.multaCentavos || 0;
  const totalInicial = totalParaQuitar(saldo, { jurosCentavos: sugestaoJuros, multaCentavos: sugestaoMulta, descontoCentavos: 0 });
  const notas = [
    args.sugestao ? `Juros e multa pelas % da filial (${args.sugestao.detalhe}).` : '',
    !args.podeDescontar ? `Desconto: só com a permissão "${ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}".` : '',
    args.dica || '',
  ].filter(Boolean);
  const miniCampo = (id: string, rotulo: string, valor: number, bloqueado = false) => `
    <div style="flex:1;min-width:0;">
      <label for="${id}" style="${ESTILO_MINI_ROTULO}">${rotulo}</label>
      <input id="${id}" type="text" inputmode="decimal" class="swal2-input" value="${textoDoCampo(valor)}" style="${ESTILO_MINI_CAMPO}" aria-label="${rotulo} em reais"${bloqueado ? ` disabled title="${escaparHtml(`Precisa da permissão ${ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}`)}"` : ''} />
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
      <div style="text-align:left;font-size:13.5px;color:var(--text-secondary);">${escaparHtml(args.texto)}</div>
      <div style="display:flex;gap:8px;margin-top:12px;padding:8px 10px;border-radius:8px;background:var(--bg-tertiary);">
        ${miniCampo('baixa-juros', 'Juros', sugestaoJuros)}
        ${miniCampo('baixa-multa', 'Multa', sugestaoMulta)}
        ${miniCampo('baixa-desconto', 'Desconto', 0, !args.podeDescontar)}
      </div>
      ${notas.length ? `<div style="text-align:left;font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.4;">${notas.map(escaparHtml).join(' ')}</div>` : ''}
      <label for="baixa-forma" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloForma)}</label>
      <select id="baixa-forma" class="swal2-select" style="${ESTILO_CAMPO}">
        <option value="">Selecione...</option>${opcoes}
      </select>
      <label for="baixa-data" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloData)}</label>
      <input id="baixa-data" type="date" class="swal2-input" value="${hoje}" max="${hoje}" style="${ESTILO_CAMPO}" />
      <div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">
        Foi pago em outro dia? Troque a data acima. Ela vale para o Fluxo de Caixa e os relatórios.
      </div>
      <label for="baixa-valor" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloValor)} (R$)</label>
      <input id="baixa-valor" type="text" inputmode="decimal" class="swal2-input" value="${textoDoCampo(totalInicial)}" style="${ESTILO_CAMPO};font-size:18px;font-weight:700;text-align:right;" aria-label="${escaparHtml(args.rotuloValor)} em reais" />
      <div id="baixa-resumo" style="text-align:left;font-size:13px;margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--bg-tertiary);color:var(--text-primary);line-height:1.45;"></div>`,
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
        if (args.sugestao && !ajustesMexidos && recebido !== null) {
          const partes = separarValorRecebido(saldo, recebido, { jurosCentavos: sugestaoJuros, multaCentavos: sugestaoMulta }, lerCentavos('baixa-desconto') ?? 0);
          escrever('baixa-juros', partes.jurosCentavos);
          escrever('baixa-multa', partes.multaCentavos);
        }
        resumo();
      };
      ['baixa-juros', 'baixa-multa', 'baixa-desconto'].forEach((id) => document.getElementById(id)?.addEventListener('input', aoMexerNosAjustes));
      document.getElementById('baixa-valor')?.addEventListener('input', aoMexerNoValor);
      resumo();
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
      const erroData = validarDataBaixa(data, hoje);
      if (erroData) {
        NexusSwal.showValidationMessage(erroData);
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
        return { forma, data, ajustes: { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 }, valorRecebidoCentavos: saldo } as DadosBaixa;
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
      return { forma, data, ajustes, valorRecebidoCentavos: recebido } as DadosBaixa;
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
    inputPlaceholder: 'Escreva por que está estornando',
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
