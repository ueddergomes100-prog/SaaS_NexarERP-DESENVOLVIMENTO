// Funcoes puras da importacao em massa de Contas a Receber / Contas a
// Pagar. Sem Firestore -- leitura de arquivo, upload, busca de
// cliente/fornecedor e gravacao ficam no componente compartilhado
// src/components/financeiro/ImportarContasBase.tsx.
//
// As duas telas gravam no MESMO formato que o resto do sistema grava em
// `transacoes` pra titulo pendente avulso (ver NotaAvulsaForm.tsx, ramo
// "a_prazo" -- saida pendente sem pagamentos.formaPagamento/naturezaFinanceira
// ainda, que so entram quando o titulo e baixado em Contas a Receber/Pagar):
// descricao, categoria, valor(Centavos), tipo, status, data (usada como
// vencimento -- transactionDueDateInput cai pra "data" quando nao ha
// dataVencimento separado), cliente/fornecedorId+Nome.
//
// Decisao (2026-09-09, implantacao Sol Life): a planilha do sistema antigo
// normalmente so lista titulos EM ABERTO (e' pra isso que se importa saldo
// financeiro de uma migracao) -- por isso o default de status e' sempre
// "Pendente" quando a coluna de situacao nao veio ou nao da pra reconhecer
// o texto, nunca "Paga" por acaso.

import { parseValorMonetario } from './importacaoEstoqueDomain';

export type StatusContaImportada = 'OK' | 'REVISAR';
export type StatusPagamentoConta = 'Pendente' | 'Paga';

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColunaConta = 'descricao' | 'valor' | 'vencimento' | 'categoria' | 'parte' | 'status' | 'dataPagamento';

export interface MapeamentoColunasConta {
  descricao: number;
  valor: number;
  vencimento: number;
  categoria: number | null;
  /** Nome do cliente (Contas a Receber) ou fornecedor (Contas a Pagar). */
  parte: number | null;
  status: number | null;
  dataPagamento: number | null;
}

const SINONIMOS: Record<CampoColunaConta, string[]> = {
  descricao: ['descricao', 'descr', 'historico', 'titulo', 'documento'],
  valor: ['valor', 'total'],
  vencimento: ['vencimento', 'venc'],
  categoria: ['categoria', 'grupo', 'natureza'],
  parte: ['cliente', 'fornecedor', 'razao social', 'razão'],
  status: ['situacao', 'situação', 'status'],
  dataPagamento: ['data pagamento', 'pago em', 'quitacao', 'quitação'],
};

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

export const inferirMapeamentoColunasConta = (cabecalho: string[]): MapeamentoColunasConta => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);
  const encontrar = (campo: CampoColunaConta, evitar: number[] = []): number => normalizados.findIndex(
    (col, idx) => !evitar.includes(idx) && SINONIMOS[campo].some((sin) => col.includes(sin)),
  );

  const vencimento = encontrar('vencimento');
  const dataPagamento = encontrar('dataPagamento', vencimento >= 0 ? [vencimento] : []);
  const categoria = encontrar('categoria');
  const parte = encontrar('parte');
  const status = encontrar('status');
  const valor = encontrar('valor');
  const descricao = encontrar('descricao');

  return {
    descricao: descricao >= 0 ? descricao : 0,
    valor: valor >= 0 ? valor : 1,
    vencimento: vencimento >= 0 ? vencimento : 2,
    categoria: categoria >= 0 ? categoria : null,
    parte: parte >= 0 ? parte : null,
    status: status >= 0 ? status : null,
    dataPagamento: dataPagamento >= 0 ? dataPagamento : null,
  };
};

// ---------------------------------------------------------------------------
// Interpretacao de data (dd/mm/aaaa do export antigo -> aaaa-mm-dd do sistema)
// ---------------------------------------------------------------------------

export interface DataInterpretada {
  data: string;
  status: StatusContaImportada;
  motivo: string;
}

