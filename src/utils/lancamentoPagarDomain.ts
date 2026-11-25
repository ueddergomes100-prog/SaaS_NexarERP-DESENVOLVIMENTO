/*
 * CONTAS A PAGAR PELO SERVIDOR (item 15 da Embala Minas, fase 2, 25/11/2026).
 *
 * Lancar despesa (uma, parcelada ou em cheques), alterar (inclusive valor e
 * vencimento) e cancelar gravavam direto do navegador no Firestore. Agora
 * passam por POST /api/financeiro/pagar/lancar|editar|cancelar, cada uma com a
 * sua permissao (financeiro.pagar_lancar / _editar / _cancelar) e o registro
 * no Historico de alteracoes feito pelo servidor. A regra dos titulos e' a
 * MESMA de antes (despesaParceladaDomain.ts): aqui so' o que o servidor
 * precisa a mais -- ler o pedido da tela, dizer o que bloqueia e o que mudou.
 *
 * O nome do fornecedor, do veiculo, do motorista e do banco do cheque vem do
 * cadastro (lido no servidor), nunca do que a tela mandou.
 *
 * Funcoes puras, compiladas para o servidor (scripts/build-server-domain.mjs).
 */
import { fromCents, toCents } from './financeDomain';
import { FORMAS_DE_PAGAMENTO } from './pagamentoEntradaDomain';
import type { BancoDoCheque, ParcelaComCheque } from './chequeEmitidoDomain';
import { montarTitulosDaDespesa, type DadosDaDespesa } from './despesaParceladaDomain';

export const LIMITE_PARCELAS_DESPESA = 60;
export const MOTIVO_MINIMO_CANCELAR_DESPESA = 12;

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
const texto = (v: unknown, limite: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, limite);
const dataValida = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATA_VALIDA.test(v)) return false;
  const ano = Number(v.slice(0, 4));
  const d = new Date(`${v}T12:00:00Z`);
  return ano >= 2000 && ano <= 2100 && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
/** Id opcional de cadastro: '' (nenhum) ou um id valido; null = invalido. */
const idOpcional = (v: unknown): string | null => {
  const id = String(v ?? '').trim();
  if (!id) return '';
  return ID_VALIDO.test(id) ? id : null;
};

export interface PedidoDeDespesa {
  /** Gerado na tela ao abrir a janela: repetir o envio (internet caiu) nao lanca duas vezes. */
  idLancamento: string;
  descricao: string;
  categoria: string;
  forma: string;
  totalCentavos: number;
  fornecedorId: string;
  veiculoId: string;
  motoristaId: string;
  /** Uma por titulo. Sem parcelamento nem cheque: uma so', no vencimento informado. */
  parcelas: ParcelaComCheque[];
  /** A soma das parcelas nao fecha com o total e a pessoa marcou "Conferi as parcelas". */
  aceitarSomaDiferente: boolean;
}

