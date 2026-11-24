"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.valorCnab = exports.dataCnab = exports.montarLinhaCnab = exports.codigoBarrasSicoob = exports.parcelaDoBoletoSicoob = exports.campoLivreSicoob = exports.formatarNossoNumeroSicoobExibicao = exports.nossoNumeroSicoobComDv = exports.dvNossoNumeroSicoob = void 0;
const boletoDomain_1 = require("./boletoDomain");
/** Pesos do Sicoob, ciclicos da esquerda pra direita. */
const PESOS_SICOOB = [3, 1, 9, 7];
/**
 * Digito verificador do nosso numero no Sicoob.
 *
 * Modulo 11 com pesos 3,1,9,7; resto 0 ou 1 (DV 10/11) vira 0 -- e' a regra
 * do banco, diferente do DV do codigo de barras.
 */
const dvNossoNumeroSicoob = (nossoNumero, p) => {
    const codigoCliente = (0, boletoDomain_1.digitosDoBoleto)(p.codigoCliente ?? '');
    const sequencia = codigoCliente
        ? (0, boletoDomain_1.zerosAEsquerda)(p.cooperativa, 4) + (0, boletoDomain_1.zerosAEsquerda)(codigoCliente, 10) + (0, boletoDomain_1.zerosAEsquerda)(nossoNumero, 7)
        : (0, boletoDomain_1.zerosAEsquerda)(p.cooperativa, 4)
            + (0, boletoDomain_1.zerosAEsquerda)(`${(0, boletoDomain_1.digitosDoBoleto)(p.conta)}${(0, boletoDomain_1.digitosDoBoleto)(p.contaDv ?? '')}`, p.digitosDaConta ?? 9)
            + (0, boletoDomain_1.zerosAEsquerda)(nossoNumero, p.digitosDoNossoNumero ?? 8);
    let soma = 0;
    for (let i = 0; i < sequencia.length; i += 1) {
        soma += Number(sequencia[i]) * PESOS_SICOOB[i % PESOS_SICOOB.length];
    }
    const dv = 11 - (soma % 11);
    return (dv === 10 || dv === 11) ? 0 : dv;
};
exports.dvNossoNumeroSicoob = dvNossoNumeroSicoob;
/** Nosso numero com o DV colado, do jeito que sai impresso e vai na remessa
 *  (9 digitos + DV = 10 posicoes, como no arquivo real do banco). */
const nossoNumeroSicoobComDv = (nossoNumero, p) => {
    const base = (0, boletoDomain_1.zerosAEsquerda)(nossoNumero, 9);
    return `${base}${(0, exports.dvNossoNumeroSicoob)(nossoNumero, p)}`;
};
exports.nossoNumeroSicoobComDv = nossoNumeroSicoobComDv;
/** Nosso numero do jeito que o Sicoob IMPRIME no boleto -- sem os zeros a
 *  esquerda, com o DV separado por hifen (ex.: "0000009184" -> "918-4").
 *  Confirmado contra o boleto real de 2026-09-28 (campo "Nosso Número": 918-4). */
const formatarNossoNumeroSicoobExibicao = (nossoNumeroComDv) => {
    const digitos = String(nossoNumeroComDv || '').replace(/\D/g, '');
    if (digitos.length < 2)
        return digitos;
    const dv = digitos.slice(-1);
    const base = digitos.slice(0, -1).replace(/^0+(?=\d)/, '');
    return `${base}-${dv}`;
};
exports.formatarNossoNumeroSicoobExibicao = formatarNossoNumeroSicoobExibicao;
/**
 * Campo livre do Sicoob (25 posicoes do codigo de barras, 20 a 44), conforme a especificacao publica
 * da cobranca Sicoob/Bancoob (conferida em tres implementacoes de referencia):
 *
 *   carteira(1) cooperativa(4) modalidade(2) codigoCliente(7) nossoNumero(7) DV(1) parcela(3)
 *
 * Carteira 1 = cobranca simples com registro ("Carteira Emissao Propria 01" no sistema antigo).
 * O nosso numero aqui tem 7 posicoes + o DV (na remessa e no retorno ele aparece com zeros a esquerda,
 * 9 posicoes + DV). Parcela "001" quando o boleto nao e' carne.
 *
 * CONFIRMADO CONTRA BOLETO REAL (2026-09-28): comparado digito a digito com um boleto da Sol Life
 * impresso pelo Sicoob (nosso numero 918-4, vencimento 24/08/2026, R$ 677,97) -- bateu certinho, ver o
 * teste "codigo de barras bate digito a digito com boleto real impresso pelo Sicoob" em
 * tests/boletoCnabDomain.test.ts. O unico ponto que exigiu configuracao explicita foi o codigo do
 * cliente: o Sicoob usa 131877-2 pra Sol Life, que NAO e' derivado da conta (51215-0) -- por isso esse
 * campo precisa estar preenchido no cadastro do banco sempre que o Sicoob tiver atribuido um codigo de
 * beneficiario proprio (comum), e so' cai no fallback conta+DV quando o convenio usa a propria conta.
 */
