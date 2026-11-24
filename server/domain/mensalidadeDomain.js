"use strict";
/**
 * MENSALIDADES DAS EMPRESAS CLIENTES (24/11/2026, pedido do dono).
 *
 * O dono da plataforma cobra cada empresa que usa o Hennder. O boleto e' gerado
 * a mao no PicPay PJ e anexado aqui (PDF, linha digitavel, link, Pix). Regras
 * decididas pelo dono em 24/11:
 *
 *  - Uma mensalidade por EMPRESA (matriz + filiais juntas). O valor e' o da
 *    matriz somado as filiais (mensalidadeComFiliais, como o SuperAdmin ja'
 *    calculava). Atrasou, o aviso e o bloqueio valem para o grupo todo.
 *  - A mensalidade de cada mes nasce sozinha (rotina diaria do servidor),
 *    `ANTECEDENCIA_DE_GERACAO_DIAS` antes do vencimento; o dono so' anexa o boleto.
 *  - Prazos padrao: lembrete 3 dias antes do vencimento, aviso forte com 5 dias
 *    de atraso, bloqueio no 10o dia de atraso. Padrao geral no SuperAdmin, com
 *    excecao por empresa.
 *  - Avisos so' para dono e administrador da empresa. O bloqueio e' tela
 *    inteira, automatico, em todos os apps (sistema, Frente de Caixa, app
 *    Vendas/tecnico/motorista). O SuperAdmin nunca e' bloqueado.
 *  - Marcar "Pago" (com a data) libera na hora. "Liberar ate dd/mm" adia o
 *    bloqueio sem pagamento; se nao pagar, bloqueia de novo no dia seguinte.
 *
 * ONDE MORA A TRAVA: o servidor grava em TODO perfil da empresa
 * (usuarios/{uid}) o resumo `cobrancaEmpresa` e o instante `cobrancaBloqueioEm`.
 * As firestore.rules (perfilAtivo) e o middleware do servidor (authenticate)
 * recusam tudo a partir desse instante -- sem leitura extra, porque os dois ja'
 * leem o perfil. Esses campos so' o servidor grava (platformManagedFields).
 * A tela so' mostra o aviso e a tela de bloqueio.
 *
 * Datas sao texto "AAAA-MM-DD" no horario de Brasilia (UTC-3, sem horario de
 * verao desde 2019). Este arquivo e' puro: roda na tela e no servidor
 * (server/domain e' gerado dele por scripts/build-server-domain.mjs).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rotuloDaEtapa = exports.validarLiberacao = exports.validarDataDoPagamento = exports.textoDaCobranca = exports.MENSAGEM_SERVIDOR_BLOQUEADO = exports.TEXTO_BLOQUEIO_FUNCIONARIO = exports.textoDoAviso = exports.comoPagarOBoleto = exports.deveAbrirJanelaDeCobranca = exports.etapaComAviso = exports.veAvisoDeCobranca = exports.situacaoDaCobranca = exports.lerResumoDaCobranca = exports.montarResumoDaCobranca = exports.primeiraCompetencia = exports.competenciasParaGerar = exports.validarBoletoDigitado = exports.formatarLinhaDigitavel = exports.lerMensalidade = exports.temBoleto = exports.lerBoleto = exports.lerContato = exports.lerPlanoCobranca = exports.lerPrazos = exports.validarPrazos = exports.lerDiaVencimento = exports.idDaMensalidade = exports.formatarMoeda = exports.formatarDiaMes = exports.formatarData = exports.rotuloCompetencia = exports.vencimentoDaCompetencia = exports.competenciaSeguinte = exports.competenciaDaData = exports.inicioDoDiaEmBrasilia = exports.diasEntre = exports.somarDias = exports.hojeEmBrasilia = exports.competenciaValida = exports.dataValida = exports.LIBERACAO_MAXIMA_DIAS = exports.ANTECEDENCIA_DE_GERACAO_DIAS = exports.PRAZOS_PADRAO = void 0;
exports.normalizarLinhaDigitavel = normalizarLinhaDigitavel;
exports.PRAZOS_PADRAO = { diasLembreteAntes: 3, diasAvisoForte: 5, diasBloqueio: 10 };
/** A mensalidade do mes nasce 10 dias antes do vencimento (tempo de anexar o boleto antes do lembrete). */
exports.ANTECEDENCIA_DE_GERACAO_DIAS = 10;
/** Liberar sem pagamento: no maximo 30 dias para a frente. */
exports.LIBERACAO_MAXIMA_DIAS = 30;
// ---------------------------------------------------------------- datas
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPETENCIA = /^(\d{4})-(\d{2})$/;
const dataUtc = (iso) => {
    const m = DATA.exec(iso);
    if (!m)
        return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.toISOString().slice(0, 10) === iso ? d : null;
};
const dataValida = (valor) => typeof valor === 'string' && dataUtc(valor) !== null;
exports.dataValida = dataValida;
const competenciaValida = (valor) => {
    if (typeof valor !== 'string')
        return false;
    const m = COMPETENCIA.exec(valor);
    return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12;
};
exports.competenciaValida = competenciaValida;
/** Hoje em Brasilia, AAAA-MM-DD. */
const hojeEmBrasilia = (agora = new Date()) => (new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10));
exports.hojeEmBrasilia = hojeEmBrasilia;
const somarDias = (iso, dias) => {
    const d = dataUtc(iso);
    if (!d)
        return iso;
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};
exports.somarDias = somarDias;
/** b - a, em dias. */
const diasEntre = (a, b) => {
    const da = dataUtc(a);
    const db = dataUtc(b);
    if (!da || !db)
        return 0;
    return Math.round((db.getTime() - da.getTime()) / 86_400_000);
};
exports.diasEntre = diasEntre;
/** 00h00 de Brasilia do dia (03h00 UTC). E' o instante gravado em cobrancaBloqueioEm. */
const inicioDoDiaEmBrasilia = (iso) => new Date(`${iso}T03:00:00.000Z`);
exports.inicioDoDiaEmBrasilia = inicioDoDiaEmBrasilia;
const competenciaDaData = (iso) => iso.slice(0, 7);
exports.competenciaDaData = competenciaDaData;
const competenciaSeguinte = (competencia) => {
    const [ano, mes] = competencia.split('-').map(Number);
    return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
};
exports.competenciaSeguinte = competenciaSeguinte;
/** Vencimento do mes: o dia escolhido, ou o ultimo dia quando o mes e' mais curto (31 em fevereiro = 28/29). */
const vencimentoDaCompetencia = (competencia, dia) => {
    const [ano, mes] = competencia.split('-').map(Number);
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${competencia}-${String(Math.min(Math.max(1, Math.trunc(dia)), ultimo)).padStart(2, '0')}`;
};
exports.vencimentoDaCompetencia = vencimentoDaCompetencia;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const rotuloCompetencia = (competencia) => {
    if (!(0, exports.competenciaValida)(competencia))
        return competencia;
    const [ano, mes] = competencia.split('-').map(Number);
    return `${MESES[mes - 1]}/${ano}`;
};
exports.rotuloCompetencia = rotuloCompetencia;
const formatarData = (iso) => {
    if (!iso || !(0, exports.dataValida)(iso))
        return '';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
};
exports.formatarData = formatarData;
const formatarDiaMes = (iso) => (0, exports.formatarData)(iso).slice(0, 5);
exports.formatarDiaMes = formatarDiaMes;
const formatarMoeda = (valor) => (`R$ ${(Math.round((Number(valor) || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`);
exports.formatarMoeda = formatarMoeda;
const idDaMensalidade = (tenantId, competencia) => `${tenantId}_${competencia}`;
exports.idDaMensalidade = idDaMensalidade;
// ---------------------------------------------------------------- leitura
const texto = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const inteiro = (v) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isInteger(n) ? n : null;
};
/** Dia de vencimento 1..31, ou null. */
const lerDiaVencimento = (valor) => {
    const n = inteiro(valor);
    return n !== null && n >= 1 && n <= 31 ? n : null;
};
exports.lerDiaVencimento = lerDiaVencimento;
/** Confere os prazos. Devolve a mensagem em portugues, ou null quando estao certos. */
const validarPrazos = (p) => {
    if (!Number.isInteger(p.diasLembreteAntes) || p.diasLembreteAntes < 0 || p.diasLembreteAntes > 15) {
        return 'O lembrete antes do vencimento vai de 0 a 15 dias.';
    }
    if (!Number.isInteger(p.diasAvisoForte) || p.diasAvisoForte < 1 || p.diasAvisoForte > 60) {
        return 'O aviso forte vai de 1 a 60 dias de atraso.';
    }
    if (!Number.isInteger(p.diasBloqueio) || p.diasBloqueio < 1 || p.diasBloqueio > 90) {
        return 'O bloqueio vai de 1 a 90 dias de atraso.';
    }
    if (p.diasAvisoForte > p.diasBloqueio) {
        return 'O aviso forte precisa vir antes do bloqueio (ou no mesmo dia).';
    }
    return null;
};
exports.validarPrazos = validarPrazos;
/** Prazos gravados; o que faltar ou vier errado cai no padrao informado. */
const lerPrazos = (valor, padrao = exports.PRAZOS_PADRAO) => {
    const v = (valor && typeof valor === 'object' ? valor : {});
    const p = {
        diasLembreteAntes: inteiro(v.diasLembreteAntes) ?? padrao.diasLembreteAntes,
        diasAvisoForte: inteiro(v.diasAvisoForte) ?? padrao.diasAvisoForte,
        diasBloqueio: inteiro(v.diasBloqueio) ?? padrao.diasBloqueio,
    };
    return (0, exports.validarPrazos)(p) ? { ...padrao } : p;
};
exports.lerPrazos = lerPrazos;
const lerPlanoCobranca = (valor) => {
    const v = (valor && typeof valor === 'object' ? valor : {});
    const prazos = v.prazos && typeof v.prazos === 'object' ? (0, exports.lerPrazos)(v.prazos) : null;
    return {
        ativa: v.ativa === true,
        diaVencimento: (0, exports.lerDiaVencimento)(v.diaVencimento),
        inicioCompetencia: (0, exports.competenciaValida)(v.inicioCompetencia) ? v.inicioCompetencia : null,
        prazos,
        liberadoAte: (0, exports.dataValida)(v.liberadoAte) ? v.liberadoAte : null,
    };
};
exports.lerPlanoCobranca = lerPlanoCobranca;
const lerContato = (valor) => {
    const v = (valor && typeof valor === 'object' ? valor : {});
    const contato = {};
    const nome = texto(v.nome, 80);
    const whatsapp = texto(v.whatsapp, 30).replace(/\D/g, '');
    const email = texto(v.email, 120).toLowerCase();
    if (nome)
        contato.nome = nome;
    if (whatsapp.length >= 10)
        contato.whatsapp = whatsapp;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        contato.email = email;
    return contato;
};
exports.lerContato = lerContato;
/** So' as chaves preenchidas (nunca undefined no Firestore). */
const lerBoleto = (valor) => {
    const v = (valor && typeof valor === 'object' ? valor : {});
    const boleto = {};
    const pdfUrl = texto(v.pdfUrl, 2000);
    const pdfCaminho = texto(v.pdfCaminho, 500);
    const linha = normalizarLinhaDigitavel(v.linhaDigitavel);
    const link = texto(v.link, 1000);
    const pix = texto(v.pixCopiaECola, 1000);
    if (/^https:\/\//.test(pdfUrl))
        boleto.pdfUrl = pdfUrl;
    if (pdfCaminho)
        boleto.pdfCaminho = pdfCaminho;
    if (linha)
        boleto.linhaDigitavel = linha;
    if (/^https:\/\//.test(link))
        boleto.link = link;
    if (pix)
        boleto.pixCopiaECola = pix;
    return boleto;
};
exports.lerBoleto = lerBoleto;
const temBoleto = (b) => Boolean(b && (b.pdfUrl || b.linhaDigitavel || b.link || b.pixCopiaECola));
exports.temBoleto = temBoleto;
const lerMensalidade = (id, dados) => {
    const v = (dados && typeof dados === 'object' ? dados : {});
    const situacao = v.situacao === 'paga' || v.situacao === 'cancelada' ? v.situacao : 'aberta';
    return {
        id,
        tenantId: texto(v.tenantId, 200),
        competencia: (0, exports.competenciaValida)(v.competencia) ? v.competencia : '',
        vencimento: (0, exports.dataValida)(v.vencimento) ? v.vencimento : '',
        valor: Math.round((Number(v.valor) || 0) * 100) / 100,
        situacao,
        pagoEm: (0, exports.dataValida)(v.pagoEm) ? v.pagoEm : null,
        boleto: (0, exports.lerBoleto)(v.boleto),
    };
};
exports.lerMensalidade = lerMensalidade;
// ---------------------------------------------------------------- boleto
/** So' os digitos; aceita linha de boleto (47) ou de concessionaria (48). Outra quantidade = ''. */
function normalizarLinhaDigitavel(valor) {
    const digitos = typeof valor === 'string' ? valor.replace(/\D/g, '') : '';
    return digitos.length === 47 || digitos.length === 48 ? digitos : '';
}
/** 47 digitos no formato do banco: 00000.00000 00000.000000 00000.000000 0 00000000000000. */
const formatarLinhaDigitavel = (digitos) => {
    if (digitos.length !== 47)
        return digitos;
    return `${digitos.slice(0, 5)}.${digitos.slice(5, 10)} ${digitos.slice(10, 15)}.${digitos.slice(15, 21)} `
        + `${digitos.slice(21, 26)}.${digitos.slice(26, 32)} ${digitos.slice(32, 33)} ${digitos.slice(33)}`;
};
exports.formatarLinhaDigitavel = formatarLinhaDigitavel;
/** Confere o que o dono anexou. Basta um (PDF, linha, link ou Pix). */
const validarBoletoDigitado = (b) => {
    const linhaBruta = (b.linhaDigitavel || '').replace(/\D/g, '');
    if (linhaBruta && !normalizarLinhaDigitavel(linhaBruta)) {
        return { erro: `A linha digitável tem ${linhaBruta.length} números; o boleto tem 47. Copie de novo do PicPay.` };
    }
    const link = (b.link || '').trim();
    if (link && !/^https:\/\//.test(link)) {
        return { erro: 'O link de pagamento precisa começar com https://. Copie o link inteiro do PicPay.' };
    }
    const boleto = (0, exports.lerBoleto)(b);
    if (!(0, exports.temBoleto)(boleto)) {
        return { erro: 'Anexe o PDF do boleto ou cole a linha digitável (o link e o Pix são opcionais).' };
    }
    return { boleto };
};
exports.validarBoletoDigitado = validarBoletoDigitado;
// ---------------------------------------------------------------- geracao do mes
/**
 * Competencias que a rotina deve criar hoje: a partir do inicio da cobranca,
 * cada mes cujo vencimento ja' esta' a ANTECEDENCIA_DE_GERACAO_DIAS (ou menos)
 * e que ainda nao existe. No maximo 3 por vez (nunca despeja um ano de atraso).
 */
const competenciasParaGerar = (params) => {
    const { hoje, plano, existentes } = params;
    if (!plano.ativa || !plano.diaVencimento || !plano.inicioCompetencia || !(0, exports.dataValida)(hoje))
        return [];
    const limite = (0, exports.somarDias)(hoje, exports.ANTECEDENCIA_DE_GERACAO_DIAS);
    const lista = [];
    let competencia = plano.inicioCompetencia;
    for (let i = 0; i < 120 && lista.length < 3; i += 1) {
        const vencimento = (0, exports.vencimentoDaCompetencia)(competencia, plano.diaVencimento);
        if (vencimento > limite)
            break;
        if (!existentes.includes(competencia))
            lista.push(competencia);
        competencia = (0, exports.competenciaSeguinte)(competencia);
    }
    return lista;
};
exports.competenciasParaGerar = competenciasParaGerar;
/** Primeira competencia ao ligar a cobranca: o proximo vencimento a partir de hoje. */
const primeiraCompetencia = (hoje, diaVencimento) => {
    const doMes = (0, exports.competenciaDaData)(hoje);
    return (0, exports.vencimentoDaCompetencia)(doMes, diaVencimento) >= hoje ? doMes : (0, exports.competenciaSeguinte)(doMes);
};
exports.primeiraCompetencia = primeiraCompetencia;
// ---------------------------------------------------------------- resumo e etapa
/**
 * Resumo gravado nos perfis da empresa. A data que manda e' a da mensalidade
 * aberta MAIS ANTIGA. Sem mensalidade aberta, null (os campos saem do perfil).
 */
const montarResumoDaCobranca = (params) => {
    const abertas = params.abertas
        .filter((m) => m.situacao === 'aberta' && (0, exports.dataValida)(m.vencimento))
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    if (!abertas.length)
        return null;
    const maisAntiga = abertas[0];
    const { prazos } = params;
    const bloqueioNormal = (0, exports.somarDias)(maisAntiga.vencimento, prazos.diasBloqueio);
    const liberadoAte = params.liberadoAte && params.liberadoAte >= bloqueioNormal ? params.liberadoAte : null;
    const resumo = {
        matrizId: params.matrizId,
        mensalidadeId: maisAntiga.id,
        competencia: maisAntiga.competencia,
        vencimento: maisAntiga.vencimento,
        valorEmAberto: Math.round(abertas.reduce((s, m) => s + m.valor, 0) * 100) / 100,
        quantidadeEmAberto: abertas.length,
        lembreteDesde: (0, exports.somarDias)(maisAntiga.vencimento, -prazos.diasLembreteAntes),
        avisoForteDesde: (0, exports.somarDias)(maisAntiga.vencimento, prazos.diasAvisoForte),
        bloqueioEm: liberadoAte ? (0, exports.somarDias)(liberadoAte, 1) : bloqueioNormal,
    };
    if (liberadoAte)
        resumo.liberadoAte = liberadoAte;
    if ((0, exports.temBoleto)(maisAntiga.boleto)) {
        // O caminho no Storage nao interessa a empresa.
        const semCaminho = { ...maisAntiga.boleto };
        delete semCaminho.pdfCaminho;
        resumo.boleto = semCaminho;
    }
    if (params.contato && Object.keys(params.contato).length)
        resumo.contato = params.contato;
    return resumo;
};
exports.montarResumoDaCobranca = montarResumoDaCobranca;
/** Le o resumo gravado no perfil (tela). Qualquer coisa fora do formato = sem cobranca pendente. */
const lerResumoDaCobranca = (valor) => {
    const v = (valor && typeof valor === 'object' ? valor : null);
    if (!v)
        return null;
    const campos = ['vencimento', 'lembreteDesde', 'avisoForteDesde', 'bloqueioEm'];
    if (!campos.every((c) => (0, exports.dataValida)(v[c])))
        return null;
    const resumo = {
        matrizId: texto(v.matrizId, 200),
        mensalidadeId: texto(v.mensalidadeId, 300),
        competencia: (0, exports.competenciaValida)(v.competencia) ? v.competencia : '',
        vencimento: v.vencimento,
        valorEmAberto: Math.round((Number(v.valorEmAberto) || 0) * 100) / 100,
        quantidadeEmAberto: Math.max(1, inteiro(v.quantidadeEmAberto) ?? 1),
        lembreteDesde: v.lembreteDesde,
        avisoForteDesde: v.avisoForteDesde,
        bloqueioEm: v.bloqueioEm,
    };
    if ((0, exports.dataValida)(v.liberadoAte))
        resumo.liberadoAte = v.liberadoAte;
    const boleto = (0, exports.lerBoleto)(v.boleto);
    if ((0, exports.temBoleto)(boleto))
        resumo.boleto = boleto;
    const contato = (0, exports.lerContato)(v.contato);
    if (Object.keys(contato).length)
        resumo.contato = contato;
    return resumo;
};
exports.lerResumoDaCobranca = lerResumoDaCobranca;
const situacaoDaCobranca = (resumo, hoje) => {
    if (!resumo)
        return { etapa: 'em_dia', diasDeAtraso: 0, diasParaVencer: 0, diasParaBloqueio: 0 };
    const diasDeAtraso = Math.max(0, (0, exports.diasEntre)(resumo.vencimento, hoje));
    const diasParaVencer = Math.max(0, (0, exports.diasEntre)(hoje, resumo.vencimento));
    const diasParaBloqueio = Math.max(0, (0, exports.diasEntre)(hoje, resumo.bloqueioEm));
    const base = { diasDeAtraso, diasParaVencer, diasParaBloqueio };
    if (hoje >= resumo.bloqueioEm)
        return { etapa: 'bloqueada', ...base };
    if (resumo.liberadoAte && hoje > resumo.vencimento)
        return { etapa: 'liberada', ...base };
    if (hoje >= resumo.avisoForteDesde && hoje > resumo.vencimento)
        return { etapa: 'aviso_forte', ...base };
    if (hoje > resumo.vencimento)
        return { etapa: 'atrasada', ...base };
    if (hoje === resumo.vencimento)
        return { etapa: 'vence_hoje', ...base };
    if (hoje >= resumo.lembreteDesde)
        return { etapa: 'lembrete', ...base };
    return { etapa: 'em_dia', ...base };
};
exports.situacaoDaCobranca = situacaoDaCobranca;
/** So' dono e administrador da empresa veem o aviso antes do bloqueio (decisao de 24/11). */
const veAvisoDeCobranca = (role) => role === 'Master' || role === 'Admin';
exports.veAvisoDeCobranca = veAvisoDeCobranca;
const etapaComAviso = (etapa) => etapa !== 'em_dia' && etapa !== 'bloqueada';
exports.etapaComAviso = etapaComAviso;
/** Janela 1x por dia (como a de aniversario): so' com aviso e se ainda nao abriu hoje. */
const deveAbrirJanelaDeCobranca = (ultimoDiaAvisado, hoje, etapa) => ((0, exports.etapaComAviso)(etapa) && etapa !== 'em_dia' && ultimoDiaAvisado !== hoje);
exports.deveAbrirJanelaDeCobranca = deveAbrirJanelaDeCobranca;
const emDias = (n) => (n === 1 ? 'amanhã' : `em ${n} dias`);
const haDias = (n) => (n === 1 ? 'há 1 dia' : `há ${n} dias`);
/** O que fazer, conforme o que o suporte anexou (nunca manda imprimir sem PDF). */
const comoPagarOBoleto = (boleto) => {
    if (!boleto || !(0, exports.temBoleto)(boleto))
        return 'O boleto ainda não foi anexado: fale com o suporte para recebê-lo.';
    const jeitos = [
        boleto.pdfUrl && 'imprima o boleto',
        boleto.linhaDigitavel && 'copie a linha digitável',
        boleto.link && 'pague pelo link',
        boleto.pixCopiaECola && 'pague pelo Pix',
    ].filter(Boolean);
    const frase = jeitos.length > 1 ? `${jeitos.slice(0, -1).join(', ')} ou ${jeitos[jeitos.length - 1]}` : jeitos[0];
    return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.`;
};
exports.comoPagarOBoleto = comoPagarOBoleto;
/** Texto do aviso, para quem paga (dono/administrador). */
const textoDoAviso = (resumo, s) => {
    const valor = (0, exports.formatarMoeda)(resumo.valorEmAberto);
    const venc = (0, exports.formatarData)(resumo.vencimento);
    const bloqueio = (0, exports.formatarData)(resumo.bloqueioEm);
    const comoPagar = (0, exports.comoPagarOBoleto)(resumo.boleto);
    const maisDeUma = resumo.quantidadeEmAberto > 1 ? ` (${resumo.quantidadeEmAberto} mensalidades em aberto)` : '';
    switch (s.etapa) {
        case 'lembrete':
            return { tom: 'info', titulo: 'Mensalidade vencendo', texto: `Sua mensalidade de ${valor} vence ${emDias(s.diasParaVencer)}, em ${venc}. ${comoPagar}` };
        case 'vence_hoje':
            return { tom: 'alerta', titulo: 'Mensalidade vence hoje', texto: `Sua mensalidade de ${valor} vence hoje (${venc}). ${comoPagar}` };
        case 'atrasada':
            return { tom: 'alerta', titulo: 'Mensalidade em atraso', texto: `Sua mensalidade de ${valor}${maisDeUma} venceu em ${venc} (${haDias(s.diasDeAtraso)}). Pague para evitar o bloqueio do sistema em ${bloqueio}. ${comoPagar}` };
        case 'aviso_forte':
            return { tom: 'perigo', titulo: 'O sistema será bloqueado', texto: `Sua mensalidade de ${valor}${maisDeUma} está em atraso ${haDias(s.diasDeAtraso)}. O sistema será bloqueado ${emDias(s.diasParaBloqueio)}, em ${bloqueio}, se o pagamento não for registrado. ${comoPagar}` };
        case 'liberada':
            return { tom: 'perigo', titulo: 'Acesso liberado por prazo', texto: `Seu acesso foi liberado até ${(0, exports.formatarData)(resumo.liberadoAte)}. A mensalidade de ${valor} venceu em ${venc}: pague antes de ${bloqueio} para o sistema não bloquear. ${comoPagar}` };
        case 'bloqueada':
            return { tom: 'perigo', titulo: 'Sistema bloqueado', texto: `O sistema foi bloqueado porque a mensalidade de ${valor}${maisDeUma}, vencida em ${venc}, não foi paga. Pague pelo boleto abaixo e envie o comprovante ao suporte para liberar.` };
        default:
            return { tom: 'info', titulo: 'Mensalidade em dia', texto: 'Não há mensalidade em aberto.' };
    }
};
exports.textoDoAviso = textoDoAviso;
/** Texto da tela de bloqueio para quem NAO paga (funcionario, vendedor, caixa). */
exports.TEXTO_BLOQUEIO_FUNCIONARIO = 'O sistema desta empresa está bloqueado por mensalidade em atraso. Avise o dono ou o administrador da empresa: assim que o pagamento for registrado, o acesso volta.';
/** Mensagem do servidor/rules ao recusar (mesmo texto nos dois lados). */
exports.MENSAGEM_SERVIDOR_BLOQUEADO = 'O sistema desta empresa está bloqueado por mensalidade em atraso. O dono ou o administrador vê o boleto ao entrar no sistema; depois do pagamento, fale com o suporte para liberar.';
/** Texto da cobranca (WhatsApp e corpo do e-mail), em nome do Hennder ERP. */
const textoDaCobranca = (params) => {
    const { empresa, competencia, vencimento, valor, boleto } = params;
    const linhas = [
        `Olá${empresa ? `, ${empresa}` : ''}!`,
        `Segue a mensalidade do Hennder ERP de ${(0, exports.rotuloCompetencia)(competencia)}: ${(0, exports.formatarMoeda)(valor)}, vencimento em ${(0, exports.formatarData)(vencimento)}.`,
    ];
    if (boleto.pdfUrl)
        linhas.push(`Boleto (PDF): ${boleto.pdfUrl}`);
    if (boleto.linhaDigitavel)
        linhas.push(`Linha digitável: ${(0, exports.formatarLinhaDigitavel)(boleto.linhaDigitavel)}`);
    if (boleto.link)
        linhas.push(`Pagar pelo link: ${boleto.link}`);
    if (boleto.pixCopiaECola)
        linhas.push(`Pix copia e cola: ${boleto.pixCopiaECola}`);
    linhas.push('O boleto também fica no sistema, para o dono e o administrador imprimirem. Se já pagou, desconsidere esta mensagem.');
    return {
        assunto: `Mensalidade Hennder ERP - ${(0, exports.rotuloCompetencia)(competencia)} - vence ${(0, exports.formatarData)(vencimento)}`,
        texto: linhas.join('\n'),
    };
};
exports.textoDaCobranca = textoDaCobranca;
/** Data do pagamento: valida e nao pode ser futura. */
const validarDataDoPagamento = (pagoEm, hoje) => {
    if (!(0, exports.dataValida)(pagoEm))
        return 'Informe a data do pagamento.';
    if (pagoEm > hoje)
        return 'A data do pagamento não pode ser depois de hoje.';
    return null;
};
exports.validarDataDoPagamento = validarDataDoPagamento;
/** "Liberar ate": de hoje ate' LIBERACAO_MAXIMA_DIAS. */
const validarLiberacao = (ate, hoje) => {
    if (!(0, exports.dataValida)(ate))
        return 'Informe até que dia o acesso fica liberado.';
    if (ate < hoje)
        return 'A data da liberação não pode ser antes de hoje.';
    if (ate > (0, exports.somarDias)(hoje, exports.LIBERACAO_MAXIMA_DIAS))
        return `A liberação vai no máximo até ${exports.LIBERACAO_MAXIMA_DIAS} dias a partir de hoje.`;
    return null;
};
exports.validarLiberacao = validarLiberacao;
/** Rotulo curto da situacao, para a lista do SuperAdmin. */
const rotuloDaEtapa = (s) => {
    switch (s.etapa) {
        case 'lembrete': return `Vence ${emDias(s.diasParaVencer)}`;
        case 'vence_hoje': return 'Vence hoje';
        case 'atrasada': return `Atrasada ${haDias(s.diasDeAtraso)}`;
        case 'aviso_forte': return `Atrasada ${haDias(s.diasDeAtraso)}, bloqueia ${emDias(s.diasParaBloqueio)}`;
        case 'liberada': return `Liberada (atrasada ${haDias(s.diasDeAtraso)})`;
        case 'bloqueada': return 'Bloqueada';
        default: return 'Em dia';
    }
};
exports.rotuloDaEtapa = rotuloDaEtapa;
