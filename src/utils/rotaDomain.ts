/**
 * CONTROLE DE ROTA: DESPESAS DE VIAGEM POR MOTORISTA (2026-09-21).
 *
 * Pedido do dono: "tem um motorista, ai ele tem despesa com gasolina, com
 * almoco, com hospedagem... lancar tudo agrupado. Nao ter que lancar uma
 * despesa de gasolina, outra de almoco, outra de hospedagem, outra de
 * pedagio."
 *
 * O ponto todo e' o LANCAMENTO UNICO: abre a rota (motorista + veiculo +
 * data), lanca as despesas do dia numa tela so' e salva uma vez. No
 * financeiro cada despesa vira sua propria linha -- porque e' assim que
 * Contas a Pagar e os relatorios enxergam -- mas quem lanca faz isso uma vez
 * so'.
 *
 * Quem lanca e' a LOJA, nao o motorista (decisao do dono, 21/09): despesa
 * digitada na estrada pode vir sem comprovante ou com valor inflado, e
 * ninguem confere depois. Passando pela loja, a notinha passa pela mao de
 * quem confere -- por isso cada despesa tem campo de comprovante.
 *
 * Regra pura: sem tela, sem Firestore.
 */

/** Os tipos de fabrica ('combustivel', 'pedagio'...) mais os que a empresa
 *  cadastrou (o proprio nome em MAIUSCULA -- ver tiposDeDespesaDisponiveis). */
export type TipoDespesaRota = string;

export const TIPO_DESPESA_OUTROS = 'outros';

export const TIPOS_DESPESA_ROTA: Array<{ value: TipoDespesaRota; label: string }> = [
  { value: 'combustivel', label: 'Combustível' },
  { value: 'pedagio', label: 'Pedágio' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'hospedagem', label: 'Hospedagem' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'outros', label: 'Outros' },
];

export const rotuloDoTipoDespesa = (tipo: string): string => (
  TIPOS_DESPESA_ROTA.find((t) => t.value === tipo)?.label || tipo
);

const semAcentoMaiusculo = (texto: string): string => texto
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase();

export const TIPO_PERSONALIZADO_MAX = 30;

/** Nome de tipo cadastrado pela empresa: aparado, espacos colapsados, caixa
 *  alta (padrao do sistema) e limitado a 30 letras. */
export const normalizarTipoPersonalizado = (texto: unknown): string => (
  String(texto ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, TIPO_PERSONALIZADO_MAX)
);

/** Erro em portugues se o nome nao pode virar tipo novo; null se pode. */
export const erroDoTipoPersonalizado = (texto: unknown, existentes: string[]): string | null => {
  const nome = normalizarTipoPersonalizado(texto);
  if (nome.length < 2) return 'Informe o nome do tipo de despesa (mínimo 2 letras).';
  const chave = semAcentoMaiusculo(nome);
  const jaExiste = [...TIPOS_DESPESA_ROTA.map((t) => t.label), ...existentes]
    .some((outro) => semAcentoMaiusculo(String(outro)) === chave);
  return jaExiste ? `Já existe o tipo "${nome}".` : null;
};

/** Lista do "Tipo" da despesa: os de fabrica, os que a empresa cadastrou e
 *  "Outros" por ultimo. `personalizados` vem de configuracoes (lixo/duplicado
 *  e' descartado em vez de quebrar a tela). */
export const tiposDeDespesaDisponiveis = (personalizados: unknown): Array<{ value: TipoDespesaRota; label: string }> => {
  const vistos = new Set(TIPOS_DESPESA_ROTA.map((t) => semAcentoMaiusculo(t.label)));
  const extras: Array<{ value: TipoDespesaRota; label: string }> = [];
  (Array.isArray(personalizados) ? personalizados : []).forEach((bruto) => {
    if (typeof bruto !== 'string') return;
    const nome = normalizarTipoPersonalizado(bruto);
    const chave = semAcentoMaiusculo(nome);
    if (nome.length < 2 || vistos.has(chave)) return;
    vistos.add(chave);
    extras.push({ value: nome, label: nome });
  });
  const fabrica = TIPOS_DESPESA_ROTA.filter((t) => t.value !== TIPO_DESPESA_OUTROS);
  const outros = TIPOS_DESPESA_ROTA.filter((t) => t.value === TIPO_DESPESA_OUTROS);
  return [...fabrica, ...extras, ...outros];
};

/** Categoria financeira das despesas de rota, no plano de contas. */
export const CATEGORIA_DESPESA_ROTA = 'DESPESAS DE ROTA';

export interface DespesaRota {
  tipo: TipoDespesaRota;
  descricao: string;
  valor: number;
  /** Numero da notinha/cupom. Em branco = sem comprovante (a tela avisa). */
  comprovante: string;
}

export interface RotaRascunho {
  motoristaId: string;
  motoristaNome: string;
  /** Placa/modelo, texto livre: o modulo Veiculos e' de oficina, vinculado a
   *  cliente -- outro dominio. */
  veiculo: string;
  data: string;
  observacao: string;
  despesas: DespesaRota[];
}

