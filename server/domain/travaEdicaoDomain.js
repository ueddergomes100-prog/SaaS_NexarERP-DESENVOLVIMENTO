"use strict";
/**
 * TRAVA DE EDICAO (pedido do dono, 15/10/2026): duas pessoas nao abrem o
 * mesmo documento ao mesmo tempo -- quem salvava por ultimo apagava o que o
 * outro fez. Quem abre "pega a vez"; enquanto a tela estiver aberta, ela
 * avisa o servidor; nas listas o documento fica cinza com "Em edicao por
 * Fulano (celular)" e quem clica nao abre. Vale no computador e no celular.
 *
 * Decisoes do dono (15/10/2026):
 *  - bloqueia (nao abre nem para ver);
 *  - 10 minutos sem mexer na tela liberam a vez; celular desligado ou
 *    navegador fechado liberam em ate 2 minutos (sem o aviso de "continuo
 *    aqui"); o dono ou um gerente libera na hora.
 *
 * O servidor e' quem grava (server/services/travasEdicao.js); as telas so'
 * leem `travas_edicao` para pintar as listas. O tempo e' sempre o do
 * servidor (milissegundos), para relogio errado de celular nao valer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mensagemDeBloqueio = exports.descreverTrava = exports.avaliarSinal = exports.avaliarPegar = exports.travaAtiva = exports.calcularValidade = exports.idDaTrava = exports.ehTipoDeTrava = exports.ROTULO_DO_TIPO = exports.INTERVALO_DO_SINAL_MS = exports.PARADO_LIBERA_MS = exports.SEM_SINAL_LIBERA_MS = exports.TIPOS_DE_TRAVA = void 0;
exports.TIPOS_DE_TRAVA = ['conferencia', 'pedido_venda'];
/** Sem o aviso de "continuo aqui" por mais que isto, a tela foi fechada ou caiu. */
exports.SEM_SINAL_LIBERA_MS = 2 * 60 * 1000;
/** Tela aberta sem ninguem mexer por mais que isto: a vez e' liberada. */
exports.PARADO_LIBERA_MS = 10 * 60 * 1000;
/** De quanto em quanto tempo a tela avisa que continua aberta. */
exports.INTERVALO_DO_SINAL_MS = 30 * 1000;
exports.ROTULO_DO_TIPO = {
    conferencia: 'a conferência',
    pedido_venda: 'o pedido',
};
const ehTipoDeTrava = (valor) => exports.TIPOS_DE_TRAVA.includes(valor);
exports.ehTipoDeTrava = ehTipoDeTrava;
/** Documento da trava: um por registro de cada tipo, dentro da empresa. */
const idDaTrava = (tenantId, tipo, registroId) => `${tenantId}__${tipo}__${registroId}`;
exports.idDaTrava = idDaTrava;
const calcularValidade = (ultimoSinalMs, ultimaAtividadeMs) => (Math.min(ultimoSinalMs + exports.SEM_SINAL_LIBERA_MS, ultimaAtividadeMs + exports.PARADO_LIBERA_MS));
exports.calcularValidade = calcularValidade;
/** A trava ainda segura o documento? (sem trava, ou vencida = livre) */
const travaAtiva = (trava, agoraMs) => (Boolean(trava) && Number(trava.validaAteMs) > agoraMs);
exports.travaAtiva = travaAtiva;
const avaliarPegar = (atual, pedido, agoraMs) => {
    if (!atual || !(0, exports.travaAtiva)(atual, agoraMs))
        return { tipo: 'livre' };
    if (atual.sessaoId === pedido.sessaoId)
        return { tipo: 'mesma_sessao' };
    if (atual.usuarioId === pedido.usuarioId)
        return { tipo: 'mesmo_usuario' };
    return { tipo: 'de_outro', trava: atual };
};
exports.avaliarPegar = avaliarPegar;
/** O aviso de "continuo aqui" de uma tela: renova, venceu ou outra pessoa/tela ficou com a vez. */
const avaliarSinal = (atual, sessaoId, agoraMs) => {
    if (atual && atual.sessaoId !== sessaoId && (0, exports.travaAtiva)(atual, agoraMs))
        return { tipo: 'perdeu', trava: atual };
    if (!atual || atual.sessaoId !== sessaoId || !(0, exports.travaAtiva)(atual, agoraMs))
        return { tipo: 'venceu' };
    return { tipo: 'ok', validaAteMs: atual.validaAteMs };
};
exports.avaliarSinal = avaliarSinal;
const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
/** "Em edição por MARIA no celular desde 14:32" -- para a lista cinza e o aviso. */
const descreverTrava = (trava) => (`Em edição por ${trava.usuarioNome || 'outro usuário'} no ${trava.aparelho === 'celular' ? 'celular' : 'computador'} desde ${hora(trava.desdeMs)}`);
exports.descreverTrava = descreverTrava;
/** Mensagem para quem tentou abrir o que outra pessoa esta editando. */
const mensagemDeBloqueio = (tipo, trava) => (`${(0, exports.descreverTrava)(trava)}. Espere terminar para abrir ${exports.ROTULO_DO_TIPO[tipo]}: assim um não apaga o que o outro fez. Se a pessoa saiu e deixou aberto, a vez é liberada sozinha depois de 10 minutos parada, ou o dono/gerente libera agora.`);
exports.mensagemDeBloqueio = mensagemDeBloqueio;
