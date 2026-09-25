import { collection, doc, getDoc, getDocs, increment, query, serverTimestamp, where, type Firestore, type Transaction } from 'firebase/firestore';
import { NexusSwal, showWarning } from '../utils/alerts';
import { getDateInputInTimeZone } from '../utils/dateTime';
import { toBaseQuantity, type ItemVendaParaEstoque } from '../utils/embalagemDomain';
import {
  avisoDeLoteVencido,
  distribuirRetornoAosLotes,
  planejarBaixaPorLotes,
  somarLotesUsados,
  type LinhaParaLote,
  type LoteSaldo,
  type LoteUsado,
  type ModoSaidaLote,
  type PlanoDeLotes,
} from '../utils/loteDomain';

/*
 * BAIXA POR LOTE NAS VENDAS (Fase 4, 2026-09-25).
 *
 * REGRA DO DONO: so' o produto marcado "Controlar lote" entra aqui; qualquer outro segue so' com o
 * estoque normal, sem nenhuma leitura extra de lote. O que a venda tira de lote e' um pedaco do
 * estoque -- `estoque.quantidade` continua sendo o total (quem grava isso e' applyStockAdjustments /
 * applyStockFieldDeltas, INALTERADOS). Aqui so' se decide DE QUAL LOTE saiu e se atualiza o saldo do lote.
 *
 * O SDK web nao faz consulta dentro de transacao, entao o fluxo de cada tela e':
 *   1. antes do runTransaction:  const plano = await prepararBaixaDeLotes(...)   (le + escolhe + avisa)
 *   2. dentro da transacao:      baixarLotesNaTransacao(transaction, db, plano...) (so' escreve, sem leitura)
 *   3. no item da venda:         grava `lotes` (lotesDaLinha) para a devolucao/cancelamento voltarem ao mesmo lote.
 */

export interface OpcoesDaBaixaDeLotes {
  db: Firestore;
  tenantId: string;
  linhas: LinhaParaLote[];
  modo: ModoSaidaLote;
  avisarVencido: boolean;
}

/** Linhas de lote a partir dos itens da venda (unidade BASE, sem item avulso). A chave e' o indice do item. */
export const linhasParaLote = (itens: ItemVendaParaEstoque[]): LinhaParaLote[] => (
  itens
    .map((item, indice) => ({
      chave: String(indice),
      produtoId: String(item.id || ''),
      nome: String(item.nome || ''),
      quantidade: toBaseQuantity(item.quantidade, item.fatorConversao),
    }))
    .filter((linha) => linha.produtoId && linha.produtoId !== 'avulso' && linha.quantidade > 0)
);

/** Lotes com saldo dos produtos que CONTROLAM lote. Produto que nao controla nao aparece (nem gasta leitura de lote). */
export const carregarLotesDosProdutosQueControlam = async (db: Firestore, tenantId: string, produtoIds: string[]): Promise<Record<string, LoteSaldo[]>> => {
  const unicos = [...new Set(produtoIds.filter(Boolean))];
  const controlam = (await Promise.all(unicos.map(async (id) => {
    const snap = await getDoc(doc(db, 'estoque', id));
    return snap.exists() && snap.data().controlarLote === true ? id : null;
  }))).filter((id): id is string => id !== null);

  const resultado: Record<string, LoteSaldo[]> = {};
  await Promise.all(controlam.map(async (produtoId) => {
    const snap = await getDocs(query(collection(db, 'estoque_lotes'), where('tenantId', '==', tenantId), where('produtoId', '==', produtoId)));
    resultado[produtoId] = snap.docs
      .map((d) => ({ id: d.id, lote: String(d.data().lote || ''), validade: d.data().validade ? String(d.data().validade) : null, quantidade: Number(d.data().quantidade || 0) }))
      .filter((l) => l.quantidade > 0);
  }));
  return resultado;
};

const dataBr = (iso: string | null | undefined): string => (iso ? iso.split('-').reverse().join('/') : 'sem validade');
const escaparHtml = (texto: string): string => texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * Modo "informar o lote": pergunta, para cada item que controla lote, de qual lote a mercadoria sai.
 * Ja vem sugerido o que vence primeiro; quem vende so' confirma ou troca. Devolve null se cancelar.
 */
