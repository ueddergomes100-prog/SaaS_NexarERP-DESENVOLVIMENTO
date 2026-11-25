/**
 * Extrato da tela Banco separado por banco (25/11/2026, pedido do dono: "ter as
 * colunas separadas certinho de cada banco, ta muito misturado ... e ter como
 * filtrar banco por banco").
 *
 * Antes o extrato era uma lista so', na ordem em que os lancamentos foram
 * gravados, sem dizer de que banco era cada linha, e a coluna Data mostrava o
 * VENCIMENTO -- um boleto pago no dia 23 aparecia no dia 27. Aqui: cada linha
 * vai para o grupo do banco dela (os bancos na ordem do cadastro; lancamento sem
 * banco num grupo proprio, no fim), com a data em que o dinheiro entrou ou saiu.
 *
 * So' regra pura: a tela (pages/Financeiro/Banco.tsx) converte os lancamentos
 * para LinhaDoExtrato com o valor liquido em centavos.
 */

/** Valor do filtro que mostra todos os bancos. */
export const TODOS_OS_BANCOS = 'todos';
/** Grupo dos lancamentos que nao dizem em que banco cairam (vendas antigas). */
export const SEM_BANCO = 'sem-banco';
export const NOME_SEM_BANCO = 'Sem banco definido';

export interface BancoDoExtrato {
  id: string;
  nome: string;
}

export interface LinhaDoExtrato {
  id: string;
  bancoId?: string;
  bancoNome?: string;
  tipo: 'entrada' | 'saida';
  /** Valor liquido, sempre positivo; o sinal vem do tipo. */
  centavos: number;
  /** Data do pagamento (AAAA-MM-DD); sem ela, a data do lancamento. */
  dataPagamento?: string;
  data?: string;
  /** Desempate entre linhas do mesmo dia: a gravada por ultimo vem primeiro. */
  criadoEmMs?: number;
}

export interface GrupoDoExtrato<T extends LinhaDoExtrato = LinhaDoExtrato> {
  chave: string;
  nome: string;
  linhas: T[];
  entradasCentavos: number;
  saidasCentavos: number;
  /** Entradas menos saidas no periodo (pode ser negativo). */
  resultadoCentavos: number;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Data que o extrato mostra: a do pagamento; sem ela, a do lancamento. '' quando nao ha nenhuma valida. */
export const dataDoExtrato = (linha: { dataPagamento?: string; data?: string }): string => {
  const pagamento = String(linha.dataPagamento || '').slice(0, 10);
  if (DATA_ISO.test(pagamento)) return pagamento;
  const data = String(linha.data || '').slice(0, 10);
  return DATA_ISO.test(data) ? data : '';
};

/** "2026-11-23" -> "23/11/2026"; vazio -> "-". */
export const formatarDataDoExtrato = (iso: string): string => (iso ? iso.split('-').reverse().join('/') : '-');

/**
 * Grupo de um lancamento: o id do banco quando ele existe no cadastro; senao o
 * banco com o mesmo nome (lancamento antigo so' com o nome); senao "sem banco".
 */
export const chaveDoBanco = (
  linha: { bancoId?: string; bancoNome?: string },
  bancos: BancoDoExtrato[],
): string => {
  const id = String(linha.bancoId || '').trim();
  if (id && bancos.some((b) => b.id === id)) return id;
  const nome = String(linha.bancoNome || '').trim().toLowerCase();
  if (nome) {
    const peloNome = bancos.find((b) => b.nome.trim().toLowerCase() === nome);
    if (peloNome) return peloNome.id;
  }
  return id || SEM_BANCO;
};

const maisRecentePrimeiro = (a: LinhaDoExtrato, b: LinhaDoExtrato) => {
  const porData = dataDoExtrato(b).localeCompare(dataDoExtrato(a));
  if (porData !== 0) return porData;
  return (b.criadoEmMs || 0) - (a.criadoEmMs || 0);
};

/**
 * Separa o extrato por banco. Ordem dos grupos: a dos bancos recebidos (a do
 * cadastro); banco que nao esta na lista (inativo, excluido) depois, pelo nome
 * gravado no lancamento; "sem banco" por ultimo. Banco sem lancamento no
 * periodo nao vira grupo. Dentro do grupo, do mais recente para o mais antigo.
 */
export const agruparExtratoPorBanco = <T extends LinhaDoExtrato>(
  linhas: T[],
  bancos: BancoDoExtrato[],
): GrupoDoExtrato<T>[] => {
  const porChave = new Map<string, GrupoDoExtrato<T>>();
  for (const linha of linhas) {
    const chave = chaveDoBanco(linha, bancos);
    let grupo = porChave.get(chave);
    if (!grupo) {
      const doCadastro = bancos.find((b) => b.id === chave);
      const nome = chave === SEM_BANCO
        ? NOME_SEM_BANCO
        : (doCadastro?.nome || String(linha.bancoNome || '').trim() || NOME_SEM_BANCO);
      grupo = { chave, nome, linhas: [], entradasCentavos: 0, saidasCentavos: 0, resultadoCentavos: 0 };
      porChave.set(chave, grupo);
    }
    grupo.linhas.push(linha);
    const valor = Math.max(0, Math.round(Number(linha.centavos) || 0));
    if (linha.tipo === 'saida') grupo.saidasCentavos += valor;
    else grupo.entradasCentavos += valor;
  }
  const ordemDoCadastro = new Map(bancos.map((b, i) => [b.id, i]));
  const grupos = [...porChave.values()];
  grupos.forEach((g) => {
    g.linhas.sort(maisRecentePrimeiro);
    g.resultadoCentavos = g.entradasCentavos - g.saidasCentavos;
  });
  return grupos.sort((a, b) => {
    if (a.chave === SEM_BANCO) return 1;
    if (b.chave === SEM_BANCO) return -1;
    const ia = ordemDoCadastro.has(a.chave) ? ordemDoCadastro.get(a.chave)! : Number.MAX_SAFE_INTEGER;
    const ib = ordemDoCadastro.has(b.chave) ? ordemDoCadastro.get(b.chave)! : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
};

/** O lancamento entra no filtro escolhido? ("todos" deixa tudo passar.) */
export const pertenceAoFiltro = (
  linha: { bancoId?: string; bancoNome?: string },
  filtro: string,
  bancos: BancoDoExtrato[],
): boolean => filtro === TODOS_OS_BANCOS || chaveDoBanco(linha, bancos) === filtro;

/**
 * Cor de cada banco (a faixa do cartao e das linhas dele), pela posicao no
 * cadastro: a mesma cor em toda a tela. Cores que leem no tema claro e no escuro.
 */
export const CORES_DOS_BANCOS = ['#2563eb', '#0d9488', '#d97706', '#9333ea', '#db2777', '#0891b2', '#65a30d', '#dc2626'];
export const COR_SEM_BANCO = '#94a3b8';

export const corDoBanco = (chave: string, bancos: BancoDoExtrato[]): string => {
  if (chave === SEM_BANCO) return COR_SEM_BANCO;
  const i = bancos.findIndex((b) => b.id === chave);
  return i < 0 ? COR_SEM_BANCO : CORES_DOS_BANCOS[i % CORES_DOS_BANCOS.length];
};
