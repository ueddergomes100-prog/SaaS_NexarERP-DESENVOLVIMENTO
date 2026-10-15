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
  valorPagoDaBaixa,
  type AjustesDaBaixa,
} from './ajustesDaBaixaDomain';

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
}

/** Sugestao de juros e multa para titulo em atraso (parametrosVendaDomain.acrescimoPorAtraso). */
export interface SugestaoDeAcrescimo {
  jurosCentavos: number;
  multaCentavos: number;
  detalhe: string;
}

const reaisDoDialogo = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

/**
 * Pergunta como e em que dia foi pago/recebido. A data comeca em hoje e nao
 * aceita futuro (ver validarDataBaixa). Devolve null se a pessoa cancelar.
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
  /** Valor da conta (centavos): base do "valor pago" que a janela mostra. */
  valorCentavos: number;
  /** "Valor recebido" / "Valor pago". */
  rotuloTotal: string;
  /** Titulo em atraso com juros/multa configurados na filial: ja' vem preenchido (da' para mudar). */
  sugestao?: SugestaoDeAcrescimo | null;
  /** Sem a permissao propria o Desconto fica bloqueado, com o aviso. */
  podeDescontar: boolean;
  /** Dica embaixo dos campos (ex.: onde configurar as % de juros e multa). */
  dica?: string;
  /** Formas que nao levam juros/multa/desconto (cheque aguarda compensacao; boleto so' emite). */
  formasSemAjuste?: string[];
}): Promise<DadosBaixa | null> => {
  const hoje = getDateInputInTimeZone();
  const opcoes = args.formas
    .map((forma) => `<option value="${escaparHtml(forma)}"${forma === args.formaInicial ? ' selected' : ''}>${escaparHtml(args.rotulosDasFormas?.[forma] || forma)}</option>`)
    .join('');

  const resultado = await NexusSwal.fire({
    title: args.titulo,
    icon: 'question',
    html: `
      <div style="text-align:left;font-size:14px;color:var(--text-secondary);">${escaparHtml(args.texto)}</div>
      <label for="baixa-forma" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloForma)}</label>
      <select id="baixa-forma" class="swal2-select" style="${ESTILO_CAMPO}">
        <option value="">Selecione...</option>${opcoes}
      </select>
      <label for="baixa-data" style="${ESTILO_ROTULO}">${escaparHtml(args.rotuloData)}</label>
      <input id="baixa-data" type="date" class="swal2-input" value="${hoje}" max="${hoje}" style="${ESTILO_CAMPO}" />
      <div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">
        Foi pago em outro dia? Troque a data acima. Ela vale para o Fluxo de Caixa e os relatórios.
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:4px;">
        <div>
          <label for="baixa-juros" style="${ESTILO_ROTULO}">Juros (R$)</label>
          <input id="baixa-juros" type="text" inputmode="decimal" class="swal2-input" value="${textoDoCampo(args.sugestao?.jurosCentavos || 0)}" style="${ESTILO_CAMPO}" aria-label="Juros em reais" />
        </div>
        <div>
          <label for="baixa-multa" style="${ESTILO_ROTULO}">Multa (R$)</label>
          <input id="baixa-multa" type="text" inputmode="decimal" class="swal2-input" value="${textoDoCampo(args.sugestao?.multaCentavos || 0)}" style="${ESTILO_CAMPO}" aria-label="Multa em reais" />
        </div>
        <div>
          <label for="baixa-desconto" style="${ESTILO_ROTULO}">Desconto (R$)</label>
          <input id="baixa-desconto" type="text" inputmode="decimal" class="swal2-input" style="${ESTILO_CAMPO}" aria-label="Desconto em reais"${args.podeDescontar ? '' : ` disabled title="${escaparHtml(`Precisa da permissão ${ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}`)}"`} />
        </div>
      </div>
      ${args.sugestao ? `<div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">
        Juros e multa calculados pelos parâmetros da filial (${escaparHtml(args.sugestao.detalhe)}). Pode mudar ou apagar.
      </div>` : ''}
      ${!args.podeDescontar ? `<div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">
        Desconto: só com a permissão "${escaparHtml(ROTULO_PERMISSAO_DESCONTO_NA_BAIXA)}".
      </div>` : ''}
      ${args.dica ? `<div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">${escaparHtml(args.dica)}</div>` : ''}
      <div id="baixa-total" style="text-align:left;font-size:15px;margin-top:14px;padding:10px 12px;border-radius:8px;background:var(--bg-tertiary);color:var(--text-primary);"></div>
      <div style="text-align:left;font-size:12px;color:var(--text-muted);margin-top:6px;">
        A conta fica quitada pelo valor cheio. Juros/multa e desconto entram como lançamentos próprios no financeiro e saem junto se a baixa for estornada.
      </div>`,
    didOpen: () => {
      // "Valor pago" acompanha o que a pessoa digita.
      const atualizar = () => {
        const ler = (id: string) => centavosDoCampo((document.getElementById(id) as HTMLInputElement | null)?.value || '');
        const juros = ler('baixa-juros');
        const multa = ler('baixa-multa');
        const desconto = ler('baixa-desconto');
        const caixa = document.getElementById('baixa-total');
        if (!caixa) return;
        if (juros === null || multa === null || desconto === null) {
          caixa.textContent = `${args.rotuloTotal}: confira os valores digitados (ex.: 12,50).`;
          return;
        }
        const total = valorPagoDaBaixa(args.valorCentavos, { jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto });
        caixa.innerHTML = `${escaparHtml(args.rotuloTotal)}: <strong>${reaisDoDialogo(total)}</strong>`
          + (juros + multa + desconto > 0 ? ` <span style="color:var(--text-muted);font-size:12.5px;">(conta ${reaisDoDialogo(args.valorCentavos)}${juros + multa > 0 ? ` + ${reaisDoDialogo(juros + multa)}` : ''}${desconto > 0 ? ` − ${reaisDoDialogo(desconto)}` : ''})</span>` : '');
      };
      ['baixa-juros', 'baixa-multa', 'baixa-desconto'].forEach((id) => document.getElementById(id)?.addEventListener('input', atualizar));
      atualizar();
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
      const campos: Array<[string, string]> = [['baixa-juros', 'Juros'], ['baixa-multa', 'Multa'], ['baixa-desconto', 'Desconto']];
      const valores: number[] = [];
      for (const [id, rotulo] of campos) {
        const centavos = centavosDoCampo((document.getElementById(id) as HTMLInputElement | null)?.value || '');
        if (centavos === null) {
          NexusSwal.showValidationMessage(`${rotulo}: informe um valor em reais (ex.: 12,50) ou deixe em branco.`);
          return false;
        }
        valores.push(centavos);
      }
      const ajustes: AjustesDaBaixa = { jurosCentavos: valores[0], multaCentavos: valores[1], descontoCentavos: valores[2] };
      if ((args.formasSemAjuste || []).includes(forma)) {
        // Cheque/boleto nao levam ajuste. O que veio sugerido e ninguem mexeu
        // sai calado (como antes); valor digitado pela pessoa e' avisado.
        const soASugestao = valores[0] === (args.sugestao?.jurosCentavos || 0)
          && valores[1] === (args.sugestao?.multaCentavos || 0)
          && valores[2] === 0;
        if (!soASugestao) {
          NexusSwal.showValidationMessage(`Em ${forma.toLowerCase().startsWith('boleto') ? 'boleto' : forma.toLowerCase()}, juros, multa e desconto não entram nesta baixa. Deixe os três campos em branco.`);
          return false;
        }
        return { forma, data, ajustes: { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 } } as DadosBaixa;
      }
      const erroAjustes = erroDosAjustes(args.valorCentavos, ajustes, { podeDescontar: args.podeDescontar });
      if (erroAjustes) {
        NexusSwal.showValidationMessage(erroAjustes);
        return false;
      }
      return { forma, data, ajustes } as DadosBaixa;
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
