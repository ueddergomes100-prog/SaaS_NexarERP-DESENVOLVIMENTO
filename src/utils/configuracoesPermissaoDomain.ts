import { PERMISSAO_ADMINISTRACAO, PERMISSAO_CONFIG_AREAS } from './permissoesNovasDomain';
import { permissionLabelMap } from './permissionCatalog';

/**
 * CONFIGURACOES DA FILIAL: UMA PERMISSAO POR BLOCO (item 15 da Embala Minas,
 * fase Administracao, 25/11/2026).
 *
 * A tela da filial abre para o dono/administrador e para quem tem "Admin:
 * Configuracoes da filial". Dentro dela, cada bloco que protege a empresa
 * pede a sua permissao (dados da empresa, Pix, limites de desconto, Spedy...).
 * Sem ela, os campos do bloco ficam com o valor GRAVADO e nao mudam: a tela
 * devolve o valor gravado a cada tentativa de mudar (manterCamposTravados) e
 * o salvar leva o gravado. O que nao esta' aqui e' o "resto" da tela, que vem
 * com "Admin: Configuracoes da filial".
 *
 * O banco ainda aceita "Admin: Configuracoes" gravando direto (firestore.rules,
 * canEditTenantConfig): a conferencia por bloco no banco fica para a fase das
 * rules. Puro, para testar sozinho.
 */

const A = PERMISSAO_ADMINISTRACAO;
const CA = PERMISSAO_CONFIG_AREAS;

/** Permissao do bloco -> campos do formulario da filial que ela protege. */
export const CAMPOS_DO_BLOCO_DA_FILIAL: Readonly<Record<string, readonly string[]>> = {
  [A.dadosEmpresa]: [
    'logo', 'nomeOficina', 'razaoSocial', 'nomeUsuario', 'cnpj', 'inscricaoEstadual', 'regimeTributario',
    'empresaMei', 'controlaFiscal', 'telefone', 'whatsapp', 'instagram', 'rua', 'numero', 'bairro', 'cep',
    'endereco', 'email', 'nfseCidadeCodigo', 'nfseCidadeNome', 'nfseCidadeEstado',
  ],
  [A.textosDocumentos]: ['garantiaPadrao', 'observacoesPadraoPedido', 'mensagensPadrao'],
  [A.documentosImpressao]: [
    'modeloImpressaoOS', 'mostrarValorListaOS', 'mostrarResumoEstoque', 'modeloImpressaoPedidoVenda', 'modeloImpressaoCaixa',
    'modeloImpressaoOrcamento', 'configOrcamento', 'maquinasPesadas', 'emissaoDocumentos',
  ],
  [CA.pixPedido]: ['pixNoPedidoAtivo', 'pixNoPedidoChave'],
  [CA.crmConfigurar]: ['diasNotificacaoLembrete'],
  [CA.parametrosVenda]: ['parametrosVenda', 'gavetaDinheiro', 'aPrazoNaFrenteDeCaixa'],
  [CA.recursosVenda]: [
    'venderSemEstoque', 'trabalhaComPreVenda', 'rotaNaPreVenda', 'trabalhaComEntregaFutura', 'entregaFuturaExigeEstoque',
    'trabalhaComCondicional', 'exigirIdentificacaoVendedor', 'identificacaoEscondeVendas', 'liberacaoEscolherVendedor', 'restringirVendasPorUsuario',
    'alterarPagamentoVendaFinalizada', 'devolucaoBotaoSeparado',
  ],
  [CA.comissaoPadrao]: ['comissaoPadraoPecas', 'comissaoPadraoServicos', 'metaFaturamentoMensal'],
  [CA.limitesDesconto]: [
    'modoLimiteDesconto', 'limiteDescontoOS', 'limiteDescontoPedido', 'limiteDescontoOrcamento', 'limiteDescontoPdv',
    'tipoDescontoPadrao', 'permitirDescontoPorItem',
  ],
  [CA.bonificacaoConfigurar]: ['bonificacao', 'tributacaoBonificacao'],
  // Banco padrao do boleto e "lembrar o banco do dia" ficam com o resto da tela.
  [CA.formasPagamento]: [
    'ordemFormasPagamento', 'formasPagamentoOcultas', 'formasConsumidorFinal', 'permitirDividirPagamento',
    'exigirEscolhaFormaPagamento', 'formasPrecoAVista', 'diasCrediario', 'maxParcelasCartao',
    'pagamentoCartaoSimplificadoAtivo', 'taxasCartaoCreditoPorParcela', 'taxaCartaoDebitoPercentual',
    'prazoRecebimentoCartaoCreditoDias', 'prazoRecebimentoCartaoDebitoDias',
  ],
  [CA.fiscalConfigurar]: [
    'spedyEnabled', 'spedyApiKey', 'emiteNFe', 'emiteNFCe', 'emiteNFSe', 'nfseInscricaoMunicipal',
    'nfseCodigoServicoMunicipal', 'nfseCodigoServicoFederal', 'nfseAliquotaIssPadrao',
  ],
  [CA.fiscalNumeracao]: ['spedyEnvironment'],
};

