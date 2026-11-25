"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mudancasDePermissoes = exports.mexidasSemTer = exports.permissoesParaGravarDoUsuario = exports.permissoesEfetivasDoUsuario = exports.permissoesParaGravar = exports.permissoesEfetivas = exports.pacotesGravados = exports.ehMarcadorInterno = exports.ehMarcadorDePacote = exports.MARCADORES_DOS_PACOTES = exports.marcadorDoPacote = exports.PREFIXO_MARCADOR_PACOTE = exports.PACOTES_DE_PERMISSOES = exports.PERMISSAO_OS = exports.PERMISSAO_CADASTROS = exports.PERMISSAO_PRODUCAO = exports.PERMISSAO_FILIAIS = exports.PERMISSAO_ESTOQUE = exports.PERMISSAO_CRM = exports.PERMISSAO_OPERACOES = exports.PERMISSAO_VENDAS = exports.PERMISSAO_COMPRAS = exports.PERMISSAO_FISCAL_ENTRADA = exports.PERMISSAO_FISCAL = exports.PERMISSAO_FINANCEIRO = void 0;
const permissoesAppDomain_1 = require("./permissoesAppDomain");
/**
 * PERMISSAO NOVA "JA' VEM MARCADA" (item 15 da Embala Minas, 25/11/2026).
 *
 * Decisao do dono: "toda funcao, sem excecao, com permissao no cadastro do
 * funcionario; o dono sempre pode; o resto so' com a permissao marcada". Para
 * isso, cada acao (dar baixa, baixa em lote, cancelar conta...) ganha uma
 * permissao propria. Quem ja' usa a tela nao pode perder nada no dia em que a
 * permissao nova aparece: ela JA' VEM MARCADA para quem tem a permissao da tela.
 *
 * Como, sem janela de quebra (sem rodar migracao antes do deploy):
 *
 * - Cada leva de permissoes novas e' um PACOTE. O pacote diz quais permissoes
 *   novas cada permissao de tela traz (`implicacoes`).
 * - Enquanto o cadastro do funcionario NAO tem o marcador do pacote
 *   (`pacote.<id>` dentro de `permissoes`), as permissoes novas valem pelo que
 *   ele ja' tinha: tem "Contas a Receber" -> tem "Contas a Receber -- dar
 *   baixa", e assim por diante.
 * - Ao SALVAR as permissoes dele (tela ou servidor), gravamos de verdade o que
 *   esta' marcado + o marcador de TODOS os pacotes conhecidos. Dai' em diante
 *   vale so' o que o dono marcou (desmarcou "dar baixa", fica sem).
 *
 * Por que o marcador mora DENTRO de `permissoes` (e nao num campo proprio): a
 * tela de Configuracoes > Permissao de Usuarios grava `permissoes` direto no
 * Firestore, e as rules so' deixam o administrador mexer nos campos da lista
 * `tenantUserEditableFields()`. Um campo novo seria recusado ate' alguem
 * publicar rules novas em dev e producao. Dentro de `permissoes`, igual ao
 * `app.definido` do app (permissoesAppDomain.ts), nada nas rules muda. O
 * catalogo nao lista os marcadores, entao eles nao aparecem na tela.
 *
 * O ADMINISTRADOR (Master/Admin) e a plataforma continuam liberados pelos
 * helpers de papel (temPermissao no servidor, hasTenantFullAccess na tela);
 * isto aqui so' decide o que o FUNCIONARIO tem.
 */
