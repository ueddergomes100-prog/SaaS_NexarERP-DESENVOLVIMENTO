"use strict";
/**
 * PESAGEM DA PRODUCAO (26/10/2026, pedido do dono).
 *
 * O caso real: subiram 20 kg de argila verde para a producao e voltaram
 * 24,250 kg na balanca, ja' com as caixas. Tirando a Caixa 1 (1,900 kg) e a
 * Caixa 2 (1,750 kg), sobram 20,600 kg = 82 pacotes de 0,250 kg e 0,100 kg que
 * nao fecham pacote. O sistema travava: a receita pedia 82 x 0,250 = 20,5 kg de
 * argila e so' havia 20 kg (a mistura/umidade aumenta o peso). A trava estava
 * CERTA (nao se baixa o que nao existe); o que faltava era lancar a realidade:
 *
 *  - taras cadastradas (as caixas), descontadas pela quantidade usada;
 *  - peso da embalagem por unidade (sacolinha), descontado por pacote;
 *  - pacotes = so' os FECHADOS (arredonda para baixo); o resto e' residuo do
 *    processo, registrado com o peso (sistema sugere, a pessoa confere);
 *  - materia-prima "usada de verdade" (os 20 kg) em vez da receita; a diferenca
 *    vira GANHO DE PESO registrado na ordem.
 *
 * Contas em gramas inteiras: 24,250 - 1,900 - 1,750 em ponto flutuante nao da'
 * 20,6 exato e 20,6 / 0,25 viraria 82,39999.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unidadeEmKg = exports.ganhoDePeso = exports.consumoDoComponente = exports.calcularPesagem = exports.erroDasTaras = exports.parseTaras = void 0;
const numero = (v) => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : NaN;
};
const gramas = (kg) => Math.round(kg * 1000);
const kg = (g) => g / 1000;
/** Lista gravada na configuracao da filial (tarasProducao); lixo e peso invalido ficam de fora. */
const parseTaras = (raw) => {
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((t) => (t && typeof t === 'object' ? t : null))
        .filter((t) => Boolean(t))
        .map((t) => ({
        id: String(t.id ?? '').trim(),
        nome: String(t.nome ?? '').trim().slice(0, 40),
        pesoKg: numero(t.pesoKg),
        ativa: t.ativa !== false,
    }))
        .filter((t) => t.id && t.nome && Number.isFinite(t.pesoKg) && t.pesoKg > 0);
};
exports.parseTaras = parseTaras;
/** Erro em portugues da lista de taras, ou null. */
const erroDasTaras = (taras) => {
    const nomes = new Set();
    for (const t of taras) {
        const nome = String(t.nome ?? '').trim();
        if (!nome)
            return 'Toda caixa precisa de um nome (ex.: Caixa 1).';
        const peso = numero(t.pesoKg);
        if (!Number.isFinite(peso) || peso <= 0 || peso > 1000)
            return `Informe o peso da "${nome}" em kg, maior que zero (ex.: 1,900).`;
        const chave = nome.toLowerCase();
        if (nomes.has(chave))
            return `Há duas caixas com o nome "${nome}". Use nomes diferentes.`;
        nomes.add(chave);
    }
    return null;
};
exports.erroDasTaras = erroDasTaras;
const VAZIO = {
    taraKg: 0, embalagemKg: 0, liquidoKg: 0, unidadesExatas: 0, unidadesSugeridas: 0, residuoKg: 0, detalheTaras: [],
};
/**
 * Bruto - taras - embalagens = liquido; pacotes fechados = liquido / peso da
 * unidade, para baixo; residuo = o que sobrou. Com a embalagem por unidade, cada
 * pacote pesa (unidade + embalagem) na balanca.
 */
