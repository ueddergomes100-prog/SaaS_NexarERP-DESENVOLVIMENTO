/**
 * SNAPSHOT DE EXCLUSAO NO LOG DE AUDITORIA, SEM ESTOURAR O DOCUMENTO.
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA
 * ---------------------------------------------------------------------------
 *
 * Excluir venda aqui e' exclusao FISICA (nao ha soft-delete), entao a copia
 * gravada no log e a unica forma de saber depois como o pedido era. Ela vai
 * inteira: cliente, pagamentos e a lista de itens.
 *
 * So que documento do Firestore tem teto de 1 MB. Um pedido com centenas de
 * itens pode passar disso -- e ai a gravacao do log falha. Pior: falha em
 * SILENCIO, porque a escrita do log e' proposital "fire and forget" (um erro
 * de log nunca pode derrubar a operacao do usuario). O resultado seria perder
 * justamente o registro da exclusao, que e' quando o log mais importa.
 *
 * ---------------------------------------------------------------------------
 * A ESCOLHA
 * ---------------------------------------------------------------------------
 *
 * Quando a copia passa do limite, em vez de gravar tudo (e perder tudo) grava
 * um RESUMO: os campos de identificacao do pedido, quantos itens tinha, e a
 * marca de que foi reduzido. Registro parcial e pior que registro completo,
 * mas e' infinitamente melhor que registro nenhum -- e a marca `truncado`
 * avisa quem for ler que falta coisa, em vez de deixar parecer completo.
 *
 * O limite e' bem abaixo do 1 MB do Firestore de proposito: o snapshot divide
 * o documento com descricao, diff e metadados, e o teto vale pro documento
 * inteiro, nao por campo.
 */

/** Teto do snapshot, em bytes de JSON. ~1/5 do limite do Firestore. */
export const LIMITE_SNAPSHOT_LOG_BYTES = 200_000;

/** Campos que identificam o pedido -- os unicos que sobrevivem a reducao. */
const CAMPOS_DE_IDENTIFICACAO = [
  'numeroPedido',
  'clienteNome',
  'clienteId',
  'vendedorId',
  'vendedorNome',
  'status',
  'valorTotal',
  'valorTotalCentavos',
  'formaPagamento',
  'dataVenda',
  'tenantId',
];

export interface SnapshotReduzido {
  truncado: true;
  motivo: string;
  totalDeItens: number;
  [campo: string]: unknown;
}

/** Tamanho do valor em bytes de JSON. Devolve Infinity quando nao da pra
 *  serializar (referencia circular) -- ai o chamador trata como grande
 *  demais, que e' o lado seguro. */
export const tamanhoJsonEmBytes = (valor: unknown): number => {
  try {
    const texto = JSON.stringify(valor);
    if (typeof texto !== 'string') return 0;
    // Nome de produto tem acento, e acento ocupa 2 bytes em UTF-8 -- medir
    // por `length` subestimaria justamente no caso que interessa.
    return new TextEncoder().encode(texto).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/**
 * Devolve o snapshot como esta, quando cabe; ou um resumo identificavel,
 * quando nao cabe. `null`/`undefined` passam direto -- ausencia de snapshot
 * nao e' erro (pode ser um documento que ja nao existia).
 */
export const reduzirSnapshotDeLog = (
  snapshot: unknown,
  limiteBytes: number = LIMITE_SNAPSHOT_LOG_BYTES,
): unknown => {
  if (snapshot === null || snapshot === undefined) return null;
  if (tamanhoJsonEmBytes(snapshot) <= limiteBytes) return snapshot;

  const dados = (typeof snapshot === 'object' ? snapshot : {}) as Record<string, unknown>;
  const itens = Array.isArray(dados.itens) ? dados.itens : [];

  const resumo: SnapshotReduzido = {
    truncado: true,
    motivo: `O registro era grande demais para o log (acima de ${Math.round(limiteBytes / 1000)} KB). Foram guardados apenas os dados de identificação e a contagem de itens.`,
    totalDeItens: itens.length,
  };

  for (const campo of CAMPOS_DE_IDENTIFICACAO) {
    if (dados[campo] !== undefined) resumo[campo] = dados[campo];
  }

  return resumo;
};
