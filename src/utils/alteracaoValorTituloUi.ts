/*
 * Janela "Alterar valor" da parcela a receber (15/10/2026). Regras e frases em
 * alteracaoValorTituloDomain.ts -- as mesmas que o servidor confere.
 */
import { NexusSwal } from './alerts';
import {
  MOTIVO_ALTERACAO_MAXIMO,
  resumoDaAlteracaoValor,
  validarMotivoAlteracaoValor,
  validarNovoValorDoTitulo,
  type AlteracaoValorRegistro,
} from './alteracaoValorTituloDomain';
import { centavosDoValorDigitado } from './totalDigitadoDomain';

const escaparHtml = (texto: string) => texto
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const reais = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ESTILO_CAMPO = 'width:100%;margin:6px 0 0;box-sizing:border-box;';
const ESTILO_ROTULO = 'display:block;text-align:left;font-size:13px;margin-top:14px;';
const ESTILO_AJUDA = 'text-align:left;font-size:12px;opacity:0.75;margin-top:6px;';

/** Frase da diferenca enquanto a pessoa digita. */
const textoDaDiferenca = (atualCentavos: number, novoCentavos: number): string => {
  if (!Number.isInteger(novoCentavos) || novoCentavos <= 0 || novoCentavos === atualCentavos) return '';
  const diferenca = novoCentavos - atualCentavos;
  return diferenca < 0
    ? `Desconto de ${reais(-diferenca)} nesta parcela.`
    : `Acréscimo de ${reais(diferenca)} nesta parcela.`;
};

export interface NovoValorDaParcela {
  novoCentavos: number;
  motivo: string;
}

/** Pede o novo valor e o motivo. Devolve null se a pessoa cancelar. */
export const pedirNovoValorDaParcela = async (args: {
  descricao: string;
  atualCentavos: number;
  /** A parcela veio de venda/OS: lembra que a venda e a nota nao mudam. */
  temOrigem: boolean;
  alteracaoAnterior?: Partial<AlteracaoValorRegistro> | null;
}): Promise<NovoValorDaParcela | null> => {
  const anterior = resumoDaAlteracaoValor(args.alteracaoAnterior);
  const resultado = await NexusSwal.fire({
    title: 'Alterar valor da parcela',
    icon: 'question',
    html: `
      <div style="text-align:left;font-size:14px;">
        Parcela <strong>${escaparHtml(args.descricao)}</strong>, valor atual <strong>${reais(args.atualCentavos)}</strong>.
        ${args.temOrigem ? 'A venda (ou OS) e a nota fiscal continuam com o valor cheio: muda só o valor a receber desta parcela (boleto, carnê, cobrança).' : ''}
      </div>
      ${anterior ? `<div style="${ESTILO_AJUDA}">Já alterada antes. ${escaparHtml(anterior)}</div>` : ''}
      <label for="alterar-valor-novo" style="${ESTILO_ROTULO}">Novo valor da parcela (R$)</label>
      <input id="alterar-valor-novo" type="text" inputmode="decimal" class="swal2-input" value="${(args.atualCentavos / 100).toFixed(2).replace('.', ',')}" style="${ESTILO_CAMPO}" />
      <div id="alterar-valor-diferenca" style="${ESTILO_AJUDA}"></div>
      <label for="alterar-valor-motivo" style="${ESTILO_ROTULO}">Motivo da alteração</label>
      <textarea id="alterar-valor-motivo" class="swal2-textarea" maxlength="${MOTIVO_ALTERACAO_MAXIMO}" style="${ESTILO_CAMPO}"></textarea>
      <div style="${ESTILO_AJUDA}">O motivo, quem alterou e o valor de antes ficam gravados na parcela.</div>`,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Alterar valor',
    cancelButtonText: 'Cancelar',
    didOpen: () => {
      const campo = document.getElementById('alterar-valor-novo') as HTMLInputElement | null;
      const aviso = document.getElementById('alterar-valor-diferenca');
      if (!campo || !aviso) return;
      campo.addEventListener('input', () => {
        aviso.textContent = textoDaDiferenca(args.atualCentavos, centavosDoValorDigitado(campo.value));
      });
      campo.focus();
      campo.select();
    },
    preConfirm: () => {
      const texto = (document.getElementById('alterar-valor-novo') as HTMLInputElement | null)?.value || '';
      const motivo = (document.getElementById('alterar-valor-motivo') as HTMLTextAreaElement | null)?.value || '';
      const novoCentavos = centavosDoValorDigitado(texto);
      const erroValor = validarNovoValorDoTitulo(args.atualCentavos, novoCentavos);
      if (erroValor) {
        NexusSwal.showValidationMessage(erroValor);
        return false;
      }
      const erroMotivo = validarMotivoAlteracaoValor(motivo);
      if (erroMotivo) {
        NexusSwal.showValidationMessage(erroMotivo);
        return false;
      }
      return { novoCentavos, motivo: motivo.trim() } as NovoValorDaParcela;
    },
  });
  return resultado.isConfirmed ? (resultado.value as NovoValorDaParcela) : null;
};