/** POST /api/financeiro/pagar/lancar. Valida antes de qualquer leitura no banco. */
export const lerPedidoDeDespesa = (corpo: unknown): { erro: string } | { pedido: PedidoDeDespesa } => {
  const c = objeto(corpo);
  const idLancamento = String(c.idLancamento ?? '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idLancamento)) return { erro: 'Lançamento inválido. Feche a janela e lance de novo.' };
  const descricao = texto(c.descricao, 200);
  if (!descricao) return { erro: 'Informe a descrição da despesa.' };
  const categoria = texto(c.categoria, 80);
  if (!categoria) return { erro: 'Escolha a categoria da despesa.' };
  const forma = String(c.forma ?? '');
  if (!(FORMAS_DE_PAGAMENTO as readonly string[]).includes(forma)) return { erro: 'Escolha a forma de pagamento da despesa.' };
  const totalCentavos = Number(c.totalCentavos);
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) return { erro: 'Informe o valor da despesa (maior que zero).' };
  const fornecedorId = idOpcional(c.fornecedorId);
  const veiculoId = idOpcional(c.veiculoId);
  const motoristaId = idOpcional(c.motoristaId);
  if (fornecedorId === null) return { erro: 'Fornecedor inválido. Busque de novo e selecione na lista, ou deixe em branco.' };
  if (veiculoId === null || motoristaId === null) return { erro: 'Veículo ou motorista inválido. Escolha de novo na lista.' };

  let parcelas: ParcelaComCheque[];
  if (Array.isArray(c.parcelas) && c.parcelas.length > 0) {
    if (c.parcelas.length > LIMITE_PARCELAS_DESPESA) return { erro: `Lance no máximo ${LIMITE_PARCELAS_DESPESA} parcelas de uma vez.` };
    parcelas = [];
    for (const [i, bruta] of c.parcelas.entries()) {
      const p = objeto(bruta);
      if (!dataValida(p.vencimento)) return { erro: `A parcela ${i + 1} está sem data de vencimento válida.` };
      const valorCentavos = Number(p.valorCentavos);
      if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return { erro: `A parcela ${i + 1} precisa ter valor maior que zero.` };
      const bancoId = idOpcional(p.bancoId);
      if (bancoId === null) return { erro: `Escolha de novo o banco do cheque da parcela ${i + 1}.` };
      const numeroCheque = texto(p.numeroCheque, 30);
      parcelas.push({
        numero: texto(p.numero, 10) || String(i + 1),
        vencimento: p.vencimento,
        valor: fromCents(valorCentavos),
        ...(bancoId ? { bancoId } : {}),
        ...(numeroCheque ? { numeroCheque } : {}),
      });
    }
  } else {
    if (forma === 'Cheque') return { erro: 'Despesa em cheque: informe o banco, o número e a data de cada cheque.' };
    if (!dataValida(c.vencimento)) return { erro: 'Informe uma data de vencimento válida.' };
    parcelas = [{ numero: '1', vencimento: c.vencimento, valor: fromCents(totalCentavos) }];
  }

  return {
    pedido: {
      idLancamento,
      descricao,
      categoria,
      forma,
      totalCentavos,
      fornecedorId,
      veiculoId,
      motoristaId,
      parcelas,
      aceitarSomaDiferente: c.aceitarSomaDiferente === true,
    },
  };
};

/** Cadastros lidos no servidor para a despesa (so' os escolhidos). */
export interface CadastrosDaDespesa {
  fornecedor?: { id: string; nome: string } | null;
  veiculo?: { id: string; nome: string; placa?: string } | null;
  motorista?: { id: string; nome: string } | null;
}

export const dadosDaDespesa = (pedido: PedidoDeDespesa, cadastros: CadastrosDaDespesa): DadosDaDespesa => ({
  descricao: pedido.descricao,
  categoria: pedido.categoria,
  forma: pedido.forma,
  ...(cadastros.fornecedor ? { fornecedorId: cadastros.fornecedor.id, fornecedorNome: cadastros.fornecedor.nome } : {}),
  ...(cadastros.veiculo ? { veiculoId: cadastros.veiculo.id, veiculoNome: cadastros.veiculo.nome, ...(cadastros.veiculo.placa ? { veiculoPlaca: cadastros.veiculo.placa } : {}) } : {}),
  ...(cadastros.motorista ? { motoristaId: cadastros.motorista.id, motoristaNome: cadastros.motorista.nome } : {}),
});

export const idDoTituloDaDespesa = (idLancamento: string, indice: number, total: number) => (
  total === 1 ? `desp_${idLancamento}` : `desp_${idLancamento}_p${indice + 1}`
);

/**
 * Os titulos (um por parcela) como ficam em `transacoes` -- os mesmos campos
 * de montarTitulosDaDespesa + quem lancou; sem os carimbos de data do
 * servidor, que o servico acrescenta. Nada `undefined`.
 */
export const titulosDaDespesaParaGravar = (
  pedido: PedidoDeDespesa,
  cadastros: CadastrosDaDespesa,
  bancos: BancoDoCheque[],
  usuario: { uid: string; nome: string; email?: string },
): Array<{ id: string; campos: Record<string, unknown> }> => {
  const titulos = montarTitulosDaDespesa(dadosDaDespesa(pedido, cadastros), pedido.parcelas, bancos, pedido.idLancamento);
  return titulos.map((titulo, i) => ({
    id: idDoTituloDaDespesa(pedido.idLancamento, i, titulos.length),
    campos: {
      ...titulo,
      lancadoPor: usuario.uid,
      lancadoPorNome: usuario.nome,
      ...(usuario.email ? { lancadoPorEmail: usuario.email } : {}),
      idempotencyKey: `despesa:${pedido.idLancamento}:parcela:${i + 1}`,
    },
  }));
};

