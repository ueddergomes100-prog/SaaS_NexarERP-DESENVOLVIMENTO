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

export type ModoOficina = 'veiculos' | 'maquinas_pesadas';

export const TIPOS_EQUIPAMENTO_PADRAO = [
  'Trator', 'Colheitadeira', 'Pulverizador', 'Plantadeira', 'Retroescavadeira', 'Pá carregadeira',
  'Escavadeira', 'Motoniveladora', 'Empilhadeira', 'Caminhão', 'Gerador', 'Implemento', 'Outro',
];

export const TEXTO_CONCORDANCIA_PADRAO = 'Como consumidor concordo com a avaliação feita pelo responsável e estou ciente que a empresa, havendo necessidade de desmontagem do equipamento/veículo entregue para realização de serviço, não havendo o conserto, poderá ocorrer a substituição de reparos e afins para remontagem, e desta forma o cliente está ciente que se trata de componente com determinado tempo de uso, podendo ser gerada a cobrança destes custos.';

export interface ConfigMaquinasPesadas {
  ativo: boolean;
  tiposEquipamento: string[];
  /** Preco do km de deslocamento, em centavos. 0 = nao cobra por km. */
  precoKmCentavos: number;
  /** Valor fixo da visita, em centavos, somado quando ha deslocamento. 0 = nao cobra. */
  valorVisitaCentavos: number;
  /** Texto de concordancia impresso acima da assinatura do cliente. */
  textoConcordancia: string;
}

export const CONFIG_MAQUINAS_PESADAS_PADRAO: ConfigMaquinasPesadas = {
  ativo: false,
  tiposEquipamento: [...TIPOS_EQUIPAMENTO_PADRAO],
  precoKmCentavos: 0,
  valorVisitaCentavos: 0,
  textoConcordancia: TEXTO_CONCORDANCIA_PADRAO,
};

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const centavos = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const parseConfigMaquinasPesadas = (raw: unknown): ConfigMaquinasPesadas => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tipos = Array.isArray(r.tiposEquipamento)
    ? r.tiposEquipamento.map(texto).filter(Boolean)
    : [];
  return {
    ativo: r.ativo === true,
    tiposEquipamento: tipos.length > 0 ? tipos : [...TIPOS_EQUIPAMENTO_PADRAO],
    precoKmCentavos: centavos(r.precoKmCentavos),
    valorVisitaCentavos: centavos(r.valorVisitaCentavos),
    textoConcordancia: texto(r.textoConcordancia) || TEXTO_CONCORDANCIA_PADRAO,
  };
};

export const modoDaConfiguracao = (config: ConfigMaquinasPesadas | null | undefined): ModoOficina => (
  config?.ativo ? 'maquinas_pesadas' : 'veiculos'
);

// ---------------------------------------------------------------------------
// Formulario de Configuracoes (strings) <-> config
// ---------------------------------------------------------------------------

export interface ConfigMaquinasPesadasForm {
  ativo: boolean;
  /** Um tipo por linha. */
  tiposEquipamento: string;
  /** "2,50" */
  precoKm: string;
  valorVisita: string;
  textoConcordancia: string;
}

const reaisTexto = (c: number) => (c > 0 ? (c / 100).toFixed(2).replace('.', ',') : '');
const reaisParaCentavos = (s: string): number | null => {
  const t = s.trim();
  if (!t) return 0;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};

export const configMaquinasParaForm = (c: ConfigMaquinasPesadas): ConfigMaquinasPesadasForm => ({
  ativo: c.ativo,
  tiposEquipamento: c.tiposEquipamento.join('\n'),
  precoKm: reaisTexto(c.precoKmCentavos),
  valorVisita: reaisTexto(c.valorVisitaCentavos),
  textoConcordancia: c.textoConcordancia,
});

export const configMaquinasDoForm = (f: ConfigMaquinasPesadasForm): { ok: true; config: ConfigMaquinasPesadas } | { ok: false; erro: string } => {
  const precoKm = reaisParaCentavos(f.precoKm);
  if (precoKm === null) return { ok: false, erro: 'Preço do km de deslocamento inválido. Informe um valor como 2,50 ou deixe em branco para não cobrar por km.' };
  const visita = reaisParaCentavos(f.valorVisita);
  if (visita === null) return { ok: false, erro: 'Valor da visita inválido. Informe um valor como 150,00 ou deixe em branco para não cobrar.' };
  const tipos = f.tiposEquipamento.split(/\r?\n|,/).map((t) => t.trim()).filter(Boolean);
  return {
    ok: true,
    config: {
      ativo: f.ativo,
      tiposEquipamento: tipos.length > 0 ? tipos : [...TIPOS_EQUIPAMENTO_PADRAO],
      precoKmCentavos: precoKm,
      valorVisitaCentavos: visita,
      textoConcordancia: f.textoConcordancia.trim() || TEXTO_CONCORDANCIA_PADRAO,
    },
  };
};

// ---------------------------------------------------------------------------
// Rotulos
// ---------------------------------------------------------------------------

export interface RotulosOficina {
  veiculo: string;
  veiculos: string;
  dadosVeiculo: string;
  /** Rotulo do campo placa. */
  placa: string;
  /** Rotulo da coluna/identificacao curta nas listas. */
  identificacao: string;
  km: string;
  kmUnidade: string;
  mecanico: string;
  defeito: string;
  defeitoPlaceholder: string;
  relatorioPlaceholder: string;
  buscaLista: string;
}

