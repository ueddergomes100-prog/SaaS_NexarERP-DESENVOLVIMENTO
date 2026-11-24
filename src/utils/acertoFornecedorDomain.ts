/**
 * ACERTO COM FORNECEDOR: o cliente paga direto o fornecedor (pedido do dono,
 * 24/11/2026, cliente Jomarly).
 *
 * "O cliente deve R$ 1.000 e a loja tem uma conta de R$ 500 com um fornecedor
 * e R$ 500 com outro. A loja pede para o cliente pagar direto os fornecedores."
 *
 * Uma operacao so' baixa as duas pontas: as contas a receber do cliente e as
 * contas a pagar dos fornecedores, pelo MESMO total, com a forma "Acerto com
 * Fornecedor". Nao mexe em caixa nem em banco: o dinheiro nunca passou pela
 * loja. Regras:
 *  - os dois lados somam o mesmo valor (o que o cliente pagou aos fornecedores
 *    e' exatamente o que sai da divida dele);
 *  - cada conta pode entrar por inteiro ou em parte (o resto fica em aberto,
 *    como no pagamento parcial de sempre);
 *  - todas as contas a receber sao do mesmo devedor;
 *  - serve tambem quando a mesma empresa e' cliente e fornecedor (ele deve e
 *    a loja deve a ele);
 *  - desfazer e' o acerto inteiro, com motivo: as duas pontas voltam juntas.
 *
 * A baixa de cada conta e' a de sempre (services/baixaFinanceira.js), em
 * sequencia, como a baixa em lote; o servidor confere tudo antes de gravar.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */
import { validarDataBaixa, validarMotivoEstorno } from './baixaFinanceiraDomain';

/** Forma gravada nas duas pontas. Nao e' forma de venda: so' existe na baixa do acerto. */
export const FORMA_ACERTO_FORNECEDOR = 'Acerto com Fornecedor';

/** Ate' quantas contas de cada lado num acerto (cada uma e' uma gravacao). */
export const LIMITE_CONTAS_POR_LADO = 20;
export const OBSERVACAO_MAX = 300;

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

