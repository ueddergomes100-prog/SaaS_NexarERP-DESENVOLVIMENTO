"use strict";
/*
 * BASE DE NCM E CEST (pedido do dono, 20/10/2026).
 *
 * Decisao do dono (caixinhas de 20/10): uma base UNICA para todas as empresas,
 * que cresce sozinha -- todo NCM/CEST que aparece num produto cadastrado ou num
 * XML de entrada entra na base, sem repetir (o codigo e' o id do documento em
 * `tabela_ncm` / `tabela_cest`). A empresa tambem cadastra a mao, com descricao.
 *
 * Privacidade: o que entra sozinho e' SO' o codigo (e, no CEST, os NCMs com que
 * ele apareceu). Nome de produto de uma empresa nunca vai para a base que as
 * outras leem. A descricao vem de quem cadastra a mao; depois de descrita, so'
 * o suporte (administrador da plataforma) altera.
 *
 * So' o servidor grava (server/services/tabelasFiscais.js); as telas so' leem.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.filtrarTabela = exports.podeDescrever = exports.codigosDoUso = exports.lerNovoCest = exports.lerNovoNcm = exports.formatarCest = exports.formatarNcm = exports.normalizarCest = exports.normalizarNcm = exports.LIMITE_DE_ITENS_POR_REGISTRO = exports.LIMITE_DA_DESCRICAO = void 0;
exports.LIMITE_DA_DESCRICAO = 300;
/** Quantos codigos uma chamada de "registrar uso" aceita. */
exports.LIMITE_DE_ITENS_POR_REGISTRO = 300;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** NCM valido: 8 digitos (00000000 nao vale). Vazio quando invalido. */
const normalizarNcm = (v) => {
    const d = soDigitos(v);
    return d.length === 8 && d !== '00000000' ? d : '';
};
exports.normalizarNcm = normalizarNcm;
/** CEST valido: 7 digitos. Vazio quando invalido. */
const normalizarCest = (v) => {
    const d = soDigitos(v);
    return d.length === 7 && d !== '0000000' ? d : '';
};
exports.normalizarCest = normalizarCest;
/** "21069090" -> "2106.90.90" */
const formatarNcm = (codigo) => (codigo.length === 8 ? `${codigo.slice(0, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6)}` : codigo);
exports.formatarNcm = formatarNcm;
/** "1700100" -> "17.001.00" */
const formatarCest = (codigo) => (codigo.length === 7 ? `${codigo.slice(0, 2)}.${codigo.slice(2, 5)}.${codigo.slice(5)}` : codigo);
exports.formatarCest = formatarCest;
const lerDescricao = (v) => {
    const d = texto(v);
    if (!d)
        return { ok: false, erro: 'Informe a descrição.' };
    if (d.length > exports.LIMITE_DA_DESCRICAO)
        return { ok: false, erro: `A descrição passou de ${exports.LIMITE_DA_DESCRICAO} letras. Resuma.` };
    return { ok: true, valor: d };
};
const lerNovoNcm = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const codigo = (0, exports.normalizarNcm)(c.codigo);
    if (!codigo)
        return { ok: false, erro: 'O NCM tem 8 números (ex.: 2106.90.90). Confira o código.' };
    const descricao = lerDescricao(c.descricao);
    if (!descricao.ok)
        return descricao;
    return { ok: true, valor: { codigo, descricao: descricao.valor } };
};
exports.lerNovoNcm = lerNovoNcm;
const lerNovoCest = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const codigo = (0, exports.normalizarCest)(c.codigo);
    if (!codigo)
        return { ok: false, erro: 'O CEST tem 7 números (ex.: 17.001.00). Confira o código.' };
    const ncmInformado = soDigitos(c.ncm);
    const ncm = (0, exports.normalizarNcm)(ncmInformado);
    if (ncmInformado && !ncm)
        return { ok: false, erro: 'O NCM ligado ao CEST tem 8 números. Confira ou deixe em branco.' };
    const descricao = lerDescricao(c.descricao);
    if (!descricao.ok)
        return descricao;
    return { ok: true, valor: { codigo, descricao: descricao.valor, ncm } };
};
exports.lerNovoCest = lerNovoCest;
/**
 * Do que veio de produtos/XML ([{ ncm, cest }]), os codigos validos sem
 * repetir. O CEST leva os NCMs com que apareceu (ajuda a sugerir o CEST pelo NCM).
 */
const codigosDoUso = (itens) => {
    const lista = Array.isArray(itens) ? itens.slice(0, exports.LIMITE_DE_ITENS_POR_REGISTRO) : [];
    const ncms = new Set();
    const cests = new Map();
    for (const item of lista) {
        if (!item || typeof item !== 'object')
            continue;
        const ncm = (0, exports.normalizarNcm)(item.ncm);
        const cest = (0, exports.normalizarCest)(item.cest);
        if (ncm)
            ncms.add(ncm);
        if (cest) {
            const doCest = cests.get(cest) ?? new Set();
            if (ncm)
                doCest.add(ncm);
            cests.set(cest, doCest);
        }
    }
    return {
        ncms: [...ncms].sort(),
        cests: [...cests.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([codigo, n]) => ({ codigo, ncms: [...n].sort() })),
    };
};
exports.codigosDoUso = codigosDoUso;
/**
 * Pode gravar a descricao? Codigo novo ou sem descricao: sim. Ja' descrito:
 * so' o suporte (administrador da plataforma), para uma empresa nao trocar o
 * que as outras usam.
 */
const podeDescrever = (descricaoAtual, ehSuporte) => ehSuporte || !texto(descricaoAtual);
exports.podeDescrever = podeDescrever;
/** Busca da tela: digitos procuram pelo comeco do codigo; texto procura na descricao. */
const filtrarTabela = (linhas, busca) => {
    const b = busca.trim().toLowerCase();
    if (!b)
        return [...linhas];
    const digitos = b.replace(/[.\s-]/g, '');
    if (/^\d+$/.test(digitos))
        return linhas.filter((l) => l.codigo.startsWith(digitos));
    return linhas.filter((l) => (l.descricao ?? '').toLowerCase().includes(b));
};
exports.filtrarTabela = filtrarTabela;
