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
      </div>`,
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
      return { forma, data } as DadosBaixa;
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