const ROTULOS: Record<ModoOficina, RotulosOficina> = {
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

export const rotulosOficina = (modo: ModoOficina): RotulosOficina => ROTULOS[modo];

// ---------------------------------------------------------------------------
// Identificacao do equipamento
// ---------------------------------------------------------------------------

export interface IdentificacaoEquipamento {
  placa?: unknown;
  frota?: unknown;
  serie?: unknown;
}

/**
 * Oficina de veiculos: placa obrigatoria (como sempre foi). Maquinas pesadas:
 * basta frota, placa ou serie/chassi -- trator nao tem placa.
 */
export const validarIdentificacaoEquipamento = (modo: ModoOficina, id: IdentificacaoEquipamento): { ok: true } | { ok: false; erro: string } => {
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

/** "ABC-1234" / "Frota 12" / "Série 9XK..." -- o que der para mostrar numa coluna. */
export const identificacaoCurta = (modo: ModoOficina, id: IdentificacaoEquipamento): string => {
  const placa = texto(id.placa).toUpperCase();
  const frota = texto(id.frota);
  const serie = texto(id.serie);
  if (modo === 'veiculos') return placa || '-';
  if (frota) return `Frota ${frota}`;
  if (placa) return placa;
  if (serie) return `Série ${serie}`;
  return '-';
};

/** Casa a busca da lista com frota, serie e placa (modo maquinas) ou so' placa. */
export const identificacaoBateBusca = (modo: ModoOficina, id: IdentificacaoEquipamento, termo: string): boolean => {
  const t = termo.trim().toLowerCase();
  if (!t) return true;
  const campos = modo === 'veiculos' ? [id.placa] : [id.placa, id.frota, id.serie];
  return campos.some((c) => texto(c).toLowerCase().includes(t));
};

// ---------------------------------------------------------------------------
// Deslocamento para atendimento ao cliente
// ---------------------------------------------------------------------------

export interface Deslocamento {
  kmInicial: number | null;
  kmFinal: number | null;
  /** Km informados direto (quando nao se usa inicial/final). */
  km: number;
  horaSaida: string;
  horaChegada: string;
  local: string;
  veiculoEmpresa: string;
}

export const DESLOCAMENTO_VAZIO: Deslocamento = {
  kmInicial: null, kmFinal: null, km: 0, horaSaida: '', horaChegada: '', local: '', veiculoEmpresa: '',
};

const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const parseDeslocamento = (raw: unknown): Deslocamento => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
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

/** Km rodados: final - inicial quando os dois existem e fazem sentido; senao o km digitado. */
export const kmDoDeslocamento = (d: Deslocamento): number => {
  if (d.kmInicial !== null && d.kmFinal !== null && d.kmFinal >= d.kmInicial) {
    return Math.round((d.kmFinal - d.kmInicial) * 10) / 10;
  }
  return Math.max(0, Math.round((d.km || 0) * 10) / 10);
};

export const temDeslocamento = (d: Deslocamento): boolean => (
  kmDoDeslocamento(d) > 0 || !!d.local || !!d.horaSaida || !!d.horaChegada || !!d.veiculoEmpresa
);

/** km x preco do km + visita (so' quando ha km). */
export const valorDeslocamentoCentavos = (km: number, config: ConfigMaquinasPesadas): number => {
  if (km <= 0) return 0;
  return Math.round(km * config.precoKmCentavos) + config.valorVisitaCentavos;
};

export const ID_SERVICO_DESLOCAMENTO = 'deslocamento';

export interface LinhaServico {
  id: string;
  nome: string;
  preco: number;
  quantidade: number;
  tempoHoras?: number;
  detalhamento?: string;
}

const formatarKm = (km: number) => (Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ','));

/**
 * Troca (ou tira) a linha de servico do deslocamento na lista de servicos da
 * OS. Linha unica, id fixo, 1 hora x valor -- bate com getServiceTotal
 * (preco x horas). Valor zero (sem preco configurado ou sem km) remove a
 * linha; o resto da lista nao e' tocado.
 */
export const aplicarDeslocamentoNosServicos = <T extends LinhaServico>(servicos: T[], km: number, config: ConfigMaquinasPesadas): T[] => {
  const semDeslocamento = servicos.filter((s) => s.id !== ID_SERVICO_DESLOCAMENTO);
  const valor = valorDeslocamentoCentavos(km, config);
  if (valor <= 0) return semDeslocamento;
  const detalhe = [
    config.precoKmCentavos > 0 ? `${formatarKm(km)} km × R$ ${reaisTexto(config.precoKmCentavos)}` : '',
    config.valorVisitaCentavos > 0 ? `visita R$ ${reaisTexto(config.valorVisitaCentavos)}` : '',
  ].filter(Boolean).join(' + ');
  const linha = {
    id: ID_SERVICO_DESLOCAMENTO,
    nome: `Deslocamento — ${formatarKm(km)} km`,
    preco: valor / 100,
    quantidade: 1,
    tempoHoras: 1,
    detalhamento: detalhe,
  } as T;
  return [...semDeslocamento, linha];
};