/** Permissoes novas do Financeiro, fase 1 (o que ja' grava pelo servidor). */
exports.PERMISSAO_FINANCEIRO = {
    receberBaixar: 'financeiro.receber_baixar',
    pagarBaixar: 'financeiro.pagar_baixar',
    baixaJurosMulta: 'financeiro.baixa_juros_multa',
    baixaDataAnterior: 'financeiro.baixa_data_anterior',
    baixaLote: 'financeiro.baixa_lote',
    receberLancar: 'financeiro.receber_lancar',
    receberEditar: 'financeiro.receber_editar',
    receberCancelar: 'financeiro.receber_cancelar',
    categorias: 'financeiro.categorias',
    acertoFornecedor: 'financeiro.acerto_fornecedor',
    // Fase 2 (25/11/2026): Contas a Pagar pelo servidor, credito do cliente e
    // acoes que nao gravam (recibo, WhatsApp, relatorios, importar).
    pagarLancar: 'financeiro.pagar_lancar',
    pagarEditar: 'financeiro.pagar_editar',
    pagarCancelar: 'financeiro.pagar_cancelar',
    baixaCreditoCliente: 'financeiro.baixa_credito_cliente',
    recibo: 'financeiro.recibo',
    cobrarWhatsapp: 'financeiro.cobrar_whatsapp',
    relatorios: 'financeiro.relatorios',
    importarTitulos: 'financeiro.importar_titulos',
};
/** Fase 2 (25/11/2026): acoes das Notas Fiscais que ganham permissao propria. */
exports.PERMISSAO_FISCAL = {
    cartaCorrecao: 'fiscal.cce',
    inutilizar: 'fiscal.inutilizar',
    devolucao: 'fiscal.devolucao',
    emitirLote: 'fiscal.emitir_lote',
};
/** Fase Estoque e cadastros (25/11/2026): excluir nota de entrada (reverte estoque e titulos). */
exports.PERMISSAO_FISCAL_ENTRADA = {
    excluir: 'fiscal.entrada_excluir',
};
/** Fase 2 (25/11/2026): gerar pedido de compra da cotacao (antes bastava a da cotacao). */
exports.PERMISSAO_COMPRAS = {
    gerarPedido: 'compras.gerar_pedido',
};
/**
 * Vendas (item 15, fase Vendas, 25/11/2026): cada acao do Pedido de Venda,
 * Orcamentos, Condicional, Trocas e Promocoes/Cashback ganha permissao propria.
 * Falta de permissao para mexer num valor que protege a empresa = o valor fica
 * no PADRAO, travado e conferido no servidor (preco do cadastro, data de hoje,
 * vendedor identificado/logado, desconto so' o do cadastro do cliente).
 */
exports.PERMISSAO_VENDAS = {
    finalizar: 'vendas.finalizar',
    alterarData: 'vendas.alterar_data',
    alterarVendedor: 'vendas.alterar_vendedor',
    alterarPreco: 'vendas.alterar_preco',
    desconto: 'vendas.desconto',
    cancelar: 'vendas.cancelar',
    alterarTransporte: 'vendas.alterar_transporte',
    alterarNotaFiscal: 'vendas.alterar_nota_fiscal',
    devolucaoEstornar: 'vendas.devolucao_estornar',
    pendenteRecusar: 'vendas.pedidos_pendentes_recusar',
    imprimir: 'vendas.imprimir',
    documentosCobranca: 'vendas.documentos_cobranca',
    preVendaRelatorioValores: 'vendas.pre_venda_relatorio_valores',
    importar: 'vendas.importar',
    orcamentosRecusar: 'vendas.orcamentos_recusar',
    orcamentosConverter: 'vendas.orcamentos_converter',
    orcamentosPreco: 'vendas.orcamentos_preco',
    orcamentosEnviar: 'vendas.orcamentos_enviar',
    condicionalSaida: 'vendas.condicional_saida',
    condicionalDevolucao: 'vendas.condicional_devolucao',
    condicionalFechar: 'vendas.condicional_fechar',
    condicionalCancelar: 'vendas.condicional_cancelar',
    trocaAprovar: 'vendas.troca_aprovar',
    trocaEntregar: 'vendas.troca_entregar',
    trocaCancelar: 'vendas.troca_cancelar',
    promocoesEncerrar: 'vendas.promocoes_encerrar',
    cashbackRelatorio: 'vendas.cashback_relatorio',
    /** Ja' existia no catalogo, sem ninguem conferir; passa a valer na senha do vendedor. */
    gerenciarPinVendedor: 'vendas.gerenciar_pin_vendedor',
};
/** Expedicao, entregas futuras e rotas (fase Vendas, 25/11/2026). */
exports.PERMISSAO_OPERACOES = {
    expedicaoDivergencia: 'operacoes.expedicao_divergencia',
    entregasFuturasRegistrar: 'operacoes.entregas_futuras_registrar',
    rotasDespesas: 'operacoes.rotas_despesas',
    rotasConfigurar: 'operacoes.rotas_configurar',
    motoristas: 'operacoes.motoristas',
    frota: 'operacoes.frota',
    rotasRelatorio: 'operacoes.rotas_relatorio',
};
/** CRM (fase Vendas, 25/11/2026). */
exports.PERMISSAO_CRM = {
    agendaCancelar: 'crm.agenda_cancelar',
    alertasCancelar: 'crm.alertas_cancelar',
};
/**
 * Estoque (item 15, fase Estoque e cadastros, 25/11/2026). Preco e custo:
 * quem INCLUI o produto define os de partida; mudar os de um produto ja'
 * gravado pede a permissao propria (sem ela, ficam os gravados, travados).
 * Estoque inicial: sem a permissao, o produto entra com saldo zero.
 */
