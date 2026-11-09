"use strict";
/*
 * HISTORICO DE ALTERACOES (09/11/2026) -- regra pura, usada pela tela e pelo
 * servidor (compilada em server/domain por scripts/build-server-domain.mjs).
 *
 * Por que existe: um cliente disse que o sistema "bugou" num romaneio que ele
 * mesmo cancelou. O dono precisa de PROVA de quem fez o que: quem (nome e
 * papel), quando (hora do servidor), onde (empresa, filial, tela ou app),
 * em qual documento (pelo numero que o usuario conhece: "Rota 02",
 * "Pedido 0375"), o que mudou (antes e depois) e o motivo.
 *
 * Onde fica: `empresas/{tenantId}/logs` (o mesmo lugar dos registros antigos,
 * para nada do que ja' foi gravado se perder). As firestore.rules so' deixam
 * CRIAR, com o uid de quem esta logado e a hora do servidor; ninguem altera
 * nem apaga -- nem o dono, nem o suporte (decisao do dono: guardar tudo para
 * sempre).
 *
 * Na interface a palavra e' "Histórico de alterações", nunca "log".
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.comNomeDaFilial = exports.resumoDasAlteracoes = exports.opcoesDosFiltros = exports.filtrarRegistros = exports.rotuloDoModulo = exports.telaDoRegistro = exports.juntarRegistros = exports.nomeDeQuemFez = exports.textoQuemEQuando = exports.dataHoraBrasil = exports.dataDoRegistro = exports.montarRegistroHistorico = exports.documentoDaDescricao = exports.semUndefined = exports.diferencasEntre = exports.valorParaHistorico = exports.corDaAcao = exports.rotuloDaAcao = exports.ehAcaoCritica = exports.rotuloDaOrigem = exports.origemDaRota = exports.telaDaRota = exports.rotuloDoPapel = exports.ROTULO_ORIGEM = void 0;
exports.ROTULO_ORIGEM = {
    sistema: 'Sistema',
    app_vendas: 'App Vendas',
    app_motorista: 'App do motorista',
    app_tecnico: 'App do técnico',
    frente_caixa: 'Frente de Caixa',
    servidor: 'Automático (servidor)',
};
const LIMITE_TEXTO = 2000;
const LIMITE_VALOR = 500;
const LIMITE_ALTERACOES = 150;
const LIMITE_DOCUMENTOS = 12;
const texto = (valor) => (typeof valor === 'string' ? valor.trim() : (typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : ''));
const textoOuNulo = (valor, limite = LIMITE_TEXTO) => {
    const t = texto(valor);
    return t ? t.slice(0, limite) : null;
};
// ---------------------------------------------------------------------------
// PAPEL
// ---------------------------------------------------------------------------
/** Papel em portugues, como o dono fala ("Dono", "Administrador", "Gerente"...). */
const rotuloDoPapel = (papel, nivelAcesso, dono) => {
    const p = texto(papel);
    if (p === 'NexarAdmin' || p === 'SuperAdmin')
        return 'Suporte Hennder';
    if (dono || p === 'Master')
        return 'Dono';
    if (p === 'Admin')
        return 'Administrador';
    if (p === 'Funcionario') {
        const nivel = texto(nivelAcesso).toLowerCase();
        if (nivel === 'gerente' || nivel === 'administracao')
            return 'Gerente';
        if (nivel === 'supervisor')
            return 'Supervisor';
        return 'Funcionário';
    }
    return p || null;
};
exports.rotuloDoPapel = rotuloDoPapel;
// ---------------------------------------------------------------------------
// TELA E ORIGEM (pelo caminho da tela)
// ---------------------------------------------------------------------------
/** Prefixo da rota -> nome da tela no menu. O mais comprido que casar ganha. */
const TELAS = [
    ['/dashboard', 'Dashboard'],
    ['/pedidos-venda', 'Pedidos de Venda'],
    ['/minhas-vendas', 'Minhas Vendas'],
    ['/pre-vendas', 'Pré-vendas em Aberto'],
    ['/orcamentos', 'Orçamentos'],
    ['/vendas/devolucoes', 'Devolução de Venda'],
    ['/vendas/promocoes', 'Promoções'],
    ['/vendas/cashback', 'Cashback'],
    ['/vendas/trocas', 'Trocas'],
    ['/vendas/condicional', 'Condicional'],
    ['/relatorios-vendas', 'Relatório de Vendas'],
    ['/os', 'Ordens de Serviço'],
    ['/crm', 'Agenda e Alertas'],
    ['/relatorios-mecanica', 'Relatório de Serviços'],
    ['/clientes', 'Clientes'],
    ['/fornecedores', 'Fornecedores'],
    ['/veiculos', 'Veículos'],
    ['/servicos', 'Serviços'],
    ['/estoque', 'Produtos (Estoque)'],
    ['/estoque/ajuste', 'Ajuste Manual de Estoque'],
    ['/estoque/balanco', 'Balanço'],
    ['/estoque/transferencias', 'Transferências'],
    ['/estoque/lotes', 'Lotes e Validades'],
    ['/estoque/notas-avulsas', 'Nota Avulsa'],
    ['/estoque/precificacao', 'Precificação'],
    ['/estoque/etiquetas', 'Etiquetas'],
    ['/estoque/movimentacao', 'Movimentação de Produtos'],
    ['/estoque/importar', 'Importação de Produtos'],
    ['/categorias', 'Categorias'],
    ['/marcas', 'Marcas'],
    ['/unidades-medida', 'Unidades de Medida'],
    ['/grades', 'Grades'],
    ['/bandeiras-cartao', 'Bandeiras de Cartão'],
    ['/bancos', 'Bancos'],
    ['/materias-primas', 'Matéria-Prima'],
    ['/insumos', 'Insumos'],
    ['/vendedores', 'Vendedores'],
    ['/producao', 'Ordens de Produção'],
    ['/operacoes/expedicao', 'Conferência de Mercadoria'],
    ['/operacoes/entregas-futuras', 'Entregas Futuras'],
    ['/operacoes/romaneios', 'Romaneio de Entrega'],
    ['/operacoes/rotas', 'Rotas e Despesas'],
    ['/operacoes/motoristas', 'Motoristas'],
    ['/operacoes/frota', 'Frota'],
    ['/financeiro/caixa', 'Fluxo de Caixa'],
    ['/financeiro/caixa-registros', 'Caixa (Sessões PDV)'],
    ['/financeiro/caixas', 'Caixas e Transferências'],
    ['/financeiro/banco', 'Banco'],
    ['/financeiro/cheques', 'Cheques'],
    ['/financeiro/boletos', 'Boletos'],
    ['/financeiro/contas-receber', 'Contas a Receber'],
    ['/financeiro/contas-pagar', 'Contas a Pagar'],
    ['/financeiro/faturamento', 'Faturamento'],
    ['/financeiro/custos', 'Custos e Formação de Preço'],
    ['/financeiro/comissoes', 'Comissões'],
    ['/fiscal/nfe', 'Notas Fiscais'],
    ['/fiscal/relatorio-contador', 'Relatório do Contador'],
    ['/fiscal/tabelas', 'Tabelas Fiscais'],
    ['/fiscal/entrada-nfe', 'Entrada de NF-e'],
    ['/fiscal/entrada-nfse', 'Entrada de NFS-e'],
    ['/utilitarios', 'Utilitários'],
    ['/usuarios', 'Usuários'],
    ['/relatorios-diversos', 'Relatórios Diversos'],
    ['/logs-sistema', 'Histórico de alterações'],
    ['/configuracoes', 'Configurações'],
    ['/configuracoes/filial', 'Configurações da Filial'],
    ['/configuracoes/filiais', 'Filiais'],
    ['/compras', 'Compras'],
    ['/integracoes', 'E-commerce'],
    ['/superadmin', 'Painel da Plataforma'],
    ['/caixa', 'Frente de Caixa'],
    ['/vendedor', 'App Vendas'],
    ['/vendedor/pedido', 'Pedido (app)'],
    ['/vendedor/pedidos', 'Meus pedidos (app)'],
    ['/vendedor/orcamento', 'Orçamento (app)'],
    ['/vendedor/troca', 'Troca (app)'],
    ['/vendedor/trocas', 'Trocas (app)'],
    ['/vendedor/cliente', 'Clientes (app)'],
    ['/vendedor/conferencia', 'Conferência (app)'],
    ['/vendedor/balanco', 'Balanço (app)'],
    ['/vendedor/contas-receber', 'Contas a Receber (app)'],
    ['/vendedor/contas-pagar', 'Contas a Pagar (app)'],
    ['/vendedor/liberacoes', 'Liberação de desconto (app)'],
    ['/vendedor/entregas', 'Entregas (app do motorista)'],
    ['/vendedor/os', 'OS (app do técnico)'],
];
const TELAS_ORDENADAS = [...TELAS].sort((a, b) => b[0].length - a[0].length);
const caminhoLimpo = (rota) => {
    const t = texto(rota).split('?')[0].split('#')[0];
    return t.length > 1 ? t.replace(/\/+$/, '') : t;
};
const casaPrefixo = (caminho, prefixo) => (caminho === prefixo || caminho.startsWith(`${prefixo}/`));
/** Nome da tela pelo caminho ("/operacoes/romaneios/abc" -> "Romaneio de Entrega"). */
const telaDaRota = (rota) => {
    const caminho = caminhoLimpo(rota);
    if (!caminho)
        return null;
    const achada = TELAS_ORDENADAS.find(([prefixo]) => casaPrefixo(caminho, prefixo));
    return achada ? achada[1] : null;
};
exports.telaDaRota = telaDaRota;
/** De onde veio a acao, pelo caminho da tela. Sem caminho = o proprio servidor. */
const origemDaRota = (rota) => {
    const caminho = caminhoLimpo(rota);
    if (!caminho)
        return 'servidor';
    if (casaPrefixo(caminho, '/vendedor/entregas'))
        return 'app_motorista';
    if (casaPrefixo(caminho, '/vendedor/os'))
        return 'app_tecnico';
    if (casaPrefixo(caminho, '/vendedor'))
        return 'app_vendas';
    if (casaPrefixo(caminho, '/caixa'))
        return 'frente_caixa';
    return 'sistema';
};
exports.origemDaRota = origemDaRota;
const ehOrigem = (valor) => (typeof valor === 'string' && Object.prototype.hasOwnProperty.call(exports.ROTULO_ORIGEM, valor));
const rotuloDaOrigem = (origem) => (ehOrigem(origem) ? exports.ROTULO_ORIGEM[origem] : '');
exports.rotuloDaOrigem = rotuloDaOrigem;
// ---------------------------------------------------------------------------
// ACAO
// ---------------------------------------------------------------------------
const ROTULO_ACAO = {
    criacao: 'Criou',
    criar_pdv: 'Vendeu no PDV',
    edicao: 'Alterou',
    exclusao: 'Excluiu',
    cancelamento: 'Cancelou',
    recusa: 'Recusou',
    recusa_pedido_pendente: 'Recusou o pedido',
    reabertura: 'Reabriu',
    fechamento: 'Fechou',
    finalizacao: 'Finalizou',
    faturamento: 'Faturou',
    liberacao: 'Liberou',
    estorno: 'Estornou',
    baixa: 'Deu baixa',
    devolucao: 'Devolução',
    emissao: 'Emitiu',
    inativacao: 'Inativou',
    reativacao: 'Reativou',
    entrega: 'Registrou entrega',
    pedido_na_rota: 'Colocou na rota',
    conferencia_aberta: 'Abriu a conferência',
    conferencia_fechada: 'Fechou a conferência',
    importacao: 'Importou',
    login: 'Entrou no sistema',
    logout: 'Saiu do sistema',
    acesso_negado: 'Acesso negado',
    balanco_abrir: 'Abriu o balanço',
    balanco_fechar: 'Fechou o balanço',
    balanco_cancelar: 'Cancelou o balanço',
};
/** Acoes que desfazem ou derrubam algo: aparecem em destaque e nunca saem do historico. */
const ACOES_CRITICAS = ['exclusao', 'cancelamento', 'estorno', 'reabertura', 'recusa', 'recusa_pedido_pendente', 'balanco_cancelar', 'inativacao', 'acesso_negado'];
const ehAcaoCritica = (acao) => {
    const a = texto(acao).toLowerCase();
    return ACOES_CRITICAS.includes(a) || /cancel|exclu|estorn|reabr|desfaz/.test(a);
};
exports.ehAcaoCritica = ehAcaoCritica;
const rotuloDaAcao = (acao) => {
    const a = texto(acao);
    if (!a)
        return '';
    if (ROTULO_ACAO[a])
        return ROTULO_ACAO[a];
    const solto = a.replace(/_/g, ' ');
    return solto.charAt(0).toUpperCase() + solto.slice(1);
};
exports.rotuloDaAcao = rotuloDaAcao;
/** Cor da etiqueta da acao (vermelho = desfez algo, azul = alterou, verde = criou). */
const corDaAcao = (acao) => {
    const a = texto(acao).toLowerCase();
    if ((0, exports.ehAcaoCritica)(a) || /negad|recus/.test(a))
        return '#ef4444';
    if (/edic|alterac|ajuste/.test(a))
        return '#3b82f6';
    if (/criac|criar|emiss|fatur|finaliz|baixa|entreg|import/.test(a))
        return '#10b981';
    return '#6b7280';
};
exports.corDaAcao = corDaAcao;
// ---------------------------------------------------------------------------
// ANTES E DEPOIS
// ---------------------------------------------------------------------------
const ehTimestamp = (valor) => (typeof valor === 'object' && valor !== null && typeof valor.seconds === 'number');
/** Valor que cabe no historico: nunca undefined, texto curto, data em ISO, objeto em JSON. */
const valorParaHistorico = (valor) => {
    if (valor === undefined || valor === null)
        return null;
    if (typeof valor === 'number')
        return Number.isFinite(valor) ? valor : null;
    if (typeof valor === 'boolean')
        return valor;
    if (typeof valor === 'string')
        return valor.length > LIMITE_VALOR ? `${valor.slice(0, LIMITE_VALOR)}…` : valor;
    if (valor instanceof Date)
        return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
    if (ehTimestamp(valor))
        return new Date(valor.seconds * 1000).toISOString();
    if (typeof valor === 'function')
        return null;
    try {
        const json = JSON.stringify(valor);
        if (json === undefined)
            return null;
        return json.length > LIMITE_VALOR ? `${json.slice(0, LIMITE_VALOR)}…` : json;
    }
    catch {
        return null;
    }
};
exports.valorParaHistorico = valorParaHistorico;
const comparavel = (valor) => {
    const v = (0, exports.valorParaHistorico)(valor);
    if (v === null || v === '')
        return '';
    return typeof v === 'string' ? v.trim() : String(v);
};
/** Campos de controle que mudam em toda gravacao e nao interessam a ninguem. */
const CAMPOS_DE_CONTROLE = new Set([
    'updatedAt', 'createdAt', 'alteradoEm', 'alteradoPor', 'ultimaAlteracao', 'criadoEm', 'criadoPor',
    'tenantId', 'id', 'travaEdicao',
]);
/**
 * O que mudou entre `antes` e `depois`. Com `campos`, compara so' esses (com o
 * rotulo do usuario); sem eles, compara todos os campos que aparecem nos dois,
 * menos os de controle. Vazio = nada mudou.
 */