const calcularPesagem = (e) => {
    const brutoG = gramas(numero(e.pesoBrutoKg));
    if (!Number.isFinite(brutoG) || brutoG <= 0)
        return { ...VAZIO, erro: 'Informe o peso bruto da balança (kg).' };
    const detalheTaras = e.taras
        .map((t) => {
        const q = Math.max(0, Math.floor(numero(e.tarasUsadas[t.id]) || 0));
        return { nome: t.nome, quantidade: q, pesoKg: t.pesoKg, totalKg: kg(gramas(t.pesoKg) * q) };
    })
        .filter((t) => t.quantidade > 0);
    const taraG = detalheTaras.reduce((s, t) => s + gramas(t.pesoKg) * t.quantidade, 0);
    const unidadeG = gramas(numero(e.pesoUnidadeKg));
    if (!Number.isFinite(unidadeG) || unidadeG <= 0) {
        return { ...VAZIO, detalheTaras, taraKg: kg(taraG), erro: 'O produto está sem o peso líquido da unidade. Informe em Estoque → editar produto → "Peso líquido unitário (kg)", ou digite aqui.' };
    }
    const embalagemUnG = Math.max(0, gramas(numero(e.pesoEmbalagemKg)) || 0);
    const manual = e.embalagemManualKg;
    const temManual = manual !== undefined && manual !== null && String(manual).trim() !== '';
    const manualG = temManual ? gramas(numero(manual)) : NaN;
    if (temManual && (!Number.isFinite(manualG) || manualG < 0))
        return { ...VAZIO, detalheTaras, taraKg: kg(taraG), erro: 'Peso das embalagens inválido.' };
    const semCaixasG = brutoG - taraG;
    let unidades;
    let embalagemG;
    if (temManual) {
        embalagemG = manualG;
        unidades = Math.floor((semCaixasG - embalagemG) / unidadeG);
    }
    else {
        unidades = Math.floor(semCaixasG / (unidadeG + embalagemUnG));
        embalagemG = Math.max(0, unidades) * embalagemUnG;
    }
    const liquidoG = semCaixasG - embalagemG;
    if (liquidoG <= 0) {
        return { ...VAZIO, detalheTaras, taraKg: kg(taraG), embalagemKg: kg(embalagemG), erro: 'As caixas e embalagens pesam mais que o peso bruto. Confira o peso da balança e as caixas marcadas.' };
    }
    unidades = Math.max(0, unidades);
    return {
        erro: null,
        taraKg: kg(taraG),
        embalagemKg: kg(embalagemG),
        liquidoKg: kg(liquidoG),
        unidadesExatas: Math.round((liquidoG / unidadeG) * 1000) / 1000,
        unidadesSugeridas: unidades,
        residuoKg: kg(liquidoG - unidades * unidadeG),
        detalheTaras,
    };
};
exports.calcularPesagem = calcularPesagem;
/**
 * Quanto do componente sai do estoque: o "usado de verdade" quando a pessoa
 * digitou; senao a receita x produzido + perda extra - sobra (como sempre foi).
 */
const consumoDoComponente = (args) => {
    const texto = args.usadaReal === undefined || args.usadaReal === null ? '' : String(args.usadaReal).trim();
    const real = numero(texto);
    if (texto !== '' && Number.isFinite(real) && real >= 0)
        return { consumo: kg(gramas(real)), real: true };
    const perda = Math.max(0, numero(args.perdaExtra) || 0);
    const sobra = Math.max(0, numero(args.sobra) || 0);
    return { consumo: kg(gramas(args.necessario + perda - sobra)), real: false };
};
exports.consumoDoComponente = consumoDoComponente;
/** Ganho (ou perda) de peso: o que saiu liquido menos a materia-prima usada (so' componentes em KG). */
const ganhoDePeso = (liquidoKg, materiaPrimaKg) => {
    const ganhoG = gramas(liquidoKg) - gramas(materiaPrimaKg);
    return {
        ganhoKg: kg(ganhoG),
        percentual: materiaPrimaKg > 0 ? Math.round((ganhoG / gramas(materiaPrimaKg)) * 10000) / 100 : 0,
    };
};
exports.ganhoDePeso = ganhoDePeso;
/** Unidade em quilos? (so' esses entram na conta do ganho de peso). */
const unidadeEmKg = (sigla) => /^kg$/i.test(String(sigla ?? '').trim());
exports.unidadeEmKg = unidadeEmKg;