// ---------------------------------------------------------------------------
// Alterar e cancelar
// ---------------------------------------------------------------------------

export interface DespesaGravada {
  tipo?: string;
  status?: string;
  descricao?: string;
  categoria?: string;
  data?: string;
  valor?: number;
  valorCentavos?: number;
  osId?: string | null;
  vendaId?: string | null;
  fornecedorId?: string | null;
  fornecedorNome?: string | null;
  veiculoId?: string | null;
  veiculoNome?: string | null;
  veiculoPlaca?: string | null;
  motoristaId?: string | null;
  motoristaNome?: string | null;
}

/** Por que esta despesa NAO pode ser alterada/cancelada agora ('' = pode). A frase diz o que fazer. */
export const bloqueioParaMexerNaDespesa = (t: DespesaGravada, acao: 'editar' | 'cancelar'): string => {
  const verbo = acao === 'editar' ? 'alterada' : 'cancelada';
  if (t.tipo !== 'saida') return 'Só contas do Contas a Pagar são mexidas aqui.';
  if (t.osId || t.vendaId) return `Esta conta veio de ${t.osId ? 'uma OS' : 'uma venda'} e só muda por lá.`;
  if (t.status === 'Paga') return `Esta despesa já foi paga. Para ela ser ${verbo}, estorne o pagamento antes (botão Estornar).`;
  if (t.status === 'Cancelada') return 'Esta despesa já está cancelada.';
  if (t.status !== 'Pendente') return `Só despesas em aberto podem ser ${verbo}s. Atualize a tela e tente de novo.`;
  return '';
};

export interface PedidoDeEdicaoDespesa {
  transacaoId: string;
  descricao: string;
  categoria: string;
  valorCentavos: number;
  vencimento: string;
  fornecedorId: string;
  veiculoId: string;
  motoristaId: string;
}

/** POST /api/financeiro/pagar/editar. */
export const lerPedidoDeEdicaoDespesa = (corpo: unknown): { erro: string } | { pedido: PedidoDeEdicaoDespesa } => {
  const c = objeto(corpo);
  const transacaoId = String(c.transacaoId ?? '');
  if (!ID_VALIDO.test(transacaoId)) return { erro: 'Conta inválida. Atualize a tela e tente de novo.' };
  const descricao = texto(c.descricao, 220);
  if (!descricao) return { erro: 'Informe a descrição da despesa.' };
  const categoria = texto(c.categoria, 80);
  if (!categoria) return { erro: 'Escolha a categoria da despesa.' };
  const valorCentavos = Number(c.valorCentavos);
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return { erro: 'Informe o valor da despesa (maior que zero).' };
  if (!dataValida(c.vencimento)) return { erro: 'Informe uma data de vencimento válida.' };
  const fornecedorId = idOpcional(c.fornecedorId);
  const veiculoId = idOpcional(c.veiculoId);
  const motoristaId = idOpcional(c.motoristaId);
  if (fornecedorId === null) return { erro: 'Fornecedor inválido. Busque de novo e selecione na lista, ou deixe em branco.' };
  if (veiculoId === null || motoristaId === null) return { erro: 'Veículo ou motorista inválido. Escolha de novo na lista.' };
  return { pedido: { transacaoId, descricao, categoria, valorCentavos, vencimento: c.vencimento, fornecedorId, veiculoId, motoristaId } };
};

const reais = (centavos: number) => `R$ ${fromCents(centavos).toFixed(2).replace('.', ',')}`;
const dataBr = (data: unknown) => {
  const v = String(data ?? '');
  return DATA_VALIDA.test(v) ? v.split('-').reverse().join('/') : v;
};

export interface MudancaDaDespesa {
  campo: string;
  valorAnterior: string;
  valorNovo: string;
}

/** Centavos atuais do titulo (valorCentavos, ou o valor antigo em reais). */
export const centavosDaDespesa = (t: DespesaGravada): number => (
  typeof t.valorCentavos === 'number' && Number.isInteger(t.valorCentavos)
    ? t.valorCentavos
    : toCents(Number(t.valor || 0))
);

/**
 * O que muda na despesa alterada: `campos` a gravar, `remover` (chaves que
 * saem -- fornecedor/veiculo/motorista tirados) e `alteracoes` para o
 * Historico. Fornecedor/veiculo/motorista que nao mudaram ficam como estao
 * (nem precisam estar ativos no cadastro).
 */