exports.PERMISSAO_ESTOQUE = {
    produtoIncluir: 'estoque.produto_incluir',
    estoqueInicial: 'estoque.estoque_inicial',
    alterarPreco: 'estoque.alterar_preco',
    alterarCusto: 'estoque.alterar_custo',
    verCusto: 'estoque.ver_custo',
    produtoInativar: 'estoque.produto_inativar',
    produtoExcluir: 'estoque.produto_excluir',
    padronizarNomes: 'estoque.padronizar_nomes',
    importar: 'estoque.importar',
    configurarLista: 'estoque.configurar_lista',
    /** Ja' existia (03/11/2026); o nivel gerente passa a trazer pelo pacote, nao mais liberar direto. */
    produtoAvancado: 'estoque.produto_avancado',
    composicao: 'estoque.composicao',
    comissaoDesconto: 'estoque.comissao_desconto',
    balancoFechar: 'estoque.balanco_fechar',
    balancoCancelar: 'estoque.balanco_cancelar',
    etiquetasModelo: 'estoque.etiquetas_modelo',
    notaAvulsaCancelar: 'estoque.nota_avulsa_cancelar',
    notaAvulsaPagamento: 'estoque.nota_avulsa_pagamento',
};
/** Transferencias entre filiais (fase Estoque e cadastros, 25/11/2026). */
exports.PERMISSAO_FILIAIS = {
    transferirSemNota: 'filiais.transferir_sem_nota',
    transferenciaReceber: 'filiais.transferencia_receber',
    transferenciaCancelar: 'filiais.transferencia_cancelar',
};
/** Ordens de producao (fase Estoque e cadastros, 25/11/2026). */
exports.PERMISSAO_PRODUCAO = {
    finalizar: 'operacoes.producao_finalizar',
    estornar: 'operacoes.producao_estornar',
    cancelar: 'operacoes.producao_cancelar',
};
/** Cadastros: o par alterar/inativar de cada um, importar, e um relatorio unico (25/11/2026). */
exports.PERMISSAO_CADASTROS = {
    relatorios: 'cadastros.relatorios',
    clientesAlterar: 'cadastros.clientes_alterar',
    clientesInativar: 'cadastros.clientes_inativar',
    clientesImportar: 'cadastros.clientes_importar',
    clientesLimiteCredito: 'cadastros.clientes_limite_credito',
    fornecedoresAlterar: 'cadastros.fornecedores_alterar',
    fornecedoresInativar: 'cadastros.fornecedores_inativar',
    fornecedoresImportar: 'cadastros.fornecedores_importar',
    servicosAlterar: 'cadastros.servicos_alterar',
    servicosInativar: 'cadastros.servicos_inativar',
    servicosPreco: 'cadastros.servicos_preco',
    servicosComissao: 'cadastros.servicos_comissao',
    categoriasAlterar: 'cadastros.categorias_alterar',
    categoriasInativar: 'cadastros.categorias_inativar',
    categoriasImportar: 'cadastros.categorias_importar',
    marcasAlterar: 'cadastros.marcas_alterar',
    marcasInativar: 'cadastros.marcas_inativar',
    unidadesMedidaAlterar: 'cadastros.unidades_medida_alterar',
    unidadesMedidaInativar: 'cadastros.unidades_medida_inativar',
    gradesAlterar: 'cadastros.grades_alterar',
    gradesInativar: 'cadastros.grades_inativar',
    veiculosAlterar: 'cadastros.veiculos_alterar',
    veiculosInativar: 'cadastros.veiculos_inativar',
    materiaPrimaInativar: 'cadastros.materia_prima_inativar',
    materiaPrimaCusto: 'cadastros.materia_prima_custo',
    materiaPrimaImportar: 'cadastros.materia_prima_importar',
};
/** Ordem de Servico (fase Estoque e cadastros, 25/11/2026). */
exports.PERMISSAO_OS = {
    finalizar: 'mecanica.os_finalizar',
    reabrir: 'mecanica.os_reabrir',
    cancelar: 'mecanica.os_cancelar',
    alterarPreco: 'mecanica.os_alterar_preco',
    responsavel: 'mecanica.os_responsavel',
    fotos: 'mecanica.os_fotos',
};
const F = exports.PERMISSAO_FINANCEIRO;
const FI = exports.PERMISSAO_FISCAL;
const V = exports.PERMISSAO_VENDAS;
const O = exports.PERMISSAO_OPERACOES;
const E = exports.PERMISSAO_ESTOQUE;
const FL = exports.PERMISSAO_FILIAIS;
const P = exports.PERMISSAO_PRODUCAO;
const C = exports.PERMISSAO_CADASTROS;
const OS = exports.PERMISSAO_OS;
/**
 * Pacotes conhecidos, na ordem em que sairam. Pacote novo entra NO FIM, com
 * id novo; nunca mexa nas implicacoes de um pacote ja' publicado (quem ja' foi
 * salvo com ele nao seria recalculado).
 */
