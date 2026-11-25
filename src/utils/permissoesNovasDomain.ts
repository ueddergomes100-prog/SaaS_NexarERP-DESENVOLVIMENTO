import {
  MARCADOR_APP_DEFINIDO,
  permissoesEfetivas as permissoesEfetivasDoApp,
  permissoesParaGravar as permissoesParaGravarDoApp,
} from './permissoesAppDomain';

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
} as const;

/** Fase 2 (25/11/2026): acoes das Notas Fiscais que ganham permissao propria. */
export const PERMISSAO_FISCAL = {
  cartaCorrecao: 'fiscal.cce',
  inutilizar: 'fiscal.inutilizar',
  devolucao: 'fiscal.devolucao',
  emitirLote: 'fiscal.emitir_lote',
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

export interface PacoteDePermissoes {
  /** Nunca muda depois de publicado: e' o que fica gravado no cadastro. */
  id: string;
  /** Permissao de tela -> permissoes novas que ela traz para quem ainda nao tem o pacote. */
  implicacoes: Readonly<Record<string, readonly string[]>>;
}

const F = PERMISSAO_FINANCEIRO;
const FI = PERMISSAO_FISCAL;
const V = PERMISSAO_VENDAS;
const O = PERMISSAO_OPERACOES;

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
];

export const PREFIXO_MARCADOR_PACOTE = 'pacote.';

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
 * Permissoes que valem de verdade: as gravadas + (para cada pacote que a
 * pessoa ainda NAO tem gravado) as novas que vem com as permissoes de tela
 * dela. O resultado SEMPRE leva os marcadores de todos os pacotes, para aplicar
 * de novo nao mudar nada (o AuthContext ja' entrega as efetivas e as telas
 * podem aplicar outra vez -- mesma licao do app).
 */
export const permissoesEfetivas = (permissoes: unknown): string[] => {
  const gravadas = lista(permissoes);
  const temGravada = new Set(gravadas);
  const resultado = new Set(gravadas);
  for (const pacote of PACOTES_DE_PERMISSOES) {
    if (temGravada.has(marcadorDoPacote(pacote.id))) continue;
    for (const [daTela, novas] of Object.entries(pacote.implicacoes)) {
      if (temGravada.has(daTela)) novas.forEach((p) => resultado.add(p));
    }
  }
  MARCADORES_DOS_PACOTES.forEach((m) => resultado.add(m));
  return [...resultado];
};

/** O que gravar: o que a tela marcou + o marcador de todos os pacotes (dai' em diante nada e' implicito). */
export const permissoesParaGravar = (marcadas: unknown): string[] => (
  [...new Set([...lista(marcadas).filter((p) => !ehMarcadorDePacote(p)), ...MARCADORES_DOS_PACOTES])]
);

// ---------------------------------------------------------------------------
// Tudo junto (app + pacotes): o que as telas e o servidor usam no cadastro.
// ---------------------------------------------------------------------------

/** Efetivas do usuario: chaves do app (permissoesAppDomain) + pacotes. Idempotente. */
export const permissoesEfetivasDoUsuario = (permissoes: unknown): string[] => (
  permissoesEfetivas(permissoesEfetivasDoApp(permissoes))
);

/** O que gravar no cadastro: marcadas + marcador do app + marcadores dos pacotes. */
export const permissoesParaGravarDoUsuario = (marcadas: unknown): string[] => (
  permissoesParaGravar(permissoesParaGravarDoApp(marcadas))
);

/**
 * Gerente so' da' e tira o que ELE MESMO tem (decisao de 19/10/2026), contando
 * as permissoes implicitas dos dois lados (app e pacotes). `depois` e' o que a
 * tela mandou gravar: conta como gravado (com os marcadores), entao desmarcar
 * uma permissao nova aparece como "tirou". Devolve as que ele mexeu sem ter.
 */
export const mexidasSemTer = (args: { antes: unknown; depois: unknown; doGerente: unknown }): string[] => {
  const antes = new Set(permissoesEfetivasDoUsuario(args.antes));
  const depois = new Set(permissoesEfetivasDoUsuario(permissoesParaGravarDoUsuario(args.depois)));
  const dele = new Set(permissoesEfetivasDoUsuario(args.doGerente));
  const mexidas = [...depois].filter((p) => !antes.has(p)).concat([...antes].filter((p) => !depois.has(p)));
  return mexidas.filter((p) => !dele.has(p) && !ehMarcadorInterno(p));
};

/** Permissoes que entraram e sairam (efetivas, sem marcadores), para o historico de alteracoes. */
export const mudancasDePermissoes = (antes: unknown, depois: unknown): { entraram: string[]; sairam: string[] } => {
  const semMarcador = (l: unknown) => new Set(permissoesEfetivasDoUsuario(l).filter((p) => !ehMarcadorInterno(p)));
  const a = semMarcador(antes);
  const d = semMarcador(depois);
  return {
    entraram: [...d].filter((p) => !a.has(p)),
    sairam: [...a].filter((p) => !d.has(p)),
  };
};
