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

import { identificacaoCurta, type ModoOficina } from './oficinaDomain';

export const STATUS_OS_EM_ATENDIMENTO = 'Em atendimento';
export const STATUS_OS_AGUARDANDO_CONFERENCIA = 'Aguardando conferência';
export const STATUS_OS_FINALIZADA = 'Finalizada';
export const STATUS_OS_CANCELADA = 'Cancelada';

/** Cores dos status novos, no mesmo esquema do getStatusColor da OS. */
export const CORES_STATUS_OS_CAMPO: Record<string, string> = {
  [STATUS_OS_EM_ATENDIMENTO]: '#0ea5e9',
  [STATUS_OS_AGUARDANDO_CONFERENCIA]: '#f97316',
};

export const osEncerrada = (status: unknown): boolean => status === STATUS_OS_FINALIZADA || status === STATUS_OS_CANCELADA;
export const osEmAtendimentoNoCampo = (status: unknown): boolean => status === STATUS_OS_EM_ATENDIMENTO;
export const osAguardandoConferencia = (status: unknown): boolean => status === STATUS_OS_AGUARDANDO_CONFERENCIA;
/** O app so' mexe em OS que ainda nao foi finalizada nem cancelada. */
export const podeAtenderNoApp = (status: unknown): boolean => !osEncerrada(status);

// ---------------------------------------------------------------------------
// Fotos e assinatura
// ---------------------------------------------------------------------------

export const LIMITE_FOTOS_OS = 10;
export const LADO_MAXIMO_FOTO_PX = 1280;
export const TAMANHO_MAXIMO_FOTO_BYTES = 5 * 1024 * 1024;

export interface FotoOS {
  caminho: string;
  url: string;
  legenda: string;
  /** ISO. */
  em: string;
  por: string;
}

export interface AssinaturaOS {
  caminho: string;
  url: string;
  em: string;
  por: string;
  nomeAssinante: string;
}

export const podeAdicionarFotos = (fotosAtuais: ReadonlyArray<unknown> | null | undefined, novas = 1): { ok: true } | { ok: false; erro: string } => {
  const atuais = Array.isArray(fotosAtuais) ? fotosAtuais.length : 0;
  if (atuais + novas <= LIMITE_FOTOS_OS) return { ok: true };
  const cabem = Math.max(0, LIMITE_FOTOS_OS - atuais);
  return {
    ok: false,
    erro: cabem === 0
      ? `Esta OS já tem ${LIMITE_FOTOS_OS} fotos, o máximo. Apague alguma para colocar outra.`
      : `Cabem só mais ${cabem} foto${cabem === 1 ? '' : 's'} nesta OS (máximo de ${LIMITE_FOTOS_OS}).`,
  };
};

const soSeguro = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

export const caminhoDaFotoOS = (tenantId: string, osId: string, carimbo: number, indice: number): string => (
  `empresas/${soSeguro(tenantId)}/os/${soSeguro(osId)}/foto-${carimbo}-${indice}.jpg`
);

export const caminhoDaAssinaturaOS = (tenantId: string, osId: string, carimbo: number): string => (
  `empresas/${soSeguro(tenantId)}/os/${soSeguro(osId)}/assinatura-${carimbo}.png`
);

// ---------------------------------------------------------------------------
// Pecas e servicos no app
// ---------------------------------------------------------------------------

/** A peca como a OS grava (mesmo formato do desktop, PecaSelecionada). */
export interface PecaCampo {
  id: string;
  nome: string;
  preco: number;
  quantidade: number;
  codigo?: string;
  unidadeMedidaSigla: string;
  unidadeMedidaFracionado: boolean;
  unidadeMedidaCasasDecimais: number;
}

/** O item como o VendedorItemPicker trabalha (ItemVendaExterna). */
export interface ItemPickerCampo {
  id: string;
  nome: string;
  codigo?: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  subtotal: number;
  unidadeMedidaSigla: string;
  unidadeMedidaFracionado: boolean;
  unidadeMedidaCasasDecimais: number;
}