export const reaisDoAcerto = (centavos: number): string => (
  `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
);

export interface ContaNoAcerto {
  transacaoId: string;
  /** Quanto desta conta entra no acerto (pode ser menos que o saldo). */
  valorCentavos: number;
}

export interface PedidoDeAcerto {
  /** Gerado na tela: reenviar (a internet caiu) nao faz o acerto duas vezes. */
  idAcerto: string;
  receber: ContaNoAcerto[];
  pagar: ContaNoAcerto[];
  /** yyyy-mm-dd: dia em que o cliente pagou o fornecedor. */
  data: string;
  observacao: string;
}

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;

const lerLado = (bruto: unknown, nome: string): { erro: string } | { contas: ContaNoAcerto[] } => {
  const lista = Array.isArray(bruto) ? bruto : [];
  if (lista.length === 0) return { erro: `Escolha ao menos uma conta ${nome}.` };
  if (lista.length > LIMITE_CONTAS_POR_LADO) {
    return { erro: `Use no máximo ${LIMITE_CONTAS_POR_LADO} contas ${nome} por acerto. Faça em mais de um acerto.` };
  }
  const vistos = new Set<string>();
  const contas: ContaNoAcerto[] = [];
  for (const item of lista) {
    const c = objeto(item);
    const transacaoId = typeof c.transacaoId === 'string' ? c.transacaoId.trim() : '';
    if (!ID_VALIDO.test(transacaoId)) return { erro: 'Conta inválida no acerto. Atualize a tela e escolha de novo.' };
    if (vistos.has(transacaoId)) return { erro: 'A mesma conta apareceu duas vezes no acerto. Atualize a tela e escolha de novo.' };
    vistos.add(transacaoId);
    const valorCentavos = Number(c.valorCentavos);
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
      return { erro: `Informe quanto de cada conta ${nome} entra no acerto (valor maior que zero).` };
    }
    contas.push({ transacaoId, valorCentavos });
  }
  return { contas };
};

export const totalDoLado = (contas: ReadonlyArray<{ valorCentavos: number }>): number => (
  contas.reduce((soma, c) => soma + c.valorCentavos, 0)
);

/** Confere o pedido que veio da tela. Puro. */
export const lerPedidoDeAcerto = (corpo: unknown, hoje: string): { erro: string } | { pedido: PedidoDeAcerto } => {
  const c = objeto(corpo);
  const idAcerto = typeof c.idAcerto === 'string' ? c.idAcerto.trim() : '';
  if (!ID_VALIDO.test(idAcerto)) return { erro: 'Acerto inválido. Atualize a tela e tente de novo.' };
  const receber = lerLado(c.receber, 'do cliente');
  if ('erro' in receber) return receber;
  const pagar = lerLado(c.pagar, 'de fornecedor');
  if ('erro' in pagar) return pagar;
  if (receber.contas.some((r) => pagar.contas.some((p) => p.transacaoId === r.transacaoId))) {
    return { erro: 'A mesma conta está dos dois lados do acerto. Atualize a tela e escolha de novo.' };
  }
  const totalReceber = totalDoLado(receber.contas);
  const totalPagar = totalDoLado(pagar.contas);
  if (totalReceber !== totalPagar) {
    return {
      erro: `Os dois lados precisam somar o mesmo valor: as contas do cliente somam ${reaisDoAcerto(totalReceber)} e as dos fornecedores ${reaisDoAcerto(totalPagar)}. `
        + 'Ajuste o valor de uma das contas (a diferença fica em aberto nela).',
    };
  }
  const data = typeof c.data === 'string' ? c.data.trim() : '';
  const erroData = validarDataBaixa(data, hoje);
  if (erroData) return { erro: erroData };
  const observacao = String(c.observacao ?? '').replace(/\s+/g, ' ').trim().slice(0, OBSERVACAO_MAX);
  return { pedido: { idAcerto, receber: receber.contas, pagar: pagar.contas, data, observacao } };
};

/** O que o servidor leu de cada conta antes de gravar. */
export interface ContaLidaParaAcerto {
  existe: boolean;
  tipo?: unknown;
  status?: unknown;
  /** Saldo em aberto, em centavos. */
  saldoCentavos: number;
  descricao?: unknown;
  /** Conta em cheque, boleto emitido, cartao...: recusa com esta frase ('' = aceita). */
  bloqueio?: string;
  /** Chave de quem deve (so' no lado a receber): `cliente:<id>`, `fornecedor:<id>` ou `nome:<nome>`. */
  devedorChave?: string;
}

/** Por que esta conta nao pode entrar no acerto ('' = pode). */
export const erroDaContaNoAcerto = (lado: 'receber' | 'pagar', conta: ContaLidaParaAcerto, valorCentavos: number): string => {
  const nome = String(conta.descricao || '').trim();
  const rotulo = nome ? `A conta "${nome}"` : 'Uma das contas';
  if (!conta.existe) return 'Uma das contas do acerto não existe mais. Atualize a tela e escolha de novo.';
  if (conta.tipo !== (lado === 'receber' ? 'entrada' : 'saida')) return `${rotulo} não é uma conta ${lado === 'receber' ? 'a receber' : 'a pagar'}. Atualize a tela.`;
  if (conta.status === 'Paga') return `${rotulo} já foi ${lado === 'receber' ? 'recebida' : 'paga'} (talvez por outra pessoa). Atualize a tela.`;
  if (conta.status !== 'Pendente') return `${rotulo} está ${String(conta.status || 'sem situação').toLowerCase()} e não pode entrar no acerto.`;
  if (conta.bloqueio) return `${rotulo} não pode entrar no acerto: ${conta.bloqueio}`;
  if (valorCentavos > conta.saldoCentavos) {
    return `${rotulo} tem ${reaisDoAcerto(conta.saldoCentavos)} em aberto; não dá para acertar ${reaisDoAcerto(valorCentavos)} nela.`;
  }
  return '';
};

/** Todas as contas a receber do acerto sao do mesmo devedor? */
export const erroDeDevedoresDiferentes = (chaves: ReadonlyArray<string>): string => (
  new Set(chaves.filter(Boolean)).size > 1
    ? 'As contas a receber do acerto são de clientes diferentes. Faça um acerto para cada cliente.'
    : ''
);

export type SituacaoDoAcerto = 'em_andamento' | 'concluido' | 'falhou' | 'estornado';

export const ROTULO_SITUACAO_ACERTO: Record<SituacaoDoAcerto, string> = {
  em_andamento: 'Gravando',
  concluido: 'Feito',
  falhou: 'Não concluído',
  estornado: 'Desfeito',
};

/** Pedido de desfazer o acerto. Puro. */
export const lerPedidoDeDesfazerAcerto = (corpo: unknown): { erro: string } | { pedido: { acertoId: string; motivo: string } } => {
  const c = objeto(corpo);
  const acertoId = typeof c.acertoId === 'string' ? c.acertoId.trim() : '';
  if (!ID_VALIDO.test(acertoId)) return { erro: 'Acerto inválido. Atualize a tela e tente de novo.' };
  const erroMotivo = validarMotivoEstorno(c.motivo);
  if (erroMotivo) return { erro: erroMotivo };
  return { pedido: { acertoId, motivo: String(c.motivo).trim() } };
};

/** Texto que fica em cada conta: quem pagou quem. */
export const textoDoAcertoNaConta = (lado: 'receber' | 'pagar', nomes: { cliente: string; fornecedores: string[] }): string => {
  const fornecedores = nomes.fornecedores.filter(Boolean).join(', ') || 'fornecedor';
  return lado === 'receber'
    ? `Pago direto a ${fornecedores}`.slice(0, 200)
    : `Pago por ${nomes.cliente || 'cliente'}`.slice(0, 200);
};

/** Linha do recibo/comprovante do acerto. */
export const fraseDoComprovante = (args: { cliente: string; empresa: string; totalCentavos: number; fornecedores: string[] }): string => (
  `${args.cliente || 'O cliente'} pagou ${reaisDoAcerto(args.totalCentavos)} diretamente a ${args.fornecedores.filter(Boolean).join(', ') || 'fornecedor(es)'}, `
  + `por conta e ordem de ${args.empresa || 'nossa empresa'}. O valor foi abatido das contas do cliente e quitou as contas dos fornecedores relacionadas abaixo.`
);
