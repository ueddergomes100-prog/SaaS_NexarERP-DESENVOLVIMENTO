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

export type OrigemHistorico = 'sistema' | 'app_vendas' | 'app_motorista' | 'app_tecnico' | 'frente_caixa' | 'servidor';

export const ROTULO_ORIGEM: Record<OrigemHistorico, string> = {
  sistema: 'Sistema',
  app_vendas: 'App Vendas',
  app_motorista: 'App do motorista',
  app_tecnico: 'App do técnico',
  frente_caixa: 'Frente de Caixa',
  servidor: 'Automático (servidor)',
};

export interface MudancaDeCampo {
  campo: string;
  valorAnterior: unknown;
  valorNovo: unknown;
}

/** Quem esta' fazendo a acao (preenchido pelo AuthContext na tela e pelo middleware no servidor). */
export interface ContextoDoUsuario {
  usuarioId: string;
  usuarioEmail?: string | null;
  usuarioNome?: string | null;
  /** Papel cru (Master, Admin, Funcionario, SuperAdmin, NexarAdmin). */
  papel?: string | null;
  nivelAcesso?: string | null;
  /** Dono da empresa (o Master da empresa casa). */
  dono?: boolean;
  /** Empresa casa (homeTenantId). */
  empresaId?: string | null;
  /** Filial em que a acao aconteceu (tenantId ativo). */
  filialId?: string | null;
  filialNome?: string | null;
}

export interface EntradaHistorico {
  modulo: string;
  acao: string;
  descricao: string;
  /** Documento principal (o que abre o "Histórico de alterações" dele). */
  registroId?: string | null;
  /** Outros documentos em que este registro tambem deve aparecer (ex.: a devolucao aparece no pedido). */
  documentosRelacionados?: Array<string | null | undefined>;
  /** "romaneio", "pedido", "os", "orcamento"... */
  documentoTipo?: string | null;
  /** Como o usuario conhece o documento: "Rota 02", "Pedido 0375". */
  documentoNumero?: string | null;
  motivo?: string | null;
  alteracoes?: MudancaDeCampo[] | null;
  valorAnterior?: string | null;
  valorNovo?: string | null;
  vendedorId?: string | null;
  vendedorNome?: string | null;
  /** Copia do documento antes de cancelar/excluir (ja' reduzida por reduzirSnapshotDeLog). */
  snapshot?: Record<string, unknown> | null;
  status?: 'sucesso' | 'erro' | 'negado';
  critico?: boolean;
  /** Caminho da tela (location.pathname); define origem e tela quando estas nao vem. */
  rota?: string | null;
  origem?: OrigemHistorico | null;
  tela?: string | null;
}

/** O que vai para o Firestore (falta so' `dataHora`, que cada lado poe com a hora do servidor). */
export interface RegistroHistorico {
  versao: 2;
  usuarioId: string;
  usuario: string;
  usuarioNome: string | null;
  usuarioPapel: string | null;
  empresaId: string | null;
  filialId: string | null;
  filialNome: string | null;
  origem: OrigemHistorico;
  tela: string | null;
  rota: string | null;
  modulo: string;
  acao: string;
  descricao: string;
  registroRelacionadoId: string | null;
  documentosRelacionados: string[];
  documentoTipo: string | null;
  documentoNumero: string | null;
  motivo: string | null;
  valorAnterior: string | null;
  valorNovo: string | null;
  vendedorId: string | null;
  vendedorNome: string | null;
  alteracoes: MudancaDeCampo[] | null;
  snapshotExcluido: Record<string, unknown> | null;
  status: 'sucesso' | 'erro' | 'negado';
  critical: boolean;
}

const LIMITE_TEXTO = 2000;
const LIMITE_VALOR = 500;
const LIMITE_ALTERACOES = 150;
const LIMITE_DOCUMENTOS = 12;

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : (typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : ''));
const textoOuNulo = (valor: unknown, limite = LIMITE_TEXTO): string | null => {
  const t = texto(valor);
  return t ? t.slice(0, limite) : null;
};

// ---------------------------------------------------------------------------
// PAPEL
// ---------------------------------------------------------------------------

/** Papel em portugues, como o dono fala ("Dono", "Administrador", "Gerente"...). */
export const rotuloDoPapel = (papel: unknown, nivelAcesso?: unknown, dono?: boolean): string | null => {
  const p = texto(papel);
  if (p === 'NexarAdmin' || p === 'SuperAdmin') return 'Suporte Hennder';
  if (dono || p === 'Master') return 'Dono';
  if (p === 'Admin') return 'Administrador';
  if (p === 'Funcionario') {
    const nivel = texto(nivelAcesso).toLowerCase();
    if (nivel === 'gerente' || nivel === 'administracao') return 'Gerente';
    if (nivel === 'supervisor') return 'Supervisor';
    return 'Funcionário';
  }
  return p || null;
};