export const mudancasDaEdicaoDespesa = (
  atual: DespesaGravada,
  pedido: PedidoDeEdicaoDespesa,
  cadastros: CadastrosDaDespesa,
): { campos: Record<string, unknown>; remover: string[]; alteracoes: MudancaDaDespesa[] } => {
  const campos: Record<string, unknown> = {};
  const remover: string[] = [];
  const alteracoes: MudancaDaDespesa[] = [];
  const anotar = (campo: string, de: string, para: string) => alteracoes.push({ campo, valorAnterior: de, valorNovo: para });

  // So' maiuscula/minuscula diferente (ex.: "(Parcela 1/2)") nao e' mudanca.
  const descricaoAtual = String(atual.descricao ?? '');
  const descricao = pedido.descricao.toUpperCase() === descricaoAtual.toUpperCase() ? descricaoAtual : pedido.descricao.toUpperCase();
  if (descricao !== descricaoAtual) { campos.descricao = descricao; anotar('Descrição', descricaoAtual, descricao); }
  const categoria = pedido.categoria.toUpperCase();
  if (categoria !== String(atual.categoria ?? '')) { campos.categoria = categoria; anotar('Categoria', String(atual.categoria ?? ''), categoria); }
  const centavosAtuais = centavosDaDespesa(atual);
  if (pedido.valorCentavos !== centavosAtuais) {
    campos.valor = fromCents(pedido.valorCentavos);
    campos.valorCentavos = pedido.valorCentavos;
    anotar('Valor', reais(centavosAtuais), reais(pedido.valorCentavos));
  }
  if (pedido.vencimento !== String(atual.data ?? '')) { campos.data = pedido.vencimento; anotar('Vencimento', dataBr(atual.data), dataBr(pedido.vencimento)); }

  const idAtual = (v: unknown) => String(v ?? '').trim();
  // Fornecedor
  if (pedido.fornecedorId !== idAtual(atual.fornecedorId)) {
    if (pedido.fornecedorId && cadastros.fornecedor) {
      campos.fornecedorId = cadastros.fornecedor.id;
      campos.fornecedorNome = cadastros.fornecedor.nome;
    } else remover.push('fornecedorId', 'fornecedorNome');
    anotar('Fornecedor', String(atual.fornecedorNome ?? ''), cadastros.fornecedor?.nome || '');
  }
  // Veiculo da frota
  if (pedido.veiculoId !== idAtual(atual.veiculoId)) {
    if (pedido.veiculoId && cadastros.veiculo) {
      campos.veiculoId = cadastros.veiculo.id;
      campos.veiculoNome = cadastros.veiculo.nome;
      if (cadastros.veiculo.placa) campos.veiculoPlaca = cadastros.veiculo.placa; else remover.push('veiculoPlaca');
    } else remover.push('veiculoId', 'veiculoNome', 'veiculoPlaca');
    anotar('Veículo', String(atual.veiculoNome ?? ''), cadastros.veiculo?.nome || '');
  }
  // Motorista
  if (pedido.motoristaId !== idAtual(atual.motoristaId)) {
    if (pedido.motoristaId && cadastros.motorista) {
      campos.motoristaId = cadastros.motorista.id;
      campos.motoristaNome = cadastros.motorista.nome;
    } else remover.push('motoristaId', 'motoristaNome');
    anotar('Motorista', String(atual.motoristaNome ?? ''), cadastros.motorista?.nome || '');
  }
  return { campos, remover, alteracoes };
};

/** POST /api/financeiro/pagar/cancelar. */
export const lerPedidoDeCancelamentoDespesa = (corpo: unknown): { erro: string } | { pedido: { transacaoId: string; motivo: string } } => {
  const c = objeto(corpo);
  const transacaoId = String(c.transacaoId ?? '');
  if (!ID_VALIDO.test(transacaoId)) return { erro: 'Conta inválida. Atualize a tela e tente de novo.' };
  const motivo = texto(c.motivo, 300);
  if (motivo.length < MOTIVO_MINIMO_CANCELAR_DESPESA) return { erro: `Escreva o motivo do cancelamento (pelo menos ${MOTIVO_MINIMO_CANCELAR_DESPESA} letras).` };
  return { pedido: { transacaoId, motivo } };
};
