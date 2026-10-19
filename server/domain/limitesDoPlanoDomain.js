"use strict";
/*
 * LIMITES DO PLANO: LOGINS E ACESSOS AO APP VENDAS (19/10/2026, auditoria de
 * seguranca "so' a tela protege"; decisao do dono: o servidor confere).
 *
 * Os limites moram no registro do dono da MATRIZ (usuarios/{matriz}:
 * limiteUsuarios, limiteAcessoMobile -- so' o SuperAdmin altera). Antes so' a
 * tela conferia; agora criar login e ligar o app passam pelo servidor
 * (server/services/limitesDoPlano.js), e o login do app pelo codigo confere a
 * vaga. Regra pura, compilada para server/domain.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mensagemSemVagaNoApp = exports.idsDentroDoLimiteDoApp = exports.mensagemLimiteDoApp = exports.mensagemLimiteDeUsuarios = exports.lerLimiteDoPlano = exports.LIMITE_ACESSO_MOBILE_PADRAO = exports.LIMITE_USUARIOS_PADRAO = void 0;
/** Sem limite gravado: 3 logins (padrao antigo do sistema). */
exports.LIMITE_USUARIOS_PADRAO = 3;
/** Sem limite gravado: app fechado (contratado a parte). */
exports.LIMITE_ACESSO_MOBILE_PADRAO = 0;
const lerLimiteDoPlano = (valor, padrao) => {
    if (valor === undefined || valor === null || valor === '')
        return padrao;
    const n = Number(valor);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : padrao;
};
exports.lerLimiteDoPlano = lerLimiteDoPlano;
const mensagemLimiteDeUsuarios = (limite) => (`Sua empresa atingiu o limite de ${limite} usuário${limite === 1 ? '' : 's'} contratado${limite === 1 ? '' : 's'}. Entre em contato com o suporte para alterar o limite do seu plano.`);
exports.mensagemLimiteDeUsuarios = mensagemLimiteDeUsuarios;
const mensagemLimiteDoApp = (limite) => (limite === 0
    ? 'Sua empresa ainda não tem o aplicativo mobile contratado. Fale com o suporte para contratar o acesso antes de liberar para alguém.'
    : `Sua empresa atingiu o limite de ${limite} acesso${limite === 1 ? '' : 's'} ao aplicativo mobile contratado${limite === 1 ? '' : 's'}. Fale com o suporte para aumentar o limite do seu plano.`);
exports.mensagemLimiteDoApp = mensagemLimiteDoApp;
/**
 * Quem cabe no limite do app: os primeiros a ganhar o acesso (sem data = os
 * antigos, primeiro), ate' o limite. Se alguem passou do limite (o limite foi
 * reduzido, ou ligaram pelo DevTools antes da trava), quem ficou por ultimo
 * e' que nao entra -- quem ja' usava continua usando.
 */
const idsDentroDoLimiteDoApp = (registros, limite) => {
    const ordem = registros
        .filter((r) => r.acessoAppMobile === true)
        .map((r) => ({ id: r.id, em: typeof r.acessoAppMobileEm === 'string' ? r.acessoAppMobileEm : '' }))
        .sort((a, b) => a.em.localeCompare(b.em) || a.id.localeCompare(b.id));
    return new Set(ordem.slice(0, Math.max(0, limite)).map((r) => r.id));
};
exports.idsDentroDoLimiteDoApp = idsDentroDoLimiteDoApp;
const mensagemSemVagaNoApp = (limite) => (`Sua empresa tem mais pessoas com o aplicativo ligado do que o plano permite (${limite}). Peça ao administrador para desligar o app de quem não usa, ou fale com o suporte para aumentar o limite.`);
exports.mensagemSemVagaNoApp = mensagemSemVagaNoApp;
