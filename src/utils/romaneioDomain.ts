/**
 * ROMANEIO DE ENTREGA (pedido do cliente, fluxo aprovado pelo dono em 2026-10-01).
 *
 * Hoje a loja monta a rota numa planilha ("Rota 04 Daniela 20/09/2026"): a
 * lista de pedidos que o motorista leva, KM de saida/chegada e, na volta, o
 * acerto (vale, combustivel, hotel, diaria, pedagio, devolucao...). Aqui isso
 * vira um documento do sistema:
 *
 *   montagem  -> a loja escolhe os pedidos FATURADOS (com e sem nota), o
 *                motorista, o veiculo; imprime o romaneio.
 *   em_rota   -> liberado. Cada entrega vira "entregue" (quem recebeu) ou
 *                "nao entregue" (motivo obrigatorio) -- pela loja ou, depois,
 *                pelo app do motorista.
 *   fechado   -> acerto feito na volta. Pedido nao entregue fica livre pra
 *                outra rota. A BAIXA dos titulos continua em Contas a Receber
 *                (decisao do dono): o acerto registra e imprime, nao baixa.
 *   cancelado -> desistiu da rota antes de qualquer entrega -- ou, com a
 *                permissao propria, desfez uma rota ja' fechada (15/10/2026).
 *
 * Rota fechada pode ser REABERTA (volta a "em rota") e fechada de novo; as
 * despesas lancadas acompanham. Ver "ROMANEIO JA' FECHADO" no fim do arquivo.
 *
 * "Rota 01, 02, 03" e' so' nomenclatura: numero sequencial + nome livre.
 *
 * Regra pura: sem tela, sem Firestore.
 */
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import type { DespesaRota } from './rotaDomain';
import { STATUS_PRE_VENDA } from './preVendaDomain';

export type StatusRomaneio = 'montagem' | 'em_rota' | 'fechado' | 'cancelado';
export type StatusEntrega = 'pendente' | 'entregue' | 'nao_entregue';

export const ROTULO_STATUS_ROMANEIO: Record<StatusRomaneio, string> = {
  montagem: 'Em montagem',
  em_rota: 'Em rota',
  fechado: 'Fechado',
  cancelado: 'Cancelado',
};

export const ROTULO_STATUS_ENTREGA: Record<StatusEntrega, string> = {
  pendente: 'Falta entregar',
  entregue: 'Entregue',
  nao_entregue: 'Não entregue',
};

/** Romaneio que ainda "segura" os pedidos (nao podem entrar em outra rota). */
export const STATUS_ROMANEIO_ATIVO: readonly StatusRomaneio[] = ['montagem', 'em_rota'];

export interface EntregaRomaneio {
  pedidoId: string;
  numeroPedido: string;
  dataVenda: string;
  /** Numero da NF-e/NFC-e autorizada do pedido; vazio = venda sem nota. */
  notaNumero: string;
  notaTipo: string;
  clienteId: string;
  clienteCodigo: string;
  clienteNome: string;
  /** "RUA X, 10 - CENTRO" -- como o motorista acha o cliente. */
  endereco: string;
  cidade: string;
  telefone: string;
  vendedorNome: string;
  formaPagamento: string;
  valorTotalCentavos: number;
  valorDescontoCentavos: number;
  status: StatusEntrega;
  recebedorNome: string;
  recebedorDocumento: string;
  /** ISO (data e hora) da entrega ou da tentativa. */
  registradoEm: string;
  registradoPor: string;
  motivo: string;
  /** O que o motorista recebeu na entrega -- so' registro, nao baixa titulo. */
  recebidoCentavos: number;
  recebidoForma: string;
  observacao: string;
  /** Foto do canhoto (app do motorista); vazio quando a loja marcou na mao. */
  canhotoUrl: string;
  /** Caminho no Storage da foto do canhoto (para trocar a foto). */
  canhotoCaminho: string;
  /**
   * Por que o valor recebido e' diferente do valor do pedido (pagamento
   * parcial, abatimento de outra nota...). Obrigatoria quando ha' diferenca
   * (decisao do dono, 08/10/2026): e' o recado do motorista para o
   * administrativo.
   */
  justificativaValor: string;
  /** 'app' quando o motorista registrou pelo celular; vazio/'sistema' quando a loja marcou. */
  registradoVia: string;
}

export type NaturezaAcerto = 'adiantamento' | 'despesa' | 'informativo';

export interface TipoAcerto {
  nome: string;
  natureza: NaturezaAcerto;
}

export const ROTULO_NATUREZA_ACERTO: Record<NaturezaAcerto, string> = {
  adiantamento: 'Adiantamento (a loja deu ao motorista)',
  despesa: 'Despesa (o motorista pagou)',
  informativo: 'Só informação (não entra na conta)',
};

/** As linhas da planilha do cliente, na mesma ordem. A empresa pode trocar. */
export const TIPOS_ACERTO_PADRAO: TipoAcerto[] = [
  { nome: 'VALE/ADIANTAMENTO', natureza: 'adiantamento' },
  { nome: 'PEDIDOS', natureza: 'informativo' },
  { nome: 'COMBUSTÍVEL', natureza: 'despesa' },
  { nome: 'HOTEL', natureza: 'despesa' },
  { nome: 'DIÁRIA', natureza: 'despesa' },
  { nome: 'PENDÊNCIAS', natureza: 'informativo' },
  { nome: 'DEVOLUÇÃO', natureza: 'informativo' },
  { nome: 'PEDÁGIO', natureza: 'despesa' },
];

export const MOTIVOS_NAO_ENTREGA_PADRAO: string[] = [
  'CLIENTE AUSENTE / FECHADO',
  'CLIENTE RECUSOU',
  'ENDEREÇO NÃO ENCONTRADO',
  'SEM PAGAMENTO',
  'MERCADORIA AVARIADA',
  'FORA DO HORÁRIO DE RECEBIMENTO',
  'OUTRO',
];

export const FORMAS_RECEBIDAS_NA_ENTREGA = ['Dinheiro', 'Cheque', 'Pix', 'Cartão', 'Boleto'] as const;

const minusculoSemAcento = (texto: unknown) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * "Como" do registro da entrega ja' vem com a forma do pedido (25/10/2026, pedido
 * do dono): pedido no boleto vem Boleto, no Pix vem Pix, cartao (credito ou debito)
 * vem Cartao. Forma que nao bate com nenhuma (crediario, varias formas) fica Dinheiro,
 * como era antes. A pessoa sempre pode trocar.
 */
export const formaRecebidaPadrao = (formaDoPedido: unknown): string => {
  const f = minusculoSemAcento(formaDoPedido);
  if (f.includes('boleto')) return 'Boleto';
  if (f.includes('pix')) return 'Pix';
  if (f.includes('cartao') || f.includes('credito') || f.includes('debito')) return 'Cartão';
  if (f.includes('cheque')) return 'Cheque';
  return 'Dinheiro';
};

/**
 * Busca do acerto (25/10/2026): "digita o numero e registra". Bate o numero do
 * pedido (sem # e sem zeros a esquerda: "81" acha "0081") ou o numero da nota;
 * com letras, procura no nome do cliente. Vazio = todas.
 */