// ---------------------------------------------------------------------------
// TELA E ORIGEM (pelo caminho da tela)
// ---------------------------------------------------------------------------

/** Prefixo da rota -> nome da tela no menu. O mais comprido que casar ganha. */
const TELAS: Array<[string, string]> = [
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

const caminhoLimpo = (rota: unknown): string => {
  const t = texto(rota).split('?')[0].split('#')[0];
  return t.length > 1 ? t.replace(/\/+$/, '') : t;
};

const casaPrefixo = (caminho: string, prefixo: string): boolean => (
  caminho === prefixo || caminho.startsWith(`${prefixo}/`)
);

/** Nome da tela pelo caminho ("/operacoes/romaneios/abc" -> "Romaneio de Entrega"). */
export const telaDaRota = (rota: unknown): string | null => {
  const caminho = caminhoLimpo(rota);
  if (!caminho) return null;
  const achada = TELAS_ORDENADAS.find(([prefixo]) => casaPrefixo(caminho, prefixo));
  return achada ? achada[1] : null;
};

/** De onde veio a acao, pelo caminho da tela. Sem caminho = o proprio servidor. */
export const origemDaRota = (rota: unknown): OrigemHistorico => {
  const caminho = caminhoLimpo(rota);
  if (!caminho) return 'servidor';
  if (casaPrefixo(caminho, '/vendedor/entregas')) return 'app_motorista';
  if (casaPrefixo(caminho, '/vendedor/os')) return 'app_tecnico';
  if (casaPrefixo(caminho, '/vendedor')) return 'app_vendas';
  if (casaPrefixo(caminho, '/caixa')) return 'frente_caixa';
  return 'sistema';
};

const ehOrigem = (valor: unknown): valor is OrigemHistorico => (
  typeof valor === 'string' && Object.prototype.hasOwnProperty.call(ROTULO_ORIGEM, valor)
);

export const rotuloDaOrigem = (origem: unknown): string => (ehOrigem(origem) ? ROTULO_ORIGEM[origem] : '');

// ---------------------------------------------------------------------------
// ACAO
// ---------------------------------------------------------------------------

const ROTULO_ACAO: Record<string, string> = {
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

export const ehAcaoCritica = (acao: unknown): boolean => {
  const a = texto(acao).toLowerCase();
  return ACOES_CRITICAS.includes(a) || /cancel|exclu|estorn|reabr|desfaz/.test(a);
};

export const rotuloDaAcao = (acao: unknown): string => {
  const a = texto(acao);
  if (!a) return '';
  if (ROTULO_ACAO[a]) return ROTULO_ACAO[a];
  const solto = a.replace(/_/g, ' ');
  return solto.charAt(0).toUpperCase() + solto.slice(1);
};

/** Cor da etiqueta da acao (vermelho = desfez algo, azul = alterou, verde = criou). */
export const corDaAcao = (acao: unknown): string => {
  const a = texto(acao).toLowerCase();
  if (ehAcaoCritica(a) || /negad|recus/.test(a)) return '#ef4444';
  if (/edic|alterac|ajuste/.test(a)) return '#3b82f6';
  if (/criac|criar|emiss|fatur|finaliz|baixa|entreg|import/.test(a)) return '#10b981';
  return '#6b7280';
};

// ---------------------------------------------------------------------------
// ANTES E DEPOIS
// ---------------------------------------------------------------------------

const ehTimestamp = (valor: unknown): valor is { seconds: number } => (
  typeof valor === 'object' && valor !== null && typeof (valor as { seconds?: unknown }).seconds === 'number'
);

/** Valor que cabe no historico: nunca undefined, texto curto, data em ISO, objeto em JSON. */
export const valorParaHistorico = (valor: unknown): string | number | boolean | null => {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') return valor.length > LIMITE_VALOR ? `${valor.slice(0, LIMITE_VALOR)}…` : valor;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  if (ehTimestamp(valor)) return new Date(valor.seconds * 1000).toISOString();
  if (typeof valor === 'function') return null;
  try {
    const json = JSON.stringify(valor);
    if (json === undefined) return null;
    return json.length > LIMITE_VALOR ? `${json.slice(0, LIMITE_VALOR)}…` : json;
  } catch {
    return null;
  }
};

const comparavel = (valor: unknown): string => {
  const v = valorParaHistorico(valor);
  if (v === null || v === '') return '';
  return typeof v === 'string' ? v.trim() : String(v);
};

export interface CampoComparado {
  campo: string;
  /** Nome que o usuario entende ("Preço de venda"); sem ele, vai o nome do campo. */
  rotulo?: string;
  /** Converte antes de comparar/gravar (ex.: centavos -> "R$ 10,00"). */
  formatar?: (valor: unknown) => unknown;
}

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
export const diferencasEntre = (
  antes: Record<string, unknown> | null | undefined,
  depois: Record<string, unknown> | null | undefined,
  campos?: Array<string | CampoComparado>,
): MudancaDeCampo[] => {
  const a = antes || {};
  const d = depois || {};
  const lista: CampoComparado[] = campos
    ? campos.map((c) => (typeof c === 'string' ? { campo: c } : c))
    : Array.from(new Set([...Object.keys(a), ...Object.keys(d)]))
      .filter((chave) => !CAMPOS_DE_CONTROLE.has(chave))
      .sort()
      .map((campo) => ({ campo }));
  const mudancas: MudancaDeCampo[] = [];
  lista.forEach(({ campo, rotulo, formatar }) => {
    const valorA = formatar ? formatar(a[campo]) : a[campo];
    const valorD = formatar ? formatar(d[campo]) : d[campo];
    if (comparavel(valorA) === comparavel(valorD)) return;
    mudancas.push({
      campo: rotulo || campo,
      valorAnterior: valorParaHistorico(valorA),
      valorNovo: valorParaHistorico(valorD),
    });
  });
  return mudancas.slice(0, LIMITE_ALTERACOES);
};

const normalizarAlteracoes = (alteracoes: MudancaDeCampo[] | null | undefined): MudancaDeCampo[] | null => {
  if (!Array.isArray(alteracoes) || alteracoes.length === 0) return null;
  const limpas = alteracoes
    .filter((m) => m && texto(m.campo))
    .slice(0, LIMITE_ALTERACOES)
    .map((m) => ({
      campo: texto(m.campo).slice(0, 120),
      valorAnterior: valorParaHistorico(m.valorAnterior),
      valorNovo: valorParaHistorico(m.valorNovo),
    }));
  return limpas.length ? limpas : null;
};

/** Copia sem undefined/funcao (o Firestore recusa undefined e derruba a gravacao). */
export const semUndefined = <T>(valor: T): T | null => {
  if (valor === undefined || valor === null) return null;
  try {
    return JSON.parse(JSON.stringify(valor)) as T;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// MONTAGEM DO REGISTRO
// ---------------------------------------------------------------------------

const PADRAO_DOCUMENTO = /(?:^|[^\p{L}])(Pr[ée]-venda|Venda(?: Direta| PDV)?|Pedido(?: de Venda| de Compra)?|OS|Ordem de Servi[çc]o|Or[çc]amento|Troca|Condicional|Romaneio|Rota|NF-e|NFC-e|NFS-e|Nota(?: Avulsa| Fiscal)?|Cota[çc][ãa]o|Transfer[êe]ncia|OP|Ordem de Produ[çc][ãa]o)\s*(?:n[ºo°]\s*)?#?\s*(\d{1,10})(?!\d)/iu;

/**
 * Numero do documento tirado da frase ("Venda Direta #375 finalizada" ->
 * "Venda Direta #375"). Serve para os registros que nao informam
 * `documentoNumero` (os antigos e os ~200 pontos que ja' gravavam frase).
 */
export const documentoDaDescricao = (descricao: unknown): string | null => {
  const achado = texto(descricao).match(PADRAO_DOCUMENTO);
  return achado ? `${achado[1]} #${achado[2]}` : null;
};

export const montarRegistroHistorico = (entrada: EntradaHistorico, quem: ContextoDoUsuario): RegistroHistorico => {
  const rota = textoOuNulo(entrada.rota, 300);
  const origem: OrigemHistorico = ehOrigem(entrada.origem) ? entrada.origem : origemDaRota(rota);
  const registroId = textoOuNulo(entrada.registroId, 200);
  const documentos = Array.from(new Set(
    [registroId, ...(entrada.documentosRelacionados || [])]
      .map((d) => texto(d))
      .filter(Boolean),
  )).slice(0, LIMITE_DOCUMENTOS);
  const usuarioId = texto(quem.usuarioId) || 'desconhecido';
  const status = entrada.status === 'erro' || entrada.status === 'negado' ? entrada.status : 'sucesso';
  return {
    versao: 2,
    usuarioId,
    usuario: texto(quem.usuarioEmail) || usuarioId,
    usuarioNome: textoOuNulo(quem.usuarioNome, 200),
    usuarioPapel: rotuloDoPapel(quem.papel, quem.nivelAcesso, quem.dono),
    empresaId: textoOuNulo(quem.empresaId, 200),
    filialId: textoOuNulo(quem.filialId, 200),
    filialNome: textoOuNulo(quem.filialNome, 200),
    origem,
    tela: textoOuNulo(entrada.tela, 120) || telaDaRota(rota),
    rota,
    modulo: texto(entrada.modulo) || 'sistema',
    acao: texto(entrada.acao) || 'edicao',
    descricao: texto(entrada.descricao).slice(0, LIMITE_TEXTO),
    registroRelacionadoId: registroId,
    documentosRelacionados: documentos,
    documentoTipo: textoOuNulo(entrada.documentoTipo, 60),
    documentoNumero: textoOuNulo(entrada.documentoNumero, 120) || documentoDaDescricao(entrada.descricao),
    motivo: textoOuNulo(entrada.motivo),
    valorAnterior: textoOuNulo(entrada.valorAnterior, LIMITE_VALOR),
    valorNovo: textoOuNulo(entrada.valorNovo, LIMITE_VALOR),
    vendedorId: textoOuNulo(entrada.vendedorId, 200),
    vendedorNome: textoOuNulo(entrada.vendedorNome, 200),
    alteracoes: normalizarAlteracoes(entrada.alteracoes),
    snapshotExcluido: entrada.snapshot ? semUndefined(entrada.snapshot) : null,
    status,
    critical: entrada.critico ?? ehAcaoCritica(entrada.acao),
  };
};

// ---------------------------------------------------------------------------
// LEITURA (telas)
// ---------------------------------------------------------------------------

/** Data/hora do registro, venha como Timestamp do Firestore, Date, texto ou numero. */
export const dataDoRegistro = (valor: unknown): Date | null => {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (ehTimestamp(valor)) return new Date(valor.seconds * 1000);
  if (typeof (valor as { toDate?: unknown }).toDate === 'function') {
    try { return (valor as { toDate: () => Date }).toDate(); } catch { return null; }
  }
  if (typeof valor === 'string' || typeof valor === 'number') {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/** "09/11/2026 14:32", no horario de Brasilia. */
export const dataHoraBrasil = (valor: unknown): string => {
  const data = dataDoRegistro(valor);
  if (!data) return '';
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(data);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value || '';
  return `${parte('day')}/${parte('month')}/${parte('year')} ${parte('hour')}:${parte('minute')}`;
};

/**
 * "Cancelado por MARIA em 09/11/2026 14:32" -- o aviso no topo do documento.
 * Sem nome nem data, devolve '' (o aviso nao aparece pela metade).
 */
export const textoQuemEQuando = (verbo: string, nome: unknown, quando: unknown): string => {
  const n = texto(nome);
  const d = dataHoraBrasil(quando);
  if (!n && !d) return '';
  return [verbo, n ? `por ${n}` : '', d ? `em ${d}` : ''].filter(Boolean).join(' ');
};

/** Nome que aparece para o usuario: nome do cadastro; sem ele, o e-mail; sem ele, o id. */
export const nomeDeQuemFez = (registro: { usuarioNome?: unknown; usuario?: unknown; usuarioId?: unknown }): string => (
  texto(registro.usuarioNome) || texto(registro.usuario) || texto(registro.usuarioId) || 'Usuário'
);

export interface RegistroLido {
  id: string;
  dataHora?: unknown;
  usuarioId?: string;
  usuario?: string;
  usuarioNome?: string | null;
  usuarioPapel?: string | null;
  filialId?: string | null;
  filialNome?: string | null;
  origem?: string | null;
  tela?: string | null;
  modulo?: string;
  acao?: string;
  descricao?: string;
  registroRelacionadoId?: string | null;
  documentosRelacionados?: string[];
  documentoTipo?: string | null;
  documentoNumero?: string | null;
  motivo?: string | null;
  vendedorNome?: string | null;
  alteracoes?: MudancaDeCampo[] | null;
  snapshotExcluido?: Record<string, unknown> | null;
  status?: string;
  critical?: boolean;
}

/** Junta as leituras (por id principal e por documentos relacionados), sem repetir, do mais novo ao mais antigo. */
export const juntarRegistros = <T extends { id: string; dataHora?: unknown }>(...listas: T[][]): T[] => {
  const porId = new Map<string, T>();
  listas.forEach((lista) => lista.forEach((r) => { if (!porId.has(r.id)) porId.set(r.id, r); }));
  return Array.from(porId.values()).sort((a, b) => (dataDoRegistro(b.dataHora)?.getTime() || 0) - (dataDoRegistro(a.dataHora)?.getTime() || 0));
};

const semAcento = (valor: unknown): string => texto(valor)
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase();

/** Tela do registro (registros antigos, sem `tela`, usam o modulo). */
export const telaDoRegistro = (registro: Pick<RegistroLido, 'tela' | 'modulo'>): string => (
  texto(registro.tela) || rotuloDoModulo(registro.modulo)
);

const ROTULO_MODULO: Record<string, string> = {
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

export const rotuloDoModulo = (modulo: unknown): string => {
  const m = texto(modulo);
  if (!m) return '';
  return ROTULO_MODULO[m] || (m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, ' '));
};

export interface FiltrosHistorico {
  /** Nome, e-mail ou id de quem fez. */
  usuario?: string;
  /** Nome da tela, como aparece em telaDoRegistro. */
  tela?: string;
  /** Numero ou nome do documento ("Rota 02", "0375"), ou parte da descricao. */
  documento?: string;
  acao?: string;
}

/** Filtro feito na tela, sobre o periodo ja' lido do banco. */
export const filtrarRegistros = <T extends RegistroLido>(registros: T[], filtros: FiltrosHistorico): T[] => {
  const usuario = semAcento(filtros.usuario);
  const tela = texto(filtros.tela);
  const documento = semAcento(filtros.documento);
  const acao = texto(filtros.acao);
  return registros.filter((r) => {
    if (usuario && !semAcento(`${r.usuarioNome || ''} ${r.usuario || ''} ${r.usuarioId || ''} ${r.vendedorNome || ''}`).includes(usuario)) return false;
    if (tela && telaDoRegistro(r) !== tela) return false;
    if (acao && r.acao !== acao) return false;
    if (documento) {
      const alvo = semAcento(`${r.documentoNumero || ''} ${r.descricao || ''} ${r.registroRelacionadoId || ''}`);
      // "0375" tambem acha "#375" e "375": compara tambem sem zeros a esquerda.
      const semZeros = documento.replace(/\b0+(\d)/g, '$1');
      if (!alvo.includes(documento) && !semAcento(alvo.replace(/\b0+(\d)/g, '$1')).includes(semZeros)) return false;
    }
    return true;
  });
};

/** Opcoes dos filtros (so' o que aparece no periodo), em ordem alfabetica. */
export const opcoesDosFiltros = (registros: RegistroLido[]): { telas: string[]; acoes: Array<{ valor: string; rotulo: string }> } => {
  const telas = Array.from(new Set(registros.map(telaDoRegistro).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const acoes = Array.from(new Set(registros.map((r) => texto(r.acao)).filter(Boolean)))
    .map((valor) => ({ valor, rotulo: rotuloDaAcao(valor) }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  return { telas, acoes };
};

/** Resumo do que mudou em uma linha ("Status: Em rota → Cancelado; KM: 10 → 12"). */
export const resumoDasAlteracoes = (alteracoes: MudancaDeCampo[] | null | undefined, limite = 6): string => {
  if (!Array.isArray(alteracoes) || alteracoes.length === 0) return '';
  const mostrar = (v: unknown) => {
    const t = valorParaHistorico(v);
    if (t === null || t === '') return '(vazio)';
    if (typeof t === 'boolean') return t ? 'Sim' : 'Não';
    return String(t);
  };
  const partes = alteracoes.slice(0, limite).map((m) => `${m.campo}: ${mostrar(m.valorAnterior)} → ${mostrar(m.valorNovo)}`);
  const resto = alteracoes.length - limite;
  return partes.join('; ') + (resto > 0 ? `; e mais ${resto} campo(s)` : '');
};

/**
 * Registro sem o nome da filial (o servidor grava so' o id, sem ler mais nada)
 * ganha o nome na hora de mostrar, pelas filiais do grupo: "10 · LOJA CENTRO".
 */
export const comNomeDaFilial = <T extends RegistroLido>(
  registros: T[],
  filiais: Array<{ tenantId: string; codigo?: string; nome?: string }> | null | undefined,
): T[] => {
  if (!filiais || filiais.length === 0) return registros;
  const porId = new Map(filiais.map((f) => [f.tenantId, [texto(f.codigo), texto(f.nome)].filter(Boolean).join(' · ')]));
  return registros.map((r) => (r.filialNome || !r.filialId || !porId.get(r.filialId) ? r : { ...r, filialNome: porId.get(r.filialId) || null }));
};
