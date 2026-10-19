"use strict";
/**
 * OFICINA DE MAQUINAS PESADAS (2026-10-07, fase 1 do plano
 * docs/PLANO_MAQUINAS_PESADAS.md).
 *
 * Uma chave em Configuracoes ("Empresa de maquinas pesadas") troca a roupa da
 * OS, do cadastro de veiculos, das listas e da impressao: Veiculo vira
 * Equipamento, Placa vira Frota/Placa (e deixa de ser obrigatoria -- frota ou
 * serie/chassi identificam), Quilometragem vira Horimetro, Mecanico vira
 * Tecnico, Defeito relatado vira Reclamacao do cliente. Entra tambem o bloco
 * de DESLOCAMENTO (km ate o cliente), com preco por km configurado: o tecnico
 * digita os km e o sistema lanca a linha de servico "Deslocamento -- N km".
 *
 * Tudo aqui e' puro. Chave desligada = sistema exatamente como antes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.aplicarDeslocamentoNosServicos = exports.ID_SERVICO_DESLOCAMENTO = exports.valorDeslocamentoCentavos = exports.temDeslocamento = exports.kmDoDeslocamento = exports.parseDeslocamento = exports.DESLOCAMENTO_VAZIO = exports.identificacaoBateBusca = exports.identificacaoCurta = exports.validarIdentificacaoEquipamento = exports.rotulosOficina = exports.configMaquinasDoForm = exports.configMaquinasParaForm = exports.modoDaConfiguracao = exports.parseConfigMaquinasPesadas = exports.CONFIG_MAQUINAS_PESADAS_PADRAO = exports.TEXTO_CONCORDANCIA_PADRAO = exports.TIPOS_EQUIPAMENTO_PADRAO = void 0;
exports.TIPOS_EQUIPAMENTO_PADRAO = [
    'Trator', 'Colheitadeira', 'Pulverizador', 'Plantadeira', 'Retroescavadeira', 'Pá carregadeira',
    'Escavadeira', 'Motoniveladora', 'Empilhadeira', 'Caminhão', 'Gerador', 'Implemento', 'Outro',
];
exports.TEXTO_CONCORDANCIA_PADRAO = 'Como consumidor concordo com a avaliação feita pelo responsável e estou ciente que a empresa, havendo necessidade de desmontagem do equipamento/veículo entregue para realização de serviço, não havendo o conserto, poderá ocorrer a substituição de reparos e afins para remontagem, e desta forma o cliente está ciente que se trata de componente com determinado tempo de uso, podendo ser gerada a cobrança destes custos.';
exports.CONFIG_MAQUINAS_PESADAS_PADRAO = {
    ativo: false,
    tiposEquipamento: [...exports.TIPOS_EQUIPAMENTO_PADRAO],
    precoKmCentavos: 0,
    valorVisitaCentavos: 0,
    textoConcordancia: exports.TEXTO_CONCORDANCIA_PADRAO,
    tecnicoVeValores: true,
    exigirAssinatura: false,
};
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const centavos = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const parseConfigMaquinasPesadas = (raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {});
    const tipos = Array.isArray(r.tiposEquipamento)
        ? r.tiposEquipamento.map(texto).filter(Boolean)
        : [];
    return {
        ativo: r.ativo === true,
        tiposEquipamento: tipos.length > 0 ? tipos : [...exports.TIPOS_EQUIPAMENTO_PADRAO],
        precoKmCentavos: centavos(r.precoKmCentavos),
        valorVisitaCentavos: centavos(r.valorVisitaCentavos),
        textoConcordancia: texto(r.textoConcordancia) || exports.TEXTO_CONCORDANCIA_PADRAO,
        tecnicoVeValores: r.tecnicoVeValores !== false,
        exigirAssinatura: r.exigirAssinatura === true,
    };
};
exports.parseConfigMaquinasPesadas = parseConfigMaquinasPesadas;
const modoDaConfiguracao = (config) => (config?.ativo ? 'maquinas_pesadas' : 'veiculos');
exports.modoDaConfiguracao = modoDaConfiguracao;
const reaisTexto = (c) => (c > 0 ? (c / 100).toFixed(2).replace('.', ',') : '');
const reaisParaCentavos = (s) => {
    const t = s.trim();
    if (!t)
        return 0;
    const n = Number(t.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0)
        return null;
    return Math.round(n * 100);
};
const configMaquinasParaForm = (c) => ({
    ativo: c.ativo,
    tiposEquipamento: c.tiposEquipamento.join('\n'),
    precoKm: reaisTexto(c.precoKmCentavos),
    valorVisita: reaisTexto(c.valorVisitaCentavos),
    textoConcordancia: c.textoConcordancia,
    tecnicoVeValores: c.tecnicoVeValores,
    exigirAssinatura: c.exigirAssinatura,
});
exports.configMaquinasParaForm = configMaquinasParaForm;
const configMaquinasDoForm = (f) => {
    const precoKm = reaisParaCentavos(f.precoKm);
    if (precoKm === null)
        return { ok: false, erro: 'Preço do km de deslocamento inválido. Informe um valor como 2,50 ou deixe em branco para não cobrar por km.' };
    const visita = reaisParaCentavos(f.valorVisita);
    if (visita === null)
        return { ok: false, erro: 'Valor da visita inválido. Informe um valor como 150,00 ou deixe em branco para não cobrar.' };
    const tipos = f.tiposEquipamento.split(/\r?\n|,/).map((t) => t.trim()).filter(Boolean);
    return {
        ok: true,
        config: {
            ativo: f.ativo,
            tiposEquipamento: tipos.length > 0 ? tipos : [...exports.TIPOS_EQUIPAMENTO_PADRAO],
            precoKmCentavos: precoKm,
            valorVisitaCentavos: visita,
            textoConcordancia: f.textoConcordancia.trim() || exports.TEXTO_CONCORDANCIA_PADRAO,
            tecnicoVeValores: f.tecnicoVeValores !== false,
            exigirAssinatura: f.exigirAssinatura === true,
        },
    };
};
exports.configMaquinasDoForm = configMaquinasDoForm;
const ROTULOS = {
    veiculos: {
        veiculo: 'Veículo',
        veiculos: 'Veículos',
        dadosVeiculo: 'Dados do Veículo',
        placa: 'Placa',
        identificacao: 'Placa',
        km: 'Quilometragem',
        kmUnidade: 'km',
        mecanico: 'Mecânico',
        defeito: 'Defeito Relatado',
        defeitoPlaceholder: 'Descreva o problema reclamado pelo cliente...',
        relatorioPlaceholder: 'Descreva tecnicamente o que foi encontrado e reparado no veículo...',
        buscaLista: 'Buscar por placa, cliente ou nº OS...',
    },
    maquinas_pesadas: {
        veiculo: 'Equipamento',
        veiculos: 'Equipamentos',
        dadosVeiculo: 'Dados do Equipamento',
        placa: 'Placa (se tiver)',
        identificacao: 'Frota / Série',
        km: 'Horímetro',
        kmUnidade: 'h',
        mecanico: 'Técnico',
        defeito: 'Reclamação do Cliente',
        defeitoPlaceholder: 'Descreva a reclamação do cliente sobre o equipamento...',
        relatorioPlaceholder: 'Descreva tecnicamente o que foi encontrado e o serviço executado no equipamento...',
        buscaLista: 'Buscar por frota, série, cliente ou nº OS...',
    },
};
const rotulosOficina = (modo) => ROTULOS[modo];
exports.rotulosOficina = rotulosOficina;
/**
 * Oficina de veiculos: placa obrigatoria (como sempre foi). Maquinas pesadas:
 * basta frota, placa ou serie/chassi -- trator nao tem placa.
 */