export const entregasDaBusca = <T extends Pick<EntregaRomaneio, 'numeroPedido' | 'notaNumero' | 'clienteNome'>>(entregas: T[], termo: string): T[] => {
  const t = minusculoSemAcento(termo).trim().replace(/^#/, '');
  if (!t) return entregas;
  if (/^\d+$/.test(t)) {
    const numero = t.replace(/^0+/, '') || '0';
    const igual = (v: unknown) => (String(v ?? '').replace(/\D/g, '').replace(/^0+/, '') || '') === numero;
    return entregas.filter((e) => igual(e.numeroPedido) || igual(e.notaNumero));
  }
  return entregas.filter((e) => minusculoSemAcento(e.clienteNome).includes(t));
};

/** "1.234,56" -> 123456. Aceita ponto ou virgula; texto vazio ou invalido = 0. */
export const centavosDoTexto = (texto: string): number => {
  const n = Number(String(texto ?? '').split('.').join('').replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
};

/** 123456 -> "1234,56"; zero vira vazio (campo em branco). */
export const textoDosCentavos = (centavos: number): string => (centavos ? (centavos / 100).toFixed(2).replace('.', ',') : '');

export interface LancamentoAcerto {
  tipo: string;
  natureza: NaturezaAcerto;
  descricao: string;
  valorCentavos: number;
}

export interface Romaneio {
  numero: number;
  nome: string;
  status: StatusRomaneio;
  dataSaida: string;
  horarioSaida: string;
  motoristaId: string;
  motoristaNome: string;
  veiculoId: string;
  veiculoDescricao: string;
  veiculoPlaca: string;
  kmSaida: number | null;
  kmChegada: number | null;
  horarioChegada: string;
  observacao: string;
  entregas: EntregaRomaneio[];
  acerto: LancamentoAcerto[];
  observacaoAcerto: string;
  /** Rota de despesas (`rotas/{id}`) criada pelo fechamento, quando as despesas foram lancadas. */
  despesasRotaId?: string;
  /** Fechou, reabriu, cancelou: quem, quando e por que (15/10/2026). */
  historico?: EventoDoRomaneio[];
}

// ---------------------------------------------------------------------------
// TEXTO
// ---------------------------------------------------------------------------

const limpar = (texto: unknown): string => String(texto ?? '').replace(/\s+/g, ' ').trim();

/** "Rota 04 DANIELA" -- numero com 2 digitos, como a loja ja' escreve. */
export const tituloDoRomaneio = (numero: number, nome: string): string => {
  const n = Number.isFinite(numero) && numero > 0 ? String(Math.floor(numero)).padStart(2, '0') : '--';
  const complemento = limpar(nome).toUpperCase();
  return `Rota ${n}${complemento ? ` ${complemento}` : ''}`;
};

/** Nome de tipo/motivo cadastrado pela empresa: caixa alta, aparado, ate 40 letras. */
export const normalizarNomeCadastro = (texto: unknown): string => limpar(texto).toUpperCase().slice(0, 40);

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Lista de configuracao lida do Firestore: so' texto valido, sem repetir; vazia = padrao. */
export const parseMotivosNaoEntrega = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [...MOTIVOS_NAO_ENTREGA_PADRAO];
  const vistos = new Set<string>();
  const lista = raw.map(normalizarNomeCadastro).filter((nome) => {
    if (!nome || vistos.has(semAcento(nome))) return false;
    vistos.add(semAcento(nome));
    return true;
  });
  return lista.length > 0 ? lista : [...MOTIVOS_NAO_ENTREGA_PADRAO];
};

export const parseTiposAcerto = (raw: unknown): TipoAcerto[] => {
  if (!Array.isArray(raw)) return TIPOS_ACERTO_PADRAO.map((t) => ({ ...t }));
  const vistos = new Set<string>();
  const lista: TipoAcerto[] = [];
  raw.forEach((item) => {
    const nome = normalizarNomeCadastro((item as TipoAcerto)?.nome);
    const natureza = (item as TipoAcerto)?.natureza;
    if (!nome || vistos.has(semAcento(nome))) return;
    if (natureza !== 'adiantamento' && natureza !== 'despesa' && natureza !== 'informativo') return;
    vistos.add(semAcento(nome));
    lista.push({ nome, natureza });
  });
  return lista.length > 0 ? lista : TIPOS_ACERTO_PADRAO.map((t) => ({ ...t }));
};

// ---------------------------------------------------------------------------
// PEDIDO -> ENTREGA
// ---------------------------------------------------------------------------

export interface PedidoParaRomaneio {
  id: string;
  numeroPedido?: unknown;
  status?: unknown;
  dataVenda?: unknown;
  clienteId?: unknown;
  clienteNome?: unknown;
  vendedorNome?: unknown;
  formaPagamento?: unknown;
  valorTotal?: unknown;
  valorTotalCentavos?: unknown;
  valorTotalDescontos?: unknown;
  valorTotalDescontosCentavos?: unknown;
}

export interface ClienteParaRomaneio {
  codigo?: unknown;
  nome?: unknown;
  endereco?: unknown;
  numero?: unknown;
  bairro?: unknown;
  cidade?: unknown;
  estado?: unknown;
  telefone?: unknown;
  celular?: unknown;
}

const centavosDe = (centavos: unknown, reais: unknown): number => {
  const c = Number(centavos);
  if (Number.isFinite(c)) return Math.round(c);
  const r = Number(reais);
  return Number.isFinite(r) ? Math.round(r * 100) : 0;
};

/**
 * So' pedido FATURADO entra na rota (decisao do dono): pre-venda nao tem
 * mercadoria separada pra sair, e cancelado nao sai. Erro em portugues ou null.
 *
 * `aceitaPreVenda` (21/10/2026, rotaPreVendaDomain.ts, modo "na_pre_venda"):
 * a pre-venda confirmada tambem entra na rota em montagem -- o "Liberar"
 * e' que exige tudo faturado. Pedido pendente do agente (WhatsApp) nao e'
 * pre-venda confirmada e continua de fora.
 */
export const erroDoPedidoParaRomaneio = (pedido: PedidoParaRomaneio, aceitaPreVenda = false): string | null => {
  const numero = limpar(pedido.numeroPedido) || '?';
  const status = limpar(pedido.status);
  if (status === 'Finalizada') return null;
  if (aceitaPreVenda && status === STATUS_PRE_VENDA) return null;
  if (status === 'Cancelada') return `O pedido #${numero} está cancelado e não pode sair para entrega.`;
  return `O pedido #${numero} ainda não foi faturado (situação: ${status || 'sem situação'}). Fature o pedido antes de colocá-lo na rota.`;
};

export const enderecoDoCliente = (cliente: ClienteParaRomaneio | null | undefined): string => {
  if (!cliente) return '';
  const rua = [limpar(cliente.endereco), limpar(cliente.numero)].filter(Boolean).join(', ');
  return [rua, limpar(cliente.bairro)].filter(Boolean).join(' - ').toUpperCase();
};

/** Monta a linha da entrega a partir do pedido. Nenhum campo fica `undefined` (Firestore recusa). */
export const montarEntregaDoPedido = (
  pedido: PedidoParaRomaneio,
  cliente: ClienteParaRomaneio | null | undefined,
  nota: { numero?: unknown; tipo?: unknown } | null | undefined,
): EntregaRomaneio => ({
  pedidoId: pedido.id,
  numeroPedido: limpar(pedido.numeroPedido),
  dataVenda: limpar(pedido.dataVenda),
  notaNumero: nota?.numero ? limpar(nota.numero) : '',
  notaTipo: nota?.numero ? limpar(nota.tipo) : '',
  clienteId: limpar(pedido.clienteId),
  clienteCodigo: limpar(cliente?.codigo),
  clienteNome: limpar(pedido.clienteNome || cliente?.nome).toUpperCase(),
  endereco: enderecoDoCliente(cliente),
  cidade: [limpar(cliente?.cidade), limpar(cliente?.estado)].filter(Boolean).join('/').toUpperCase(),
  telefone: limpar(cliente?.celular || cliente?.telefone),
  vendedorNome: limpar(pedido.vendedorNome).toUpperCase(),
  formaPagamento: limpar(pedido.formaPagamento),
  valorTotalCentavos: centavosDe(pedido.valorTotalCentavos, pedido.valorTotal),
  valorDescontoCentavos: centavosDe(pedido.valorTotalDescontosCentavos, pedido.valorTotalDescontos),
  status: 'pendente',
  recebedorNome: '',
  recebedorDocumento: '',
  canhotoCaminho: '',
  justificativaValor: '',
  registradoVia: '',
  registradoEm: '',
  registradoPor: '',
  motivo: '',
  recebidoCentavos: 0,
  recebidoForma: '',
  observacao: '',
  canhotoUrl: '',
});

/** Le uma entrega gravada, completando campo que falte (documento antigo/parcial). */
export const normalizarEntrega = (raw: Partial<EntregaRomaneio> & { pedidoId: string }): EntregaRomaneio => {
  const base = montarEntregaDoPedido({ id: raw.pedidoId }, null, null);
  const status: StatusEntrega = raw.status === 'entregue' || raw.status === 'nao_entregue' ? raw.status : 'pendente';
  return {
    ...base,
    ...Object.fromEntries(Object.entries(raw).filter(([, valor]) => valor !== undefined && valor !== null)),
    status,
    valorTotalCentavos: Number(raw.valorTotalCentavos) || 0,
    valorDescontoCentavos: Number(raw.valorDescontoCentavos) || 0,
    recebidoCentavos: Number(raw.recebidoCentavos) || 0,
  } as EntregaRomaneio;
};

// ---------------------------------------------------------------------------
// ORDEM DAS ENTREGAS
// ---------------------------------------------------------------------------

/** Move a entrega uma posicao pra cima (-1) ou pra baixo (+1). Fora do limite: lista igual. */
export const moverEntrega = (entregas: EntregaRomaneio[], indice: number, direcao: -1 | 1): EntregaRomaneio[] => {
  const destino = indice + direcao;
  if (indice < 0 || indice >= entregas.length || destino < 0 || destino >= entregas.length) return entregas;
  const nova = [...entregas];
  [nova[indice], nova[destino]] = [nova[destino], nova[indice]];
  return nova;
};

/** Ordena pela cidade e, dentro dela, pelo cliente -- ponto de partida pra montar a rota. */
export const ordenarPorCidade = (entregas: EntregaRomaneio[]): EntregaRomaneio[] => (
  [...entregas].sort((a, b) => (
    a.cidade.localeCompare(b.cidade, 'pt-BR') || a.clienteNome.localeCompare(b.clienteNome, 'pt-BR')
  ))
);

// ---------------------------------------------------------------------------
// TRANSICOES
// ---------------------------------------------------------------------------

/** O que falta pra liberar a rota pro motorista (em portugues), ou null. */
export const erroParaLiberar = (romaneio: Pick<Romaneio, 'status' | 'motoristaId' | 'entregas' | 'dataSaida'>): string | null => {
  if (romaneio.status !== 'montagem') return 'Só um romaneio em montagem pode ser liberado.';
  if (!romaneio.motoristaId) return 'Escolha o motorista antes de liberar a rota.';
  if (!romaneio.dataSaida) return 'Informe a data de saída antes de liberar a rota.';
  if (romaneio.entregas.length === 0) return 'Coloque pelo menos um pedido na rota antes de liberar.';
  return null;
};

/**
 * Diferenca entre o que o motorista recebeu e o valor do pedido, em centavos
 * (positivo = recebeu a mais). Zero quando nada foi recebido: "nao recebi"
 * e' o normal do pedido a prazo e nao pede explicacao.
 */
export const diferencaDoRecebido = (registro: { recebidoCentavos?: number; valorTotalCentavos?: number }): number => {
  const recebido = Number(registro.recebidoCentavos) || 0;
  const total = Number(registro.valorTotalCentavos) || 0;
  if (recebido <= 0 || total <= 0) return 0;
  return recebido - total;
};

export const precisaJustificarValor = (registro: { status?: StatusEntrega; recebidoCentavos?: number; valorTotalCentavos?: number }): boolean => (
  registro.status !== 'pendente' && diferencaDoRecebido(registro) !== 0
);

export const TAMANHO_MINIMO_JUSTIFICATIVA = 5;

/** "+R$ 10,00" / "−R$ 10,00" para a tela e a impressao. */
export const textoDaDiferenca = (centavos: number): string => (
  centavos === 0 ? '' : `${centavos > 0 ? '+' : '−'}${moeda(Math.abs(centavos))}`
);

/** Pode registrar uma entrega/tentativa? */
export const erroDoRegistroDeEntrega = (
  registro: {
    status: StatusEntrega;
    recebedorNome?: string;
    motivo?: string;
    recebidoCentavos?: number;
    recebidoForma?: string;
    valorTotalCentavos?: number;
    justificativaValor?: string;
  },
): string | null => {
  if (registro.status === 'entregue' && !limpar(registro.recebedorNome)) {
    return 'Informe o nome de quem recebeu a mercadoria.';
  }
  if (registro.status === 'nao_entregue' && !limpar(registro.motivo)) {
    return 'Escolha o motivo de a entrega não ter sido feita.';
  }
  const recebido = Number(registro.recebidoCentavos) || 0;
  if (recebido < 0) return 'O valor recebido não pode ser negativo.';
  if (recebido > 0 && !limpar(registro.recebidoForma)) return 'Informe como o motorista recebeu (dinheiro, cheque...).';
  if (precisaJustificarValor(registro) && limpar(registro.justificativaValor).length < TAMANHO_MINIMO_JUSTIFICATIVA) {
    const diferenca = diferencaDoRecebido(registro);
    return `O valor recebido (${moeda(recebido)}) é ${diferenca > 0 ? 'maior' : 'menor'} que o valor do pedido (${moeda(Number(registro.valorTotalCentavos) || 0)}). Explique o motivo (pagamento parcial, abatimento de outra nota...) para o administrativo.`;
  }
  return null;
};

// ---------------------------------------------------------------------------
// REGISTROS DO APP DO MOTORISTA (2026-10-08)
// ---------------------------------------------------------------------------
//
// O motorista registra a entrega sem sinal. Regravar a lista `entregas`
// inteira de um celular que ficou horas offline atropelaria o que a loja fez
// nesse meio-tempo. Por isso o app grava cada registro num mapa a parte,
// `registros.{pedidoId}`, campo a campo (update com caminho pontilhado): dois
// aparelhos mexendo em pedidos diferentes nunca se sobrescrevem, e a loja
// (registrarEntrega) grava nos DOIS lugares. Na leitura, o que esta' no mapa
// vale sobre a lista.

/** O que o app grava por pedido -- subconjunto da entrega. */
export const CAMPOS_DO_REGISTRO = [
  'status', 'recebedorNome', 'recebedorDocumento', 'motivo', 'recebidoCentavos', 'recebidoForma',
  'observacao', 'justificativaValor', 'registradoEm', 'registradoPor', 'registradoVia', 'canhotoUrl', 'canhotoCaminho',
] as const;

export type RegistroGravado = Pick<EntregaRomaneio, (typeof CAMPOS_DO_REGISTRO)[number]>;

/** Mapa `registros` do documento aplicado sobre a lista de entregas. */
export const aplicarRegistros = (entregas: EntregaRomaneio[], registros: unknown): EntregaRomaneio[] => {
  if (!registros || typeof registros !== 'object') return entregas;
  const mapa = registros as Record<string, Partial<RegistroGravado> | undefined>;
  return entregas.map((entrega) => {
    const registro = mapa[entrega.pedidoId];
    if (!registro || typeof registro !== 'object') return entrega;
    const limpo = Object.fromEntries(
      CAMPOS_DO_REGISTRO.filter((campo) => registro[campo] !== undefined && registro[campo] !== null).map((campo) => [campo, registro[campo]]),
    );
    return normalizarEntrega({ ...entrega, ...limpo, pedidoId: entrega.pedidoId });
  });
};

export interface DadosDoRegistro {
  status: StatusEntrega;
  recebedorNome: string;
  recebedorDocumento: string;
  motivo: string;
  recebidoCentavos: number;
  recebidoForma: string;
  observacao: string;
  justificativaValor: string;
}

/** O registro que vai para `registros.{pedidoId}` -- sem undefined, sempre completo. */
export const registroParaGravar = (
  entrega: Pick<EntregaRomaneio, 'canhotoUrl' | 'canhotoCaminho'>,
  r: DadosDoRegistro,
  quem: { nome: string; via: 'app' | 'sistema'; agoraIso: string },
): RegistroGravado => {
  const pendente = r.status === 'pendente';
  const recebido = pendente ? 0 : Math.max(0, Math.round(Number(r.recebidoCentavos) || 0));
  return {
    status: r.status,
    recebedorNome: r.status === 'entregue' ? limpar(r.recebedorNome).toUpperCase() : '',
    recebedorDocumento: r.status === 'entregue' ? limpar(r.recebedorDocumento) : '',
    motivo: r.status === 'nao_entregue' ? limpar(r.motivo) : '',
    recebidoCentavos: recebido,
    recebidoForma: recebido > 0 ? limpar(r.recebidoForma) : '',
    observacao: limpar(r.observacao),
    justificativaValor: pendente ? '' : limpar(r.justificativaValor),
    registradoEm: pendente ? '' : quem.agoraIso,
    registradoPor: pendente ? '' : quem.nome,
    registradoVia: pendente ? '' : quem.via,
    canhotoUrl: limpar(entrega.canhotoUrl),
    canhotoCaminho: limpar(entrega.canhotoCaminho),
  };
};

/** Campo a campo (`registros.{pedidoId}.status`...): e' o que deixa dois aparelhos gravarem sem se atropelar. */
export const caminhosDoRegistro = (pedidoId: string, registro: RegistroGravado): Record<string, string | number> => (
  Object.fromEntries(CAMPOS_DO_REGISTRO.map((campo) => [`registros.${pedidoId}.${campo}`, registro[campo]]))
);

/** Entregas que faltam e as ja' resolvidas, na ordem da rota -- as duas abas do app. */
export const separarEntregas = (entregas: EntregaRomaneio[]): { faltam: EntregaRomaneio[]; feitas: EntregaRomaneio[] } => ({
  faltam: entregas.filter((e) => e.status === 'pendente'),
  feitas: entregas.filter((e) => e.status !== 'pendente'),
});

/** Link do Google Maps para o endereco da entrega (abre o app de mapas no celular). */
export const linkDoMapa = (entrega: Pick<EntregaRomaneio, 'endereco' | 'cidade'>): string => {
  const partes = [limpar(entrega.endereco), limpar(entrega.cidade)].filter(Boolean);
  return partes.length ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(partes.join(', '))}` : '';
};

/** O que impede fechar o acerto, ou null. Toda entrega precisa ter desfecho. */
export const erroParaFechar = (romaneio: Pick<Romaneio, 'status' | 'entregas' | 'kmSaida' | 'kmChegada'>): string | null => {
  if (romaneio.status !== 'em_rota') return 'Só uma rota que já saiu pode ter o acerto fechado.';
  const pendentes = romaneio.entregas.filter((e) => e.status === 'pendente');
  if (pendentes.length > 0) {
    const lista = pendentes.slice(0, 5).map((e) => `#${e.numeroPedido}`).join(', ');
    return `Ainda falta dizer o que aconteceu com ${pendentes.length} entrega(s) (${lista}${pendentes.length > 5 ? '...' : ''}). Marque cada uma como entregue ou não entregue.`;
  }
  if (romaneio.kmSaida !== null && romaneio.kmChegada !== null && romaneio.kmChegada < romaneio.kmSaida) {
    return 'O KM de chegada está menor que o de saída. Confira o que foi digitado.';
  }
  return null;
};

