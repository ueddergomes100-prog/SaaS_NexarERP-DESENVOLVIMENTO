"use strict";
/**
 * OS NO CAMPO -- app do tecnico (maquinas pesadas, fase 3 -- 2026-10-08,
 * docs/PLANO_MAQUINAS_PESADAS.md).
 *
 * O tecnico abre e atende a OS pelo celular (dentro do app Vendas): lanca
 * pecas e servicos, km de deslocamento, horimetro, observacao do servico,
 * fotos e a assinatura do cliente, e "conclui o atendimento". A OS entao
 * fica AGUARDANDO CONFERENCIA: a oficina confere e finaliza no desktop, com
 * pagamento, baixa de estoque e comissao -- o app nunca fecha financeiro
 * (mesmo principio da pre-venda).
 *
 * Tudo aqui e' puro: montagem do documento, validacoes e textos. Firestore
 * e Storage ficam em services/osCampoService.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.filtrarOsDoApp = exports.resumoDaOsParaLista = exports.AVISO_OS_EM_ATENDIMENTO_NO_CAMPO = exports.validarConclusaoAtendimento = exports.montarNovaOsDeCampo = exports.descricaoDoEquipamento = exports.equipamentoDoCadastro = exports.EQUIPAMENTO_CAMPO_VAZIO = exports.totalDoAtendimentoCentavos = exports.servicoDeCatalogo = exports.itemPickerParaPeca = exports.pecaParaItemPicker = exports.caminhoDaAssinaturaOS = exports.caminhoDaFotoOS = exports.podeAdicionarFotos = exports.TAMANHO_MAXIMO_FOTO_BYTES = exports.LADO_MAXIMO_FOTO_PX = exports.LIMITE_FOTOS_OS = exports.podeAtenderNoApp = exports.osAguardandoConferencia = exports.osEmAtendimentoNoCampo = exports.osEncerrada = exports.CORES_STATUS_OS_CAMPO = exports.STATUS_OS_CANCELADA = exports.STATUS_OS_FINALIZADA = exports.STATUS_OS_AGUARDANDO_CONFERENCIA = exports.STATUS_OS_EM_ATENDIMENTO = void 0;
const oficinaDomain_1 = require("./oficinaDomain");
exports.STATUS_OS_EM_ATENDIMENTO = 'Em atendimento';
exports.STATUS_OS_AGUARDANDO_CONFERENCIA = 'Aguardando conferência';
exports.STATUS_OS_FINALIZADA = 'Finalizada';
exports.STATUS_OS_CANCELADA = 'Cancelada';
/** Cores dos status novos, no mesmo esquema do getStatusColor da OS. */
exports.CORES_STATUS_OS_CAMPO = {
    [exports.STATUS_OS_EM_ATENDIMENTO]: '#0ea5e9',
    [exports.STATUS_OS_AGUARDANDO_CONFERENCIA]: '#f97316',
};
const osEncerrada = (status) => status === exports.STATUS_OS_FINALIZADA || status === exports.STATUS_OS_CANCELADA;
exports.osEncerrada = osEncerrada;
const osEmAtendimentoNoCampo = (status) => status === exports.STATUS_OS_EM_ATENDIMENTO;
exports.osEmAtendimentoNoCampo = osEmAtendimentoNoCampo;
const osAguardandoConferencia = (status) => status === exports.STATUS_OS_AGUARDANDO_CONFERENCIA;
exports.osAguardandoConferencia = osAguardandoConferencia;
/** O app so' mexe em OS que ainda nao foi finalizada nem cancelada. */
const podeAtenderNoApp = (status) => !(0, exports.osEncerrada)(status);
exports.podeAtenderNoApp = podeAtenderNoApp;
// ---------------------------------------------------------------------------
// Fotos e assinatura
// ---------------------------------------------------------------------------
exports.LIMITE_FOTOS_OS = 10;
exports.LADO_MAXIMO_FOTO_PX = 1280;
exports.TAMANHO_MAXIMO_FOTO_BYTES = 5 * 1024 * 1024;
const podeAdicionarFotos = (fotosAtuais, novas = 1) => {
    const atuais = Array.isArray(fotosAtuais) ? fotosAtuais.length : 0;
    if (atuais + novas <= exports.LIMITE_FOTOS_OS)
        return { ok: true };
    const cabem = Math.max(0, exports.LIMITE_FOTOS_OS - atuais);
    return {
        ok: false,
        erro: cabem === 0
            ? `Esta OS já tem ${exports.LIMITE_FOTOS_OS} fotos, o máximo. Apague alguma para colocar outra.`
            : `Cabem só mais ${cabem} foto${cabem === 1 ? '' : 's'} nesta OS (máximo de ${exports.LIMITE_FOTOS_OS}).`,
    };
};
exports.podeAdicionarFotos = podeAdicionarFotos;
const soSeguro = (s) => s.replace(/[^a-zA-Z0-9_-]/g, '');
const caminhoDaFotoOS = (tenantId, osId, carimbo, indice) => (`empresas/${soSeguro(tenantId)}/os/${soSeguro(osId)}/foto-${carimbo}-${indice}.jpg`);
exports.caminhoDaFotoOS = caminhoDaFotoOS;
const caminhoDaAssinaturaOS = (tenantId, osId, carimbo) => (`empresas/${soSeguro(tenantId)}/os/${soSeguro(osId)}/assinatura-${carimbo}.png`);
exports.caminhoDaAssinaturaOS = caminhoDaAssinaturaOS;
const rastreioDoPreco = (x) => ({
    ...(x.tabelaPreco ? { tabelaPreco: x.tabelaPreco } : {}),
    ...(x.origemPreco ? { origemPreco: x.origemPreco } : {}),
    ...(x.promocaoId ? { promocaoId: x.promocaoId, promocaoNome: x.promocaoNome || '' } : {}),
});
const pecaParaItemPicker = (p) => ({
    id: p.id,
    nome: p.nome,
    ...(p.codigo ? { codigo: p.codigo } : {}),
    precoUnitario: Number(p.preco || 0),
    quantidade: Number(p.quantidade || 0),
    desconto: 0,
    subtotal: Math.round(Number(p.preco || 0) * Number(p.quantidade || 0) * 100) / 100,
    unidadeMedidaSigla: p.unidadeMedidaSigla || 'UN',
    unidadeMedidaFracionado: p.unidadeMedidaFracionado === true,
    unidadeMedidaCasasDecimais: Number(p.unidadeMedidaCasasDecimais || 0),
    ...rastreioDoPreco(p),
});
exports.pecaParaItemPicker = pecaParaItemPicker;
const itemPickerParaPeca = (i) => ({
    id: i.id,
    nome: i.nome,
    ...(i.codigo ? { codigo: i.codigo } : {}),
    preco: Number(i.precoUnitario || 0),
    quantidade: Number(i.quantidade || 0),
    unidadeMedidaSigla: i.unidadeMedidaSigla || 'UN',
    unidadeMedidaFracionado: i.unidadeMedidaFracionado === true,
    unidadeMedidaCasasDecimais: Number(i.unidadeMedidaCasasDecimais || 0),
    ...rastreioDoPreco(i),
});
exports.itemPickerParaPeca = itemPickerParaPeca;
const servicoDeCatalogo = (s, horas = 1) => ({
    id: s.id,
    nome: s.nome,
    preco: Number(s.preco || 0),
    quantidade: 1,
    tempoHoras: Math.max(0, Number(horas) || 0),
    detalhamento: '',
});
exports.servicoDeCatalogo = servicoDeCatalogo;
const horasDoServico = (s) => {
    if (s.tempoHoras === undefined || s.tempoHoras === null || s.tempoHoras === '')
        return Math.max(0, Number(s.quantidade || 1));
    return Math.max(0, Number(s.tempoHoras || 0));
};
const totalDoAtendimentoCentavos = (pecas, servicos) => {
    const pecasC = pecas.reduce((t, p) => t + Math.round(Number(p.preco || 0) * Number(p.quantidade || 0) * 100), 0);
    const servicosC = servicos.reduce((t, s) => t + Math.round(Number(s.preco || 0) * horasDoServico(s) * 100), 0);
    return pecasC + servicosC;
};
exports.totalDoAtendimentoCentavos = totalDoAtendimentoCentavos;
exports.EQUIPAMENTO_CAMPO_VAZIO = {
    placa: '', modelo: '', marca: '', ano: '', cor: '', frota: '', serie: '', horimetro: '', tipoEquipamento: '',
};
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
/** Cadastro de veiculos/equipamentos -> campos da OS. */
const equipamentoDoCadastro = (v) => ({
    placa: texto(v?.placa).toUpperCase(),
    modelo: texto(v?.modelo),
    marca: texto(v?.marca),
    ano: texto(v?.ano),
    cor: texto(v?.cor),
    frota: texto(v?.frota),
    serie: texto(v?.serie).toUpperCase(),
    horimetro: v?.horimetro ? String(v.horimetro) : '',
    tipoEquipamento: texto(v?.tipoEquipamento),
});
exports.equipamentoDoCadastro = equipamentoDoCadastro;
const descricaoDoEquipamento = (modo, e) => {
    const ident = (0, oficinaDomain_1.identificacaoCurta)(modo, e);
    const nome = [texto(e.marca), texto(e.modelo)].filter(Boolean).join(' ');
    return [ident !== '-' ? ident : '', nome].filter(Boolean).join(' · ') || 'Sem equipamento';
};
exports.descricaoDoEquipamento = descricaoDoEquipamento;
/**
 * O documento da OS nascendo no campo. Mesmos campos que o desktop grava,
 * sem nenhum `undefined` (o Firestore recusa). Status "Em atendimento".
 */