exports.PACOTES_DE_PERMISSOES = [
    {
        id: 'financeiro-1',
        implicacoes: {
            'financeiro.receber': [
                F.receberBaixar,
                F.receberLancar,
                F.receberEditar,
                F.receberCancelar,
                F.baixaJurosMulta,
                F.baixaDataAnterior,
                F.baixaLote,
                F.categorias,
                F.acertoFornecedor,
            ],
            'financeiro.pagar': [
                F.pagarBaixar,
                F.baixaJurosMulta,
                F.baixaDataAnterior,
                F.baixaLote,
                F.categorias,
            ],
        },
    },
    {
        // Fase 2 (25/11/2026). Relatorios: todas as telas do Financeiro que tem
        // relatorio entram ja' agora (mesmo as que ainda nao conferem), para nao
        // precisar de pacote novo quando passarem a conferir.
        id: 'financeiro-2',
        implicacoes: {
            'financeiro.receber': [F.baixaCreditoCliente, F.recibo, F.cobrarWhatsapp, F.relatorios, F.importarTitulos],
            'financeiro.pagar': [F.pagarLancar, F.pagarEditar, F.pagarCancelar, F.relatorios, F.importarTitulos],
            'financeiro.caixa_registros': [F.relatorios],
            'financeiro.banco': [F.relatorios],
            'financeiro.cheques': [F.relatorios],
            'financeiro.faturamento': [F.relatorios],
            'financeiro.comissoes': [F.relatorios],
            'fiscal.emitir': [FI.cartaCorrecao, FI.inutilizar, FI.devolucao, FI.emitirLote],
            'compras.cotacoes': [exports.PERMISSAO_COMPRAS.gerarPedido],
        },
    },
    {
        // Fase Vendas (25/11/2026). Ficam FORA de proposito (hoje so' o
        // administrador faz; quem precisar, o dono marca): valores do relatorio
        // de pre-vendas, importar pedidos e configurar tipos de despesa da rota.
        // "Aprovar desconto acima do limite" (vendas.liberar_desconto) tambem nao
        // vem com nada: no modo "avisar" ela passou a ser exigida.
        id: 'vendas-1',
        implicacoes: {
            'vendas.pedidos': [V.finalizar, V.alterarData, V.alterarVendedor, V.alterarPreco, V.desconto, V.imprimir, V.documentosCobranca],
            'vendas.alterar': [V.cancelar, V.alterarTransporte, V.alterarNotaFiscal],
            'vendas.devolucao': [V.devolucaoEstornar],
            'vendas.pedidos_pendentes_editar': [V.pendenteRecusar],
            'vendas.orcamentos': [V.orcamentosConverter, V.orcamentosPreco, V.orcamentosEnviar],
            'vendas.orcamentos_excluir': [V.orcamentosRecusar],
            'vendas.condicional': [V.condicionalSaida, V.condicionalDevolucao, V.condicionalFechar, V.condicionalCancelar],
            'vendas.troca_gerenciar': [V.trocaAprovar, V.trocaEntregar, V.trocaCancelar],
            'vendas.promocoes': [V.promocoesEncerrar],
            'vendas.cashback': [V.cashbackRelatorio],
            // A senha do vendedor era conferida por "Cadastros: Vendedores — incluir".
            'cadastros.vendedores_incluir': [V.gerenciarPinVendedor],
            'operacoes.expedicao': [O.expedicaoDivergencia],
            'operacoes.entregas_futuras': [O.entregasFuturasRegistrar],
            'operacoes.rotas': [O.rotasDespesas, O.motoristas, O.frota, O.rotasRelatorio],
            'crm.agenda': [exports.PERMISSAO_CRM.agendaCancelar],
            'crm.alertas': [exports.PERMISSAO_CRM.alertasCancelar],
        },
    },
    {
        // Fase Estoque e cadastros (25/11/2026). Fica FORA de proposito (hoje so'
        // o administrador faz; quem precisar, o dono marca): trocar o tecnico da
        // OS. Colunas da lista e modelo de etiqueta vem com "Admin: Configuracoes",
        // que era o que liberava. O nivel gerente traz o Modo Avancado e a
        // transferencia sem nota, que ele liberava sozinho.
        id: 'estoque-1',
        implicacoes: {
            'cadastros.estoque_alterar': [
                E.produtoIncluir, E.estoqueInicial, E.alterarPreco, E.alterarCusto, E.verCusto,
                E.produtoInativar, E.produtoExcluir, E.padronizarNomes, E.importar,
            ],
            'estoque.produto_avancado': [E.composicao, E.comissaoDesconto],
            'estoque.precificacao': [E.verCusto],
            'estoque.relatorio': [E.verCusto],
            'estoque.balanco_gerenciar': [E.balancoFechar, E.balancoCancelar],
            'estoque.nota_avulsa': [E.notaAvulsaCancelar, E.notaAvulsaPagamento],
            'administrativo.config': [E.configurarLista, E.etiquetasModelo],
            'fiscal.entrada': [E.alterarPreco, exports.PERMISSAO_FISCAL_ENTRADA.excluir, C.fornecedoresAlterar],
            'filiais.utilizar': [FL.transferenciaReceber, FL.transferenciaCancelar],
            'operacoes.producao': [P.finalizar, P.estornar, P.cancelar],
            'cadastros.materia_prima': [C.materiaPrimaInativar, C.materiaPrimaCusto, C.materiaPrimaImportar, E.estoqueInicial, E.alterarCusto],
            'cadastros.grades': [C.gradesAlterar, C.gradesInativar],
            'cadastros.unidades_medida': [C.unidadesMedidaAlterar, C.unidadesMedidaInativar],
            'cadastros.categorias': [C.categoriasAlterar, C.categoriasInativar, C.categoriasImportar],
            'cadastros.marcas': [C.marcasAlterar, C.marcasInativar],
            'cadastros.servicos': [C.servicosAlterar, C.servicosInativar, C.servicosPreco, C.servicosComissao, C.relatorios],
            'cadastros.clientes': [C.clientesAlterar, C.clientesInativar, C.clientesImportar, C.clientesLimiteCredito, C.relatorios],
            'cadastros.fornecedores': [C.fornecedoresAlterar, C.fornecedoresInativar, C.fornecedoresImportar, C.relatorios],
            'cadastros.veiculos': [C.veiculosAlterar, C.veiculosInativar, C.relatorios],
            'mecanica.os': [OS.finalizar, OS.reabrir, OS.cancelar, OS.alterarPreco, OS.fotos],
            'mecanica.os_app': [OS.fotos],
        },
        implicacoesDoNivel: {
            gerente: [E.produtoAvancado, E.composicao, E.comissaoDesconto, FL.transferirSemNota],
        },
    },
];
exports.PREFIXO_MARCADOR_PACOTE = 'pacote.';
/** O que fica gravado em `permissoes` quando o pacote ja' foi salvo para a pessoa. */
const marcadorDoPacote = (id) => `${exports.PREFIXO_MARCADOR_PACOTE}${id}`;
exports.marcadorDoPacote = marcadorDoPacote;
exports.MARCADORES_DOS_PACOTES = exports.PACOTES_DE_PERMISSOES.map((p) => (0, exports.marcadorDoPacote)(p.id));
const lista = (permissoes) => (Array.isArray(permissoes) ? permissoes.filter((p) => typeof p === 'string') : []);
const ehMarcadorDePacote = (permissao) => (typeof permissao === 'string' && permissao.startsWith(exports.PREFIXO_MARCADOR_PACOTE));
exports.ehMarcadorDePacote = ehMarcadorDePacote;
/** Marcador interno (app ou pacote): nao e' permissao que o dono veja nem que entre no historico. */
const ehMarcadorInterno = (permissao) => (permissao === permissoesAppDomain_1.MARCADOR_APP_DEFINIDO || (0, exports.ehMarcadorDePacote)(permissao));
exports.ehMarcadorInterno = ehMarcadorInterno;
/** Ids dos pacotes ja' gravados no cadastro (o que o dono marcou vale sozinho). */
const pacotesGravados = (permissoes) => {
    const gravadas = new Set(lista(permissoes));
    return exports.PACOTES_DE_PERMISSOES.filter((p) => gravadas.has((0, exports.marcadorDoPacote)(p.id))).map((p) => p.id);
};
exports.pacotesGravados = pacotesGravados;
/**
 * Nivel de acesso como o pacote conhece. 'administracao' e' o nome antigo do
 * gerente (mesma regra de parseNivelAcesso, visibilidadeVendasDomain.ts).
 */