/** Permissao propria para mexer em rota ja' fechada (15/10/2026). Dono e administrador ja' tem. */
export const PERMISSAO_ROMANEIO_ENCERRADO = 'operacoes.romaneios_reabrir';
export const ROTULO_PERMISSAO_ROMANEIO_ENCERRADO = 'Romaneio de Entrega: reabrir e cancelar depois de fechado';

/** Cancelar rota fechada ou com entrega ja' registrada DESFAZ o que aconteceu: pede a permissao propria e motivo. */
export const cancelamentoDesfazEntregas = (romaneio: Pick<Romaneio, 'status' | 'entregas'>): boolean => (
  romaneio.status === 'fechado' || romaneio.entregas.some((e) => e.status !== 'pendente')
);

/**
 * Sem a permissao propria, cancelar so' antes de qualquer entrega registrada
 * -- depois disso, o caminho e' fechar. Com ela (15/10/2026), cancela tambem a
 * rota fechada ou com entrega, desfazendo tudo.
 */
export const erroParaCancelar = (
  romaneio: Pick<Romaneio, 'status' | 'entregas'>,
  opcoes: { podeDesfazer?: boolean } = {},
): string | null => {
  if (romaneio.status === 'cancelado') return 'Este romaneio já foi cancelado.';
  if (cancelamentoDesfazEntregas(romaneio) && !opcoes.podeDesfazer) {
    return romaneio.status === 'fechado'
      ? `Este romaneio já foi fechado. Para cancelar, é preciso a permissão "${ROTULO_PERMISSAO_ROMANEIO_ENCERRADO}". Peça ao administrador.`
      : 'Esta rota já tem entrega registrada e não pode mais ser cancelada. Feche o acerto marcando o que não foi entregue.';
  }
  return null;
};

