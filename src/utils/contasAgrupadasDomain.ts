/**
 * Contas a receber / a pagar do app Vendas AGRUPADAS por cliente ou
 * fornecedor (pedido do dono, 15/10/2026): o cliente que deve 3 notas
 * aparecia 3 vezes. Agora vira uma linha so' -- nome, quantas notas, total e
 * o vencimento mais antigo -- e as notas abrem embaixo ao tocar. So'
 * visualizacao: nada aqui grava.
 */

export interface ContaParaAgrupar {
  id: string;
  /** Cliente (receber) ou fornecedor (pagar). */
  nome: string;
  descricao: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  valor: number;
}

export interface GrupoDeContas<T extends ContaParaAgrupar> {
  chave: string;
  nome: string;
  contas: T[];
  quantidade: number;
  total: number;
  vencimentoMaisAntigo: string;
  vencidas: number;
}

const centavos = (valor: number) => Math.round((Number(valor) || 0) * 100);

/** Conta sem cliente/fornecedor agrupa pela descricao (ex.: "ALUGUEL" todo mes junto). */
export const nomeDoGrupo = (conta: Pick<ContaParaAgrupar, 'nome' | 'descricao'>): string => (
  conta.nome.trim().replace(/\s+/g, ' ') || conta.descricao.trim().replace(/\s+/g, ' ') || 'Sem descrição'
);

/**
 * Agrupa pelo nome (maiusculas, acentos de digitacao e espacos nao separam o
 * mesmo cliente). Dentro do grupo, as notas vem do vencimento mais antigo ao
 * mais novo; os grupos, do que tem a conta mais antiga (o mais urgente) ao
 * mais novo, e no empate pelo nome.
 */
export const agruparContasPorNome = <T extends ContaParaAgrupar>(contas: T[], hoje: string): GrupoDeContas<T>[] => {
  const grupos = new Map<string, GrupoDeContas<T>>();
  for (const conta of contas) {
    const nome = nomeDoGrupo(conta);
    const chave = nome.toLocaleUpperCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
    const grupo = grupos.get(chave) || { chave, nome, contas: [], quantidade: 0, total: 0, vencimentoMaisAntigo: '', vencidas: 0 };
    grupo.contas.push(conta);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()]
    .map((grupo) => {
      const ordenadas = [...grupo.contas].sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
      return {
        ...grupo,
        // O nome como foi escrito na nota mais antiga: nao muda conforme a ordem do banco.
        nome: nomeDoGrupo(ordenadas[0]),
        contas: ordenadas,
        quantidade: ordenadas.length,
        total: ordenadas.reduce((soma, c) => soma + centavos(c.valor), 0) / 100,
        vencimentoMaisAntigo: ordenadas.find((c) => c.vencimento)?.vencimento || '',
        vencidas: ordenadas.filter((c) => c.vencimento && c.vencimento < hoje).length,
      };
    })
    .sort((a, b) => (a.vencimentoMaisAntigo || '9999').localeCompare(b.vencimentoMaisAntigo || '9999') || a.nome.localeCompare(b.nome, 'pt-BR'));
};