const nivelDoPacote = (nivelAcesso) => (nivelAcesso === 'administracao' ? 'gerente' : (typeof nivelAcesso === 'string' ? nivelAcesso : ''));
/**
 * Permissoes que valem de verdade: as gravadas + (para cada pacote que a
 * pessoa ainda NAO tem gravado) as novas que vem com as permissoes de tela
 * dela e com o nivel de acesso dela. O resultado SEMPRE leva os marcadores de
 * todos os pacotes, para aplicar de novo nao mudar nada (o AuthContext ja'
 * entrega as efetivas e as telas podem aplicar outra vez -- mesma licao do app).
 */
const permissoesEfetivas = (permissoes, nivelAcesso) => {
    const gravadas = lista(permissoes);
    const temGravada = new Set(gravadas);
    const resultado = new Set(gravadas);
    const nivel = nivelDoPacote(nivelAcesso);
    for (const pacote of exports.PACOTES_DE_PERMISSOES) {
        if (temGravada.has((0, exports.marcadorDoPacote)(pacote.id)))
            continue;
        for (const [daTela, novas] of Object.entries(pacote.implicacoes)) {
            if (temGravada.has(daTela))
                novas.forEach((p) => resultado.add(p));
        }
        const doNivel = nivel && pacote.implicacoesDoNivel ? pacote.implicacoesDoNivel[nivel] : undefined;
        if (doNivel)
            doNivel.forEach((p) => resultado.add(p));
    }
    exports.MARCADORES_DOS_PACOTES.forEach((m) => resultado.add(m));
    return [...resultado];
};
exports.permissoesEfetivas = permissoesEfetivas;
/** O que gravar: o que a tela marcou + o marcador de todos os pacotes (dai' em diante nada e' implicito). */
const permissoesParaGravar = (marcadas) => ([...new Set([...lista(marcadas).filter((p) => !(0, exports.ehMarcadorDePacote)(p)), ...exports.MARCADORES_DOS_PACOTES])]);
exports.permissoesParaGravar = permissoesParaGravar;
// ---------------------------------------------------------------------------
// Tudo junto (app + pacotes): o que as telas e o servidor usam no cadastro.
// ---------------------------------------------------------------------------
/**
 * Efetivas do usuario: chaves do app (permissoesAppDomain) + pacotes. Idempotente.
 * `nivelAcesso` (do cadastro): o que o nivel traz enquanto o pacote nao foi salvo.
 */
