"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolverAcaoValidacaoCliente = exports.parseModoValidacaoCliente = exports.DEFAULT_MODO_VALIDACAO_CLIENTE = void 0;
exports.DEFAULT_MODO_VALIDACAO_CLIENTE = 'permitir';
const parseModoValidacaoCliente = (raw) => (raw === 'bloquear' || raw === 'perguntar' ? raw : exports.DEFAULT_MODO_VALIDACAO_CLIENTE);
exports.parseModoValidacaoCliente = parseModoValidacaoCliente;
/**
 * Decide o que a tela deve fazer ao salvar, dado o modo configurado e se o
 * nome digitado bateu com um cliente ja cadastrado.
 * - clienteEncontrado: sempre segue (nao ha nada pra validar).
 * - nome vazio: sempre segue (a tela ja trata como "Consumidor Final").
 */
const resolverAcaoValidacaoCliente = (modo, clienteEncontrado, nomeDigitado) => {
    if (clienteEncontrado || !nomeDigitado.trim())
        return { tipo: 'seguir' };
    if (modo === 'bloquear') {
        return {
            tipo: 'bloquear',
            motivo: 'Selecione um cliente cadastrado ou use o botão "Cadastrar Cliente".',
        };
    }
    if (modo === 'perguntar')
        return { tipo: 'perguntar' };
    return { tipo: 'seguir' };
};
exports.resolverAcaoValidacaoCliente = resolverAcaoValidacaoCliente;