const diferencasEntre = (antes, depois, campos) => {
    const a = antes || {};
    const d = depois || {};
    const lista = campos
        ? campos.map((c) => (typeof c === 'string' ? { campo: c } : c))
        : Array.from(new Set([...Object.keys(a), ...Object.keys(d)]))
            .filter((chave) => !CAMPOS_DE_CONTROLE.has(chave))
            .sort()
            .map((campo) => ({ campo }));
    const mudancas = [];
    lista.forEach(({ campo, rotulo, formatar }) => {
        const valorA = formatar ? formatar(a[campo]) : a[campo];
        const valorD = formatar ? formatar(d[campo]) : d[campo];
        if (comparavel(valorA) === comparavel(valorD))
            return;
        mudancas.push({
            campo: rotulo || campo,
            valorAnterior: (0, exports.valorParaHistorico)(valorA),
            valorNovo: (0, exports.valorParaHistorico)(valorD),
        });
    });
    return mudancas.slice(0, LIMITE_ALTERACOES);
};
exports.diferencasEntre = diferencasEntre;
const normalizarAlteracoes = (alteracoes) => {
    if (!Array.isArray(alteracoes) || alteracoes.length === 0)
        return null;
    const limpas = alteracoes
        .filter((m) => m && texto(m.campo))
        .slice(0, LIMITE_ALTERACOES)
        .map((m) => ({
        campo: texto(m.campo).slice(0, 120),
        valorAnterior: (0, exports.valorParaHistorico)(m.valorAnterior),
        valorNovo: (0, exports.valorParaHistorico)(m.valorNovo),
    }));
    return limpas.length ? limpas : null;
};
/** Copia sem undefined/funcao (o Firestore recusa undefined e derruba a gravacao). */
const semUndefined = (valor) => {
    if (valor === undefined || valor === null)
        return null;
    try {
        return JSON.parse(JSON.stringify(valor));
    }
    catch {
        return null;
    }
};
exports.semUndefined = semUndefined;
// ---------------------------------------------------------------------------
// MONTAGEM DO REGISTRO
// ---------------------------------------------------------------------------
const PADRAO_DOCUMENTO = /(?:^|[^\p{L}])(Pr[ée]-venda|Venda(?: Direta| PDV)?|Pedido(?: de Venda| de Compra)?|OS|Ordem de Servi[çc]o|Or[çc]amento|Troca|Condicional|Romaneio|Rota|NF-e|NFC-e|NFS-e|Nota(?: Avulsa| Fiscal)?|Cota[çc][ãa]o|Transfer[êe]ncia|OP|Ordem de Produ[çc][ãa]o)\s*(?:n[ºo°]\s*)?#?\s*(\d{1,10})(?!\d)/iu;
/**
 * Numero do documento tirado da frase ("Venda Direta #375 finalizada" ->
 * "Venda Direta #375"). Serve para os registros que nao informam
 * `documentoNumero` (os antigos e os ~200 pontos que ja' gravavam frase).
 */
