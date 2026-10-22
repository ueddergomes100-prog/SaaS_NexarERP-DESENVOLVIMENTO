"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.podeLiberarDesconto = exports.podeLiberarDescontoNoApp = exports.lerResposta = exports.notificacaoDoPedido = exports.textoDoPedido = exports.erroParaResponder = exports.textoDoTempoRestante = exports.segundosRestantes = exports.situacaoAtual = exports.formatarReais = exports.percentualDoDesconto = exports.lerPedidoRemoto = exports.ROTULO_STATUS_LIBERACAO = exports.MOTIVO_RECUSA_MAXIMO = exports.DOCUMENTO_MAXIMO = exports.MOTIVO_MAXIMO = exports.INTERVALO_CONSULTA_APP_MS = exports.INTERVALO_CONSULTA_ESTACAO_MS = exports.MINUTOS_DE_VALIDADE_DO_PEDIDO = exports.VALIDADE_DO_PEDIDO_MS = exports.NOME_DA_TELA_REMOTA = void 0;
const conferenciaDescontoDomain_1 = require("./conferenciaDescontoDomain");
Object.defineProperty(exports, "podeLiberarDesconto", { enumerable: true, get: function () { return conferenciaDescontoDomain_1.podeLiberarDesconto; } });
const roles_1 = require("./roles");
exports.NOME_DA_TELA_REMOTA = { ...conferenciaDescontoDomain_1.NOME_DA_TELA, orcamento: 'Orçamento' };
/** O gerente tem 10 minutos; depois o vendedor pede de novo (ou usa a senha). */
exports.VALIDADE_DO_PEDIDO_MS = 10 * 60 * 1000;
exports.MINUTOS_DE_VALIDADE_DO_PEDIDO = exports.VALIDADE_DO_PEDIDO_MS / 60000;
/** A estacao pergunta ao servidor a cada 3 s enquanto espera; o app, a cada 10 s na tela. */
exports.INTERVALO_CONSULTA_ESTACAO_MS = 3000;
exports.INTERVALO_CONSULTA_APP_MS = 10000;
exports.MOTIVO_MAXIMO = 300;
exports.DOCUMENTO_MAXIMO = 120;
exports.MOTIVO_RECUSA_MAXIMO = 200;
exports.ROTULO_STATUS_LIBERACAO = {
    pendente: 'Aguardando o gerente',
    aprovada: 'Aprovada',
    recusada: 'Recusada',
    vencida: 'Venceu sem resposta',
    cancelada: 'Cancelada pelo vendedor',
};
const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
};
const texto = (v, maximo) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, maximo);
const TELAS = ['pedido', 'pdv', 'os', 'orcamento'];
const lerPedidoRemoto = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const tela = TELAS.find((t) => t === c.tela);
    if (!tela)
        return { erro: 'Tela da liberação inválida. Atualize a página e tente de novo.' };
    const baseCentavos = numero(c.baseCentavos);
    const descontoCentavos = numero(c.descontoCentavos);
    if (!Number.isInteger(baseCentavos) || !Number.isInteger(descontoCentavos) || baseCentavos <= 0 || descontoCentavos <= 0 || descontoCentavos > baseCentavos) {
        return { erro: 'Valores do desconto inválidos. Confira o desconto e peça a liberação de novo.' };
    }
    return { pedido: { tela, baseCentavos, descontoCentavos, motivo: texto(c.motivo, exports.MOTIVO_MAXIMO), documento: texto(c.documento, exports.DOCUMENTO_MAXIMO) } };
};
exports.lerPedidoRemoto = lerPedidoRemoto;
const percentualDoDesconto = (baseCentavos, descontoCentavos) => (baseCentavos > 0 ? Math.round((descontoCentavos / baseCentavos) * 1000) / 10 : 0);
exports.percentualDoDesconto = percentualDoDesconto;
const formatarReais = (centavos) => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;
exports.formatarReais = formatarReais;
/** Situacao lida AGORA: pedido pendente alem do prazo e' "vencida", mesmo que o banco ainda diga pendente. */
const situacaoAtual = (registro, agoraMs) => {
    const status = String(registro.status || 'pendente');
    if (status === 'pendente' && !(agoraMs <= numero(registro.expiraEmMs)))
        return 'vencida';
    return ['pendente', 'aprovada', 'recusada', 'vencida', 'cancelada'].includes(status) ? status : 'pendente';
};
exports.situacaoAtual = situacaoAtual;
const segundosRestantes = (registro, agoraMs) => (Math.max(0, Math.ceil((numero(registro.expiraEmMs) - agoraMs) / 1000)));
exports.segundosRestantes = segundosRestantes;
/** "4:59" para o contador da estacao. */
const textoDoTempoRestante = (segundos) => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
exports.textoDoTempoRestante = textoDoTempoRestante;
/** Por que este pedido nao pode mais ser respondido (ou null). */
const erroParaResponder = (registro, agoraMs) => {
    switch ((0, exports.situacaoAtual)(registro, agoraMs)) {
        case 'pendente': return null;
        case 'aprovada': return `Este pedido já foi aprovado${registro.aprovadorNome ? ` por ${String(registro.aprovadorNome)}` : ''}.`;
        case 'recusada': return `Este pedido já foi recusado${registro.aprovadorNome ? ` por ${String(registro.aprovadorNome)}` : ''}.`;
        case 'cancelada': return 'O vendedor cancelou este pedido de liberação.';
        default: return `Este pedido venceu (o gerente tem ${exports.MINUTOS_DE_VALIDADE_DO_PEDIDO} minutos para responder). Peça ao vendedor para pedir de novo.`;
    }
};
exports.erroParaResponder = erroParaResponder;
/** "ANA pede 12,5% de desconto (R$ 30,00 em R$ 240,00) — Pedido de Venda, Pedido #0231" */
const textoDoPedido = (r) => {
    const pct = (0, exports.percentualDoDesconto)(r.baseCentavos, r.descontoCentavos).toLocaleString('pt-BR');
    const onde = [exports.NOME_DA_TELA_REMOTA[r.tela], r.documento].filter(Boolean).join(', ');
    return `${r.solicitanteNome || 'Vendedor'} pede ${pct}% de desconto (${(0, exports.formatarReais)(r.descontoCentavos)} em ${(0, exports.formatarReais)(r.baseCentavos)}) — ${onde}`;
};
exports.textoDoPedido = textoDoPedido;
/** Aviso que chega no celular de quem pode liberar. */
const notificacaoDoPedido = (r) => {
    const pct = (0, exports.percentualDoDesconto)(r.baseCentavos, r.descontoCentavos).toLocaleString('pt-BR');
    return {
        titulo: 'Liberar desconto?',
        corpo: `${r.solicitanteNome || 'Vendedor'} pede ${pct}% (${(0, exports.formatarReais)(r.descontoCentavos)}) — ${[exports.NOME_DA_TELA_REMOTA[r.tela], r.documento].filter(Boolean).join(', ')}`,
    };
};
exports.notificacaoDoPedido = notificacaoDoPedido;
const lerResposta = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const decisao = c.decisao === 'aprovar' || c.decisao === 'recusar' ? c.decisao : null;
    if (!decisao)
        return { erro: 'Escolha Aprovar ou Recusar.' };
    const cr = (c.credencial && typeof c.credencial === 'object' ? c.credencial : {});
    let credencial = null;
    if (cr.tipo === 'login' && typeof cr.idToken === 'string' && cr.idToken.length > 20 && cr.idToken.length < 5000)
        credencial = { tipo: 'login', idToken: cr.idToken };
    if (cr.tipo === 'pin' && typeof cr.pin === 'string' && cr.pin.trim())
        credencial = { tipo: 'pin', pin: cr.pin.trim() };
    if (!credencial)
        return { erro: 'Confirme com a sua senha (ou o seu PIN) para responder.' };
    return { resposta: { decisao, motivoRecusa: texto(c.motivoRecusa, exports.MOTIVO_RECUSA_MAXIMO), credencial } };
};
exports.lerResposta = lerResposta;
/** Quem ve a tela Liberacoes no app: dono/gestor, ou quem tem "Liberar desconto". */
const podeLiberarDescontoNoApp = (userRole, isOwner, permissoes) => ((0, roles_1.hasTenantFullAccess)(userRole, isOwner) || permissoes.includes(conferenciaDescontoDomain_1.PERMISSAO_LIBERAR_DESCONTO));
exports.podeLiberarDescontoNoApp = podeLiberarDescontoNoApp;