/** Aceita "dd/mm/aaaa", "dd-mm-aaaa" e "aaaa-mm-dd" (planilha ja no
 * formato do sistema, ou export de outro pais). Nunca inverte dia/mes
 * sozinho quando ambos os numeros sao <= 12 (data ambigua de verdade) --
 * fica REVISAR pro usuario decidir. */
export const interpretarDataConta = (dataBruta: string): DataInterpretada => {
  const bruto = (dataBruta || '').trim();
  if (!bruto) return { data: '', status: 'REVISAR', motivo: 'Data em branco.' };

  const isoMatch = bruto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return { data: bruto, status: 'OK', motivo: '' };

  const brMatch = bruto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (brMatch) {
    const dia = Number(brMatch[1]);
    const mes = Number(brMatch[2]);
    const ano = Number(brMatch[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { data: '', status: 'REVISAR', motivo: `Data "${bruto}" não é válida (dia ou mês fora do intervalo).` };
    }
    const data = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    return { data, status: 'OK', motivo: '' };
  }

  return { data: '', status: 'REVISAR', motivo: `Não foi possível interpretar a data "${bruto}" -- use o formato dd/mm/aaaa.` };
};

// ---------------------------------------------------------------------------
// Interpretacao da situacao (Paga / Pendente)
// ---------------------------------------------------------------------------

const TERMOS_PAGA = ['pago', 'paga', 'quitado', 'quitada', 'recebido', 'recebida', 'liquidado', 'liquidada'];

/** So reconhece "Paga" quando o texto bate um termo conhecido -- qualquer
 * outra coisa (em branco, "aberto", "pendente", texto nao reconhecido) cai
 * em Pendente, que e' o caso normal de uma migracao de saldo. */
export const resolverStatusConta = (textoBruto: string): StatusPagamentoConta => {
  const texto = normalizarTextoComparacao(textoBruto);
  if (!texto) return 'Pendente';
  return TERMOS_PAGA.some((termo) => texto.includes(termo)) ? 'Paga' : 'Pendente';
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export interface ContaImportada {
  /** Identificador estavel da linha -- usado pra reconciliar edicoes do
   * usuario na tela sem depender da descricao, que pode repetir. */
  linhaId: number;
  descricao: string;
  valor: number | null;
  valorBruto: string;
  vencimento: string;
  vencimentoBruto: string;
  categoria: string;
  parteNomeBruto: string;
  /** Preenchido pelo componente (precisa da lista de clientes/fornecedores
   * do tenant, que e' Firestore) via resolverParteImportada -- aqui fica
   * so o texto original da planilha. */
  parteId: string | null;
  parteNome: string;
  statusPagamento: StatusPagamentoConta;
  dataPagamento: string;
  status: StatusContaImportada;
  motivo: string;
}

export const processarLinhasContas = (
  linhas: string[][],
  mapeamento: MapeamentoColunasConta,
): ContaImportada[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const descricao = (linha[mapeamento.descricao] || '').trim();
    const valorBruto = (linha[mapeamento.valor] || '').trim();
    const vencimentoBruto = (linha[mapeamento.vencimento] || '').trim();
    const categoria = mapeamento.categoria !== null ? (linha[mapeamento.categoria] || '').trim() : '';
    const parteNomeBruto = mapeamento.parte !== null ? (linha[mapeamento.parte] || '').trim() : '';
    const statusBruto = mapeamento.status !== null ? (linha[mapeamento.status] || '').trim() : '';
    const dataPagamentoBruta = mapeamento.dataPagamento !== null ? (linha[mapeamento.dataPagamento] || '').trim() : '';

    const valor = parseValorMonetario(valorBruto);
    const dataInterpretada = interpretarDataConta(vencimentoBruto);
    const statusPagamento = resolverStatusConta(statusBruto);
    const dataPagamentoInterpretada = statusPagamento === 'Paga'
      ? (dataPagamentoBruta ? interpretarDataConta(dataPagamentoBruta) : dataInterpretada)
      : { data: '', status: 'OK' as StatusContaImportada, motivo: '' };

    const problemas: string[] = [];
    if (!descricao) problemas.push('Descrição em branco.');
    if (valor === null || valor <= 0) problemas.push(`Valor "${valorBruto}" inválido -- precisa ser maior que zero.`);
    if (dataInterpretada.status === 'REVISAR') problemas.push(dataInterpretada.motivo);
    if (statusPagamento === 'Paga' && dataPagamentoInterpretada.status === 'REVISAR') problemas.push(`Data de pagamento: ${dataPagamentoInterpretada.motivo}`);
    const status: StatusContaImportada = problemas.length > 0 ? 'REVISAR' : 'OK';

    return {
      linhaId: index,
      descricao,
      valor,
      valorBruto,
      vencimento: dataInterpretada.data,
      vencimentoBruto,
      categoria,
      parteNomeBruto,
      parteId: null,
      parteNome: parteNomeBruto.toUpperCase(),
      statusPagamento,
      dataPagamento: dataPagamentoInterpretada.data,
      status,
      motivo: problemas.join(' '),
    };
  })
  .filter((item) => item.descricao || item.valorBruto);

// ---------------------------------------------------------------------------
// Vinculo com cliente/fornecedor ja cadastrado
// ---------------------------------------------------------------------------

export interface ParteCadastrada {
  id: string;
  nome: string;
}

/** So vincula em MATCH EXATO (apos normalizar acento/caixa) -- nunca
 * "acha parecido" sozinho, pra nao grudar um titulo no cadastro errado.
 * Sem match, o titulo entra so com o nome em texto (parteNome), do jeito
 * que despesa avulsa sem fornecedor ja funciona em ContasPagar.tsx. */
export const resolverParteImportada = (
  nomeBruto: string,
  partesDisponiveis: ParteCadastrada[],
): { id: string | null; nome: string } => {
  const nome = nomeBruto.trim().toUpperCase();
  if (!nome) return { id: null, nome: '' };
  const chave = normalizarTextoComparacao(nome);
  const encontrada = partesDisponiveis.find((p) => normalizarTextoComparacao(p.nome) === chave);
  return encontrada ? { id: encontrada.id, nome: encontrada.nome } : { id: null, nome };
};

// ---------------------------------------------------------------------------
// Montagem da transacao final (mesmo formato que NotaAvulsaForm.tsx grava
// pra titulo pendente avulso, ver cabecalho do arquivo)
// ---------------------------------------------------------------------------

export interface ContaParaImportar {
  descricao: string;
  categoria: string;
  valor: number;
  vencimento: string;
  statusPagamento: StatusPagamentoConta;
  dataPagamento: string;
  parteId: string | null;
  parteNome: string;
}

const CATEGORIA_PADRAO: Record<'entrada' | 'saida', string> = {
  entrada: 'VENDAS',
  saida: 'OUTROS',
};

export const montarContaImportada = (
  conta: ContaParaImportar,
  tipo: 'entrada' | 'saida',
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => {
  const valorCentavos = Math.round(conta.valor * 100);
  const campoParteId = tipo === 'entrada' ? 'clienteId' : 'fornecedorId';
  const campoParteNome = tipo === 'entrada' ? 'clienteNome' : 'fornecedorNome';

  return {
    descricao: conta.descricao.trim(),
    categoria: (conta.categoria || CATEGORIA_PADRAO[tipo]).trim().toUpperCase(),
    valor: conta.valor,
    valorCentavos,
    tipo,
    status: conta.statusPagamento,
    data: conta.statusPagamento === 'Paga' ? (conta.dataPagamento || conta.vencimento) : conta.vencimento,
    ...(conta.statusPagamento === 'Paga' ? {
      dataPagamento: conta.dataPagamento || conta.vencimento,
      formaPagamento: 'Outros',
      naturezaFinanceira: 'bancario_digital',
      movimentaCaixaFisico: false,
    } : {}),
    [campoParteId]: conta.parteId,
    ...(conta.parteNome ? { [campoParteNome]: conta.parteNome } : {}),
    tenantId,
    createdAt: timestamp,
    criadoPor: userId,
    criadoEm: timestamp,
    alteradoPor: userId,
    alteradoEm: timestamp,
    origemImportacao: 'migracao_cadastro',
  };
};
