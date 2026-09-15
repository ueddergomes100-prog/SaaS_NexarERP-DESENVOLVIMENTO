// Funcoes puras da importacao em massa de composicao (receita de producao).
// Sem Firestore -- leitura de arquivo, busca dos catalogos e gravacao ficam
// em src/pages/Estoque/ImportarComposicao.tsx.
//
// Diferente dos outros importadores: este NAO cria cadastro nenhum. Ele liga
// cadastros que ja' existem -- cada linha da planilha diz "o produto X leva
// N unidades do componente Y", e o trabalho e' casar X e Y pelo nome com o
// que ja' esta' cadastrado. Linha que nao casa NAO vira cadastro novo: vira
// pendencia pro usuario resolver, porque criar um produto a partir de um
// nome solto numa receita produziria cadastro sem preco, sem unidade e sem
// saldo -- exatamente o tipo de registro pela metade que o sistema depois
// nao sabe tratar.

import { buildDocumentMetadata } from './documentMetadata';
import { parseNumeroExportado } from './importacaoEstoqueDomain';
import type { ComponenteComposicao, OrigemComponente } from './producaoDomain';

export {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
} from './importacaoEstoqueDomain';

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export type CampoColunaComposicao = 'produto' | 'componente' | 'quantidade' | 'unidade';

export interface MapeamentoColunasComposicao {
  produto: number;
  componente: number;
  quantidade: number;
  unidade: number | null;
}

const SINONIMOS: Record<CampoColunaComposicao, string[]> = {
  produto: ['produto final', 'produto', 'item', 'acabado', 'receita'],
  componente: ['componente', 'materia-prima', 'materia prima', 'insumo', 'similar', 'ingrediente'],
  quantidade: ['quantidade', 'quant', 'qtd', 'qtde'],
  unidade: ['unidade', 'und', 'un.', 'medida'],
};

const normalizarTextoComparacao = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

/** Exato primeiro, substring depois -- mesma logica dos outros importadores
 * (ver importacaoEstoqueDomain.ts pro porque). Aqui importa em especial
 * porque "produto" e' substring de nada mas "componente" e "produto" podem
 * aparecer os dois numa planilha com cabecalho verboso. */
