"use strict";
/**
 * BOLETO BANCARIO REGISTRADO (2026-09-21).
 *
 * Pedido do dono: "eu vou te mandar o CNAB 240 do Sicoob e o do Banco do
 * Brasil... porque a gente tem que mandar esse arquivo remessa para o banco
 * validar", e "sim, e' para ter o retorno do banco para baixar automatico".
 *
 * Este arquivo tem a parte que NAO depende de banco: fator de vencimento,
 * digitos verificadores, codigo de barras e linha digitavel. Sao definicoes
 * da FEBRABAN, iguais em qualquer banco, e sao a parte em que errar um
 * digito faz o boleto nao ser pago -- por isso ficam aqui, puras e testadas,
 * longe de tela e de Firestore.
 *
 * O que muda por banco (nosso numero, carteira, posicoes do arquivo remessa)
 * fica em boletoCnabDomain.ts.
 *
 * ATENCAO, que vale repetir pro dono: gerar o arquivo certo nao basta. Todo
 * banco exige HOMOLOGACAO -- a empresa manda um arquivo de teste, o banco
 * confere e so' entao libera a cobranca registrada. Nada disto entra em
 * producao sem esse aceite do banco.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.zerosAEsquerda = exports.digitosDoBoleto = exports.codigoBarrasDaLinhaDigitavel = exports.erroDaLinhaDigitavel = exports.formatarLinhaDigitavel = exports.linhaDigitavelDoCodigoBarras = exports.montarCodigoBarras = exports.modulo10 = exports.dvCodigoBarras = exports.fatorDeVencimento = void 0;
/** Data-base da FEBRABAN para o fator de vencimento. */
const DATA_BASE_FATOR = Date.UTC(1997, 9, 7); // 07/10/1997
const DIA_MS = 24 * 60 * 60 * 1000;
const apenasDigitos = (valor) => String(valor || '').replace(/\D/g, '');
exports.digitosDoBoleto = apenasDigitos;
const zeros = (valor, tamanho) => (apenasDigitos(String(valor)).slice(-tamanho).padStart(tamanho, '0'));
exports.zerosAEsquerda = zeros;
/**
 * Fator de vencimento: dias corridos desde 07/10/1997, em 4 posicoes.
 *
 * Em 22/02/2025 o contador estourou 9999 e a FEBRABAN mandou voltar pra
 * 1000 (nao pra 0000) -- por isso o `% 9000 + 1000` quando passa de 9999.
 * Sem esse tratamento, todo boleto com vencimento a partir dessa data sai
 * com fator errado e o banco recusa.
 */
const fatorDeVencimento = (vencimento) => {
    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(vencimento || ''));
    if (!partes)
        return '0000';
    const dias = Math.round((Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])) - DATA_BASE_FATOR) / DIA_MS);
    if (dias < 0)
        return '0000';
    if (dias <= 9999)
        return zeros(dias, 4);
    return zeros(((dias - 10000) % 9000) + 1000, 4);
};
exports.fatorDeVencimento = fatorDeVencimento;
/**
 * Modulo 11 do codigo de barras (pesos 2..9 da direita pra esquerda).
 * Resto 0, 1 ou 10 => DV 1. E' a regra especifica do DV geral do codigo de
 * barras, diferente do modulo 11 usado em outros campos.
 */
