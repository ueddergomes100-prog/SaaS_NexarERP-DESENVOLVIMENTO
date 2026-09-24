import { NexusSwal, showError, showSuccess } from './alerts';
import {
  escaparHtml,
  htmlDoImpactoDeCusto,
  precoManterMargem,
  type ImpactoNoProduto,
  type ResultadoDoRecalculo,
} from './custoProducaoDomain';

/** O aviso nao conhece o Firestore: quem chama entrega a funcao que grava os precos escolhidos. */
export interface ContextoDeReajuste {
  aplicarPrecos: (itens: { produtoId: string; precoNovo: number }[]) => Promise<{ aplicados: number; ignorados: number }>;
}

const moeda = (valor: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
const percentual = (valor: number | null): string => (valor === null ? '—' : `${valor.toFixed(1).replace('.', ',')}%`);

/**
 * Segundo passo: a pessoa escolhe, produto a produto, se reajusta o preco de
 * venda. O valor que ja vem digitado mantem a margem de antes; ela pode trocar.
 * Nada e' gravado sem o clique em "Aplicar".
 */
const escolherNovosPrecos = async (impactos: ImpactoNoProduto[], contexto: ContextoDeReajuste) => {
  const linhas = impactos.map((i, indice) => {
    const sugerido = precoManterMargem(i);
    return `<tr style="border-top:1px solid rgba(128,128,128,.25)">
      <td style="padding:8px 6px"><input type="checkbox" id="reaj-marca-${indice}" checked aria-label="Reajustar ${escaparHtml(i.nome)}"></td>
      <td style="padding:8px 6px;text-align:left">${escaparHtml(i.nome)}
        <div style="font-size:11px;opacity:.75">margem de antes ${escaparHtml(percentual(i.margemAntes))} · com o preço atual ${escaparHtml(percentual(i.margemDepois))}</div></td>
      <td style="padding:8px 6px;white-space:nowrap">${escaparHtml(moeda(i.custoNovo))}</td>
      <td style="padding:8px 6px;white-space:nowrap">${escaparHtml(moeda(i.precoVenda))}</td>
      <td style="padding:8px 6px"><input type="number" step="0.01" min="0.01" id="reaj-preco-${indice}" value="${sugerido ?? ''}" style="width:110px;padding:6px;border-radius:6px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit"></td>
    </tr>`;
  }).join('');

  const resposta = await NexusSwal.fire({
    title: 'Escolher novos preços de venda',
    width: 900,
    html: `<div style="text-align:left;font-size:13px">
      <div style="margin-bottom:8px">O valor sugerido <strong>mantém a margem que o produto tinha antes</strong>. Você pode digitar outro preço ou desmarcar o produto para não mexer nele. Nada é alterado até você clicar em "Aplicar preços".</div>
      <div style="max-height:340px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="text-align:left;opacity:.7"><th></th><th style="padding:6px">Produto</th><th style="padding:6px">Custo agora</th><th style="padding:6px">Preço atual</th><th style="padding:6px">Novo preço</th></tr></thead>
        <tbody>${linhas}</tbody></table></div></div>`,
    showCancelButton: true,
    confirmButtonText: 'Aplicar preços',
    cancelButtonText: 'Cancelar, manter os preços',
    focusConfirm: false,
    preConfirm: () => {
      const escolhidos: { produtoId: string; precoNovo: number }[] = [];
      for (let indice = 0; indice < impactos.length; indice += 1) {
        const marcado = (document.getElementById(`reaj-marca-${indice}`) as HTMLInputElement | null)?.checked;
        if (!marcado) continue;
        const preco = Number((document.getElementById(`reaj-preco-${indice}`) as HTMLInputElement | null)?.value);
        if (!Number.isFinite(preco) || preco <= 0) {
          NexusSwal.showValidationMessage(`Informe um preço maior que zero para "${impactos[indice].nome}" ou desmarque o produto.`);
          return false;
        }
        escolhidos.push({ produtoId: impactos[indice].produtoId, precoNovo: preco });
      }
      if (escolhidos.length === 0) {
        NexusSwal.showValidationMessage('Nenhum produto marcado. Marque ao menos um ou clique em "Cancelar, manter os preços".');
        return false;
      }
      return escolhidos;
    },
  });
  if (!resposta.isConfirmed || !Array.isArray(resposta.value)) return;

  try {
    const { aplicados, ignorados } = await contexto.aplicarPrecos(resposta.value);
    if (aplicados > 0) {
      showSuccess(`${aplicados} preço(s) de venda atualizado(s)${ignorados > 0 ? ` (${ignorados} sem mudança)` : ''}.`);
    } else {
      showSuccess('Nenhum preço precisou mudar.');
    }
  } catch (erro) {
    console.error('Erro ao aplicar os novos preços:', erro);
    showError('Não foi possível gravar os preços', 'Nenhum preço foi alterado. Confira a conexão e tente pelo cadastro do produto ou pela tela de Precificação.');
  }
};

/**
 * Janela com o impacto do custo nos produtos acabados. Nao abre se nada mudou.
 * Com `contexto`, oferece a escolha: manter os precos ou reajustar.
 */
export const mostrarImpactoDeCusto = async (
  resultado: ResultadoDoRecalculo,
  titulo = 'Custo dos produtos acabados atualizado',
  contexto?: ContextoDeReajuste,
) => {
  const html = htmlDoImpactoDeCusto(resultado);
  if (!html) return;
  const reajustaveis = resultado.impactos.filter((i) => precoManterMargem(i) !== null);
  const podeEscolher = Boolean(contexto) && reajustaveis.length > 0;

  const resposta = await NexusSwal.fire({
    icon: resultado.impactos.some((i) => i.vendeAbaixoDoCusto) ? 'warning' : 'info',
    title: titulo,
    html,
    width: 900,
    showDenyButton: podeEscolher,
    confirmButtonText: podeEscolher ? 'Manter os preços' : 'Entendi',
    denyButtonText: 'Escolher novos preços',
    denyButtonColor: '#3f3f46',
  });
  if (resposta.isDenied && contexto) await escolherNovosPrecos(reajustaveis, contexto);
};