/**
 * Situacao da "trava" de cada pedido depois de fechar/cancelar: entregue fica
 * preso a esta rota; o resto volta a ficar livre pra outra.
 */
export const situacaoDoPedidoAoEncerrar = (entrega: Pick<EntregaRomaneio, 'status'>, cancelando: boolean): 'entregue' | 'liberado' => (
  !cancelando && entrega.status === 'entregue' ? 'entregue' : 'liberado'
);

// ---------------------------------------------------------------------------
// RESUMO E ACERTO
// ---------------------------------------------------------------------------

export interface ResumoRomaneio {
  totalEntregas: number;
  entregues: number;
  naoEntregues: number;
  pendentes: number;
  /** Entregas em que o motorista recebeu valor diferente do pedido (com justificativa). */
  comDiferenca: number;
  valorTotalCentavos: number;
  valorEntregueCentavos: number;
  valorNaoEntregueCentavos: number;
  recebidoCentavos: number;
  recebidoPorForma: Array<{ forma: string; centavos: number }>;
  kmRodados: number | null;
  adiantamentoCentavos: number;
  despesasCentavos: number;
  /** Quanto o motorista tem de devolver a loja: recebido + vale - despesas que ele pagou. */
  saldoAPrestarCentavos: number;
}

export const resumoDoRomaneio = (romaneio: Pick<Romaneio, 'entregas' | 'acerto' | 'kmSaida' | 'kmChegada'>): ResumoRomaneio => {
  const soma = (lista: EntregaRomaneio[], campo: 'valorTotalCentavos' | 'recebidoCentavos') => lista.reduce((t, e) => t + (Number(e[campo]) || 0), 0);
  const entregues = romaneio.entregas.filter((e) => e.status === 'entregue');
  const naoEntregues = romaneio.entregas.filter((e) => e.status === 'nao_entregue');
  const porForma = new Map<string, number>();
  romaneio.entregas.forEach((e) => {
    if (e.recebidoCentavos > 0) porForma.set(e.recebidoForma || 'Não informada', (porForma.get(e.recebidoForma || 'Não informada') || 0) + e.recebidoCentavos);
  });
  const recebido = soma(romaneio.entregas, 'recebidoCentavos');
  const comDiferenca = romaneio.entregas.filter((e) => precisaJustificarValor(e)).length;
  const porNatureza = (natureza: NaturezaAcerto) => romaneio.acerto
    .filter((l) => l.natureza === natureza)
    .reduce((t, l) => t + (Number(l.valorCentavos) || 0), 0);
  const adiantamento = porNatureza('adiantamento');
  const despesas = porNatureza('despesa');
  const kmRodados = romaneio.kmSaida !== null && romaneio.kmChegada !== null && romaneio.kmChegada >= romaneio.kmSaida
    ? romaneio.kmChegada - romaneio.kmSaida
    : null;
  return {
    totalEntregas: romaneio.entregas.length,
    entregues: entregues.length,
    naoEntregues: naoEntregues.length,
    pendentes: romaneio.entregas.length - entregues.length - naoEntregues.length,
    comDiferenca,
    valorTotalCentavos: soma(romaneio.entregas, 'valorTotalCentavos'),
    valorEntregueCentavos: soma(entregues, 'valorTotalCentavos'),
    valorNaoEntregueCentavos: soma(naoEntregues, 'valorTotalCentavos'),
    recebidoCentavos: recebido,
    recebidoPorForma: [...porForma.entries()].map(([forma, centavos]) => ({ forma, centavos })),
    kmRodados,
    adiantamentoCentavos: adiantamento,
    despesasCentavos: despesas,
    saldoAPrestarCentavos: recebido + adiantamento - despesas,
  };
};

