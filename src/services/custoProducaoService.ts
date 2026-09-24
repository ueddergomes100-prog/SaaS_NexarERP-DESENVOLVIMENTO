import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { chaveComponente, normalizarComponente } from '../utils/producaoDomain';
import { margemMarkup } from '../utils/precificacaoDomain';
import {
  entradaDeHistorico,
  montarAtualizacaoDePreco,
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
  const vazio: ResultadoDoRecalculo = { impactos: [], emCiclo: [], idsEmCiclo: [], produtosConferidos: 0, marcadosComoProduzidos: [] };
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
  const temBlocoAvancado = new Set<string>();

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
    if (data.avancado && typeof data.avancado === 'object') temBlocoAvancado.add(d.id);
  });

  // Decisao do dono (2026-09-24): produto com composicao cadastrada E'
  // produzido internamente. A marca so' era gravada pelo formulario do
  // produto, e receita importada nunca a recebia -- o custo nao acompanhava
  // nada. So' marca quando ha uma conferencia geral ou a receita acabou de
  // ser salva; numa entrada de nota nao mexe em cadastro de ninguem.
  const marcados: { id: string; nome: string }[] = [];
  if (opcoes.todos || receitasAlteradas.length > 0) {
    const receitaTemItens = new Set(receitas.filter((r) => r.itens.length > 0).map((r) => r.produtoId));
    produtos.forEach((p) => {
      if (!p.produzidoInternamente && receitaTemItens.has(p.id)) {
        p.produzidoInternamente = true;
        marcados.push({ id: p.id, nome: p.nome });
      }
    });
    for (let inicio = 0; inicio < marcados.length; inicio += LIMITE_DO_LOTE) {
      const lote = writeBatch(db);
      marcados.slice(inicio, inicio + LIMITE_DO_LOTE).forEach((p) => {
        lote.update(doc(db, 'estoque', p.id), {
          produzidoInternamente: true,
          ...(temBlocoAvancado.has(p.id) ? { 'avancado.produzidoInternamente': true } : {}),
          updatedAt: serverTimestamp(),
        });
      });
      await lote.commit();
    }
  }

  const resultado = planejarRecalculoDeCustos({
    mudancas,
    receitasAlteradas,
    todos: opcoes.todos,
    receitas,
    produtos,
    custosAtuais,
    nomesDosComponentes: nomes,
  });
  resultado.marcadosComoProduzidos = marcados;
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
    if (mostrarAviso && (resultado.impactos.length > 0 || resultado.emCiclo.length > 0 || resultado.marcadosComoProduzidos.length > 0)) {
      await mostrarImpactoDeCusto(resultado, undefined, contextoDeReajuste(opcoes.tenantId, opcoes.usuarioId));
    }
    return resultado;
  } catch (erro) {
    console.error('Erro ao atualizar o custo dos produtos acabados:', erro);
    showWarning('Custo dos produtos acabados não atualizado', MENSAGEM_DE_FALHA);
    return null;
  }
};

export interface PrecoEscolhido {
  produtoId: string;
  precoNovo: number;
}

/**
 * Grava os precos de venda que a PESSOA escolheu reajustar depois do aviso de
 * custo. Le cada produto de novo (custo e historico de agora, nao os de quando
 * o aviso abriu) e so' toca em produto do proprio tenant.
 */
export const aplicarNovosPrecos = async (opcoes: {
  tenantId: string;
  usuarioId?: string;
  itens: PrecoEscolhido[];
  motivo?: string;
}): Promise<{ aplicados: number; ignorados: number }> => {
  const motivo = opcoes.motivo ?? 'Preço reajustado após mudança de custo (escolha do usuário).';
  const agora = new Date();
  const leituras = await Promise.all(opcoes.itens.map(async (item) => ({ item, snap: await getDoc(doc(db, 'estoque', item.produtoId)) })));

  const lote = writeBatch(db);
  let aplicados = 0;
  let ignorados = 0;
  leituras.forEach(({ item, snap }) => {
    const data = snap.data();
    if (!snap.exists() || !data || data.tenantId !== opcoes.tenantId) { ignorados += 1; return; }
    const campos = montarAtualizacaoDePreco({
      precoVenda: numero(data.precoVenda ?? data.precos?.venda),
      precoCusto: numero(data.precoCusto ?? data.precos?.custo),
      historicoPrecos: Array.isArray(data.historicoPrecos) ? data.historicoPrecos : [],
      temPrecos: Boolean(data.precos) && typeof data.precos === 'object',
    }, item.precoNovo, opcoes.usuarioId, motivo, agora);
    if (!campos) { ignorados += 1; return; }
    lote.update(snap.ref, { ...campos, updatedAt: serverTimestamp() });
    aplicados += 1;
  });
  if (aplicados > 0) await lote.commit();
  return { aplicados, ignorados };
};

/** Liga o aviso de custo a gravacao de preco escolhido (o aviso nao conhece o Firestore). */
export const contextoDeReajuste = (tenantId: string, usuarioId?: string) => ({
  aplicarPrecos: (itens: PrecoEscolhido[]) => aplicarNovosPrecos({ tenantId, usuarioId, itens }),
});