/** Permissoes dos blocos, na ordem da tela. */
export const PERMISSOES_DOS_BLOCOS_DA_FILIAL: readonly string[] = Object.keys(CAMPOS_DO_BLOCO_DA_FILIAL);

/** Quem abre a tela da filial: dono/administrador ou "Admin: Configuracoes da filial". */
export const podeAbrirConfigDaFilial = (args: { gestor: boolean; permissoes: readonly string[] }): boolean => (
  args.gestor || args.permissoes.includes(A.configFilial)
);

/** Blocos (permissoes) que a pessoa NAO pode mudar. Gestor muda tudo. */
export const blocosTravadosDaFilial = (args: { gestor: boolean; permissoes: readonly string[] }): string[] => (
  args.gestor ? [] : PERMISSOES_DOS_BLOCOS_DA_FILIAL.filter((p) => !args.permissoes.includes(p))
);

/** Campos do formulario que ficam no valor gravado (os dos blocos travados). */
export const camposTravadosDaFilial = (blocosTravados: readonly string[]): Set<string> => (
  new Set(blocosTravados.flatMap((p) => CAMPOS_DO_BLOCO_DA_FILIAL[p] || []))
);

/**
 * Devolve `novo` com os campos travados no valor GRAVADO (`gravado`). Sem o
 * gravado (tela ainda carregando), devolve `novo` como veio.
 */
export const manterCamposTravados = <T extends Record<string, unknown>>(
  gravado: Record<string, unknown> | null | undefined,
  novo: T,
  travados: ReadonlySet<string>,
): T => {
  if (!gravado || travados.size === 0) return novo;
  let mudou = false;
  const copia: Record<string, unknown> = { ...novo };
  for (const campo of travados) {
    if (!(campo in gravado) || copia[campo] === gravado[campo]) continue;
    copia[campo] = gravado[campo];
    mudou = true;
  }
  return mudou ? (copia as T) : novo;
};

/** Frase para o aviso da tela: o que esta' travado e o que pedir. */
export const avisoDosBlocosTravados = (blocosTravados: readonly string[]): string => {
  if (blocosTravados.length === 0) return '';
  const rotulos = blocosTravados.map((p) => `"${permissionLabelMap[p] || p}"`);
  return `Estes blocos ficam como estão, sem mudar: ${rotulos.join(', ')}. Para alterar, peça a um responsável liberar a permissão no seu cadastro de funcionário.`;
};

/**
 * Configuracoes Gerais (as que valem para todas as filiais): o bloco que cada
 * permissao protege na tela. O servidor confere de novo (configuracoesGerais.js).
 */
export const CAMPOS_GERAIS_DA_PERMISSAO: Readonly<Record<string, readonly string[]>> = {
  [CA.planoContas]: ['planoContasReceitas', 'planoContasDespesas', 'planoContasSoInforma'],
  [CA.cashbackConfigurar]: ['cashback'],
  [A.configGerais]: [
    'validarCadastroProduto', 'modoValidacaoCliente', 'trabalhaComLimiteCredito', 'transferenciaSemNota',
    'transferenciaNfeTributacao', 'usaGradeDeProdutos',
  ],
};