const permissoesEfetivasDoUsuario = (permissoes, nivelAcesso) => ((0, exports.permissoesEfetivas)((0, permissoesAppDomain_1.permissoesEfetivas)(permissoes), nivelAcesso));
exports.permissoesEfetivasDoUsuario = permissoesEfetivasDoUsuario;
/** O que gravar no cadastro: marcadas + marcador do app + marcadores dos pacotes. */
const permissoesParaGravarDoUsuario = (marcadas) => ((0, exports.permissoesParaGravar)((0, permissoesAppDomain_1.permissoesParaGravar)(marcadas)));
exports.permissoesParaGravarDoUsuario = permissoesParaGravarDoUsuario;
/**
 * Gerente so' da' e tira o que ELE MESMO tem (decisao de 19/10/2026), contando
 * as permissoes implicitas dos dois lados (app e pacotes). `depois` e' o que a
 * tela mandou gravar: conta como gravado (com os marcadores), entao desmarcar
 * uma permissao nova aparece como "tirou". Devolve as que ele mexeu sem ter.
 */
const mexidasSemTer = (args) => {
    const antes = new Set((0, exports.permissoesEfetivasDoUsuario)(args.antes, args.nivelAntes));
    const depois = new Set((0, exports.permissoesEfetivasDoUsuario)((0, exports.permissoesParaGravarDoUsuario)(args.depois)));
    const dele = new Set((0, exports.permissoesEfetivasDoUsuario)(args.doGerente, args.nivelDoGerente));
    const mexidas = [...depois].filter((p) => !antes.has(p)).concat([...antes].filter((p) => !depois.has(p)));
    return mexidas.filter((p) => !dele.has(p) && !(0, exports.ehMarcadorInterno)(p));
};
exports.mexidasSemTer = mexidasSemTer;
/** Permissoes que entraram e sairam (efetivas, sem marcadores), para o historico de alteracoes. */
const mudancasDePermissoes = (antes, depois, nivelAntes) => {
    const semMarcador = (l, nivel) => new Set((0, exports.permissoesEfetivasDoUsuario)(l, nivel).filter((p) => !(0, exports.ehMarcadorInterno)(p)));
    const a = semMarcador(antes, nivelAntes);
    const d = semMarcador(depois);
    return {
        entraram: [...d].filter((p) => !a.has(p)),
        sairam: [...a].filter((p) => !d.has(p)),
    };
};
exports.mudancasDePermissoes = mudancasDePermissoes;
