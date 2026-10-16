import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { differenceInCalendarDays } from './dateTime';

/*
 * RELATORIO DE CHEQUES (pedido do dono, 16/10/2026): "Mais opcoes ›
 * Relatorio" em Financeiro › Cheques, no padrao dos outros relatorios. Sai a
 * aba aberta (recebidos ou emitidos) com a situacao, o periodo e a busca da
 * tela -- a lista de cheques por "bom para" que a loja confere no banco.
 *
 * Regra pura: a tela entrega os cheques ja' filtrados e com o valor liquido.
 */

export interface ChequeDoRelatorio {
  id: string;
  /** entrada = recebido de cliente; saida = emitido pela empresa. */
  tipo: 'entrada' | 'saida';
  status: string;
  /** Cliente (recebido) ou fornecedor (emitido). */
  pessoa: string;
  descricao: string;
  bancoEmissor?: string;
  numero?: string;
  agencia?: string;
  emitente?: string;
  /** Banco onde cai (recebido) ou de onde sai (emitido). */
  bancoDestino?: string;
  /** "Bom para" (AAAA-MM-DD). */
  bomPara: string;
  dataPagamento?: string;
  valorCentavos: number;
}

const dataBr = (dia?: string): string => (dia && /^\d{4}-\d{2}-\d{2}/.test(dia) ? dia.slice(0, 10).split('-').reverse().join('/') : '');

const pendente = (c: ChequeDoRelatorio): boolean => c.status === 'Pendente';

/** Dias de atraso de um cheque a compensar (0 = nao venceu). */
export const diasDeAtrasoDoCheque = (c: ChequeDoRelatorio, hoje: string): number => {
  if (!pendente(c)) return 0;
  const dias = differenceInCalendarDays(hoje, c.bomPara);
  return dias !== null && dias < 0 ? Math.abs(dias) : 0;
};

export const situacaoDoCheque = (c: ChequeDoRelatorio, hoje: string): string => {
  if (c.status === 'Paga') return 'Compensado';
  if (c.status === 'Cancelada') return 'Cancelado';
  const atraso = diasDeAtrasoDoCheque(c, hoje);
  if (atraso > 0) return `Vencido há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}`;
  return 'A compensar';
};

interface PessoaDoResumo {
  pessoa: string;
  cheques: number;
  valorCentavos: number;
}

export const resumoPorPessoaCheques = (cheques: ChequeDoRelatorio[]): PessoaDoResumo[] => {
  const mapa = new Map<string, PessoaDoResumo>();
  cheques.forEach((c) => {
    const pessoa = c.pessoa.trim() || 'Não identificado';
    const chave = pessoa.toUpperCase();
    const atual = mapa.get(chave) || { pessoa, cheques: 0, valorCentavos: 0 };
    atual.cheques += 1;
    atual.valorCentavos += c.valorCentavos;
    mapa.set(chave, atual);
  });
  return [...mapa.values()].sort((a, b) => b.valorCentavos - a.valorCentavos || a.pessoa.localeCompare(b.pessoa, 'pt-BR'));
};

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

export interface DocumentoCheques {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const montarDocumentoCheques = (
  cheques: ChequeDoRelatorio[],
  opcoes: { emitidos: boolean; filtrosAplicados: string[]; periodo: string; dataHoje: string },
): DocumentoCheques => {
  const lista = [...cheques].sort((a, b) => a.bomPara.localeCompare(b.bomPara));
  const total = lista.reduce((soma, c) => soma + c.valorCentavos, 0);
  const aCompensar = lista.filter(pendente).reduce((soma, c) => soma + c.valorCentavos, 0);
  const vencidos = lista.filter((c) => diasDeAtrasoDoCheque(c, opcoes.dataHoje) > 0);

  const colunas: ColunaRelatorio<ChequeDoRelatorio>[] = [
    { id: 'bomPara', titulo: 'Bom para', tipo: 'texto', largura: 20, valor: (c) => dataBr(c.bomPara) },
    { id: 'pessoa', titulo: opcoes.emitidos ? 'Fornecedor' : 'Cliente', tipo: 'texto', largura: 50, valor: (c) => c.pessoa || 'Não identificado' },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 56, padrao: false, valor: (c) => c.descricao || '' },
    { id: 'banco', titulo: opcoes.emitidos ? 'Banco da empresa' : 'Banco emissor', tipo: 'texto', largura: 30, valor: (c) => (opcoes.emitidos ? (c.bancoDestino || c.bancoEmissor || '') : (c.bancoEmissor || '')) },
    { id: 'numero', titulo: 'Nº cheque', tipo: 'texto', largura: 20, valor: (c) => c.numero || '' },
    { id: 'agencia', titulo: 'Agência', tipo: 'texto', largura: 16, padrao: false, valor: (c) => c.agencia || '' },
    { id: 'emitente', titulo: 'Emitente', tipo: 'texto', largura: 40, padrao: false, valor: (c) => c.emitente || '' },
    ...(opcoes.emitidos ? [] : [{
      id: 'destino', titulo: 'Cai no banco', tipo: 'texto' as const, largura: 30, padrao: false,
      valor: (c: ChequeDoRelatorio) => c.bancoDestino || 'Escolhido ao compensar',
    }]),
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (c) => c.valorCentavos },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 30, valor: (c) => situacaoDoCheque(c, opcoes.dataHoje) },
    { id: 'compensado', titulo: 'Compensado em', tipo: 'texto', largura: 20, padrao: false, valor: (c) => (c.status === 'Paga' ? dataBr(c.dataPagamento) : '') },
  ];

  const colunasPessoa: ColunaRelatorio<PessoaDoResumo>[] = [
    { id: 'pessoa', titulo: opcoes.emitidos ? 'Fornecedor' : 'Cliente', tipo: 'texto', largura: 70, valor: (p) => p.pessoa },
    { id: 'cheques', titulo: 'Cheques', tipo: 'inteiro', valor: (p) => p.cheques },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (p) => p.valorCentavos },
  ];

  return {
    titulo: opcoes.emitidos ? 'Cheques Emitidos' : 'Cheques Recebidos',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Cheques', valor: String(lista.length) },
      { rotulo: 'Valor total', valor: moeda(total) },
      { rotulo: 'A compensar', valor: moeda(aCompensar) },
      { rotulo: 'Vencidos', valor: `${vencidos.length} (${moeda(vencidos.reduce((soma, c) => soma + c.valorCentavos, 0))})` },
    ],
    secoes: [
      {
        id: 'cheques', titulo: 'Cheques', colunas, linhas: lista, opcional: true, padrao: true,
        unidade: ['cheque', 'cheques'], mensagemVazia: 'Nenhum cheque com esses filtros.',
      } as SecaoRelatorio,
      {
        id: 'pessoas', titulo: opcoes.emitidos ? 'Por fornecedor' : 'Por cliente', colunas: colunasPessoa, linhas: resumoPorPessoaCheques(lista),
        opcional: true, padrao: false, unidade: opcoes.emitidos ? ['fornecedor', 'fornecedores'] : ['cliente', 'clientes'],
        mensagemVazia: 'Nenhum cheque com esses filtros.',
      } as SecaoRelatorio,
    ],
  };
};
