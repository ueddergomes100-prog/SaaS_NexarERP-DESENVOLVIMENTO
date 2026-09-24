import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { chaveComponente, normalizarComponente } from '../utils/producaoDomain';
import { margemMarkup } from '../utils/precificacaoDomain';
import {
  entradaDeHistorico,
  planejarRecalculoDeCustos,
  type MudancaDeCusto,
  type ProdutoParaCusto,
  type ReceitaDoProduto,
  type ResultadoDoRecalculo,
} from '../utils/custoProducaoDomain';
import { showWarning } from '../utils/alerts';
import { mostrarImpactoDeCusto } from '../utils/impactoCustoAlert';

/*
 * Grava o custo recalculado dos produtos acabados. A regra esta em
 * custoProducaoDomain.ts; aqui so' ha leitura e gravacao.
 *
 * NUNCA mexe em preco de venda (nem em `custoNaUltimaPrecificacao`, que e' a
 * base do aviso "a margem caiu" da Precificacao): so o custo, a margem
 * calculada e o historico.
 */

export interface OpcoesDeSincronizacao {
  tenantId: string;
  usuarioId?: string;
  /** De onde veio a mudanca, para o historico ("Entrada de NF 1234", "Cadastro de matéria-prima"...). */
  origemDaMudanca: string;
  mudancas?: MudancaDeCusto[];
  /** Produtos cuja receita acabou de ser salva. */
  receitasAlteradas?: string[];
  /** Conferir todas as receitas do tenant. */
  todos?: boolean;
}

const LIMITE_DO_LOTE = 400;
const LIMITE_DO_HISTORICO = 200;

const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Recalcula e grava. Devolve o que mudou (vazio quando nada mudou) para a tela
 * mostrar o impacto. Lanca erro se a leitura/gravacao falhar: use
 * `sincronizarCustosSemFalhar` quando isto vier DEPOIS de uma gravacao que ja
 * deu certo e nao pode ser desfeita por causa disto.
 */
export const sincronizarCustosDaProducao = async (opcoes: OpcoesDeSincronizacao): Promise<ResultadoDoRecalculo> => {
  const { tenantId } = opcoes;
  const mudancas = (opcoes.mudancas ?? []).filter((m) => m.id && m.custoAnterior !== m.custoNovo);
  const receitasAlteradas = opcoes.receitasAlteradas ?? [];
  const vazio: ResultadoDoRecalculo = { impactos: [], emCiclo: [], idsEmCiclo: [], produtosConferidos: 0, comReceitaSemMarcacao: [] };
  if (mudancas.length === 0 && receitasAlteradas.length === 0 && !opcoes.todos) return vazio;

  const [snapReceitas, snapEstoque, snapMateriasPrimas] = await Promise.all([
    getDocs(query(collection(db, 'produtos_composicao'), where('tenantId', '==', tenantId))),
    getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId))),
    getDocs(query(collection(db, 'materias_primas'), where('tenantId', '==', tenantId))),
  ]);

  const receitas: ReceitaDoProduto[] = [];
  snapReceitas.forEach((d) => {
    const data = d.data();
    const itens = Array.isArray(data.itens) ? data.itens.map(normalizarComponente) : [];
    receitas.push({ produtoId: String(data.produtoId || d.id), itens: itens.filter((i) => i.componenteId) });
  });

  const custosAtuais = new Map<string, number>();
  const nomes = new Map<string, string>();
  const produtos: ProdutoParaCusto[] = [];
  const historicoPorProduto = new Map<string, unknown[]>();

  snapMateriasPrimas.forEach((d) => {
    const data = d.data();
    const chave = chaveComponente('materia_prima', d.id);
    custosAtuais.set(chave, numero(data.precoCusto));
    nomes.set(chave, String(data.nome || ''));
  });
  snapEstoque.forEach((d) => {
    const data = d.data();
    const custo = numero(data.precoCusto ?? data.precos?.custo);
    const chave = chaveComponente('estoque', d.id);
    custosAtuais.set(chave, custo);
    nomes.set(chave, String(data.nome || ''));
    produtos.push({
      id: d.id,
      nome: String(data.nome || ''),
      codigo: String(data.codigo || ''),
      precoCusto: custo,
      precoVenda: numero(data.precoVenda ?? data.precos?.venda),
      produzidoInternamente: data.produzidoInternamente === true,
    });
    historicoPorProduto.set(d.id, Array.isArray(data.historicoPrecos) ? data.historicoPrecos : []);
  });

  const resultado = planejarRecalculoDeCustos({
    mudancas,
    receitasAlteradas,
    todos: opcoes.todos,
    receitas,
    produtos,
    custosAtuais,
    nomesDosComponentes: nomes,
  });
  // O aviso de "composicao sem marcacao" so' faz sentido quando a pessoa pediu
  // uma conferencia geral; numa entrada de nota seria ruido.
  if (!opcoes.todos) resultado.comReceitaSemMarcacao = [];
  if (resultado.impactos.length === 0) return resultado;

  const agora = new Date();
  for (let inicio = 0; inicio < resultado.impactos.length; inicio += LIMITE_DO_LOTE) {
    const lote = writeBatch(db);
    resultado.impactos.slice(inicio, inicio + LIMITE_DO_LOTE).forEach((impacto) => {
      const historico = historicoPorProduto.get(impacto.produtoId) ?? [];
      const entrada = entradaDeHistorico(impacto, opcoes.origemDaMudanca, opcoes.usuarioId, agora);
      lote.update(doc(db, 'estoque', impacto.produtoId), {
        precoCusto: impacto.custoNovo,
        // Margem/lucro calculados acompanham o custo novo, com o MESMO preco de venda.
        margemLucro: impacto.custoNovo > 0 && impacto.precoVenda > 0 ? margemMarkup(impacto.precoVenda, impacto.custoNovo) : 0,
        lucroEstimado: impacto.precoVenda - impacto.custoNovo,
        historicoPrecos: [entrada, ...historico].slice(0, LIMITE_DO_HISTORICO),
        custoAtualizadoEm: agora.toISOString(),
        custoAtualizadoMotivo: entrada.motivo,
        updatedAt: serverTimestamp(),
      });
    });
    await lote.commit();
  }
  return resultado;
};

const MENSAGEM_DE_FALHA = 'A gravação principal foi feita, mas o custo dos produtos acabados não pôde ser atualizado agora. '
  + 'Abra Produção › Matérias-primas e use "Atualizar custo dos produtos acabados" para refazer.';

/** Versao para chamar DEPOIS de uma gravacao ja concluida: falha vira aviso, nunca erro. */
export const sincronizarCustosSemFalhar = async (
  opcoes: OpcoesDeSincronizacao,
  { mostrarAviso = true }: { mostrarAviso?: boolean } = {},
): Promise<ResultadoDoRecalculo | null> => {
  try {
    const resultado = await sincronizarCustosDaProducao(opcoes);
    if (mostrarAviso && (resultado.impactos.length > 0 || resultado.emCiclo.length > 0 || resultado.comReceitaSemMarcacao.length > 0)) {
      await mostrarImpactoDeCusto(resultado);
    }
    return resultado;
  } catch (erro) {
    console.error('Erro ao atualizar o custo dos produtos acabados:', erro);
    showWarning('Custo dos produtos acabados não atualizado', MENSAGEM_DE_FALHA);
    return null;
  }
};