const perguntarOsLotes = async (linhas: LinhaParaLote[], lotesPorProduto: Record<string, LoteSaldo[]>): Promise<Record<string, string> | null> => {
  const pendentes = linhas.filter((l) => (lotesPorProduto[l.produtoId] || []).length > 0);
  if (pendentes.length === 0) return {};
  const linhasHtml = pendentes.map((linha) => {
    const opcoes = (lotesPorProduto[linha.produtoId] || [])
      .map((l) => `<option value="${escaparHtml(l.id)}">${escaparHtml(l.lote)} — validade ${dataBr(l.validade)} — saldo ${l.quantidade}</option>`)
      .join('');
    return `<div style="text-align:left;margin-bottom:14px"><div style="font-weight:600;margin-bottom:4px">${escaparHtml(linha.nome)} <span style="color:#a1a1aa;font-weight:400">· ${linha.quantidade} un.</span></div>`
      + `<select data-chave="${escaparHtml(linha.chave)}" class="swal2-select" style="margin:0;width:100%;background:#27272a;color:#fff"><option value="">Automático (o que vence primeiro)</option>${opcoes}</select></div>`;
  }).join('');
  const resposta = await NexusSwal.fire({
    title: 'Escolha o lote',
    html: `<div style="font-size:13px;color:#a1a1aa;margin-bottom:12px">Estes produtos controlam lote. De qual lote a mercadoria vai sair?</div>${linhasHtml}`,
    showCancelButton: true,
    confirmButtonText: 'Confirmar lotes',
    cancelButtonText: 'Voltar',
    preConfirm: () => {
      const escolhas: Record<string, string> = {};
      document.querySelectorAll<HTMLSelectElement>('select[data-chave]').forEach((select) => {
        if (select.value) escolhas[select.dataset.chave as string] = select.value;
      });
      return escolhas;
    },
  });
  return resposta.isConfirmed ? (resposta.value as Record<string, string>) : null;
};

/**
 * Passo 1 (antes da transacao). Devolve o plano de lotes da venda, ou:
 *  - `{}` vazio (nenhum produto controla lote): nada muda na venda;
 *  - null: quem vende cancelou a escolha do lote -- a tela deve abortar a venda.
 * Lote vencido so' AVISA (decisao do dono): aparece um aviso e a venda segue.
 */
export const prepararBaixaDeLotes = async (opcoes: OpcoesDaBaixaDeLotes): Promise<PlanoDeLotes | null> => {
  const { db, tenantId, linhas, modo, avisarVencido } = opcoes;
  const vazio: PlanoDeLotes = { porLinha: {}, semLote: {}, vencidosUsados: [] };
  if (linhas.length === 0) return vazio;

  const lotesPorProduto = await carregarLotesDosProdutosQueControlam(db, tenantId, linhas.map((l) => l.produtoId));
  if (Object.keys(lotesPorProduto).length === 0) return vazio;

  const hoje = getDateInputInTimeZone();
  const linhasDeLote = linhas.filter((l) => lotesPorProduto[l.produtoId]);
  const preferidos = modo === 'informar' ? await perguntarOsLotes(linhasDeLote, lotesPorProduto) : {};
  if (preferidos === null) return null;

  const plano = planejarBaixaPorLotes(linhasDeLote, lotesPorProduto, hoje, preferidos);
  if (avisarVencido) {
    const aviso = avisoDeLoteVencido(plano.vencidosUsados);
    if (aviso) void showWarning('Lote vencido nesta venda', aviso);
  }
  return plano;
};

/** Lotes que a linha da venda tirou, prontos para gravar no item (`lotes`). Vazio quando nao controla lote. */
export const lotesDaLinha = (plano: PlanoDeLotes | null | undefined, chave: string): LoteUsado[] => plano?.porLinha[chave] || [];

/** Campo `lotes` para espalhar no item da venda; nao grava chave nenhuma quando o produto nao controla lote. */
export const camposDeLoteDoItem = (plano: PlanoDeLotes | null | undefined, chave: string): { lotes?: LoteUsado[] } => {
  const usados = lotesDaLinha(plano, chave);
  return usados.length > 0 ? { lotes: usados } : {};
};

/** Passo 2 (dentro da transacao, SO' escrita): a venda tira dos lotes. */
export const baixarLotesNaTransacao = (transaction: Transaction, db: Firestore, plano: PlanoDeLotes | null | undefined): void => {
  if (!plano) return;
  somarLotesUsados(Object.values(plano.porLinha)).forEach((lote) => {
    transaction.update(doc(db, 'estoque_lotes', lote.loteId), { quantidade: increment(-lote.quantidade), updatedAt: serverTimestamp() });
  });
};

/**
 * Devolucao / estorno / cancelamento: devolve ao MESMO lote de onde a venda tirou.
 * `itens` sao os itens da venda ja gravados (com `lotes`); `jaDevolvido` e `quantidade` vem na unidade
 * BASE por item (mesma ordem de `itens`). So' escrita, pode ser chamada em qualquer ponto da transacao.
 */
