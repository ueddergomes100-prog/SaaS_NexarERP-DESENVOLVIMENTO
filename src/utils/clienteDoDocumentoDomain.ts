/**
 * Qual cadastro de cliente vai no cabecalho de um documento impresso
 * (pedido, orcamento, OS) -- 23/11/2026.
 *
 * Caso real (Jomarly): dois clientes "LIMA PETROLEO LTDA", matriz e filial,
 * com CNPJ diferente. A impressao procurava o cadastro pelo NOME e saia
 * sempre o primeiro que o banco devolvia -- o pedido feito para a matriz
 * imprimia o CNPJ e o endereco da filial.
 *
 * Regra:
 * 1. O documento guardou o clienteId -> vale esse cadastro (se for da empresa).
 * 2. Sem id (documento antigo) ou cadastro apagado -> procura pelo nome, mas
 *    so' aceita se houver UM cadastro com aquele nome. Com dois ou mais nao
 *    da' para saber qual e', e imprimir o CNPJ de outro cliente e' pior do
 *    que sair o cabecalho so' com o nome que o documento guardou.
 */

export interface ReferenciaDoCliente {
  clienteId?: unknown;
  clienteNome?: unknown;
}

export const idDoClienteDoDocumento = (documento: ReferenciaDoCliente | null | undefined): string =>
  String(documento?.clienteId ?? '').trim();

export const nomeDoClienteDoDocumento = (documento: ReferenciaDoCliente | null | undefined): string =>
  String(documento?.clienteNome ?? '').trim();

export function escolherCadastroDoCliente<T extends { tenantId?: unknown }>(args: {
  tenantId: string;
  porId: T | null | undefined;
  porNome: T[];
}): T | null {
  const { tenantId, porId, porNome } = args;
  if (porId && porId.tenantId === tenantId) return porId;
  const daEmpresa = porNome.filter((c) => c.tenantId === tenantId);
  return daEmpresa.length === 1 ? daEmpresa[0] : null;
}