const campoLivreSicoob = (dados) => {
    const carteira = '1';
    const agencia = (0, boletoDomain_1.zerosAEsquerda)(dados.cooperativa, 4);
    const modalidade = (0, boletoDomain_1.zerosAEsquerda)(dados.modalidade || '01', 2);
    const codigoCliente = (0, boletoDomain_1.zerosAEsquerda)((0, boletoDomain_1.digitosDoBoleto)(dados.codigoCliente || '') || `${(0, boletoDomain_1.digitosDoBoleto)(dados.conta)}${(0, boletoDomain_1.digitosDoBoleto)(dados.contaDv ?? '')}`, 7);
    const nossoNumeroBase = (0, boletoDomain_1.digitosDoBoleto)(String(dados.nossoNumero));
    if (nossoNumeroBase.length > 7) {
        throw new Error('O nosso número do Sicoob tem no máximo 7 dígitos: a numeração do convênio chegou ao limite. Fale com o suporte para configurar uma nova faixa.');
    }
    const nossoNumero = (0, boletoDomain_1.zerosAEsquerda)(nossoNumeroBase, 7);
    const dv = (0, exports.dvNossoNumeroSicoob)(dados.nossoNumero, {
        cooperativa: dados.cooperativa,
        conta: dados.conta,
        contaDv: dados.contaDv,
        digitosDaConta: dados.digitosDaConta,
        digitosDoNossoNumero: dados.digitosDoNossoNumero,
        ...((0, boletoDomain_1.digitosDoBoleto)(dados.codigoCliente || '') ? { codigoCliente: dados.codigoCliente } : {}),
    });
    const parcela = (0, boletoDomain_1.zerosAEsquerda)(dados.parcela ?? 1, 3);
    return `${carteira}${agencia}${modalidade}${codigoCliente}${nossoNumero}${dv}${parcela}`;
};
exports.campoLivreSicoob = campoLivreSicoob;
/**
 * Parcela do titulo no boleto Sicoob -- a MESMA no codigo de barras (ultimas 3 posicoes do campo livre)
 * e na remessa (Segmento P 48-49). O banco registra o titulo com a parcela da remessa e monta o codigo
 * de barras dele com ela; se o PDF usar outra, o boleto impresso nao bate com o registrado e o caixa
 * responde "boleto nao registrado" (caso real de 27/10/2026: remessa com parcela 02, PDF com 001).
 * Titulo sem parcela (lancado a mao, parcela unica) = 1.
 */
const parcelaDoBoletoSicoob = (titulo) => {
    const parcela = Math.trunc(Number(titulo.paymentIndex));
    return Number.isFinite(parcela) && parcela >= 1 && parcela <= 99 ? parcela : 1;
};
exports.parcelaDoBoletoSicoob = parcelaDoBoletoSicoob;
/** Codigo de barras completo de um boleto Sicoob. */
const codigoBarrasSicoob = (args) => (0, boletoDomain_1.montarCodigoBarras)({
    banco: '756',
    vencimento: args.vencimento,
    valorCentavos: args.valorCentavos,
    campoLivre: (0, exports.campoLivreSicoob)(args.dados),
});
exports.codigoBarrasSicoob = codigoBarrasSicoob;
const montarLinhaCnab = (campos, tamanho = 240) => {
    const linha = new Array(tamanho).fill(' ');
    for (const campo of campos) {
        const largura = campo.ate - campo.de + 1;
        if (largura <= 0 || campo.ate > tamanho) {
            throw new Error(`Campo CNAB fora do registro: posições ${campo.de}-${campo.ate}.`);
        }
        const bruto = campo.tipo === 'num'
            ? (0, boletoDomain_1.zerosAEsquerda)((0, boletoDomain_1.digitosDoBoleto)(String(campo.valor ?? '')), largura)
            : String(campo.valor ?? '').toUpperCase().slice(0, largura).padEnd(largura, ' ');
        if (bruto.length !== largura) {
            throw new Error(`Campo CNAB com tamanho errado nas posições ${campo.de}-${campo.ate}.`);
        }
        for (let i = 0; i < largura; i += 1)
            linha[campo.de - 1 + i] = bruto[i];
    }
    return linha.join('');
};
exports.montarLinhaCnab = montarLinhaCnab;
/** Data `AAAA-MM-DD` no formato DDMMAAAA da remessa. */
const dataCnab = (iso) => {
    const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return p ? `${p[3]}${p[2]}${p[1]}` : '00000000';
};
exports.dataCnab = dataCnab;
/** Valor em centavos para o campo de 15 posicoes da remessa. */
const valorCnab = (centavos) => (0, boletoDomain_1.zerosAEsquerda)(Math.max(0, Math.round(Number(centavos) || 0)), 15);
exports.valorCnab = valorCnab;