const montarNovaOsDeCampo = (n) => ({
    tenantId: n.tenantId,
    numeroOS: n.numeroOS,
    status: exports.STATUS_OS_EM_ATENDIMENTO,
    statusColor: exports.CORES_STATUS_OS_CAMPO[exports.STATUS_OS_EM_ATENDIMENTO],
    clienteId: n.cliente.id || null,
    clienteNome: texto(n.cliente.nome).toUpperCase(),
    clienteTelefone: texto(n.cliente.telefone),
    placa: n.equipamento.placa,
    modelo: n.equipamento.modelo,
    marca: n.equipamento.marca,
    ano: n.equipamento.ano,
    cor: n.equipamento.cor,
    renavam: '',
    quilometragem: '',
    combustivel: '',
    frota: n.equipamento.frota,
    serie: n.equipamento.serie,
    horimetro: n.equipamento.horimetro,
    tipoEquipamento: n.equipamento.tipoEquipamento,
    dataEntrada: n.data,
    dataSaida: '',
    horaEntrada: n.hora,
    horaSaida: '',
    defeitoRelatado: texto(n.reclamacao),
    relatorioTecnico: '',
    materiaisCliente: '',
    condicoesPagamento: '',
    observacoes: '',
    servicos: [],
    pecas: [],
    valorTotal: 0,
    valorTotalCentavos: 0,
    desconto: { tipo: 'percentual', valorInformado: 0, valorAplicadoCentavos: 0, excedeuLimite: false },
    estoqueBaixado: false,
    estoqueReservado: false,
    formaPagamento: 'Dinheiro',
    statusPagamento: 'Pendente',
    mecanicoId: n.tecnico.id,
    mecanicoNome: n.tecnico.nome,
    orcamentoId: '',
    deslocamento: null,
    fotos: [],
    assinaturaCliente: null,
    origem: 'app_tecnico',
    atendimentoCampo: { inicio: `${n.data}T${n.hora}`, fim: null, tecnicoId: n.tecnico.id },
});
exports.montarNovaOsDeCampo = montarNovaOsDeCampo;
const validarConclusaoAtendimento = (c) => {
    const erros = [];
    const avisos = [];
    if ((0, exports.osEncerrada)(c.status))
        erros.push(`Esta OS já está ${String(c.status).toLowerCase()} e não pode ser atendida pelo app.`);
    if (c.exigirAssinatura && !c.temAssinatura)
        erros.push('A empresa exige a assinatura do cliente para concluir o atendimento. Toque em "Assinatura do cliente" e peça para ele assinar na tela.');
    if (!texto(c.relatorioTecnico))
        avisos.push('Sem observação do serviço feito.');
    if (c.pecas.length === 0 && c.servicos.length === 0)
        avisos.push('Nenhuma peça nem serviço lançado.');
    return { ok: erros.length === 0, erros, avisos };
};
exports.validarConclusaoAtendimento = validarConclusaoAtendimento;
/** Texto do aviso do desktop quando alguem abre uma OS que o tecnico ainda esta atendendo. */
exports.AVISO_OS_EM_ATENDIMENTO_NO_CAMPO = 'Esta OS está em atendimento pelo técnico no app. O que você gravar aqui pode ser sobrescrito pelo que ele ainda vai enviar do campo. Se possível, espere o atendimento ser concluído ("Aguardando conferência").';
const resumoDaOsParaLista = (modo, id, d) => ({
    id,
    numeroOS: texto(d.numeroOS) || id.slice(0, 6).toUpperCase(),
    status: texto(d.status),
    statusColor: texto(d.statusColor) || exports.CORES_STATUS_OS_CAMPO[texto(d.status)] || '#6b7280',
    clienteNome: texto(d.clienteNome),
    equipamento: (0, exports.descricaoDoEquipamento)(modo, d),
    mecanicoId: texto(d.mecanicoId),
    abertaNoCampo: (0, exports.osEmAtendimentoNoCampo)(d.status),
    aguardandoConferencia: (0, exports.osAguardandoConferencia)(d.status),
    criadoEmSegundos: Number(d.createdAt?.seconds || 0),
});
exports.resumoDaOsParaLista = resumoDaOsParaLista;
/** "Minhas": as do tecnico ainda nao encerradas. "Todas": tudo que nao encerrou. Encerradas ficam de fora da aba. */
const filtrarOsDoApp = (lista, aba, tecnicoId) => (lista
    .filter((os) => !(0, exports.osEncerrada)(os.status))
    .filter((os) => aba === 'todas' || os.mecanicoId === tecnicoId)
    .sort((a, b) => {
    // Em atendimento primeiro, depois aguardando conferencia, depois as outras; mais recente em cima.
    const peso = (os) => (os.abertaNoCampo ? 0 : os.aguardandoConferencia ? 1 : 2);
    return peso(a) - peso(b) || b.criadoEmSegundos - a.criadoEmSegundos;
}));
exports.filtrarOsDoApp = filtrarOsDoApp;