export const devolverAosLotesNaTransacao = (
  transaction: Transaction,
  db: Firestore,
  devolucoes: Array<{ lotes?: LoteUsado[]; jaDevolvido: number; quantidade: number }>,
): LoteUsado[] => {
  const voltas = somarLotesUsados(devolucoes.map((d) => distribuirRetornoAosLotes(d.lotes || [], d.jaDevolvido, d.quantidade)));
  voltas.forEach((lote) => {
    transaction.update(doc(db, 'estoque_lotes', lote.loteId), { quantidade: increment(lote.quantidade), updatedAt: serverTimestamp() });
  });
  // Quem chama grava isto no documento da devolucao, para o estorno saber de quais lotes retirar de novo.
  return voltas;
};

/** Estorno de uma devolucao: retira de novo dos lotes que a devolucao tinha reposto. */
export const estornarLotesDaDevolucaoNaTransacao = (transaction: Transaction, db: Firestore, lotesDevolvidos: LoteUsado[] | undefined): void => {
  (lotesDevolvidos || []).forEach((lote) => {
    transaction.update(doc(db, 'estoque_lotes', lote.loteId), { quantidade: increment(-lote.quantidade), updatedAt: serverTimestamp() });
  });
};

/** Itens gravados de uma venda -> entrada de devolverAosLotesNaTransacao (cancelamento devolve tudo o que saiu de lote). */
export const devolucaoTotalDosLotes = (itensDaVenda: unknown): Array<{ lotes?: LoteUsado[]; jaDevolvido: number; quantidade: number }> => (
  (Array.isArray(itensDaVenda) ? itensDaVenda : [])
    .filter((item) => Array.isArray(item?.lotes) && item.lotes.length > 0)
    .map((item) => ({
      lotes: item.lotes as LoteUsado[],
      jaDevolvido: 0,
      quantidade: (item.lotes as LoteUsado[]).reduce((soma, l) => soma + Number(l.quantidade || 0), 0),
    }))
);

/* ------------------------------------------------------------------------------------------------
 * ENTRADA EM LOTE (Nota Avulsa, Producao): produto que controla lote so' entra com lote e validade.
 * ---------------------------------------------------------------------------------------------- */

export interface EntradaDeLote {
  produtoId: string;
  lote: string;
  /** AAAA-MM-DD. */
  validade: string;
  /** Unidade base do estoque. */
  quantidade: number;
}

export interface EntradaDeLotePreparada extends EntradaDeLote {
  loteId: string;
  existente: boolean;
}