export const inferirMapeamentoColunasComposicao = (cabecalho: string[]): MapeamentoColunasComposicao => {
  const normalizados = cabecalho.map(normalizarTextoComparacao);

  const encontrar = (campo: CampoColunaComposicao, evitar: number[] = []): number => {
    const sinonimos = SINONIMOS[campo];
    for (const sin of sinonimos) {
      const idx = normalizados.findIndex((col, i) => !evitar.includes(i) && col === sin);
      if (idx >= 0) return idx;
    }
    for (const sin of sinonimos) {
      const idx = normalizados.findIndex((col, i) => !evitar.includes(i) && col.includes(sin));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const componente = encontrar('componente');
  // "produto" nunca pode cair na mesma coluna que "componente": numa planilha
  // com "Produto" e "Componente" o substring de um nao pode roubar o outro.
  const produto = encontrar('produto', componente >= 0 ? [componente] : []);
  const quantidade = encontrar('quantidade');
  const unidade = encontrar('unidade');

  return {
    produto: produto >= 0 ? produto : 0,
    componente: componente >= 0 ? componente : 1,
    quantidade: quantidade >= 0 ? quantidade : 2,
    unidade: unidade >= 0 ? unidade : null,
  };
};

// ---------------------------------------------------------------------------
// Catalogo e casamento por nome
// ---------------------------------------------------------------------------

export interface ItemCatalogo {
  id: string;
  nome: string;
  codigo: string;
  origem: OrigemComponente;
  unidade: string;
}

/** Nome comparavel: sem acento, caixa alta, pontuacao virando espaco e
 * espaco repetido colapsado. Precisa ser assim porque a planilha do sistema
 * antigo tem "ACUCAR MASCAVO  KG" (dois espacos) e "SACO PP 15 X 22 ( SACOLA
 * DE CHA )" (espaco encostado no parenteses) -- comparacao literal perderia
 * os dois. */
export const normalizarNomeCatalogo = (valor: string): string => (valor || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim();

export const construirIndiceCatalogo = (itens: ItemCatalogo[]): Map<string, ItemCatalogo[]> => {
  const indice = new Map<string, ItemCatalogo[]>();
  for (const item of itens) {
    const chave = normalizarNomeCatalogo(item.nome);
    if (!chave) continue;
    if (!indice.has(chave)) indice.set(chave, []);
    indice.get(chave)!.push(item);
  }
  return indice;
};

export type StatusResolucao = 'encontrado' | 'nao_encontrado' | 'ambiguo';

export interface Resolucao {
  status: StatusResolucao;
  item: ItemCatalogo | null;
  /** So preenchido quando `ambiguo`: os cadastros que disputam o mesmo nome,
   * pro usuario escolher na conferencia. */
  candidatos: ItemCatalogo[];
}

/** Resolve um nome da planilha contra o catalogo. Nome repetido NAO e'
 * desempatado por chute (nem por data de cadastro, nem por codigo menor):
 * dois cadastros com o mesmo nome sao dois produtos diferentes ate' alguem
 * dizer o contrario, e escolher errado aqui gravaria a receita no produto
 * errado sem ninguem perceber. */
export const resolverNome = (indice: Map<string, ItemCatalogo[]>, nome: string): Resolucao => {
  const chave = normalizarNomeCatalogo(nome);
  const achados = chave ? indice.get(chave) : undefined;
  if (!achados || achados.length === 0) return { status: 'nao_encontrado', item: null, candidatos: [] };
  if (achados.length === 1) return { status: 'encontrado', item: achados[0], candidatos: [] };
  return { status: 'ambiguo', item: null, candidatos: achados };
};

// ---------------------------------------------------------------------------
// Linha da planilha processada
// ---------------------------------------------------------------------------

export type StatusLinhaComposicao = 'OK' | 'REVISAR';

export interface LinhaComposicaoImportada {
  linhaId: number;
  produtoBruto: string;
  componenteBruto: string;
  quantidadeBruta: string;
  quantidade: number | null;
  unidadeArquivo: string;
  produto: Resolucao;
  componente: Resolucao;
  /** Escolha manual feita na tela de conferencia; vence a resolucao
   * automatica quando preenchida. */
  produtoEscolhidoId: string | null;
  componenteEscolhidoId: string | null;
  status: StatusLinhaComposicao;
  motivo: string;
}

/** Quantidade da receita: numero de export estruturado (ponto decimal) e,
 * se nao bater, formato brasileiro com virgula. */
const parseQuantidade = (bruto: string | undefined): number | null => {
  const limpo = (bruto || '').trim();
  if (!limpo) return null;
  const direto = parseNumeroExportado(limpo);
  if (direto !== null) return direto;
  const numero = Number(limpo.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
};

const motivoDaLinha = (
  produto: Resolucao,
  componente: Resolucao,
  quantidadeBruta: string,
  quantidade: number | null,
  produtoBruto: string,
  componenteBruto: string,
): string => {
  if (produto.status === 'nao_encontrado') return `Produto "${produtoBruto}" não está cadastrado no Estoque`;
  if (produto.status === 'ambiguo') return `Existe mais de um produto chamado "${produtoBruto}" — escolha qual é`;
  if (componente.status === 'nao_encontrado') return `Componente "${componenteBruto}" não está cadastrado como matéria-prima nem como produto`;
  if (componente.status === 'ambiguo') return `Existe mais de um cadastro chamado "${componenteBruto}" — escolha qual é`;
  if (!quantidadeBruta) return 'Quantidade em branco';
  if (quantidade === null) return `Não foi possível interpretar "${quantidadeBruta}" como número`;
  if (quantidade <= 0) return 'Quantidade precisa ser maior que zero';
  return '';
};

export const processarLinhasComposicao = (
  linhas: string[][],
  mapeamento: MapeamentoColunasComposicao,
  indiceProdutos: Map<string, ItemCatalogo[]>,
  indiceComponentes: Map<string, ItemCatalogo[]>,
): LinhaComposicaoImportada[] => linhas
  .filter((linha) => linha.some((celula) => celula && celula.trim()))
  .map((linha, index) => {
    const produtoBruto = (linha[mapeamento.produto] || '').trim();
    const componenteBruto = (linha[mapeamento.componente] || '').trim();
    const quantidadeBruta = (linha[mapeamento.quantidade] || '').trim();
    const quantidade = parseQuantidade(quantidadeBruta);

    const produto = resolverNome(indiceProdutos, produtoBruto);
    const componente = resolverNome(indiceComponentes, componenteBruto);
    const motivo = motivoDaLinha(produto, componente, quantidadeBruta, quantidade, produtoBruto, componenteBruto);

    return {
      linhaId: index,
      produtoBruto,
      componenteBruto,
      quantidadeBruta,
      quantidade,
      unidadeArquivo: mapeamento.unidade !== null ? (linha[mapeamento.unidade] || '').trim().toUpperCase() : '',
      produto,
      componente,
      produtoEscolhidoId: produto.status === 'encontrado' ? produto.item!.id : null,
      componenteEscolhidoId: componente.status === 'encontrado' ? componente.item!.id : null,
      status: motivo ? 'REVISAR' : 'OK',
      motivo,
    } satisfies LinhaComposicaoImportada;
  })
  .filter((item) => item.produtoBruto && item.componenteBruto);

/** Reavalia status/motivo depois do usuario escolher um cadastro numa linha
 * ambigua na tela de conferencia. */
export const reavaliarLinha = (
  linha: LinhaComposicaoImportada,
  catalogoPorId: Map<string, ItemCatalogo>,
): LinhaComposicaoImportada => {
  const produtoOk = linha.produtoEscolhidoId !== null && catalogoPorId.has(linha.produtoEscolhidoId);
  const componenteOk = linha.componenteEscolhidoId !== null && catalogoPorId.has(linha.componenteEscolhidoId);

  let motivo = '';
  if (!produtoOk) {
    motivo = linha.produto.status === 'ambiguo'
      ? `Existe mais de um produto chamado "${linha.produtoBruto}" — escolha qual é`
      : `Produto "${linha.produtoBruto}" não está cadastrado no Estoque`;
  } else if (!componenteOk) {
    motivo = linha.componente.status === 'ambiguo'
      ? `Existe mais de um cadastro chamado "${linha.componenteBruto}" — escolha qual é`
      : `Componente "${linha.componenteBruto}" não está cadastrado como matéria-prima nem como produto`;
  } else if (linha.quantidade === null || linha.quantidade <= 0) {
    motivo = linha.quantidade === null
      ? `Não foi possível interpretar "${linha.quantidadeBruta}" como número`
      : 'Quantidade precisa ser maior que zero';
  }

  return { ...linha, status: motivo ? 'REVISAR' : 'OK', motivo };
};

// ---------------------------------------------------------------------------
// Agrupamento por produto e montagem do documento
// ---------------------------------------------------------------------------

export interface ComposicaoParaImportar {
  produtoId: string;
  produtoNome: string;
  produtoCodigo: string;
  itens: ComponenteComposicao[];
  /** Linhas descartadas por repetirem um componente ja presente na receita
   * do mesmo produto -- a planilha do sistema antigo tem alguns pares
   * duplicados, e a composicao guarda um item por componente. */
  duplicadasIgnoradas: number;
}

/** Agrupa as linhas OK numa composicao por produto. So entra linha OK: linha
 * em revisao fica de fora da gravacao, nao entra "pela metade". */
export const agruparComposicoes = (
  linhas: LinhaComposicaoImportada[],
  catalogoPorId: Map<string, ItemCatalogo>,
): ComposicaoParaImportar[] => {
  const porProduto = new Map<string, ComposicaoParaImportar>();

  for (const linha of linhas) {
    if (linha.status !== 'OK') continue;
    const produto = linha.produtoEscolhidoId ? catalogoPorId.get(linha.produtoEscolhidoId) : undefined;
    const componente = linha.componenteEscolhidoId ? catalogoPorId.get(linha.componenteEscolhidoId) : undefined;
    if (!produto || !componente || linha.quantidade === null) continue;

    if (!porProduto.has(produto.id)) {
      porProduto.set(produto.id, {
        produtoId: produto.id,
        produtoNome: produto.nome,
        produtoCodigo: produto.codigo,
        itens: [],
        duplicadasIgnoradas: 0,
      });
    }
    const grupo = porProduto.get(produto.id)!;
    const jaTem = grupo.itens.some((i) => i.componenteId === componente.id && i.origem === componente.origem);
    if (jaTem) {
      grupo.duplicadasIgnoradas += 1;
      continue;
    }
    grupo.itens.push({
      componenteId: componente.id,
      componenteNome: componente.nome,
      origem: componente.origem,
      unidade: componente.unidade || 'UN',
      quantidade: linha.quantidade,
    });
  }

  return [...porProduto.values()].sort((a, b) => a.produtoNome.localeCompare(b.produtoNome));
};

/** Produto que entra na propria receita -- receita circular direta. A
 * producao entraria em laco (pra produzir 1 precisa de 1), entao a linha e'
 * barrada em vez de gravada. */
export const composicaoEhCircular = (grupo: ComposicaoParaImportar): boolean => (
  grupo.itens.some((item) => item.origem === 'estoque' && item.componenteId === grupo.produtoId)
);

export const montarComposicaoImportada = (
  grupo: ComposicaoParaImportar,
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Record<string, unknown> => ({
  produtoId: grupo.produtoId,
  itens: grupo.itens,
  tenantId,
  updatedAt: timestamp,
  ...buildDocumentMetadata(userId, timestamp),
  origemImportacao: 'planilha_sistema_antigo',
});