export const despesaVazia = (): DespesaRota => ({ tipo: 'combustivel', descricao: '', valor: 0, comprovante: '' });

/** Total da rota em centavos -- soma em inteiro, nunca em float. */
export const totalDaRotaCentavos = (despesas: DespesaRota[]): number => (
  (despesas || []).reduce((soma, d) => soma + Math.round((Number(d.valor) || 0) * 100), 0)
);

export const totalDaRota = (despesas: DespesaRota[]): number => totalDaRotaCentavos(despesas) / 100;

/** Quanto foi gasto em cada tipo, para o resumo da rota e o relatorio. */
export const totaisPorTipo = (despesas: DespesaRota[]): Array<{ tipo: TipoDespesaRota; label: string; totalCentavos: number }> => {
  const mapa = new Map<TipoDespesaRota, number>();
  (despesas || []).forEach((d) => {
    const centavos = Math.round((Number(d.valor) || 0) * 100);
    if (centavos <= 0) return;
    mapa.set(d.tipo, (mapa.get(d.tipo) || 0) + centavos);
  });
  // Tipos cadastrados pela empresa entram depois dos de fabrica (e antes de
  // "Outros"), na ordem em que apareceram; mesmo que o tipo tenha sido
  // apagado do cadastro depois, a rota antiga continua mostrando o nome.
  const fabrica = TIPOS_DESPESA_ROTA.filter((t) => t.value !== TIPO_DESPESA_OUTROS && mapa.has(t.value));
  const personalizados = Array.from(mapa.keys()).filter((t) => !TIPOS_DESPESA_ROTA.some((f) => f.value === t));
  const outros = TIPOS_DESPESA_ROTA.filter((t) => t.value === TIPO_DESPESA_OUTROS && mapa.has(t.value));
  return [
    ...fabrica.map((t) => ({ tipo: t.value, label: t.label, totalCentavos: mapa.get(t.value) as number })),
    ...personalizados.map((t) => ({ tipo: t, label: t, totalCentavos: mapa.get(t) as number })),
    ...outros.map((t) => ({ tipo: t.value, label: t.label, totalCentavos: mapa.get(t.value) as number })),
  ];
};

/** Despesas que valem gravar: linha em branco que a pessoa deixou na tela sai fora. */
export const despesasValidas = (despesas: DespesaRota[]): DespesaRota[] => (
  (despesas || []).filter((d) => Number(d.valor) > 0)
);

/**
 * Erros em portugues do que impede salvar a rota. Lista, nao string: a tela
 * mostra tudo o que falta de uma vez, em vez de a pessoa descobrir um
 * problema por tentativa.
 */
export const errosDaRota = (rota: RotaRascunho): string[] => {
  const erros: string[] = [];
  if (!String(rota.motoristaId || '').trim()) erros.push('Escolha o motorista da rota.');
  if (!String(rota.data || '').trim()) erros.push('Informe a data da rota.');

  const validas = despesasValidas(rota.despesas);
  if (validas.length === 0) erros.push('Lance pelo menos uma despesa com valor maior que zero.');

  const negativa = (rota.despesas || []).find((d) => Number(d.valor) < 0);
  if (negativa) erros.push('Despesa com valor negativo: confira os valores lançados.');

  const semDescricao = validas.find((d) => d.tipo === 'outros' && !String(d.descricao || '').trim());
  if (semDescricao) erros.push('Despesa do tipo "Outros" precisa de uma descrição, senão ninguém sabe o que foi.');

  return erros;
};

/**
 * Avisos que NAO impedem salvar (a loja decide). Despesa sem comprovante e'
 * o caso classico: acontece de verdade (pedagio sem cupom), mas tem de ficar
 * visivel -- e' justamente o motivo pelo qual o lancamento e' da loja.
 */
export const avisosDaRota = (rota: RotaRascunho): string[] => {
  const avisos: string[] = [];
  const semComprovante = despesasValidas(rota.despesas).filter((d) => !String(d.comprovante || '').trim());
  if (semComprovante.length > 0) {
    avisos.push(
      semComprovante.length === 1
        ? '1 despesa está sem número de comprovante.'
        : `${semComprovante.length} despesas estão sem número de comprovante.`,
    );
  }
  if (!String(rota.veiculo || '').trim()) avisos.push('A rota está sem veículo informado.');
  return avisos;
};

/** Descricao da despesa no financeiro: quem olha Contas a Pagar entende sem abrir a rota. */
export const descricaoDaDespesaNoFinanceiro = (
  despesa: DespesaRota,
  motoristaNome: string,
  data: string,
): string => {
  const dataBr = String(data || '').split('-').reverse().join('/');
  const complemento = String(despesa.descricao || '').trim();
  return [
    rotuloDoTipoDespesa(despesa.tipo).toUpperCase(),
    complemento ? `(${complemento})` : '',
    '- ROTA',
    motoristaNome ? motoristaNome.toUpperCase() : '',
    dataBr,
  ].filter(Boolean).join(' ');
};