export const pecaParaItemPicker = (p: PecaCampo): ItemPickerCampo => ({
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
});

export const itemPickerParaPeca = (i: ItemPickerCampo): PecaCampo => ({
  id: i.id,
  nome: i.nome,
  ...(i.codigo ? { codigo: i.codigo } : {}),
  preco: Number(i.precoUnitario || 0),
  quantidade: Number(i.quantidade || 0),
  unidadeMedidaSigla: i.unidadeMedidaSigla || 'UN',
  unidadeMedidaFracionado: i.unidadeMedidaFracionado === true,
  unidadeMedidaCasasDecimais: Number(i.unidadeMedidaCasasDecimais || 0),
});

/** O servico como a OS grava (ServicoSelecionado do desktop): preco x horas. */
export interface ServicoCampo {
  id: string;
  nome: string;
  preco: number;
  quantidade: number;
  tempoHoras: number;
  detalhamento: string;
}

export const servicoDeCatalogo = (s: { id: string; nome: string; preco?: number }, horas = 1): ServicoCampo => ({
  id: s.id,
  nome: s.nome,
  preco: Number(s.preco || 0),
  quantidade: 1,
  tempoHoras: Math.max(0, Number(horas) || 0),
  detalhamento: '',
});

const horasDoServico = (s: { quantidade?: number; tempoHoras?: number | string | null }) => {
  if (s.tempoHoras === undefined || s.tempoHoras === null || s.tempoHoras === '') return Math.max(0, Number(s.quantidade || 1));
  return Math.max(0, Number(s.tempoHoras || 0));
};

export const totalDoAtendimentoCentavos = (
  pecas: ReadonlyArray<{ preco?: number; quantidade?: number }>,
  servicos: ReadonlyArray<{ preco?: number; quantidade?: number; tempoHoras?: number | string | null }>,
): number => {
  const pecasC = pecas.reduce((t, p) => t + Math.round(Number(p.preco || 0) * Number(p.quantidade || 0) * 100), 0);
  const servicosC = servicos.reduce((t, s) => t + Math.round(Number(s.preco || 0) * horasDoServico(s) * 100), 0);
  return pecasC + servicosC;
};

// ---------------------------------------------------------------------------
// Abrir OS no campo
// ---------------------------------------------------------------------------

export interface EquipamentoCampo {
  placa: string;
  modelo: string;
  marca: string;
  ano: string;
  cor: string;
  frota: string;
  serie: string;
  horimetro: string;
  tipoEquipamento: string;
}

