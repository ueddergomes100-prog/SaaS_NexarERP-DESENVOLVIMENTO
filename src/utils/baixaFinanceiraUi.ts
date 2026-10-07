/*
 * Dialogos de "Dar Baixa" (forma + data) e de estorno (motivo), compartilhados
 * por Contas a Pagar e Contas a Receber. Regras em baixaFinanceiraDomain.ts.
 */
import { NexusSwal } from './alerts';
import { getDateInputInTimeZone } from './dateTime';
import { validarDataBaixa, validarMotivoEstorno } from './baixaFinanceiraDomain';

const escaparHtml = (texto: string) => texto
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ESTILO_CAMPO = 'width:100%;margin:6px 0 0;box-sizing:border-box;color-scheme:dark;';
const ESTILO_ROTULO = 'display:block;text-align:left;font-size:13px;margin-top:14px;color:#d4d4d8;';

export interface DadosBaixa {
  forma: string;
  /** yyyy-mm-dd */
  data: string;
  /** Juros e multa cobrados junto (centavos). 0 = nenhum. So' no Receber. */
  acrescimoCentavos: number;
}

/** Sugestao de juros e multa para titulo em atraso (parametrosVendaDomain.acrescimoPorAtraso). */
export interface SugestaoDeAcrescimo {
  centavos: number;
  detalhe: string;
}

/**
 * Pergunta como e em que dia foi pago/recebido. A data comeca em hoje e nao
 * aceita futuro (ver validarDataBaixa). Devolve null se a pessoa cancelar.
 */
export const pedirDadosBaixa = async (args: {
  titulo: string;
  texto: string;
  formas: string[];
  formaInicial?: string;
  rotuloForma: string;
  /** Frase quando confirma sem escolher a forma. Ex.: "Escolha como foi pago." */
  mensagemSemForma: string;
  rotuloData: string;
  textoConfirmar: string;
  /** Receber em atraso com juros/multa configurados: mostra a sugestao, que a pessoa ajusta ou tira. */
  acrescimo?: SugestaoDeAcrescimo | null;
}): Promise<DadosBaixa | null> => {
  const hoje = getDateInputInTimeZone();
  const opcoes = args.formas
    .map((forma) => `<option value="${escaparHtml(forma)}"${forma === args.formaInicial ? ' selected' : ''}>${escaparHtml(forma)}</option>`)
    .join('');

  const resultado = await NexusSwal.fire({
    title: args.titulo,
    icon: 'question',
    html: `
      <div style="text-align:left;font-size:14px;color:#d4d4d8;">${escaparHtml(args.texto)}</div>
      <label for="baixa-forma" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloForma)}</label>
      <select id="baixa-forma" class="swal2-select" style="${ESTILO_CAMPO}">
        <option value="">Selecione...</option>${opcoes}
      </select>
      <label for="baixa-data" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloData)}</label>
      <input id="baixa-data" type="date" class="swal2-input" value="${hoje}" max="${hoje}" style="${ESTILO_CAMPO}" />
      <div style="text-align:left;font-size:12px;color:#a1a1aa;margin-top:6px;">
        Foi pago em outro dia? Troque a data acima. Ela vale para o Fluxo de Caixa e os relatórios.
      </div>
      ${args.acrescimo ? `
      <label for="baixa-acrescimo-ligado" style="${ESTILO_ROTULO};display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input id="baixa-acrescimo-ligado" type="checkbox" checked style="accent-color:#8b5cf6;width:16px;height:16px;" />
        Cobrar juros e multa (${escaparHtml(args.acrescimo.detalhe)})
      </label>
      <input id="baixa-acrescimo" type="text" inputmode="decimal" class="swal2-input" value="${(args.acrescimo.centavos / 100).toFixed(2).replace('.', ',')}" style="${ESTILO_CAMPO}" aria-label="Valor de juros e multa em reais" />
      <div style="text-align:left;font-size:12px;color:#a1a1aa;margin-top:6px;">
        Valor sugerido pelos parâmetros da filial; pode ajustar. Entra como lançamento "Juros e multa" junto deste recebimento.
      </div>` : ''}`,
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
      let acrescimoCentavos = 0;
      if (args.acrescimo) {
        const ligado = (document.getElementById('baixa-acrescimo-ligado') as HTMLInputElement | null)?.checked ?? false;
        const texto = (document.getElementById('baixa-acrescimo') as HTMLInputElement | null)?.value || '';
        if (ligado) {
          const valor = Number(texto.replace(/\./g, '').replace(',', '.'));
          if (!Number.isFinite(valor) || valor < 0) {
            NexusSwal.showValidationMessage('Juros e multa: informe um valor em reais (ex.: 12,50) ou desmarque a opção.');
            return false;
          }
          acrescimoCentavos = Math.round(valor * 100);
        }
      }
      return { forma, data, acrescimoCentavos } as DadosBaixa;
    },
  });

  return resultado.isConfirmed ? (resultado.value as DadosBaixa) : null;
};

/** Confirma o estorno e exige o motivo. Devolve o motivo, ou null se cancelar. */
export const pedirMotivoEstorno = async (args: { titulo: string; texto: string }): Promise<string | null> => {
  const resultado = await NexusSwal.fire({
    title: args.titulo,
    icon: 'warning',
    html: `<div style="text-align:left;font-size:14px;color:#d4d4d8;">${escaparHtml(args.texto)}</div>`,
    input: 'textarea',
    inputLabel: 'Motivo do estorno',
    inputPlaceholder: 'Ex.: baixa feita na data errada',
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