const dvCodigoBarras = (campo43) => {
    const digitos = apenasDigitos(campo43);
    if (digitos.length !== 43)
        return -1;
    let peso = 2;
    let soma = 0;
    for (let i = digitos.length - 1; i >= 0; i -= 1) {
        soma += Number(digitos[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return (resto === 0 || resto === 1 || resto === 10) ? 1 : 11 - resto;
};
exports.dvCodigoBarras = dvCodigoBarras;
/** Modulo 10 (pesos 2 e 1 alternados, somando os digitos do dobro). Usado
 *  nos tres campos da linha digitavel. */
const modulo10 = (campo) => {
    const digitos = apenasDigitos(campo);
    let peso = 2;
    let soma = 0;
    for (let i = digitos.length - 1; i >= 0; i -= 1) {
        const produto = Number(digitos[i]) * peso;
        soma += produto > 9 ? produto - 9 : produto;
        peso = peso === 2 ? 1 : 2;
    }
    const resto = soma % 10;
    return resto === 0 ? 0 : 10 - resto;
};
exports.modulo10 = modulo10;
/**
 * Codigo de barras, 44 posicoes:
 *   banco(3) moeda(1) DV(1) fator(4) valor(10) campoLivre(25)
 *
 * O DV fica na 5a posicao e e' calculado sobre as outras 43 -- por isso ele
 * e' montado por ultimo.
 */
const montarCodigoBarras = (dados) => {
    const banco = zeros(dados.banco, 3);
    const moeda = zeros(dados.moeda || '9', 1);
    const fator = (0, exports.fatorDeVencimento)(dados.vencimento);
    const valor = zeros(Math.max(0, Math.round(Number(dados.valorCentavos) || 0)), 10);
    const livre = zeros(dados.campoLivre, 25);
    const semDv = `${banco}${moeda}${fator}${valor}${livre}`;
    const dv = (0, exports.dvCodigoBarras)(semDv);
    return `${banco}${moeda}${dv}${fator}${valor}${livre}`;
};
exports.montarCodigoBarras = montarCodigoBarras;
/**
 * Linha digitavel (47 posicoes) a partir do codigo de barras.
 *
 * Nao e' o codigo de barras "com pontinhos": os campos sao REMONTADOS numa
 * ordem diferente, cada um com seu proprio DV (modulo 10), e o fator+valor
 * vao pro fim. Foi desenhada assim pra quem digita errar menos -- cada bloco
 * se confere sozinho.
 */
const linhaDigitavelDoCodigoBarras = (codigoBarras) => {
    const cb = apenasDigitos(codigoBarras);
    if (cb.length !== 44)
        return '';
    const banco = cb.slice(0, 3);
    const moeda = cb.slice(3, 4);
    const dvGeral = cb.slice(4, 5);
    const fatorValor = cb.slice(5, 19);
    const livre = cb.slice(19, 44);
    const campo1 = `${banco}${moeda}${livre.slice(0, 5)}`;
    const campo2 = livre.slice(5, 15);
    const campo3 = livre.slice(15, 25);
    return `${campo1}${(0, exports.modulo10)(campo1)}${campo2}${(0, exports.modulo10)(campo2)}${campo3}${(0, exports.modulo10)(campo3)}${dvGeral}${fatorValor}`;
};
exports.linhaDigitavelDoCodigoBarras = linhaDigitavelDoCodigoBarras;
/** Linha digitavel com a pontuacao que sai impressa no boleto. */
const formatarLinhaDigitavel = (linha) => {
    const d = apenasDigitos(linha);
    if (d.length !== 47)
        return linha;
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} `
        + `${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`;
};
exports.formatarLinhaDigitavel = formatarLinhaDigitavel;
/**
 * Confere uma linha digitavel digitada/colada: os tres DVs de campo e o DV
 * geral. Devolve erro em portugues ou null.
 */
const erroDaLinhaDigitavel = (linha) => {
    const d = apenasDigitos(linha);
    if (!d)
        return null;
    if (d.length !== 47)
        return `A linha digitável tem 47 números. Você informou ${d.length}.`;
    const campos = [
        { valor: d.slice(0, 9), dv: Number(d[9]) },
        { valor: d.slice(10, 20), dv: Number(d[20]) },
        { valor: d.slice(21, 31), dv: Number(d[31]) },
    ];
    for (let i = 0; i < campos.length; i += 1) {
        if ((0, exports.modulo10)(campos[i].valor) !== campos[i].dv) {
            return `A linha digitável não confere (${i + 1}º bloco). Confira os números.`;
        }
    }
    return null;
};
exports.erroDaLinhaDigitavel = erroDaLinhaDigitavel;
/** Volta do formato da linha digitavel pro codigo de barras (44). */
const codigoBarrasDaLinhaDigitavel = (linha) => {
    const d = apenasDigitos(linha);
    if (d.length !== 47)
        return '';
    const campoLivre = `${d.slice(4, 9)}${d.slice(10, 20)}${d.slice(21, 31)}`;
    return `${d.slice(0, 4)}${d.slice(32, 33)}${d.slice(33, 47)}${campoLivre}`;
};
exports.codigoBarrasDaLinhaDigitavel = codigoBarrasDaLinhaDigitavel;
