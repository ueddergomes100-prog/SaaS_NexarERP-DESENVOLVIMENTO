import {
  MARCADOR_APP_DEFINIDO,
  PERMISSAO_APP_COBRAR_WHATSAPP,
  PERMISSAO_APP_COMPRAS_CLIENTE,
  PERMISSAO_APP_DEBITO_CLIENTE,
  permissoesEfetivas as permissoesEfetivasDoApp,
  permissoesParaGravar as permissoesParaGravarDoApp,
} from './permissoesAppDomain';
import { PERMISSION_CATALOG } from './permissionCatalog';
import {
  MARCADOR_ADMINISTRADOR,
  PERMISSOES_QUE_RESTRINGEM,
  administradorComTodas,
  ehPapelDeAdministrador,
} from './papelAdministradorDomain';

export {
  MARCADOR_ADMINISTRADOR,
  PACOTE_ADMINISTRADOR,
  PAPEIS_DE_ADMINISTRADOR,
  PERMISSOES_QUE_RESTRINGEM,
  administradorComTodas,
  administradorTemSemPacote,
  ehPapelDeAdministrador,
} from './papelAdministradorDomain';

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
 * O DONO (uid igual ao da empresa) e a plataforma continuam liberados pelos
 * helpers de papel (temPermissao no servidor, hasTenantFullAccess na tela).
 *
 * O ADMINISTRADOR (papel Master/Admin que NAO e' o dono) deixou de ser
 * liberado pelo papel (troca do administrador, 25/11/2026: "o dono sempre
 * pode; o resto so' com a permissao marcada"). Ele passa pelas efetivas como
 * um funcionario, com o pacote 'administrador-1': enquanto o cadastro dele
 * NAO tem o marcador `pacote.administrador-1`, as efetivas sao TODAS as
 * permissoes do catalogo (menos as que restringem, PERMISSOES_QUE_RESTRINGEM).
 * Quando o dono salva as permissoes dele, grava o marcado + todos os
 * marcadores, e dai' em diante vale so' o marcado. As efetivas recebem o
 * papel em `opcoes.papel` (como ja' recebem o nivel).
 */

/** Permissoes novas do Financeiro, fase 1 (o que ja' grava pelo servidor). */
export const PERMISSAO_FINANCEIRO = {
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
  // 26/11/2026: ver os creditos dos clientes (e o que o fornecedor deve) e de onde vem cada um.
  creditosVer: 'financeiro.creditos_ver',
  // 28/11/2026: em Cheques, usar o cheque do cliente para pagar uma conta a pagar de fornecedor.
  chequePagarConta: 'financeiro.cheque_pagar_conta',
} as const;

/** Fase 2 (25/11/2026): acoes das Notas Fiscais que ganham permissao propria. */
export const PERMISSAO_FISCAL = {
  cartaCorrecao: 'fiscal.cce',
  inutilizar: 'fiscal.inutilizar',
  devolucao: 'fiscal.devolucao',
  emitirLote: 'fiscal.emitir_lote',
} as const;

/** Fase Estoque e cadastros (25/11/2026): excluir nota de entrada (reverte estoque e titulos). */
export const PERMISSAO_FISCAL_ENTRADA = {
  excluir: 'fiscal.entrada_excluir',
} as const;

/** Fase 2 (25/11/2026): gerar pedido de compra da cotacao (antes bastava a da cotacao). */
export const PERMISSAO_COMPRAS = {
  gerarPedido: 'compras.gerar_pedido',
} as const;

/**
 * Vendas (item 15, fase Vendas, 25/11/2026): cada acao do Pedido de Venda,
 * Orcamentos, Condicional, Trocas e Promocoes/Cashback ganha permissao propria.
 * Falta de permissao para mexer num valor que protege a empresa = o valor fica
 * no PADRAO, travado e conferido no servidor (preco do cadastro, data de hoje,
 * vendedor identificado/logado, desconto so' o do cadastro do cliente).
 */
export const PERMISSAO_VENDAS = {
  finalizar: 'vendas.finalizar',
  alterarData: 'vendas.alterar_data',
  alterarVendedor: 'vendas.alterar_vendedor',
  alterarPreco: 'vendas.alterar_preco',
  /**
   * Preco abaixo da tabela fica como PRECO, sem virar desconto e sem contar no
   * limite de desconto (26/11/2026, decisao do dono). Nao entra em pacote:
   * nasce desmarcada para todos; o dono sempre pode.
   */
  precoSemDesconto: 'vendas.preco_sem_desconto',
  desconto: 'vendas.desconto',
  cancelar: 'vendas.cancelar',
  alterarTransporte: 'vendas.alterar_transporte',
  alterarNotaFiscal: 'vendas.alterar_nota_fiscal',
  /** Observacao de venda concluida (27/11/2026); vem com 'Alterar Pedidos' (pacote 'vendas-2'). */
  alterarObservacao: 'vendas.alterar_observacao',
  devolucaoEstornar: 'vendas.devolucao_estornar',
  pendenteRecusar: 'vendas.pedidos_pendentes_recusar',
  imprimir: 'vendas.imprimir',
  documentosCobranca: 'vendas.documentos_cobranca',
  preVendaRelatorioValores: 'vendas.pre_venda_relatorio_valores',
  /** Relatorio parcial do caixa aberto na Frente de Caixa (26/11/2026); vem com o PDV (pacote 'pdv-1'). */
  pdvRelatorioCaixa: 'vendas.pdv_relatorio_caixa',
  /** Receber notinha (Contas a Receber) no caixa (28/11/2026). Nasce desmarcada: o dono marca. */
  pdvReceberContas: 'vendas.pdv_receber_contas',
  /** Suprimento na Frente de Caixa (27/11/2026); vem com o PDV (pacote 'pdv-2'). */
  pdvSuprimento: 'vendas.pdv_suprimento',
  /** Reabrir o caixa fechado hoje (27/11/2026); vem com o PDV (pacote 'pdv-3'). */
  pdvReabrirCaixa: 'vendas.pdv_reabrir_caixa',
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
} as const;

/** Expedicao, entregas futuras e rotas (fase Vendas, 25/11/2026). */
export const PERMISSAO_OPERACOES = {
  expedicaoDivergencia: 'operacoes.expedicao_divergencia',
  entregasFuturasRegistrar: 'operacoes.entregas_futuras_registrar',
  rotasDespesas: 'operacoes.rotas_despesas',
  rotasConfigurar: 'operacoes.rotas_configurar',
  motoristas: 'operacoes.motoristas',
  frota: 'operacoes.frota',
  rotasRelatorio: 'operacoes.rotas_relatorio',
} as const;

/** CRM (fase Vendas, 25/11/2026). */
export const PERMISSAO_CRM = {
  agendaCancelar: 'crm.agenda_cancelar',
  alertasCancelar: 'crm.alertas_cancelar',
} as const;

/**
 * Estoque (item 15, fase Estoque e cadastros, 25/11/2026). Preco e custo:
 * quem INCLUI o produto define os de partida; mudar os de um produto ja'
 * gravado pede a permissao propria (sem ela, ficam os gravados, travados).
 * Estoque inicial: sem a permissao, o produto entra com saldo zero.
 */
export const PERMISSAO_ESTOQUE = {
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
} as const;

/** Transferencias entre filiais (fase Estoque e cadastros, 25/11/2026). */
export const PERMISSAO_FILIAIS = {
  transferirSemNota: 'filiais.transferir_sem_nota',
  transferenciaReceber: 'filiais.transferencia_receber',
  transferenciaCancelar: 'filiais.transferencia_cancelar',
} as const;

/** Ordens de producao (fase Estoque e cadastros, 25/11/2026). */
export const PERMISSAO_PRODUCAO = {
  finalizar: 'operacoes.producao_finalizar',
  estornar: 'operacoes.producao_estornar',
  cancelar: 'operacoes.producao_cancelar',
} as const;

/** Cadastros: o par alterar/inativar de cada um, importar, e um relatorio unico (25/11/2026). */
export const PERMISSAO_CADASTROS = {
  relatorios: 'cadastros.relatorios',
  clientesAlterar: 'cadastros.clientes_alterar',
  clientesInativar: 'cadastros.clientes_inativar',
  clientesImportar: 'cadastros.clientes_importar',
  clientesLimiteCredito: 'cadastros.clientes_limite_credito',
  /** Compras do cliente na ficha (27/11/2026); vem com a tela de Clientes (pacote 'clientes-1'). */
  clientesCompras: 'cadastros.clientes_compras',
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
} as const;

/** Ordem de Servico (fase Estoque e cadastros, 25/11/2026). */
export const PERMISSAO_OS = {
  finalizar: 'mecanica.os_finalizar',
  reabrir: 'mecanica.os_reabrir',
  cancelar: 'mecanica.os_cancelar',
  alterarPreco: 'mecanica.os_alterar_preco',
  responsavel: 'mecanica.os_responsavel',
  fotos: 'mecanica.os_fotos',
} as const;

/**
 * Administracao (item 15, fase Administracao, 25/11/2026): Configuracoes
 * Gerais e da filial (uma permissao por bloco sensivel), Equipe e Acessos,
 * historico, relatorios diversos, backup, trava de edicao. Hoje muita coisa
 * aqui e' "so' o dono/administrador" (papel) ou do NIVEL gerente: o que o
 * gerente ja' fazia vem marcado pelo nivel; o que so' o papel fazia nao vem
 * com nada (o dono marca para quem quiser).
 */
export const PERMISSAO_ADMINISTRACAO = {
  configGerais: 'administrativo.config_gerais',
  configFilial: 'administrativo.config_filial',
  dadosEmpresa: 'administrativo.dados_empresa',
  textosDocumentos: 'administrativo.textos_documentos',
  documentosImpressao: 'administrativo.documentos_impressao',
  numeracao: 'administrativo.numeracao',
  /** Ja' existia (tela Equipe e Acessos); o nivel gerente passa a trazer pelo pacote, nao mais abrir direto. */
  equipe: 'administrativo.equipe',
  equipeCriar: 'administrativo.equipe_criar',
  equipeEditar: 'administrativo.equipe_editar',
  equipeSenha: 'administrativo.equipe_senha',
  equipeInativar: 'administrativo.equipe_inativar',
  equipePermissoes: 'administrativo.equipe_permissoes',
  equipeNivel: 'administrativo.equipe_nivel',
  equipeApp: 'administrativo.equipe_app',
  equipeFilialPadrao: 'administrativo.equipe_filial_padrao',
  logsExportar: 'administrativo.logs_exportar',
  relatoriosFinanceiros: 'administrativo.relatorios_financeiros',
  relatoriosVendas: 'administrativo.relatorios_vendas',
  backupGerar: 'administrativo.backup_gerar',
  backupBaixar: 'administrativo.backup_baixar',
  liberarTrava: 'administrativo.liberar_trava',
} as const;

/** Blocos das Configuracoes que sao de outra area (fase Administracao, 25/11/2026). */
export const PERMISSAO_CONFIG_AREAS = {
  limitesDesconto: 'vendas.limites_desconto',
  parametrosVenda: 'vendas.parametros',
  recursosVenda: 'vendas.recursos',
  bonificacaoConfigurar: 'vendas.bonificacao_configurar',
  cashbackConfigurar: 'vendas.cashback_configurar',
  metas: 'vendas.metas',
  caixaComputadores: 'vendas.caixa_computadores',
  planoContas: 'financeiro.plano_contas',
  pixPedido: 'financeiro.pix_pedido',
  comissaoPadrao: 'financeiro.comissao_padrao',
  formasPagamento: 'financeiro.formas_pagamento',
  fiscalConfigurar: 'fiscal.configurar',
  fiscalNumeracao: 'fiscal.numeracao',
  crmConfigurar: 'crm.configurar',
} as const;

/** Filiais do grupo (fase Administracao, 25/11/2026): hoje so' o dono/administrador do grupo. */
export const PERMISSAO_FILIAIS_GESTAO = {
  gerenciar: 'filiais.gerenciar',
  cadastrar: 'filiais.cadastrar',
  alterar: 'filiais.alterar',
  resumo: 'filiais.resumo',
} as const;

/**
 * O que so' o papel de administrador fazia e ainda nao tinha permissao (troca
 * do administrador, 25/11/2026). Nao vem com nada para funcionario; o
 * administrador que o dono ainda nao salvou tem todas.
 */
export const PERMISSAO_TROCA_ADMINISTRADOR = {
  /** Liberar desconto e o aplicativo no cadastro de Vendedores (balcao). */
  vendedoresLiberadores: 'cadastros.vendedores_liberadores',
  /** Regras de comissao de cada usuario (Configuracoes > Permissao de Usuarios). */
  comissaoUsuario: 'administrativo.comissao_usuario',
  /** Ativar/desativar CFOP nas Tabelas Fiscais (vale para todas as filiais). */
  tabelasAtivar: 'fiscal.tabelas_ativar',
  /** App do motorista: ver as rotas de todos os motoristas. */
  entregasTodas: 'operacoes.entregas_app_todas',
} as const;

/**
 * Configuracoes Gerais (gravadas pelo servidor em todas as filiais): a
 * permissao que cada campo pede. O que nao esta' aqui pede
 * "Admin: Configuracoes gerais".
 */
export const PERMISSAO_DO_CAMPO_GERAL: Readonly<Record<string, string>> = {
  planoContasReceitas: PERMISSAO_CONFIG_AREAS.planoContas,
  planoContasDespesas: PERMISSAO_CONFIG_AREAS.planoContas,
  planoContasSoInforma: PERMISSAO_CONFIG_AREAS.planoContas,
  cashback: PERMISSAO_CONFIG_AREAS.cashbackConfigurar,
};

export const permissaoDoCampoGeral = (campo: string): string => (
  PERMISSAO_DO_CAMPO_GERAL[campo] || PERMISSAO_ADMINISTRACAO.configGerais
);

export interface PacoteDePermissoes {
  /** Nunca muda depois de publicado: e' o que fica gravado no cadastro. */
  id: string;
  /** Permissao de tela -> permissoes novas que ela traz para quem ainda nao tem o pacote. */
  implicacoes: Readonly<Record<string, readonly string[]>>;
  /**
   * Nivel de acesso (`nivelAcesso` do cadastro) -> permissoes que ele traz
   * para quem ainda nao tem o pacote. Existe para o nivel "gerente" deixar de
   * liberar coisas sozinho (Modo Avancado do produto, transferencia sem nota)
   * sem que o gerente de hoje perca nada: vira permissao marcada.
   */
  implicacoesDoNivel?: Readonly<Record<string, readonly string[]>>;
  /**
   * Nivel + permissao de tela -> permissoes novas (as duas juntas). Existe
   * para o que hoje so' o gerente COM a tela fazia (criar login, trocar senha
   * e inativar na Equipe e Acessos): nem o nivel sozinho, nem a tela sozinha.
   */
  implicacoesDoNivelComTela?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /**
   * So' para empresa SEM filiais (`semFiliais` nas opcoes): o que a permissao de
   * tela deixava fazer so' quando a empresa nao tinha filiais (Configuracoes
   * Gerais: com filiais, so' o dono/administrador do grupo -- decisao de 15/10/2026).
   */
  implicacoesSemFiliais?: Readonly<Record<string, readonly string[]>>;
}

/** Contexto da empresa e da pessoa para as permissoes implicitas. */
export interface OpcoesDasEfetivas {
  /** true = empresa sem grupo de filiais (vale `implicacoesSemFiliais`). */
  semFiliais?: boolean;
  /**
   * Papel do cadastro (`role`). Master/Admin sem o marcador do pacote
   * 'administrador-1' tem todas as permissoes do catalogo (troca do
   * administrador, 25/11/2026). Sem o papel, conta como funcionario.
   */
  papel?: unknown;
}

const F = PERMISSAO_FINANCEIRO;
const FI = PERMISSAO_FISCAL;
const V = PERMISSAO_VENDAS;
const O = PERMISSAO_OPERACOES;
const E = PERMISSAO_ESTOQUE;
const FL = PERMISSAO_FILIAIS;
const P = PERMISSAO_PRODUCAO;
const C = PERMISSAO_CADASTROS;
const OS = PERMISSAO_OS;
const A = PERMISSAO_ADMINISTRACAO;
const CA = PERMISSAO_CONFIG_AREAS;

/**
 * Pacotes conhecidos, na ordem em que sairam. Pacote novo entra NO FIM, com
 * id novo; nunca mexa nas implicacoes de um pacote ja' publicado (quem ja' foi
 * salvo com ele nao seria recalculado).
 */
export const PACOTES_DE_PERMISSOES: readonly PacoteDePermissoes[] = [
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
      'compras.cotacoes': [PERMISSAO_COMPRAS.gerarPedido],
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
      'crm.agenda': [PERMISSAO_CRM.agendaCancelar],
      'crm.alertas': [PERMISSAO_CRM.alertasCancelar],
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
      'fiscal.entrada': [E.alterarPreco, PERMISSAO_FISCAL_ENTRADA.excluir, C.fornecedoresAlterar],
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
  {
    // Fase Administracao (25/11/2026). "Admin: Configuracoes" traz o que ela
    // ja' deixava fazer pela tela: a meta dos vendedores e, so' em empresa SEM
    // filiais, as Configuracoes Gerais (plano de contas e cashback juntos) --
    // com filiais, so' o dono/administrador do grupo salvava. As
    // Configuracoes da FILIAL nao vem com nada: a tela era so' do dono e do
    // administrador (as rules aceitavam a permissao, a tela nao). O nivel
    // gerente vira permissao marcada: abrir Equipe e Acessos, liberar e retirar
    // permissoes (ele fazia pelas Configuracoes, direto no banco) e liberar
    // documento aberto por outra pessoa; com a Equipe marcada, tambem criar
    // login, alterar a ficha, trocar a senha e inativar. Ficam FORA (so' o
    // administrador hoje): nivel de acesso, aplicativo, filial padrao, backup,
    // computadores do caixa, numeracao, filiais e cada bloco da filial.
    id: 'administracao-1',
    implicacoes: {
      'administrativo.config': [CA.metas],
      'administrativo.logs': [A.logsExportar],
      'administrativo.relatorios': [A.relatoriosFinanceiros, A.relatoriosVendas],
    },
    implicacoesDoNivel: {
      gerente: [A.equipe, A.equipePermissoes, A.liberarTrava],
    },
    implicacoesDoNivelComTela: {
      gerente: { [A.equipe]: [A.equipeCriar, A.equipeEditar, A.equipeSenha, A.equipeInativar] },
    },
    implicacoesSemFiliais: {
      'administrativo.config': [A.configGerais, CA.planoContas, CA.cashbackConfigurar],
    },
  },
  {
    // 26/11/2026 (pedido do dono): ver os creditos e de onde vem cada um. Quem ja'
    // usa o Contas a Receber ou o Contas a Pagar continua vendo.
    id: 'financeiro-3',
    implicacoes: {
      'financeiro.receber': [F.creditosVer],
      'financeiro.pagar': [F.creditosVer],
    },
  },
  {
    // 26/11/2026 (pedido do dono): relatorio parcial do caixa aberto. Quem ja'
    // opera a Frente de Caixa continua podendo tirar.
    id: 'pdv-1',
    implicacoes: {
      'vendas.pdv': [V.pdvRelatorioCaixa],
      'vendas.so_caixa': [V.pdvRelatorioCaixa],
    },
  },
  {
    // 27/11/2026: ver o debito do cliente no app. Quem consulta cliente no app
    // continua vendo (a chave do app ja' conta as implicitas de quem nunca salvou).
    id: 'app-1',
    implicacoes: {
      'app.clientes': [PERMISSAO_APP_DEBITO_CLIENTE],
    },
  },
  {
    // 27/11/2026 (pedido do dono): compras do cliente na ficha e na consulta do
    // app. Quem ja' abre Clientes (ou consulta cliente no app) continua vendo.
    id: 'clientes-1',
    implicacoes: {
      'cadastros.clientes': [PERMISSAO_CADASTROS.clientesCompras],
      'app.clientes': [PERMISSAO_APP_COMPRAS_CLIENTE],
    },
  },
  {
    // 27/11/2026 (pedido do dono): alterar a observacao da venda concluida. Quem ja'
    // altera pedidos continua podendo.
    id: 'vendas-2',
    implicacoes: {
      'vendas.alterar': [PERMISSAO_VENDAS.alterarObservacao],
    },
  },
  {
    // 27/11/2026 (pedido do dono): suprimento na Frente de Caixa. Quem opera o caixa continua podendo.
    id: 'pdv-2',
    implicacoes: {
      'vendas.pdv': [PERMISSAO_VENDAS.pdvSuprimento],
      'vendas.so_caixa': [PERMISSAO_VENDAS.pdvSuprimento],
    },
  },
  {
    // 27/11/2026 (pedido do dono): reabrir o caixa fechado no mesmo dia. Quem opera o caixa continua podendo.
    id: 'pdv-3',
    implicacoes: {
      'vendas.pdv': [PERMISSAO_VENDAS.pdvReabrirCaixa],
      'vendas.so_caixa': [PERMISSAO_VENDAS.pdvReabrirCaixa],
    },
  },
  {
    // 28/11/2026 (pedido do dono): cobrar pelo WhatsApp no Contas a Receber do app.
    // Quem ja' ve o Contas a Receber no app continua com tudo da tela.
    id: 'app-2',
    implicacoes: {
      'app.contas_receber': [PERMISSAO_APP_COBRAR_WHATSAPP],
    },
  },
  {
    // 28/11/2026 (pedido do dono): ao compensar, pagar uma conta a pagar com o
    // cheque do cliente. Quem ja' compensa cheques continua podendo.
    id: 'financeiro-4',
    implicacoes: {
      'financeiro.cheques': [F.chequePagarConta],
    },
  },
];

export const PREFIXO_MARCADOR_PACOTE = 'pacote.';

// ---------------------------------------------------------------------------
// Pacote 'administrador-1' (troca do administrador, 25/11/2026) -- regra em
// papelAdministradorDomain.ts (sem dependencias, usada tambem por roles.ts).
// ---------------------------------------------------------------------------

/** Todas as permissoes do catalogo que o administrador tem enquanto o pacote dele nao foi salvo. */
export const PERMISSOES_DO_ADMINISTRADOR: readonly string[] = PERMISSION_CATALOG
  .map((item) => item.id)
  .filter((id) => !PERMISSOES_QUE_RESTRINGEM.includes(id));

/** O que fica gravado em `permissoes` quando o pacote ja' foi salvo para a pessoa. */
export const marcadorDoPacote = (id: string): string => `${PREFIXO_MARCADOR_PACOTE}${id}`;

export const MARCADORES_DOS_PACOTES: string[] = PACOTES_DE_PERMISSOES.map((p) => marcadorDoPacote(p.id));

const lista = (permissoes: unknown): string[] => (
  Array.isArray(permissoes) ? permissoes.filter((p): p is string => typeof p === 'string') : []
);

export const ehMarcadorDePacote = (permissao: unknown): boolean => (
  typeof permissao === 'string' && permissao.startsWith(PREFIXO_MARCADOR_PACOTE)
);

/** Marcador interno (app ou pacote): nao e' permissao que o dono veja nem que entre no historico. */
export const ehMarcadorInterno = (permissao: unknown): boolean => (
  permissao === MARCADOR_APP_DEFINIDO || ehMarcadorDePacote(permissao)
);

/** Ids dos pacotes ja' gravados no cadastro (o que o dono marcou vale sozinho). */
export const pacotesGravados = (permissoes: unknown): string[] => {
  const gravadas = new Set(lista(permissoes));
  return PACOTES_DE_PERMISSOES.filter((p) => gravadas.has(marcadorDoPacote(p.id))).map((p) => p.id);
};

/**
 * Nivel de acesso como o pacote conhece. 'administracao' e' o nome antigo do
 * gerente (mesma regra de parseNivelAcesso, visibilidadeVendasDomain.ts).
 */
const nivelDoPacote = (nivelAcesso: unknown): string => (
  nivelAcesso === 'administracao' ? 'gerente' : (typeof nivelAcesso === 'string' ? nivelAcesso : '')
);

/**
 * Permissoes que valem de verdade: as gravadas + (para cada pacote que a
 * pessoa ainda NAO tem gravado) as novas que vem com as permissoes de tela
 * dela e com o nivel de acesso dela. O resultado SEMPRE leva os marcadores de
 * todos os pacotes, para aplicar de novo nao mudar nada (o AuthContext ja'
 * entrega as efetivas e as telas podem aplicar outra vez -- mesma licao do app).
 */
export const permissoesEfetivas = (permissoes: unknown, nivelAcesso?: unknown, opcoes: OpcoesDasEfetivas = {}): string[] => {
  const gravadas = lista(permissoes);
  const temGravada = new Set(gravadas);
  const resultado = new Set(gravadas);
  // Administrador cujo pacote o dono ainda nao salvou: todas (ninguem perde acesso no deploy).
  // O resultado leva o marcador dele, para aplicar de novo nao mudar nada.
  if (administradorComTodas(gravadas, opcoes.papel)) {
    // A que restringe ("So' a Frente de Caixa") nao vale, nem se sobrou de quando ele era funcionario.
    PERMISSOES_QUE_RESTRINGEM.forEach((p) => resultado.delete(p));
    PERMISSOES_DO_ADMINISTRADOR.forEach((p) => resultado.add(p));
    MARCADORES_DOS_PACOTES.forEach((m) => resultado.add(m));
    resultado.add(MARCADOR_ADMINISTRADOR);
    return [...resultado];
  }
  const nivel = nivelDoPacote(nivelAcesso);
  for (const pacote of PACOTES_DE_PERMISSOES) {
    if (temGravada.has(marcadorDoPacote(pacote.id))) continue;
    for (const [daTela, novas] of Object.entries(pacote.implicacoes)) {
      if (temGravada.has(daTela)) novas.forEach((p) => resultado.add(p));
    }
    const doNivel = nivel && pacote.implicacoesDoNivel ? pacote.implicacoesDoNivel[nivel] : undefined;
    if (doNivel) doNivel.forEach((p) => resultado.add(p));
    // Nivel + tela: a tela conta so' se estiver GRAVADA (a que o nivel traz nao vale aqui).
    const doNivelComTela = nivel && pacote.implicacoesDoNivelComTela ? pacote.implicacoesDoNivelComTela[nivel] : undefined;
    if (doNivelComTela) {
      for (const [daTela, novas] of Object.entries(doNivelComTela)) {
        if (temGravada.has(daTela)) novas.forEach((p) => resultado.add(p));
      }
    }
    if (opcoes.semFiliais && pacote.implicacoesSemFiliais) {
      for (const [daTela, novas] of Object.entries(pacote.implicacoesSemFiliais)) {
        if (temGravada.has(daTela)) novas.forEach((p) => resultado.add(p));
      }
    }
  }
  MARCADORES_DOS_PACOTES.forEach((m) => resultado.add(m));
  return [...resultado];
};

/**
 * O que gravar: o que a tela marcou + o marcador de todos os pacotes (dai' em
 * diante nada e' implicito). `papel` do cadastro ALVO: administrador leva
 * tambem o marcador dele (dai' em diante vale so' o que o dono marcou).
 */
export const permissoesParaGravar = (marcadas: unknown, papel?: unknown): string[] => (
  [...new Set([
    ...lista(marcadas).filter((p) => !ehMarcadorDePacote(p)),
    ...MARCADORES_DOS_PACOTES,
    ...(ehPapelDeAdministrador(papel) ? [MARCADOR_ADMINISTRADOR] : []),
  ])]
);

/**
 * Nivel de acesso que vale (o que cada um ve de vendas). Administrador cujo
 * pacote o dono ainda nao salvou ve como gerente (via tudo pelo papel ate'
 * 25/11/2026); depois, o nivel que o dono escolheu ao salvar.
 */
export const nivelAcessoEfetivo = (nivelAcesso: unknown, papel?: unknown, permissoes?: unknown): 'funcionario' | 'supervisor' | 'gerente' => {
  if (administradorComTodas(permissoes, papel)) return 'gerente';
  if (nivelAcesso === 'administracao' || nivelAcesso === 'gerente') return 'gerente';
  return nivelAcesso === 'supervisor' ? 'supervisor' : 'funcionario';
};

// ---------------------------------------------------------------------------
// Tudo junto (app + pacotes): o que as telas e o servidor usam no cadastro.
// ---------------------------------------------------------------------------

/**
 * Efetivas do usuario: chaves do app (permissoesAppDomain) + pacotes. Idempotente.
 * `nivelAcesso` (do cadastro): o que o nivel traz enquanto o pacote nao foi salvo.
 */
export const permissoesEfetivasDoUsuario = (permissoes: unknown, nivelAcesso?: unknown, opcoes: OpcoesDasEfetivas = {}): string[] => (
  permissoesEfetivas(permissoesEfetivasDoApp(permissoes), nivelAcesso, opcoes)
);

/** O que gravar no cadastro: marcadas + marcador do app + marcadores dos pacotes (+ o do administrador, pelo papel do alvo). */
export const permissoesParaGravarDoUsuario = (marcadas: unknown, papel?: unknown): string[] => (
  permissoesParaGravar(permissoesParaGravarDoApp(marcadas), papel)
);

/**
 * Gerente so' da' e tira o que ELE MESMO tem (decisao de 19/10/2026), contando
 * as permissoes implicitas dos dois lados (app e pacotes). `depois` e' o que a
 * tela mandou gravar: conta como gravado (com os marcadores), entao desmarcar
 * uma permissao nova aparece como "tirou". Devolve as que ele mexeu sem ter.
 */
export const mexidasSemTer = (args: {
  antes: unknown;
  depois: unknown;
  doGerente: unknown;
  /** Nivel de acesso do funcionario editado e o do gerente (o que o nivel traz conta dos dois lados). */
  nivelAntes?: unknown;
  nivelDoGerente?: unknown;
  /** Contexto da empresa (o mesmo para os tres lados). */
  opcoes?: OpcoesDasEfetivas;
  /** Papel do editado e o de quem edita (administrador sem o pacote salvo tem todas). */
  papelAntes?: unknown;
  papelDoGerente?: unknown;
}): string[] => {
  const opcoes = args.opcoes || {};
  const antes = new Set(permissoesEfetivasDoUsuario(args.antes, args.nivelAntes, { ...opcoes, papel: args.papelAntes }));
  const depois = new Set(permissoesEfetivasDoUsuario(permissoesParaGravarDoUsuario(args.depois, args.papelAntes), undefined, { papel: args.papelAntes }));
  const dele = new Set(permissoesEfetivasDoUsuario(args.doGerente, args.nivelDoGerente, { ...opcoes, papel: args.papelDoGerente }));
  const mexidas = [...depois].filter((p) => !antes.has(p)).concat([...antes].filter((p) => !depois.has(p)));
  return mexidas.filter((p) => !dele.has(p) && !ehMarcadorInterno(p));
};

/** Permissoes que entraram e sairam (efetivas, sem marcadores), para o historico de alteracoes. */
export const mudancasDePermissoes = (antes: unknown, depois: unknown, nivelAntes?: unknown, opcoes: OpcoesDasEfetivas = {}): { entraram: string[]; sairam: string[] } => {
  // `opcoes.papel` = papel do cadastro (o mesmo antes e depois).
  const semMarcador = (l: unknown, nivel?: unknown) => new Set(permissoesEfetivasDoUsuario(l, nivel, opcoes).filter((p) => !ehMarcadorInterno(p)));
  const a = semMarcador(antes, nivelAntes);
  const d = semMarcador(depois);
  return {
    entraram: [...d].filter((p) => !a.has(p)),
    sairam: [...a].filter((p) => !d.has(p)),
  };
};
