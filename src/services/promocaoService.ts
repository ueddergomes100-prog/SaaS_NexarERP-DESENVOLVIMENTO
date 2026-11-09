import { addDoc, collection, doc, getDoc, getDocs, getDocsFromServer, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { createAuditLog } from './logService';
import { diferencasEntre, type CampoComparado, type MudancaDeCampo } from '../utils/historicoAlteracoesDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { getDateInputInTimeZone } from '../utils/dateTime';
import {
  conflitosDaPromocao,
  errosDaPromocao,
  lerPromocao,
  promocaoParaGravar,
  type Promocao,
  type ItemPromocao,
  type PromocaoComId,
} from '../utils/promocaoDomain';

/**
 * Firestore das PROMOCOES (2026-10-01). Regra em promocaoDomain.ts.
 *
 * `produtoIds` e' gravado junto dos itens so' pra consulta: "em que promocoes
 * este produto esta?" (cadastro do produto e a trava de duplicidade).
 */

export const COLECAO_PROMOCOES = 'promocoes';

// ---------------------------------------------------------------------------
// HISTORICO DE ALTERACOES (09/11/2026)
// ---------------------------------------------------------------------------

const DIAS_DA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const simNao = (v: unknown) => (v === true ? 'Sim' : 'Não');

const CAMPOS_PROMOCAO_HISTORICO: CampoComparado[] = [
  { campo: 'nome', rotulo: 'Nome' },
  { campo: 'dataInicio', rotulo: 'Início' },
  { campo: 'dataFim', rotulo: 'Fim' },
  { campo: 'continua', rotulo: 'Sem data para acabar', formatar: simNao },
  { campo: 'inativa', rotulo: 'Inativa', formatar: simNao },
  {
    campo: 'diasSemana',
    rotulo: 'Dias da semana',
    formatar: (v) => (Array.isArray(v) && v.length > 0 ? v.map((d) => DIAS_DA_SEMANA[Number(d)] || String(d)).join(', ') : 'Todos'),
  },
  { campo: 'formas', rotulo: 'Formas de pagamento', formatar: (v) => (v === 'vista' ? 'Só à vista' : 'Todas') },
  { campo: 'limitePorVenda', rotulo: 'Limite por venda' },
  { campo: 'observacao', rotulo: 'Observação' },
];

const precoDoItem = (item: ItemPromocao): string => {
  const valor = Number(item.valor) || 0;
  const preco = item.tipo === 'percentual'
    ? `${String(valor).replace('.', ',')}% de desconto`
    : `R$ ${valor.toFixed(2).replace('.', ',')}`;
  return item.quota ? `${preco} (quota ${item.quota})` : preco;
};

/** Itens que entraram, sairam ou mudaram de preco/quota (um campo por produto). */
const mudancasDosItens = (antes: ItemPromocao[], depois: ItemPromocao[]): MudancaDeCampo[] => {
  const porId = (lista: ItemPromocao[]) => new Map(lista.map((i) => [i.produtoId, i]));
  const a = porId(antes);
  const d = porId(depois);
  const mudancas: MudancaDeCampo[] = [];
  new Set([...a.keys(), ...d.keys()]).forEach((produtoId) => {
    const velho = a.get(produtoId);
    const novo = d.get(produtoId);
    const nome = (novo || velho)?.nome || produtoId;
    const precoVelho = velho ? precoDoItem(velho) : null;
    const precoNovo = novo ? precoDoItem(novo) : null;
    if (precoVelho === precoNovo) return;
    mudancas.push({ campo: `Produto ${nome}`, valorAnterior: precoVelho, valorNovo: precoNovo });
  });
  return mudancas;
};

const registrarPromocaoNoHistorico = (args: {
  tenantId: string;
  uid: string;
  id: string;
  acao: 'criacao' | 'edicao' | 'inativacao' | 'reativacao';
  descricao: string;
  nome: string;
  alteracoes?: MudancaDeCampo[];
}) => {
  createAuditLog({
    tenantId: args.tenantId,
    usuarioId: args.uid,
    usuarioEmail: auth.currentUser?.email || args.uid,
    modulo: 'cadastros',
    acao: args.acao,
    descricao: args.descricao,
    registroRelacionadoId: args.id,
    documentoTipo: 'promocao',
    documentoNumero: `Promoção ${args.nome}`,
    ...(args.alteracoes && args.alteracoes.length > 0 ? { alteracoes: args.alteracoes } : {}),
    status: 'sucesso',
  });
};

const pedacos = <T>(lista: T[], tamanho = 30): T[][] => {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
};

/** Promocoes da empresa que contem algum destes produtos. */
export const promocoesComProdutos = async (tenantId: string, produtoIds: string[]): Promise<PromocaoComId[]> => {
  const achadas = new Map<string, PromocaoComId>();
  for (const lote of pedacos([...new Set(produtoIds)])) {
    const snap = await getDocs(query(collection(db, COLECAO_PROMOCOES), where('tenantId', '==', tenantId), where('produtoIds', 'array-contains-any', lote)));
    snap.forEach((d) => achadas.set(d.id, { ...lerPromocao(d.data()), id: d.id }));
  }
  return [...achadas.values()];
};

/**
 * Grava a promocao (nova ou existente). Erros de preenchimento e produto que
 * ja esta em outra promocao no mesmo periodo voltam como Error em portugues,
 * todos juntos -- nada e' gravado.
 */
export const salvarPromocao = async (args: {
  tenantId: string;
  uid: string;
  id?: string;
  promocao: Promocao;
  precosAtuais?: Record<string, number>;
}): Promise<string> => {
  const dados = promocaoParaGravar(args.promocao);
  const erros = errosDaPromocao(dados, args.precosAtuais);
  if (erros.length > 0) throw new Error(erros.join(' '));

  const outras = await promocoesComProdutos(args.tenantId, dados.itens.map((i) => i.produtoId));
  const conflitos = conflitosDaPromocao({ ...dados, id: args.id }, outras, getDateInputInTimeZone());
  if (conflitos.length > 0) throw new Error(conflitos.join(' '));

  const gravar = {
    ...dados,
    produtoIds: dados.itens.map((i) => i.produtoId),
    tenantId: args.tenantId,
    updatedAt: serverTimestamp(),
  };
  if (args.id) {
    // "Antes" do Histórico de alterações: quase sempre ja' veio na consulta de
    // conflitos (a promocao tem os mesmos produtos); senao, le' o documento.
    let anterior: Promocao | null = outras.find((o) => o.id === args.id) || null;
    if (!anterior) {
      try {
        const snap = await getDoc(doc(db, COLECAO_PROMOCOES, args.id));
        anterior = snap.exists() ? lerPromocao(snap.data()) : null;
      } catch {
        anterior = null;
      }
    }
    await updateDoc(doc(db, COLECAO_PROMOCOES, args.id), {
      ...gravar,
      ...buildDocumentUpdateMetadata(args.uid, serverTimestamp(), dados.inativa ? 'Promoção inativada' : 'Promoção alterada'),
    });
    const alteracoes = [
      ...diferencasEntre(anterior as unknown as Record<string, unknown> | null, dados as unknown as Record<string, unknown>, CAMPOS_PROMOCAO_HISTORICO),
      ...mudancasDosItens(anterior?.itens || [], dados.itens),
    ];
    if (alteracoes.length > 0) {
      registrarPromocaoNoHistorico({
        tenantId: args.tenantId,
        uid: args.uid,
        id: args.id,
        acao: 'edicao',
        descricao: `Promoção ${dados.nome} alterada: ${alteracoes.map((a) => a.campo).join(', ')}.`,
        nome: dados.nome,
        alteracoes,
      });
    }
    return args.id;
  }
  const ref = await addDoc(collection(db, COLECAO_PROMOCOES), {
    ...gravar,
    createdAt: serverTimestamp(),
    ...buildDocumentMetadata(args.uid, serverTimestamp()),
  });
  registrarPromocaoNoHistorico({
    tenantId: args.tenantId,
    uid: args.uid,
    id: ref.id,
    acao: 'criacao',
    descricao: `Promoção ${dados.nome} cadastrada com ${dados.itens.length} produto(s), de ${dados.dataInicio || '(sem início)'}${dados.continua ? ' sem data para acabar' : ` até ${dados.dataFim || '(sem fim)'}`}.`,
    nome: dados.nome,
    alteracoes: mudancasDosItens([], dados.itens),
  });
  return ref.id;
};

/** Encerra/reativa sem mexer no resto (nao some da lista: o historico fica). */
export const alterarSituacaoDaPromocao = async (uid: string, id: string, inativa: boolean): Promise<void> => {
  await updateDoc(doc(db, COLECAO_PROMOCOES, id), {
    inativa,
    updatedAt: serverTimestamp(),
    ...buildDocumentUpdateMetadata(uid, serverTimestamp(), inativa ? 'Promoção inativada' : 'Promoção reativada'),
  });
  // Historico de alteracoes (09/11/2026): quem chama nao passa a empresa nem
  // o nome; le' a promocao depois de gravar, sem segurar a tela.
  void (async () => {
    try {
      const snap = await getDoc(doc(db, COLECAO_PROMOCOES, id));
      if (!snap.exists()) return;
      const dados = snap.data();
      const nome = String(dados.nome || '');
      registrarPromocaoNoHistorico({
        tenantId: String(dados.tenantId || ''),
        uid,
        id,
        acao: inativa ? 'inativacao' : 'reativacao',
        descricao: `Promoção ${nome} ${inativa ? 'encerrada (inativada)' : 'reativada'}.`,
        nome,
        alteracoes: [{ campo: 'Inativa', valorAnterior: inativa ? 'Não' : 'Sim', valorNovo: inativa ? 'Sim' : 'Não' }],
      });
    } catch (erro) {
      console.error('Falha ao registrar a promoção no histórico de alterações:', erro);
    }
  })();
};

/**
 * Quanto da quota ja saiu: soma, nos pedidos NAO cancelados que levaram a
 * promocao, a quantidade (na unidade base) dos itens dela. Venda cancelada
 * devolve a quota sozinha, porque deixa de entrar na soma.
 *
 * Sempre do servidor (19/10/2026): no app Vendas offline o cache local daria
 * uma conta incompleta; sem internet, falha e quem chama trata como "nao
 * conferido".
 */
export const vendidoNaPromocao = async (tenantId: string, promocaoId: string, ignorarPedidoId?: string): Promise<Record<string, number>> => {
  const snap = await getDocsFromServer(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('promocaoIds', 'array-contains', promocaoId)));
  const vendido: Record<string, number> = {};
  snap.forEach((d) => {
    const pedido = d.data();
    // O pedido que esta aberto na tela conta pelos itens da tela, nao pelo que foi gravado.
    if (pedido.status === 'Cancelada' || d.id === ignorarPedidoId) return;
    (Array.isArray(pedido.itens) ? pedido.itens : []).forEach((item: Record<string, unknown>) => {
      if (item.promocaoId !== promocaoId) return;
      const qtd = Number(item.quantidadeBase ?? item.quantidade) || 0;
      const id = String(item.id || '');
      vendido[id] = (vendido[id] || 0) + qtd;
    });
  });
  return vendido;
};