export const EQUIPAMENTO_CAMPO_VAZIO: EquipamentoCampo = {
  placa: '', modelo: '', marca: '', ano: '', cor: '', frota: '', serie: '', horimetro: '', tipoEquipamento: '',
};

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Cadastro de veiculos/equipamentos -> campos da OS. */
export const equipamentoDoCadastro = (v: Partial<Record<keyof EquipamentoCampo, unknown>> | null | undefined): EquipamentoCampo => ({
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

export const descricaoDoEquipamento = (modo: ModoOficina, e: { placa?: unknown; frota?: unknown; serie?: unknown; marca?: unknown; modelo?: unknown }): string => {
  const ident = identificacaoCurta(modo, e);
  const nome = [texto(e.marca), texto(e.modelo)].filter(Boolean).join(' ');
  return [ident !== '-' ? ident : '', nome].filter(Boolean).join(' · ') || 'Sem equipamento';
};

export interface NovaOsDeCampo {
  tenantId: string;
  numeroOS: string;
  tecnico: { id: string; nome: string };
  cliente: { id: string | null; nome: string; telefone: string };
  equipamento: EquipamentoCampo;
  reclamacao: string;
  /** AAAA-MM-DD e HH:MM, na hora de abrir. */
  data: string;
  hora: string;
}

/**
 * O documento da OS nascendo no campo. Mesmos campos que o desktop grava,
 * sem nenhum `undefined` (o Firestore recusa). Status "Em atendimento".
 */
export const montarNovaOsDeCampo = (n: NovaOsDeCampo): Record<string, unknown> => ({
  tenantId: n.tenantId,
  numeroOS: n.numeroOS,
  status: STATUS_OS_EM_ATENDIMENTO,
  statusColor: CORES_STATUS_OS_CAMPO[STATUS_OS_EM_ATENDIMENTO],
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

// ---------------------------------------------------------------------------
// Concluir atendimento
// ---------------------------------------------------------------------------

export interface ChecagemConclusao {
  status: unknown;
  relatorioTecnico: unknown;
  temAssinatura: boolean;
  exigirAssinatura: boolean;
  pecas: ReadonlyArray<unknown>;
  servicos: ReadonlyArray<unknown>;
}

export const validarConclusaoAtendimento = (c: ChecagemConclusao): { ok: boolean; erros: string[]; avisos: string[] } => {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (osEncerrada(c.status)) erros.push(`Esta OS já está ${String(c.status).toLowerCase()} e não pode ser atendida pelo app.`);
  if (c.exigirAssinatura && !c.temAssinatura) erros.push('A empresa exige a assinatura do cliente para concluir o atendimento. Toque em "Assinatura do cliente" e peça para ele assinar na tela.');
  if (!texto(c.relatorioTecnico)) avisos.push('Sem observação do serviço feito.');
  if (c.pecas.length === 0 && c.servicos.length === 0) avisos.push('Nenhuma peça nem serviço lançado.');
  return { ok: erros.length === 0, erros, avisos };
};

/** Texto do aviso do desktop quando alguem abre uma OS que o tecnico ainda esta atendendo. */
export const AVISO_OS_EM_ATENDIMENTO_NO_CAMPO = 'Esta OS está em atendimento pelo técnico no app. O que você gravar aqui pode ser sobrescrito pelo que ele ainda vai enviar do campo. Se possível, espere o atendimento ser concluído ("Aguardando conferência").';

// ---------------------------------------------------------------------------
// Lista "Minhas OS"
// ---------------------------------------------------------------------------

export interface OsResumoCampo {
  id: string;
  numeroOS: string;
  status: string;
  statusColor: string;
  clienteNome: string;
  equipamento: string;
  mecanicoId: string;
  abertaNoCampo: boolean;
  aguardandoConferencia: boolean;
  criadoEmSegundos: number;
}

export const resumoDaOsParaLista = (modo: ModoOficina, id: string, d: Record<string, unknown>): OsResumoCampo => ({
  id,
  numeroOS: texto(d.numeroOS) || id.slice(0, 6).toUpperCase(),
  status: texto(d.status),
  statusColor: texto(d.statusColor) || CORES_STATUS_OS_CAMPO[texto(d.status)] || '#6b7280',
  clienteNome: texto(d.clienteNome),
  equipamento: descricaoDoEquipamento(modo, d as { placa?: unknown; frota?: unknown; serie?: unknown; marca?: unknown; modelo?: unknown }),
  mecanicoId: texto(d.mecanicoId),
  abertaNoCampo: osEmAtendimentoNoCampo(d.status),
  aguardandoConferencia: osAguardandoConferencia(d.status),
  criadoEmSegundos: Number((d.createdAt as { seconds?: number } | undefined)?.seconds || 0),
});

/** "Minhas": as do tecnico ainda nao encerradas. "Todas": tudo que nao encerrou. Encerradas ficam de fora da aba. */
export const filtrarOsDoApp = (lista: OsResumoCampo[], aba: 'minhas' | 'todas', tecnicoId: string): OsResumoCampo[] => (
  lista
    .filter((os) => !osEncerrada(os.status))
    .filter((os) => aba === 'todas' || os.mecanicoId === tecnicoId)
    .sort((a, b) => {
      // Em atendimento primeiro, depois aguardando conferencia, depois as outras; mais recente em cima.
      const peso = (os: OsResumoCampo) => (os.abertaNoCampo ? 0 : os.aguardandoConferencia ? 1 : 2);
      return peso(a) - peso(b) || b.criadoEmSegundos - a.criadoEmSegundos;
    })
);
