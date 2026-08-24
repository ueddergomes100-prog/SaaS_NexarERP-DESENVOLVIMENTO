// Funcoes puras de Validacao de Cliente Cadastrado (Pedido de Venda, OS,
// Orcamento). Sem Firestore -- leitura/escrita fica nas telas que consomem
// isto.
//
// So se aplica as 3 telas de texto livre. No PDV o ClientModal ja so deixa
// selecionar cliente cadastrado (nunca digita nome livre), entao o modo nao
// muda nada la.
//
// Modo ausente/invalido = 'permitir' -- preserva o comportamento de hoje
// (criar cliente novo silenciosamente) em todo tenant que nao configurar
// nada.

export type ModoValidacaoCliente = 'permitir' | 'bloquear' | 'perguntar';

export const DEFAULT_MODO_VALIDACAO_CLIENTE: ModoValidacaoCliente = 'permitir';

export const parseModoValidacaoCliente = (raw: unknown): ModoValidacaoCliente => (
  raw === 'bloquear' || raw === 'perguntar' ? raw : DEFAULT_MODO_VALIDACAO_CLIENTE
);

export type AcaoValidacaoCliente =
  | { tipo: 'seguir' }
  | { tipo: 'bloquear'; motivo: string }
  | { tipo: 'perguntar' };

/**
 * Decide o que a tela deve fazer ao salvar, dado o modo configurado e se o
 * nome digitado bateu com um cliente ja cadastrado.
 * - clienteEncontrado: sempre segue (nao ha nada pra validar).
 * - nome vazio: sempre segue (a tela ja trata como "Consumidor Final").
 */
export const resolverAcaoValidacaoCliente = (
  modo: ModoValidacaoCliente,
  clienteEncontrado: boolean,
  nomeDigitado: string,
): AcaoValidacaoCliente => {
  if (clienteEncontrado || !nomeDigitado.trim()) return { tipo: 'seguir' };

  if (modo === 'bloquear') {
    return {
      tipo: 'bloquear',
      motivo: 'Selecione um cliente cadastrado ou use o botão "Cadastrar Cliente".',
    };
  }

  if (modo === 'perguntar') return { tipo: 'perguntar' };

  return { tipo: 'seguir' };
};
