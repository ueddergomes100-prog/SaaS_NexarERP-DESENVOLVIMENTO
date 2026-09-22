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

export type TipoDespesaRota =
  | 'combustivel'
  | 'pedagio'
  | 'alimentacao'
  | 'hospedagem'
  | 'manutencao'
  | 'outros';

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
  return TIPOS_DESPESA_ROTA
    .filter((t) => mapa.has(t.value))
    .map((t) => ({ tipo: t.value, label: t.label, totalCentavos: mapa.get(t.value) as number }));
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