/** Linhas do acerto que valem gravar: valor positivo. Valor negativo e' erro de digitacao. */
export const erroDoAcerto = (acerto: LancamentoAcerto[]): string | null => {
  const negativo = acerto.find((l) => (Number(l.valorCentavos) || 0) < 0);
  return negativo ? `O valor de "${negativo.tipo}" está negativo. Confira o que foi digitado.` : null;
};

/** Linhas com valor, limpas, sem campo a mais (o Firestore recusa `undefined`). */
export const acertoParaGravar = (acerto: LancamentoAcerto[]): LancamentoAcerto[] => acerto
  .filter((l) => (Number(l.valorCentavos) || 0) > 0)
  .map((l) => ({ tipo: l.tipo, natureza: l.natureza, descricao: limpar(l.descricao), valorCentavos: Math.round(Number(l.valorCentavos)) }));

/** Uma linha por tipo configurado, com o valor ja' lancado (se houver). */
export const linhasDoAcerto = (tipos: TipoAcerto[], gravado: LancamentoAcerto[]): LancamentoAcerto[] => {
  const linhas = tipos.map((t) => {
    const existente = gravado.find((l) => semAcento(l.tipo) === semAcento(t.nome));
    return existente ? { ...existente, natureza: existente.natureza } : { tipo: t.nome, natureza: t.natureza, descricao: '', valorCentavos: 0 };
  });
  // Tipo que saiu da configuracao mas tem valor gravado continua aparecendo.
  gravado.forEach((l) => {
    if (!linhas.some((x) => semAcento(x.tipo) === semAcento(l.tipo))) linhas.push({ ...l });
  });
  return linhas;
};

// ---------------------------------------------------------------------------
// PDF DO ROMANEIO E RELATORIO
// ---------------------------------------------------------------------------

const dataBr = (data: string): string => (data && /^\d{4}-\d{2}-\d{2}/.test(data) ? data.slice(0, 10).split('-').reverse().join('/') : '');
const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((centavos || 0) / 100);
const kmTexto = (km: number | null): string => (km === null ? '______' : new Intl.NumberFormat('pt-BR').format(km));

export interface DocumentoRomaneio {
  titulo: string;
  periodo?: string;
  filtros?: string[];
  indicadores?: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

interface LinhaAcertoPdf { item: string; valor: string }

/**
 * O romaneio impresso: o mesmo desenho da planilha da loja. Cabecalho com
 * motorista/veiculo/saida, a lista de pedidos na ordem de entrega e o quadro
 * do acerto. Campo em branco sai com linha pra preencher a mao.
 */
export const montarDocumentoRomaneio = (romaneio: Romaneio): DocumentoRomaneio => {
  const resumo = resumoDoRomaneio(romaneio);
  const colunas: ColunaRelatorio<EntregaRomaneio & { ordem: number }>[] = [
    { id: 'ordem', titulo: 'Nº', tipo: 'inteiro', largura: 8, total: 'nenhum', valor: (e) => e.ordem },
    { id: 'nf', titulo: 'N/F', tipo: 'texto', largura: 14, valor: (e) => e.notaNumero || 'S/N' },
    { id: 'pedido', titulo: 'Pedido', tipo: 'texto', largura: 14, valor: (e) => e.numeroPedido },
    { id: 'codigo', titulo: 'Cód.', tipo: 'texto', largura: 12, valor: (e) => e.clienteCodigo },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 50, valor: (e) => e.clienteNome },
    { id: 'endereco', titulo: 'Endereço', tipo: 'texto', largura: 50, padrao: false, valor: (e) => e.endereco },
    { id: 'cidade', titulo: 'Cidade', tipo: 'texto', largura: 26, valor: (e) => e.cidade },
    { id: 'telefone', titulo: 'Telefone', tipo: 'texto', largura: 24, padrao: false, valor: (e) => e.telefone },
    { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 24, valor: (e) => e.vendedorNome },
    { id: 'pagamento', titulo: 'Pagamento', tipo: 'texto', largura: 24, padrao: false, valor: (e) => e.formaPagamento },
    { id: 'desconto', titulo: 'Vr Desc.', tipo: 'moeda', valor: (e) => e.valorDescontoCentavos },
    { id: 'total', titulo: 'Vr Total', tipo: 'moeda', valor: (e) => e.valorTotalCentavos },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 22, padrao: romaneio.status === 'fechado', valor: (e) => ROTULO_STATUS_ENTREGA[e.status] },
    { id: 'recebedor', titulo: 'Recebido por', tipo: 'texto', largura: 34, padrao: romaneio.status === 'fechado', valor: (e) => (e.status === 'nao_entregue' ? e.motivo : e.recebedorNome) },
    { id: 'recebido', titulo: 'Recebido (R$)', tipo: 'moeda', padrao: romaneio.status === 'fechado', valor: (e) => e.recebidoCentavos },
    { id: 'diferenca', titulo: 'Diferença no valor', tipo: 'texto', largura: 40, padrao: resumo.comDiferenca > 0, valor: (e) => (precisaJustificarValor(e) ? `${textoDaDiferenca(diferencaDoRecebido(e))}: ${e.justificativaValor}` : '') },
    { id: 'assinatura', titulo: 'Assinatura', tipo: 'texto', largura: 34, padrao: false, valor: () => '' },
  ];

  const linhasAcerto: LinhaAcertoPdf[] = [
    ...romaneio.acerto.map((l) => ({ item: l.descricao ? `${l.tipo} — ${l.descricao}` : l.tipo, valor: moeda(l.valorCentavos) })),
  ];
  if (romaneio.status === 'fechado' || romaneio.acerto.length > 0) {
    linhasAcerto.push(
      { item: 'Recebido nas entregas', valor: moeda(resumo.recebidoCentavos) },
      { item: 'Total de despesas', valor: moeda(resumo.despesasCentavos) },
      { item: 'Saldo a prestar (recebido + vale − despesas)', valor: moeda(resumo.saldoAPrestarCentavos) },
    );
  } else {
    // Romaneio que vai sair: o quadro vai em branco pra preencher a mao, como na planilha.
    TIPOS_ACERTO_PADRAO.forEach((t) => linhasAcerto.push({ item: t.nome, valor: '' }));
    linhasAcerto.push({ item: 'TOTAL', valor: '' }, { item: 'TOTAL DESPESAS', valor: '' });
  }

  const colunasAcerto: ColunaRelatorio<LinhaAcertoPdf>[] = [
    { id: 'item', titulo: 'Acerto', tipo: 'texto', largura: 90, valor: (l) => l.item },
    { id: 'valor', titulo: 'Valor', tipo: 'texto', largura: 40, valor: (l) => l.valor },
  ];

  return {
    titulo: `${tituloDoRomaneio(romaneio.numero, romaneio.nome)} — ${dataBr(romaneio.dataSaida) || 'sem data'}`,
    periodo: `Situação: ${ROTULO_STATUS_ROMANEIO[romaneio.status]}`,
    filtros: romaneio.observacao ? [`Observação: ${romaneio.observacao}`] : [],
    indicadores: [
      { rotulo: 'Motorista', valor: romaneio.motoristaNome || '______________' },
      { rotulo: 'Veículo', valor: romaneio.veiculoDescricao || romaneio.veiculoPlaca || '______________' },
      { rotulo: 'Saída', valor: `${dataBr(romaneio.dataSaida) || '__/__/____'} ${romaneio.horarioSaida || ''}`.trim() },
      { rotulo: 'KM de saída', valor: kmTexto(romaneio.kmSaida) },
      { rotulo: 'KM de chegada', valor: kmTexto(romaneio.kmChegada) },
      { rotulo: 'KM rodados', valor: resumo.kmRodados === null ? '______' : kmTexto(resumo.kmRodados) },
      { rotulo: 'Pedidos', valor: String(resumo.totalEntregas) },
      { rotulo: 'Valor total', valor: moeda(resumo.valorTotalCentavos) },
    ],
    secoes: [
      {
        id: 'entregas',
        titulo: 'Pedidos da rota (na ordem de entrega)',
        colunas,
        linhas: romaneio.entregas.map((e, i) => ({ ...e, ordem: i + 1 })),
        unidade: ['pedido', 'pedidos'],
        mensagemVazia: 'Nenhum pedido nesta rota.',
      },
      {
        id: 'acerto',
        titulo: 'Acerto da viagem',
        colunas: colunasAcerto,
        linhas: linhasAcerto,
        opcional: true,
        padrao: true,
        rotuloTotal: '',
      },
    ],
  };
};