const documentoDaDescricao = (descricao) => {
    const achado = texto(descricao).match(PADRAO_DOCUMENTO);
    return achado ? `${achado[1]} #${achado[2]}` : null;
};
exports.documentoDaDescricao = documentoDaDescricao;
const montarRegistroHistorico = (entrada, quem) => {
    const rota = textoOuNulo(entrada.rota, 300);
    const origem = ehOrigem(entrada.origem) ? entrada.origem : (0, exports.origemDaRota)(rota);
    const registroId = textoOuNulo(entrada.registroId, 200);
    const documentos = Array.from(new Set([registroId, ...(entrada.documentosRelacionados || [])]
        .map((d) => texto(d))
        .filter(Boolean))).slice(0, LIMITE_DOCUMENTOS);
    const usuarioId = texto(quem.usuarioId) || 'desconhecido';
    const status = entrada.status === 'erro' || entrada.status === 'negado' ? entrada.status : 'sucesso';
    return {
        versao: 2,
        usuarioId,
        usuario: texto(quem.usuarioEmail) || usuarioId,
        usuarioNome: textoOuNulo(quem.usuarioNome, 200),
        usuarioPapel: (0, exports.rotuloDoPapel)(quem.papel, quem.nivelAcesso, quem.dono),
        empresaId: textoOuNulo(quem.empresaId, 200),
        filialId: textoOuNulo(quem.filialId, 200),
        filialNome: textoOuNulo(quem.filialNome, 200),
        origem,
        tela: textoOuNulo(entrada.tela, 120) || (0, exports.telaDaRota)(rota),
        rota,
        modulo: texto(entrada.modulo) || 'sistema',
        acao: texto(entrada.acao) || 'edicao',
        descricao: texto(entrada.descricao).slice(0, LIMITE_TEXTO),
        registroRelacionadoId: registroId,
        documentosRelacionados: documentos,
        documentoTipo: textoOuNulo(entrada.documentoTipo, 60),
        documentoNumero: textoOuNulo(entrada.documentoNumero, 120) || (0, exports.documentoDaDescricao)(entrada.descricao),
        motivo: textoOuNulo(entrada.motivo),
        valorAnterior: textoOuNulo(entrada.valorAnterior, LIMITE_VALOR),
        valorNovo: textoOuNulo(entrada.valorNovo, LIMITE_VALOR),
        vendedorId: textoOuNulo(entrada.vendedorId, 200),
        vendedorNome: textoOuNulo(entrada.vendedorNome, 200),
        alteracoes: normalizarAlteracoes(entrada.alteracoes),
        snapshotExcluido: entrada.snapshot ? (0, exports.semUndefined)(entrada.snapshot) : null,
        status,
        critical: entrada.critico ?? (0, exports.ehAcaoCritica)(entrada.acao),
    };
};
exports.montarRegistroHistorico = montarRegistroHistorico;
// ---------------------------------------------------------------------------
// LEITURA (telas)
// ---------------------------------------------------------------------------
/** Data/hora do registro, venha como Timestamp do Firestore, Date, texto ou numero. */
const dataDoRegistro = (valor) => {
    if (!valor)
        return null;
    if (valor instanceof Date)
        return Number.isNaN(valor.getTime()) ? null : valor;
    if (ehTimestamp(valor))
        return new Date(valor.seconds * 1000);
    if (typeof valor.toDate === 'function') {
        try {
            return valor.toDate();
        }
        catch {
            return null;
        }
    }
    if (typeof valor === 'string' || typeof valor === 'number') {
        const d = new Date(valor);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
};
exports.dataDoRegistro = dataDoRegistro;
/** "09/11/2026 14:32", no horario de Brasilia. */
const dataHoraBrasil = (valor) => {
    const data = (0, exports.dataDoRegistro)(valor);
    if (!data)
        return '';
    const partes = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(data);
    const parte = (tipo) => partes.find((p) => p.type === tipo)?.value || '';
    return `${parte('day')}/${parte('month')}/${parte('year')} ${parte('hour')}:${parte('minute')}`;
};
exports.dataHoraBrasil = dataHoraBrasil;
/**
 * "Cancelado por MARIA em 09/11/2026 14:32" -- o aviso no topo do documento.
 * Sem nome nem data, devolve '' (o aviso nao aparece pela metade).
 */
const textoQuemEQuando = (verbo, nome, quando) => {
    const n = texto(nome);
    const d = (0, exports.dataHoraBrasil)(quando);
    if (!n && !d)
        return '';
    return [verbo, n ? `por ${n}` : '', d ? `em ${d}` : ''].filter(Boolean).join(' ');
};
exports.textoQuemEQuando = textoQuemEQuando;
/** Nome que aparece para o usuario: nome do cadastro; sem ele, o e-mail; sem ele, o id. */
const nomeDeQuemFez = (registro) => (texto(registro.usuarioNome) || texto(registro.usuario) || texto(registro.usuarioId) || 'Usuário');
exports.nomeDeQuemFez = nomeDeQuemFez;
/** Junta as leituras (por id principal e por documentos relacionados), sem repetir, do mais novo ao mais antigo. */
const juntarRegistros = (...listas) => {
    const porId = new Map();
    listas.forEach((lista) => lista.forEach((r) => { if (!porId.has(r.id))
        porId.set(r.id, r); }));
    return Array.from(porId.values()).sort((a, b) => ((0, exports.dataDoRegistro)(b.dataHora)?.getTime() || 0) - ((0, exports.dataDoRegistro)(a.dataHora)?.getTime() || 0));
};
exports.juntarRegistros = juntarRegistros;
const semAcento = (valor) => texto(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
/** Tela do registro (registros antigos, sem `tela`, usam o modulo). */
const telaDoRegistro = (registro) => (texto(registro.tela) || (0, exports.rotuloDoModulo)(registro.modulo));
exports.telaDoRegistro = telaDoRegistro;
const ROTULO_MODULO = {
    autenticacao: 'Entrada no sistema',
    vendas: 'Vendas',
    estoque: 'Estoque',
    financeiro: 'Financeiro',
    fiscal: 'Fiscal',
    romaneios: 'Romaneio de Entrega',
    mecanica: 'Ordens de Serviço',
    'Ordens de Serviço': 'Ordens de Serviço',
    logs: 'Histórico de alterações',
    compras: 'Compras',
    producao: 'Produção',
    trocas: 'Trocas',
    condicionais: 'Condicional',
    cadastros: 'Cadastros',
    usuarios: 'Usuários',
    configuracoes: 'Configurações',
    filiais: 'Filiais',
};
const rotuloDoModulo = (modulo) => {
    const m = texto(modulo);
    if (!m)
        return '';
    return ROTULO_MODULO[m] || (m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, ' '));
};
exports.rotuloDoModulo = rotuloDoModulo;
/** Filtro feito na tela, sobre o periodo ja' lido do banco. */
const filtrarRegistros = (registros, filtros) => {
    const usuario = semAcento(filtros.usuario);
    const tela = texto(filtros.tela);
    const documento = semAcento(filtros.documento);
    const acao = texto(filtros.acao);
    return registros.filter((r) => {
        if (usuario && !semAcento(`${r.usuarioNome || ''} ${r.usuario || ''} ${r.usuarioId || ''} ${r.vendedorNome || ''}`).includes(usuario))
            return false;
        if (tela && (0, exports.telaDoRegistro)(r) !== tela)
            return false;
        if (acao && r.acao !== acao)
            return false;
        if (documento) {
            const alvo = semAcento(`${r.documentoNumero || ''} ${r.descricao || ''} ${r.registroRelacionadoId || ''}`);
            // "0375" tambem acha "#375" e "375": compara tambem sem zeros a esquerda.
            const semZeros = documento.replace(/\b0+(\d)/g, '$1');
            if (!alvo.includes(documento) && !semAcento(alvo.replace(/\b0+(\d)/g, '$1')).includes(semZeros))
                return false;
        }
        return true;
    });
};
exports.filtrarRegistros = filtrarRegistros;
/** Opcoes dos filtros (so' o que aparece no periodo), em ordem alfabetica. */
const opcoesDosFiltros = (registros) => {
    const telas = Array.from(new Set(registros.map(exports.telaDoRegistro).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const acoes = Array.from(new Set(registros.map((r) => texto(r.acao)).filter(Boolean)))
        .map((valor) => ({ valor, rotulo: (0, exports.rotuloDaAcao)(valor) }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
    return { telas, acoes };
};
exports.opcoesDosFiltros = opcoesDosFiltros;
/** Resumo do que mudou em uma linha ("Status: Em rota → Cancelado; KM: 10 → 12"). */
const resumoDasAlteracoes = (alteracoes, limite = 6) => {
    if (!Array.isArray(alteracoes) || alteracoes.length === 0)
        return '';
    const mostrar = (v) => {
        const t = (0, exports.valorParaHistorico)(v);
        if (t === null || t === '')
            return '(vazio)';
        if (typeof t === 'boolean')
            return t ? 'Sim' : 'Não';
        return String(t);
    };
    const partes = alteracoes.slice(0, limite).map((m) => `${m.campo}: ${mostrar(m.valorAnterior)} → ${mostrar(m.valorNovo)}`);
    const resto = alteracoes.length - limite;
    return partes.join('; ') + (resto > 0 ? `; e mais ${resto} campo(s)` : '');
};
exports.resumoDasAlteracoes = resumoDasAlteracoes;
/**
 * Registro sem o nome da filial (o servidor grava so' o id, sem ler mais nada)
 * ganha o nome na hora de mostrar, pelas filiais do grupo: "10 · LOJA CENTRO".
 */
const comNomeDaFilial = (registros, filiais) => {
    if (!filiais || filiais.length === 0)
        return registros;
    const porId = new Map(filiais.map((f) => [f.tenantId, [texto(f.codigo), texto(f.nome)].filter(Boolean).join(' · ')]));
    return registros.map((r) => (r.filialNome || !r.filialId || !porId.get(r.filialId) ? r : { ...r, filialNome: porId.get(r.filialId) || null }));
};
exports.comNomeDaFilial = comNomeDaFilial;
