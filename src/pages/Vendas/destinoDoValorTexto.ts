import type { DestinoDoValor } from '../../utils/devolucaoVendaDomain';

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

/** Mensagem de sucesso da devolucao conforme o destino escolhido na janela (25/11/2026). */
export const textoDoDestino = (destino: DestinoDoValor['tipo'] | undefined, bancoNome = '', sobraCentavos = 0): string => {
  if (destino === 'caixa') return 'O valor saiu do caixa (dinheiro), com o lançamento de saída.';
  if (destino === 'banco') return `O valor saiu do banco${bancoNome ? ` ${bancoNome}` : ''}, com o lançamento de saída.`;
  if (destino === 'abater') {
    return `O valor foi abatido das parcelas marcadas no Contas a Receber.${sobraCentavos > 0 ? ` Sobrou ${moeda(sobraCentavos / 100)} de crédito do cliente.` : ''}`;
  }
  return 'O valor ficou como crédito do cliente.';
};