export interface RomaneioDaLista extends Romaneio {
  id: string;
}

export interface FiltroRelatorioRomaneios {
  de: string;
  ate: string;
  motoristaId?: string;
}

/** Relatorio do periodo: as rotas, as entregas e os nao entregues por motivo. */
export const montarDocumentoRelatorioRomaneios = (
  romaneios: RomaneioDaLista[],
  filtro: FiltroRelatorioRomaneios,
  rotuloMotorista?: string,
): DocumentoRomaneio => {
  const doPeriodo = romaneios.filter((r) => (
    r.status !== 'cancelado'
    && (!filtro.de || r.dataSaida >= filtro.de)
    && (!filtro.ate || r.dataSaida <= filtro.ate)
    && (!filtro.motoristaId || r.motoristaId === filtro.motoristaId)
  )).sort((a, b) => a.dataSaida.localeCompare(b.dataSaida) || a.numero - b.numero);

  type LinhaRota = RomaneioDaLista & { resumo: ResumoRomaneio };
  type LinhaEntrega = EntregaRomaneio & { rota: string; dataSaida: string; motoristaNome: string };

  const rotas: LinhaRota[] = doPeriodo.map((r) => ({ ...r, resumo: resumoDoRomaneio(r) }));
  const entregas: LinhaEntrega[] = doPeriodo.flatMap((r) => r.entregas.map((e) => ({
    ...e, rota: tituloDoRomaneio(r.numero, r.nome), dataSaida: r.dataSaida, motoristaNome: r.motoristaNome,
  })));
  const naoEntregues = entregas.filter((e) => e.status === 'nao_entregue');
  const porMotivo = new Map<string, { motivo: string; quantidade: number; centavos: number }>();
  naoEntregues.forEach((e) => {
    const chave = e.motivo || 'SEM MOTIVO';
    const atual = porMotivo.get(chave) || { motivo: chave, quantidade: 0, centavos: 0 };
    atual.quantidade += 1;
    atual.centavos += e.valorTotalCentavos;
    porMotivo.set(chave, atual);
  });

  const totalKm = rotas.reduce((t, r) => t + (r.resumo.kmRodados || 0), 0);
  const totalEntregue = rotas.reduce((t, r) => t + r.resumo.entregues, 0);
  const totalPedidos = rotas.reduce((t, r) => t + r.resumo.totalEntregas, 0);

  const filtros: string[] = [];
  if (rotuloMotorista) filtros.push(`Motorista: ${rotuloMotorista}`);

  return {
    titulo: 'Romaneios de Entrega',
    periodo: `Saída de ${dataBr(filtro.de) || '—'} a ${dataBr(filtro.ate) || '—'}`,
    filtros,
    indicadores: [
      { rotulo: 'Rotas', valor: String(rotas.length) },
      { rotulo: 'Pedidos', valor: String(totalPedidos) },
      { rotulo: 'Entregues', valor: String(totalEntregue) },
      { rotulo: 'Não entregues', valor: String(naoEntregues.length) },
      { rotulo: 'KM rodados', valor: new Intl.NumberFormat('pt-BR').format(totalKm) },
      { rotulo: 'Despesas', valor: moeda(rotas.reduce((t, r) => t + r.resumo.despesasCentavos, 0)) },
    ],
    secoes: [
      {
        id: 'rotas',
        titulo: 'Rotas do período',
        unidade: ['rota', 'rotas'],
        mensagemVazia: 'Nenhuma rota no período.',
        linhas: rotas,
        colunas: [
          { id: 'rota', titulo: 'Rota', tipo: 'texto', largura: 40, valor: (r: LinhaRota) => tituloDoRomaneio(r.numero, r.nome) },
          { id: 'saida', titulo: 'Saída', tipo: 'texto', largura: 20, valor: (r: LinhaRota) => dataBr(r.dataSaida) },
          { id: 'motorista', titulo: 'Motorista', tipo: 'texto', largura: 30, valor: (r: LinhaRota) => r.motoristaNome },
          { id: 'veiculo', titulo: 'Veículo', tipo: 'texto', largura: 30, padrao: false, valor: (r: LinhaRota) => r.veiculoDescricao },
          { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 20, valor: (r: LinhaRota) => ROTULO_STATUS_ROMANEIO[r.status] },
          { id: 'pedidos', titulo: 'Pedidos', tipo: 'inteiro', valor: (r: LinhaRota) => r.resumo.totalEntregas },
          { id: 'entregues', titulo: 'Entregues', tipo: 'inteiro', valor: (r: LinhaRota) => r.resumo.entregues },
          { id: 'naoentregues', titulo: 'Não entr.', tipo: 'inteiro', valor: (r: LinhaRota) => r.resumo.naoEntregues },
          { id: 'km', titulo: 'KM', tipo: 'inteiro', valor: (r: LinhaRota) => r.resumo.kmRodados || 0 },
          { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (r: LinhaRota) => r.resumo.valorTotalCentavos },
          { id: 'recebido', titulo: 'Recebido', tipo: 'moeda', padrao: false, valor: (r: LinhaRota) => r.resumo.recebidoCentavos },
          { id: 'despesas', titulo: 'Despesas', tipo: 'moeda', valor: (r: LinhaRota) => r.resumo.despesasCentavos },
        ],
      },
      {
        id: 'motivos',
        titulo: 'Não entregues por motivo',
        opcional: true,
        padrao: true,
        unidade: ['motivo', 'motivos'],
        mensagemVazia: 'Todas as entregas do período foram feitas.',
        linhas: [...porMotivo.values()].sort((a, b) => b.quantidade - a.quantidade),
        colunas: [
          { id: 'motivo', titulo: 'Motivo', tipo: 'texto', largura: 70, valor: (m: { motivo: string }) => m.motivo },
          { id: 'quantidade', titulo: 'Entregas', tipo: 'inteiro', valor: (m: { quantidade: number }) => m.quantidade },
          { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (m: { centavos: number }) => m.centavos },
        ],
      },
      {
        id: 'entregas',
        titulo: 'Entregas',
        opcional: true,
        padrao: false,
        unidade: ['entrega', 'entregas'],
        linhas: entregas,
        agruparPor: { chave: (e: LinhaEntrega) => e.rota, rotulo: (e: LinhaEntrega) => `${e.rota} — ${dataBr(e.dataSaida)} — ${e.motoristaNome}` },
        colunas: [
          { id: 'pedido', titulo: 'Pedido', tipo: 'texto', largura: 14, valor: (e: LinhaEntrega) => e.numeroPedido },
          { id: 'nf', titulo: 'N/F', tipo: 'texto', largura: 14, valor: (e: LinhaEntrega) => e.notaNumero || 'S/N' },
          { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 50, valor: (e: LinhaEntrega) => e.clienteNome },
          { id: 'cidade', titulo: 'Cidade', tipo: 'texto', largura: 26, padrao: false, valor: (e: LinhaEntrega) => e.cidade },
          { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 22, valor: (e: LinhaEntrega) => ROTULO_STATUS_ENTREGA[e.status] },
          { id: 'detalhe', titulo: 'Recebido por / motivo', tipo: 'texto', largura: 40, valor: (e: LinhaEntrega) => (e.status === 'nao_entregue' ? e.motivo : e.recebedorNome) },
          { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (e: LinhaEntrega) => e.valorTotalCentavos },
        ],
      },
    ],
  };
};

// ---------------------------------------------------------------------------
// LEITURA DO DOCUMENTO (servidor e tela leem igual)
// ---------------------------------------------------------------------------

