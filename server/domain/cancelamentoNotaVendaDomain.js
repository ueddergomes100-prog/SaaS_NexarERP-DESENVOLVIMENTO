"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORIENTACAO_FORA_DO_PRAZO = exports.ehErroDePrazo = exports.validarJustificativaCancelamento = exports.JUSTIFICATIVA_MAXIMA = exports.JUSTIFICATIVA_MINIMA = exports.tipoSpedyDaNota = exports.listaDeNotas = exports.descricaoDaNota = exports.classificarNotasDaVenda = exports.STATUS_NOTA_EM_TRANSMISSAO = void 0;
const nomeArquivoDomain_1 = require("./nomeArquivoDomain");
exports.STATUS_NOTA_EM_TRANSMISSAO = ['enqueued', 'processing', 'created'];
const ehNotaDaVenda = (nota) => ((nota.tipo === 'NF-e' || nota.tipo === 'NFC-e') && nota.finalidade !== 'devolucao');
/** As notas da venda que impedem cancelar so' a venda: as autorizadas e as que ainda aguardam a SEFAZ. */
const classificarNotasDaVenda = (notas) => {
    const daVenda = notas.filter(ehNotaDaVenda);
    return {
        autorizadas: daVenda.filter((nota) => nota.status === 'authorized'),
        emTransmissao: daVenda.filter((nota) => exports.STATUS_NOTA_EM_TRANSMISSAO.includes(String(nota.status))),
    };
};
exports.classificarNotasDaVenda = classificarNotasDaVenda;
/** "NF-e nº 93" / "NFC-e" -- como o cliente le. */
const descricaoDaNota = (nota) => {
    const numero = (0, nomeArquivoDomain_1.numeroDaNota)(nota.number);
    return `${String(nota.tipo || 'Nota')}${numero ? ` nº ${numero}` : ''}`;
};
exports.descricaoDaNota = descricaoDaNota;
/** Lista para frase: "NF-e nº 93", "NF-e nº 93 e NFC-e nº 12". */
const listaDeNotas = (notas) => {
    const nomes = notas.map(exports.descricaoDaNota);
    if (nomes.length <= 1)
        return nomes[0] || '';
    return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
};
exports.listaDeNotas = listaDeNotas;
/** Tipo do documento na Spedy (a rota de cancelamento e' por tipo). */
const tipoSpedyDaNota = (tipo) => (tipo === 'NFC-e' ? 'consumer' : 'product');
exports.tipoSpedyDaNota = tipoSpedyDaNota;
exports.JUSTIFICATIVA_MINIMA = 15;
exports.JUSTIFICATIVA_MAXIMA = 255;
/** Regra da SEFAZ para o motivo do cancelamento. Devolve a mensagem de erro ou null. */
const validarJustificativaCancelamento = (texto) => {
    const limpo = String(texto ?? '').trim();
    if (limpo.length < exports.JUSTIFICATIVA_MINIMA)
        return `Escreva o motivo com pelo menos ${exports.JUSTIFICATIVA_MINIMA} letras (regra da SEFAZ).`;
    if (limpo.length > exports.JUSTIFICATIVA_MAXIMA)
        return `O motivo pode ter no máximo ${exports.JUSTIFICATIVA_MAXIMA} letras (limite da SEFAZ).`;
    return null;
};
exports.validarJustificativaCancelamento = validarJustificativaCancelamento;
/** A Spedy/SEFAZ recusou porque passou do prazo de cancelamento. */
const ehErroDePrazo = (mensagem) => /prazo|501/i.test(String(mensagem ?? ''));
exports.ehErroDePrazo = ehErroDePrazo;
/** O que fazer quando a SEFAZ recusa por prazo (mesma orientacao da tela de Notas Fiscais). */
exports.ORIENTACAO_FORA_DO_PRAZO = [
    'A venda NÃO foi cancelada.',
    '• Venda que NÃO aconteceu, com a nota autorizada há até 168 horas (7 dias): peça o cancelamento extemporâneo no SIARE (site da SEFAZ-MG) e depois tente de novo. Em outros estados o caminho é parecido: confirme com o contador.',
    '• Mercadoria que saiu e voltou: não cancele — use "Devolução de itens" (em Mais ações), que devolve o estoque e emite a NF-e de devolução.',
].join('\n');