/** Quais dos produtos controlam lote (le so' o cadastro; produto que nao controla nao gasta mais nada). */
export const produtosQueControlamLote = async (db: Firestore, produtoIds: string[]): Promise<Set<string>> => {
  const unicos = [...new Set(produtoIds.filter((id) => id && id !== 'avulso'))];
  const marcados = await Promise.all(unicos.map(async (id) => {
    const snap = await getDoc(doc(db, 'estoque', id));
    return snap.exists() && snap.data().controlarLote === true ? id : null;
  }));
  return new Set(marcados.filter((id): id is string => id !== null));
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pergunta lote e validade de cada produto que controla lote (Nota Avulsa, Producao). Nao deixa
 * confirmar com campo vazio ou data invalida. Devolve null se a pessoa cancelar.
 */
export const pedirLotesDeEntrada = async (
  itens: Array<{ chave: string; nome: string; quantidade: number }>,
  titulo = 'Lote e validade',
): Promise<Record<string, { lote: string; validade: string }> | null> => {
  if (itens.length === 0) return {};
  const linhas = itens.map((item) => (
    `<div style="text-align:left;margin-bottom:14px"><div style="font-weight:600;margin-bottom:4px">${escaparHtml(item.nome)} <span style="color:#a1a1aa;font-weight:400">· ${item.quantidade} un.</span></div>`
    + `<div style="display:flex;gap:8px"><input data-lote="${escaparHtml(item.chave)}" class="swal2-input" placeholder="Lote" style="margin:0;flex:1;background:#27272a;color:#fff">`
    + `<input data-validade="${escaparHtml(item.chave)}" type="date" class="swal2-input" style="margin:0;flex:1;background:#27272a;color:#fff"></div></div>`
  )).join('');
  const resposta = await NexusSwal.fire({
    title: titulo,
    html: `<div style="font-size:13px;color:#a1a1aa;margin-bottom:12px">Estes produtos controlam lote. Informe o lote e a validade que estão na embalagem.</div>${linhas}`,
    showCancelButton: true,
    confirmButtonText: 'Confirmar',
    cancelButtonText: 'Voltar',
    preConfirm: () => {
      const valores: Record<string, { lote: string; validade: string }> = {};
      for (const item of itens) {
        const lote = document.querySelector<HTMLInputElement>(`input[data-lote="${item.chave}"]`)?.value.trim() || '';
        const validade = document.querySelector<HTMLInputElement>(`input[data-validade="${item.chave}"]`)?.value.trim() || '';
        if (!lote || !DATA_ISO.test(validade)) {
          NexusSwal.showValidationMessage(`Informe o lote e a validade de "${item.nome}".`);
          return false;
        }
        valores[item.chave] = { lote, validade };
      }
      return valores;
    },
  });
  return resposta.isConfirmed ? (resposta.value as Record<string, { lote: string; validade: string }>) : null;
};

/** Junta entradas do mesmo produto+lote e acha os lotes que ja existem (para somar em vez de duplicar). */
export const prepararEntradasEmLotes = async (db: Firestore, tenantId: string, entradas: EntradaDeLote[]): Promise<EntradaDeLotePreparada[]> => {
  const agregadas = new Map<string, EntradaDeLote>();
  entradas.forEach((e) => {
    const chave = `${e.produtoId}|${e.lote.trim().toUpperCase()}`;
    const atual = agregadas.get(chave);
    agregadas.set(chave, atual ? { ...atual, quantidade: Math.round((atual.quantidade + e.quantidade) * 1e6) / 1e6 } : { ...e, lote: e.lote.trim() });
  });
  const existentes = new Map<string, string>();
  for (const produtoId of new Set([...agregadas.values()].map((e) => e.produtoId))) {
    const snap = await getDocs(query(collection(db, 'estoque_lotes'), where('tenantId', '==', tenantId), where('produtoId', '==', produtoId)));
    snap.forEach((d) => existentes.set(`${produtoId}|${String(d.data().lote || '').trim().toUpperCase()}`, d.id));
  }
  return [...agregadas.entries()].map(([chave, e]) => {
    const idExistente = existentes.get(chave);
    return { ...e, loteId: idExistente || doc(collection(db, 'estoque_lotes')).id, existente: Boolean(idExistente) };
  });
};

/** Dentro da transacao (so' escrita): cria o lote ou soma no que ja existe. */
export const gravarEntradasEmLotesNaTransacao = (
  transaction: Transaction,
  db: Firestore,
  tenantId: string,
  entradas: EntradaDeLotePreparada[],
  metadados: object,
  origem: string,
): void => {
  entradas.forEach((e) => {
    const ref = doc(db, 'estoque_lotes', e.loteId);
    if (e.existente) {
      transaction.update(ref, { quantidade: increment(e.quantidade), updatedAt: serverTimestamp() });
    } else {
      transaction.set(ref, {
        tenantId,
        produtoId: e.produtoId,
        lote: e.lote,
        validade: e.validade || null,
        quantidade: e.quantidade,
        origemEntrada: origem,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...metadados,
      });
    }
  });
};

/** Forma gravada no documento da nota/ordem para o estorno saber o que desfazer. */
export const lotesDaEntradaParaGravar = (entradas: EntradaDeLotePreparada[]): Array<{ produtoId: string; loteId: string; lote: string; validade: string; quantidade: number }> => (
  entradas.map((e) => ({ produtoId: e.produtoId, loteId: e.loteId, lote: e.lote, validade: e.validade, quantidade: e.quantidade }))
);

/**
 * Estorno de uma ENTRADA (cancelar nota avulsa, estornar producao): confere que cada lote ainda tem o
 * saldo que entrou (senao parte ja foi vendida) e devolve a funcao que retira. LE agora (chame antes das
 * escritas da transacao) e ESCREVE quando a funcao devolvida for chamada.
 */
export const prepararEstornoDeEntradaEmLotes = async (
  transaction: Transaction,
  db: Firestore,
  lotes: Array<{ loteId: string; lote: string; quantidade: number }> | undefined,
  contexto: string,
): Promise<() => void> => {
  const lista = Array.isArray(lotes) ? lotes : [];
  const snaps = await Promise.all(lista.map((l) => transaction.get(doc(db, 'estoque_lotes', l.loteId))));
  lista.forEach((l, i) => {
    if (!snaps[i].exists() || Number(snaps[i].data()?.quantidade || 0) < l.quantidade - 0.0005) {
      throw new Error(`Não é possível estornar ${contexto}: o lote "${l.lote}" já teve parte do saldo vendida ou ajustada desde a entrada.`);
    }
  });
  return () => {
    lista.forEach((l, i) => {
      transaction.update(snaps[i].ref, { quantidade: increment(-l.quantidade), updatedAt: serverTimestamp() });
    });
  };
};
