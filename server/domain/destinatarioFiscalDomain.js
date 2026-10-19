"use strict";
/**
 * INSCRICAO ESTADUAL DO DESTINATARIO NA NF-e (2026-09-21; 19/10/2026).
 *
 * Caso real (Sol Natus, producao): a NF-e para uma pessoa juridica voltou com
 * "Rejeicao 232: IE do destinatario nao informada" -- embora o cadastro do
 * cliente TIVESSE a Inscricao Estadual. O sistema simplesmente nunca mandava
 * `receiver.stateTaxNumber`: o campo "Inscricao Estadual / RG" do cliente
 * (`identidade`) nao entrava no payload.
 *
 * 19/10/2026 (Sol Life, producao): MEI do Espirito Santo sem IE. Com "ISENTO" a
 * SEFAZ do destinatario recusou ("Rejeicao 805: nao permite Contribuinte Isento
 * de Inscricao Estadual") e, em branco, o sistema bloqueava. Pela regra da NF-e,
 * empresa sem IE e' NAO CONTRIBUINTE do ICMS (indIEDest = 9, "pode ou nao
 * possuir IE") -- e' assim que o ERP antigo do cliente emite (IE em branco,
 * CFOP 6102, autorizada). A NF-e da cliente saiu autorizada sem IE: a Spedy
 * manda CNPJ sem `stateTaxNumber` como indIEDest 9.
 *
 * Decisoes do dono (19/10): "ISENTO" sai como nao contribuinte (varios estados
 * recusam o "contribuinte isento", 805). Campo EM BRANCO, porem, e' cadastro
 * incompleto -- a empresa pode ter IE e so' nao ter sido cadastrada; seguir
 * como nao contribuinte emitiria errado calado (nem todo estado confere e
 * devolve 232). Entao em branco bloqueia pedindo a IE ou "ISENTO".
 *
 * Regras:
 *  - PESSOA JURIDICA com IE (5 a 14 digitos): vai em `stateTaxNumber`
 *    (contribuinte, indIEDest = 1).
 *  - PESSOA JURIDICA "ISENTO": NAO manda `stateTaxNumber` -- a nota sai como
 *    nao contribuinte / consumidor final, e a tela avisa.
 *  - PESSOA JURIDICA sem nada, ou com algo que nao e' IE ("abc", "123"):
 *    bloqueia dizendo o que fazer (IE ou ISENTO).
 *  - PESSOA FISICA (CPF): o campo guarda o RG, que NAO e' Inscricao Estadual --
 *    nunca vai no payload.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolverInscricaoEstadualDestinatario = void 0;
const somenteDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const resolverInscricaoEstadualDestinatario = (params) => {
    const documento = somenteDigitos(params.documento);
    if (documento.length !== 14)
        return {}; // CPF: o campo e' RG, nao IE
    const bruto = String(params.identidade ?? '').trim();
    const digitos = somenteDigitos(bruto);
    if (digitos.length >= 5 && digitos.length <= 14)
        return { valor: digitos };
    const nome = String(params.clienteNome ?? '').trim();
    const quem = nome ? `O cliente "${nome}"` : 'O cliente';
    if (/^isento$/i.test(bruto)) {
        return {
            aviso: `${quem} está como ISENTO de Inscrição Estadual: a nota sai como não contribuinte do ICMS (consumidor final). Se a empresa tiver Inscrição Estadual, cadastre em Cadastros → Clientes (campo "Inscrição Estadual / RG").`,
        };
    }
    return {
        erro: bruto
            ? `${quem} é pessoa jurídica e a Inscrição Estadual cadastrada ("${bruto}") não parece válida. Corrija em Cadastros → Clientes (campo "Inscrição Estadual / RG"); se a empresa não tiver Inscrição Estadual, escreva ISENTO — a nota sai como não contribuinte.`
            : `${quem} é pessoa jurídica e está sem Inscrição Estadual no cadastro. Informe a IE em Cadastros → Clientes (campo "Inscrição Estadual / RG"); se a empresa não tiver Inscrição Estadual, escreva ISENTO — a nota sai como não contribuinte.`,
    };
};
exports.resolverInscricaoEstadualDestinatario = resolverInscricaoEstadualDestinatario;
