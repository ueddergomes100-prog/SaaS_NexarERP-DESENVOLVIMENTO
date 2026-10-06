/**
 * ALERTA DO CLIENTE (2026-10-06, pedido do dono).
 *
 * No cadastro do cliente: marcar "Mostrar alerta ao escolher este cliente" e
 * escrever o recado ("so' vende a vista", "cobrar boleto atrasado antes de
 * vender", "entregar so' depois das 14h"...). Quando o cliente for escolhido
 * no PDV, no Pedido de Venda, no Orcamento, na OS (e nas outras telas que usam
 * a busca de cliente), o recado aparece numa janela que a pessoa precisa
 * fechar com "Entendi".
 *
 * Gravado no proprio documento do cliente: `alertaAtivo` (boolean) e
 * `alertaTexto` (string). Nunca `undefined` (regra 3 do CLAUDE.md).
 */

export interface ClienteComAlerta {
  nome?: string | null;
  alertaAtivo?: boolean;
  alertaTexto?: string;
}

export const ALERTA_TAMANHO_MAXIMO = 500;

/** Texto do alerta a mostrar, ou null quando o cliente nao tem alerta ligado. */
export const alertaDoCliente = (cliente: ClienteComAlerta | null | undefined): string | null => {
  if (!cliente || cliente.alertaAtivo !== true) return null;
  const texto = String(cliente.alertaTexto ?? '').trim();
  return texto || null;
};

/** Mensagem para o usuario quando o alerta nao pode ser gravado como esta; null = ok. */
export const erroDoAlertaDoCliente = (ativo: boolean, texto: string): string | null => {
  if (!ativo) return null;
  const limpo = String(texto ?? '').trim();
  if (!limpo) return 'Escreva o texto do alerta, ou desmarque "Mostrar alerta ao escolher este cliente".';
  if (limpo.length > ALERTA_TAMANHO_MAXIMO) {
    return `O alerta tem ${limpo.length} caracteres e o limite é ${ALERTA_TAMANHO_MAXIMO}. Resuma o texto.`;
  }
  return null;
};

/** Campos que o Salvar grava. Desmarcado guarda o texto (para religar depois sem redigitar). */
export const camposDoAlertaParaGravar = (ativo: boolean, texto: string): { alertaAtivo: boolean; alertaTexto: string } => {
  const limpo = String(texto ?? '').trim();
  return { alertaAtivo: Boolean(ativo) && limpo !== '', alertaTexto: limpo };
};