const numeroOuNulo = (valor: unknown): number | null => (
  valor !== null && valor !== undefined && valor !== '' && Number.isFinite(Number(valor)) ? Number(valor) : null
);

/** Romaneio lido do Firestore, com todo campo completo (documento parcial nao quebra a tela). */
export const romaneioDoDocumento = (dados: Record<string, unknown>): Romaneio => ({
  numero: Number(dados.numero) || 0,
  nome: String(dados.nome || ''),
  status: (['montagem', 'em_rota', 'fechado', 'cancelado'].includes(String(dados.status)) ? dados.status : 'montagem') as Romaneio['status'],
  dataSaida: String(dados.dataSaida || ''),
  horarioSaida: String(dados.horarioSaida || ''),
  motoristaId: String(dados.motoristaId || ''),
  motoristaNome: String(dados.motoristaNome || ''),
  veiculoId: String(dados.veiculoId || ''),
  veiculoDescricao: String(dados.veiculoDescricao || ''),
  veiculoPlaca: String(dados.veiculoPlaca || ''),
  kmSaida: numeroOuNulo(dados.kmSaida),
  kmChegada: numeroOuNulo(dados.kmChegada),
  horarioChegada: String(dados.horarioChegada || ''),
  observacao: String(dados.observacao || ''),
  // O que o app do motorista gravou em `registros.{pedidoId}` vale sobre a lista ("REGISTROS DO APP").
  entregas: aplicarRegistros(
    Array.isArray(dados.entregas) ? (dados.entregas as Array<Partial<EntregaRomaneio> & { pedidoId: string }>).filter((e) => e?.pedidoId).map(normalizarEntrega) : [],
    dados.registros,
  ),
  acerto: Array.isArray(dados.acerto) ? (dados.acerto as LancamentoAcerto[]) : [],
  observacaoAcerto: String(dados.observacaoAcerto || ''),
  despesasRotaId: String(dados.despesasRotaId || ''),
  historico: parseHistorico(dados.historico),
});

/** Campos que a tela edita, sem nada `undefined` (o Firestore recusa). */
export const camposEditaveisDaRota = (r: Romaneio) => ({
  nome: r.nome.trim().toUpperCase(),
  dataSaida: r.dataSaida,
  horarioSaida: r.horarioSaida,
  motoristaId: r.motoristaId,
  motoristaNome: r.motoristaNome,
  veiculoId: r.veiculoId,
  veiculoDescricao: r.veiculoDescricao,
  veiculoPlaca: r.veiculoPlaca,
  kmSaida: r.kmSaida,
  observacao: r.observacao.trim(),
});

// ---------------------------------------------------------------------------
// ROMANEIO JA' FECHADO: REABRIR E CANCELAR (15/10/2026, pedido do cliente)
// ---------------------------------------------------------------------------
//
// O cliente esqueceu de lancar as despesas do motorista e a rota ja' estava
// fechada. Decisoes do dono (15/10/2026):
//   - REABRIR volta a rota inteira para "Em rota" (acerto, KM, entregas). O
//     pedido nao entregue que nesse meio-tempo entrou em outra rota fica de
//     fora: agora quem manda nele e' a outra rota.
//   - O FINANCEIRO ACOMPANHA: ao fechar de novo, despesa nova vira lancamento
//     pago, valor alterado corrige o lancamento e despesa que saiu do acerto
//     cancela o lancamento. Nada e' apagado.
//   - CANCELAR (mesmo fechado ou com entrega registrada) desfaz tudo: os
//     pedidos ficam livres e os lancamentos de despesa sao cancelados.
//   - Permissao propria (PERMISSAO_ROMANEIO_ENCERRADO); motivo obrigatorio;
//     tudo vai para o log e para o historico do romaneio.
// Quem grava e' o SERVIDOR (server/services/romaneios.js): as firestore.rules
// nao deixam a tela mexer em romaneio fechado ou cancelado.

export const TAMANHO_MINIMO_MOTIVO_ROMANEIO = 10;

export const erroDoMotivo = (motivo: unknown): string | null => (
  limpar(motivo).length < TAMANHO_MINIMO_MOTIVO_ROMANEIO
    ? `Escreva o motivo com pelo menos ${TAMANHO_MINIMO_MOTIVO_ROMANEIO} letras. Ele fica no histórico do romaneio.`
    : null
);

export const erroParaReabrir = (romaneio: Pick<Romaneio, 'status'>): string | null => {
  if (romaneio.status === 'cancelado') return 'Romaneio cancelado não volta. Monte uma rota nova com os pedidos.';
  if (romaneio.status !== 'fechado') return 'Só dá para reabrir um romaneio com o acerto fechado.';
  return null;
};

// --- Historico na propria rota -------------------------------------------

export type AcaoDoHistorico = 'fechado' | 'reaberto' | 'cancelado';

export interface EventoDoRomaneio {
  acao: AcaoDoHistorico;
  /** Vazio no fechamento comum. */
  motivo: string;
  usuarioNome: string;
  /** ISO (data e hora). */
  emIso: string;
}

export const ROTULO_ACAO_HISTORICO: Record<AcaoDoHistorico, string> = {
  fechado: 'Acerto fechado',
  reaberto: 'Reaberto',
  cancelado: 'Cancelado',
};

export const parseHistorico = (raw: unknown): EventoDoRomaneio[] => (
  Array.isArray(raw)
    ? raw
      .filter((e) => e && typeof e === 'object' && ['fechado', 'reaberto', 'cancelado'].includes(String((e as EventoDoRomaneio).acao)))
      .map((e) => ({
        acao: (e as EventoDoRomaneio).acao,
        motivo: limpar((e as EventoDoRomaneio).motivo),
        usuarioNome: limpar((e as EventoDoRomaneio).usuarioNome),
        emIso: String((e as EventoDoRomaneio).emIso || ''),
      }))
    : []
);

export const eventoDoHistorico = (acao: AcaoDoHistorico, usuarioNome: string, agoraIso: string, motivo = ''): EventoDoRomaneio => ({
  acao,
  motivo: limpar(motivo),
  usuarioNome: limpar(usuarioNome) || 'Usuário',
  emIso: agoraIso,
});

// --- Travas dos pedidos ----------------------------------------------------

export interface TravaDoPedido {
  romaneioId?: string;
  romaneioTitulo?: string;
  situacao?: string;
}

/** A trava esta' livre, nao existe ou e' desta rota: so' nesses casos esta rota mexe nela. */
export const travaLivreOuDestaRota = (romaneioId: string, trava: TravaDoPedido | null | undefined): boolean => (
  !trava || !trava.romaneioId || trava.romaneioId === romaneioId || trava.situacao === 'liberado'
);

/** Reabrir: quem continua na rota e quem ja' saiu em outra (fica de fora, com o nome da outra rota). */
export const planoDeReabertura = (
  romaneioId: string,
  entregas: EntregaRomaneio[],
  travas: Record<string, TravaDoPedido | null | undefined>,
): { ficam: EntregaRomaneio[]; saem: Array<{ entrega: EntregaRomaneio; outraRota: string }> } => {
  const ficam: EntregaRomaneio[] = [];
  const saem: Array<{ entrega: EntregaRomaneio; outraRota: string }> = [];
  entregas.forEach((entrega) => {
    const trava = travas[entrega.pedidoId];
    if (travaLivreOuDestaRota(romaneioId, trava)) ficam.push(entrega);
    else saem.push({ entrega, outraRota: limpar(trava?.romaneioTitulo) || 'outra rota' });
  });
  return { ficam, saem };
};

// --- Despesas lancadas no Financeiro ----------------------------------------

/** Despesas do acerto como o Financeiro grava (mesmo desenho da tela Rotas e Despesas). */
export const despesasDoAcerto = (acerto: LancamentoAcerto[]): DespesaRota[] => acertoParaGravar(acerto)
  .filter((l) => l.natureza === 'despesa')
  .map((l) => ({ tipo: l.tipo, descricao: l.descricao, valor: l.valorCentavos / 100, comprovante: '' }));

const centavosDaDespesa = (despesa: Pick<DespesaRota, 'valor'>): number => Math.round((Number(despesa.valor) || 0) * 100);