const validarIdentificacaoEquipamento = (modo, id) => {
    const placa = texto(id.placa);
    const frota = texto(id.frota);
    const serie = texto(id.serie);
    if (modo === 'veiculos') {
        return placa ? { ok: true } : { ok: false, erro: 'Por favor, preencha o Nome do Cliente e a Placa.' };
    }
    return placa || frota || serie
        ? { ok: true }
        : { ok: false, erro: 'Informe como identificar o equipamento: número de frota, placa ou série/chassi (pelo menos um).' };
};
exports.validarIdentificacaoEquipamento = validarIdentificacaoEquipamento;
/** "ABC-1234" / "Frota 12" / "Série 9XK..." -- o que der para mostrar numa coluna. */
const identificacaoCurta = (modo, id) => {
    const placa = texto(id.placa).toUpperCase();
    const frota = texto(id.frota);
    const serie = texto(id.serie);
    if (modo === 'veiculos')
        return placa || '-';
    if (frota)
        return `Frota ${frota}`;
    if (placa)
        return placa;
    if (serie)
        return `Série ${serie}`;
    return '-';
};
exports.identificacaoCurta = identificacaoCurta;
/** Casa a busca da lista com frota, serie e placa (modo maquinas) ou so' placa. */
const identificacaoBateBusca = (modo, id, termo) => {
    const t = termo.trim().toLowerCase();
    if (!t)
        return true;
    const campos = modo === 'veiculos' ? [id.placa] : [id.placa, id.frota, id.serie];
    return campos.some((c) => texto(c).toLowerCase().includes(t));
};
exports.identificacaoBateBusca = identificacaoBateBusca;
exports.DESLOCAMENTO_VAZIO = {
    kmInicial: null, kmFinal: null, km: 0, horaSaida: '', horaChegada: '', local: '', veiculoEmpresa: '',
};
const numeroOuNulo = (v) => {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
};
const parseDeslocamento = (raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {});
    return {
        kmInicial: numeroOuNulo(r.kmInicial),
        kmFinal: numeroOuNulo(r.kmFinal),
        km: numeroOuNulo(r.km) ?? 0,
        horaSaida: texto(r.horaSaida),
        horaChegada: texto(r.horaChegada),
        local: texto(r.local),
        veiculoEmpresa: texto(r.veiculoEmpresa),
    };
};
exports.parseDeslocamento = parseDeslocamento;
/** Km rodados: final - inicial quando os dois existem e fazem sentido; senao o km digitado. */
const kmDoDeslocamento = (d) => {
    if (d.kmInicial !== null && d.kmFinal !== null && d.kmFinal >= d.kmInicial) {
        return Math.round((d.kmFinal - d.kmInicial) * 10) / 10;
    }
    return Math.max(0, Math.round((d.km || 0) * 10) / 10);
};
exports.kmDoDeslocamento = kmDoDeslocamento;
const temDeslocamento = (d) => ((0, exports.kmDoDeslocamento)(d) > 0 || !!d.local || !!d.horaSaida || !!d.horaChegada || !!d.veiculoEmpresa);
exports.temDeslocamento = temDeslocamento;
/** km x preco do km + visita (so' quando ha km). */
const valorDeslocamentoCentavos = (km, config) => {
    if (km <= 0)
        return 0;
    return Math.round(km * config.precoKmCentavos) + config.valorVisitaCentavos;
};
exports.valorDeslocamentoCentavos = valorDeslocamentoCentavos;
exports.ID_SERVICO_DESLOCAMENTO = 'deslocamento';
const formatarKm = (km) => (Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ','));
/**
 * Troca (ou tira) a linha de servico do deslocamento na lista de servicos da
 * OS. Linha unica, id fixo, 1 hora x valor -- bate com getServiceTotal
 * (preco x horas). Valor zero (sem preco configurado ou sem km) remove a
 * linha; o resto da lista nao e' tocado.
 */
const aplicarDeslocamentoNosServicos = (servicos, km, config) => {
    const semDeslocamento = servicos.filter((s) => s.id !== exports.ID_SERVICO_DESLOCAMENTO);
    const valor = (0, exports.valorDeslocamentoCentavos)(km, config);
    if (valor <= 0)
        return semDeslocamento;
    const detalhe = [
        config.precoKmCentavos > 0 ? `${formatarKm(km)} km × R$ ${reaisTexto(config.precoKmCentavos)}` : '',
        config.valorVisitaCentavos > 0 ? `visita R$ ${reaisTexto(config.valorVisitaCentavos)}` : '',
    ].filter(Boolean).join(' + ');
    const linha = {
        id: exports.ID_SERVICO_DESLOCAMENTO,
        nome: `Deslocamento — ${formatarKm(km)} km`,
        preco: valor / 100,
        quantidade: 1,
        tempoHoras: 1,
        detalhamento: detalhe,
    };
    return [...semDeslocamento, linha];
};
exports.aplicarDeslocamentoNosServicos = aplicarDeslocamentoNosServicos;
