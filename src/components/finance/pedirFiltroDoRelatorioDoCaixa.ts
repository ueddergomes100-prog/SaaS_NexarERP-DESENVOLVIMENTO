import { NexusSwal, escaparHtml } from '../../utils/alerts';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { formasDaEmpresa } from '../../utils/formasPagamentoDomain';
import { validarDataBaixa } from '../../utils/baixaFinanceiraDomain';

/**
 * Filtros do relatorio completo do caixa (27/11/2026, pedido do dono: "relatorio
 * completo sem dor de cabeca para o dono ver tudo que recebeu e vendeu por forma
 * de pagamento, turnos do caixa"). Pergunta o periodo (abre em hoje) e as formas
 * (nenhuma marcada = todas). Devolve o endereco da pagina do relatorio, ou null.
 */
export const pedirFiltroDoRelatorioDoCaixa = async (caminhoDoRelatorio: string): Promise<string | null> => {
  const hoje = getDateInputInTimeZone();
  const formas = formasDaEmpresa([], []);
  const rotulo = 'display:block;text-align:left;font-size:13px;margin-top:12px;color:var(--text-secondary);';
  const campo = 'width:100%;margin:6px 0 0;box-sizing:border-box;';
  const caixas = formas.map((f, i) => `
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-primary);cursor:pointer;">
      <input type="checkbox" class="rel-caixa-forma" id="rel-caixa-forma-${i}" value="${escaparHtml(f)}" style="width:15px;height:15px;" />
      ${escaparHtml(f)}
    </label>`).join('');
  const resposta = await NexusSwal.fire({
    title: 'Relatório completo do caixa',
    html: `
      <div style="text-align:left;font-size:13.5px;color:var(--text-secondary);">Vendas e recebimentos por forma de pagamento, turnos do caixa, sangrias e contas pagas. Para hoje, é só confirmar.</div>
      <label for="rel-caixa-de" style="${rotulo}">De</label>
      <input id="rel-caixa-de" type="date" class="swal2-input" value="${hoje}" max="${hoje}" style="${campo}" />
      <label for="rel-caixa-ate" style="${rotulo}">Até</label>
      <input id="rel-caixa-ate" type="date" class="swal2-input" value="${hoje}" max="${hoje}" style="${campo}" />
      <div style="${rotulo}">Formas de pagamento (nenhuma marcada = todas)</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin-top:8px;text-align:left;">${caixas}</div>`,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Gerar relatório',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const inicio = (document.getElementById('rel-caixa-de') as HTMLInputElement | null)?.value || '';
      const fim = (document.getElementById('rel-caixa-ate') as HTMLInputElement | null)?.value || '';
      if (validarDataBaixa(inicio, hoje) || validarDataBaixa(fim, hoje)) {
        NexusSwal.showValidationMessage('Informe as duas datas (até hoje).');
        return false;
      }
      if (inicio > fim) {
        NexusSwal.showValidationMessage('A data "De" precisa ser igual ou anterior à data "Até".');
        return false;
      }
      const marcadas = Array.from(document.querySelectorAll<HTMLInputElement>('.rel-caixa-forma:checked')).map((c) => c.value);
      return { inicio, fim, marcadas };
    },
  });
  if (!resposta.isConfirmed || !resposta.value) return null;
  const { inicio, fim, marcadas } = resposta.value as { inicio: string; fim: string; marcadas: string[] };
  const busca = new URLSearchParams({ inicio, fim });
  if (marcadas.length > 0) busca.set('formas', marcadas.join(','));
  return `${caminhoDoRelatorio}?${busca.toString()}`;
};