/** Chave de cada despesa: o tipo sem acento; tipo repetido ganha "#2", "#3"... */
const chavesDasDespesas = (despesas: Array<Pick<DespesaRota, 'tipo'>>): string[] => {
  const vistos = new Map<string, number>();
  return despesas.map((d) => {
    const base = semAcento(limpar(d.tipo));
    const vezes = (vistos.get(base) || 0) + 1;
    vistos.set(base, vezes);
    return vezes > 1 ? `${base}#${vezes}` : base;
  });
};

export interface DespesaJaLancada {
  despesa: DespesaRota;
  transacaoId: string;
  /** false = o lancamento sumiu ou ja' foi cancelado no Financeiro. */
  ativa: boolean;
}

/** Pares despesa x lancamento gravados na rota de despesas (`despesas[i]` <-> `transacaoIds[i]`). */
export const despesasJaLancadas = (
  rota: { despesas?: unknown; transacaoIds?: unknown } | null | undefined,
  ativa: (transacaoId: string) => boolean,
): DespesaJaLancada[] => {
  const despesas = Array.isArray(rota?.despesas) ? (rota!.despesas as DespesaRota[]) : [];
  const ids = Array.isArray(rota?.transacaoIds) ? (rota!.transacaoIds as unknown[]).map((x) => String(x || '')) : [];
  return despesas
    .map((despesa, i) => ({ despesa, transacaoId: ids[i] || '' }))
    .filter((par) => par.transacaoId)
    .map((par) => ({ ...par, ativa: ativa(par.transacaoId) }));
};

export interface PlanoDeDespesas {
  /** Na ordem do acerto. `transacaoId` vazio = lancamento novo. */
  linhas: Array<{ despesa: DespesaRota; transacaoId: string; alterada: boolean }>;
  /** Lancamentos cuja despesa saiu do acerto: viram "Cancelada" (nada e' apagado). */
  cancelar: string[];
}

/**
 * "O financeiro acompanha a edicao": compara o acerto com o que ja' foi
 * lancado. Mesma despesa (pelo tipo) e lancamento ativo = atualiza; despesa
 * nova (ou cujo lancamento foi cancelado no Financeiro) = lanca de novo;
 * lancamento sem despesa correspondente = cancela.
 */
export const planoDeDespesas = (desejadas: DespesaRota[], lancadas: DespesaJaLancada[]): PlanoDeDespesas => {
  const chavesNovas = chavesDasDespesas(desejadas);
  const ativas = lancadas.filter((l) => l.ativa);
  const chavesAtivas = chavesDasDespesas(ativas.map((l) => l.despesa));
  const usadas = new Set<number>();
  const linhas = desejadas.map((despesa, i) => {
    const j = chavesAtivas.findIndex((chave, k) => chave === chavesNovas[i] && !usadas.has(k));
    if (j < 0) return { despesa, transacaoId: '', alterada: false };
    usadas.add(j);
    const antiga = ativas[j].despesa;
    const alterada = centavosDaDespesa(antiga) !== centavosDaDespesa(despesa) || limpar(antiga.descricao) !== limpar(despesa.descricao);
    return { despesa, transacaoId: ativas[j].transacaoId, alterada };
  });
  return { linhas, cancelar: ativas.filter((_, k) => !usadas.has(k)).map((l) => l.transacaoId) };
};

export const contagemDoPlano = (plano: PlanoDeDespesas): { novas: number; alteradas: number; canceladas: number } => ({
  novas: plano.linhas.filter((l) => !l.transacaoId).length,
  alteradas: plano.linhas.filter((l) => l.transacaoId && l.alterada).length,
  canceladas: plano.cancelar.length,
});

/** Frase do resultado para a tela ("2 despesa(s) lançada(s), 1 corrigida"). Vazio = nada mudou no Financeiro. */
export const textoDoPlano = (contagem: { novas: number; alteradas: number; canceladas: number }): string => [
  contagem.novas ? `${contagem.novas} despesa(s) lançada(s)` : '',
  contagem.alteradas ? `${contagem.alteradas} corrigida(s)` : '',
  contagem.canceladas ? `${contagem.canceladas} cancelada(s)` : '',
].filter(Boolean).join(', ');

// --- O que mudou entre o fechamento anterior e o novo (log) -----------------

export interface FotoDoFechamento {
  dataSaida: string;
  motoristaNome: string;
  veiculoDescricao: string;
  kmSaida: number | null;
  kmChegada: number | null;
  horarioChegada: string;
  observacaoAcerto: string;
  acerto: LancamentoAcerto[];
  entregas: Array<{ pedidoId: string; numeroPedido: string; status: StatusEntrega; recebidoCentavos: number }>;
}

/** Guardada ao reabrir: no novo fechamento, o log diz exatamente o que mudou. */
export const fotoDoFechamento = (r: Romaneio): FotoDoFechamento => ({
  dataSaida: r.dataSaida,
  motoristaNome: r.motoristaNome,
  veiculoDescricao: r.veiculoDescricao,
  kmSaida: r.kmSaida,
  kmChegada: r.kmChegada,
  horarioChegada: r.horarioChegada,
  observacaoAcerto: r.observacaoAcerto,
  acerto: acertoParaGravar(r.acerto),
  entregas: r.entregas.map((e) => ({ pedidoId: e.pedidoId, numeroPedido: e.numeroPedido, status: e.status, recebidoCentavos: Number(e.recebidoCentavos) || 0 })),
});

export interface AlteracaoDoRomaneio {
  campo: string;
  valorAnterior: string;
  valorNovo: string;
}

const textoDoKm = (km: number | null): string => (km === null ? '—' : new Intl.NumberFormat('pt-BR').format(km));

/** Lista "campo: antes -> depois" em portugues, pronta para o log de auditoria. */
export const alteracoesDesdeOFechamento = (antes: FotoDoFechamento, depois: Romaneio): AlteracaoDoRomaneio[] => {
  const lista: AlteracaoDoRomaneio[] = [];
  const comparar = (campo: string, a: string, b: string) => { if (a !== b) lista.push({ campo, valorAnterior: a || '—', valorNovo: b || '—' }); };
  comparar('Data de saída', dataBr(antes.dataSaida), dataBr(depois.dataSaida));
  comparar('Motorista', antes.motoristaNome, depois.motoristaNome);
  comparar('Veículo', antes.veiculoDescricao, depois.veiculoDescricao);
  comparar('KM de saída', textoDoKm(antes.kmSaida), textoDoKm(depois.kmSaida));
  comparar('KM de chegada', textoDoKm(antes.kmChegada), textoDoKm(depois.kmChegada));
  comparar('Horário de chegada', antes.horarioChegada, depois.horarioChegada);
  comparar('Observação do acerto', limpar(antes.observacaoAcerto), limpar(depois.observacaoAcerto));

  const linhaDoAcerto = (l: LancamentoAcerto | undefined) => (l ? `${moeda(l.valorCentavos)}${limpar(l.descricao) ? ` (${limpar(l.descricao)})` : ''}` : '');
  const novas = acertoParaGravar(depois.acerto);
  const tipos = [...new Set([...antes.acerto, ...novas].map((l) => l.tipo))];
  tipos.forEach((tipo) => {
    const a = antes.acerto.find((l) => semAcento(l.tipo) === semAcento(tipo));
    const b = novas.find((l) => semAcento(l.tipo) === semAcento(tipo));
    comparar(`Acerto: ${tipo}`, linhaDoAcerto(a), linhaDoAcerto(b));
  });

  const situacao = (e: { status: StatusEntrega; recebidoCentavos: number } | undefined) => (
    e ? `${ROTULO_STATUS_ENTREGA[e.status]}${e.recebidoCentavos ? `, recebido ${moeda(e.recebidoCentavos)}` : ''}` : 'Fora da rota'
  );
  antes.entregas.forEach((a) => {
    const b = depois.entregas.find((e) => e.pedidoId === a.pedidoId);
    comparar(`Pedido #${a.numeroPedido}`, situacao(a), situacao(b ? { status: b.status, recebidoCentavos: Number(b.recebidoCentavos) || 0 } : undefined));
  });
  return lista;
};
