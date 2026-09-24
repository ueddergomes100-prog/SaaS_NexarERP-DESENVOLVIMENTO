import { buildInitialItemEntradaConfig, type ItemEntradaConfig, type OrigemDoVinculoItem, type ProdutoFiscalAtual } from './entradaNfeDomain';
import { normalizarTextoDeItem } from './fiscalDomain';

export { normalizarTextoDeItem };

/*
 * VINCULO DOS ITENS DA NOTA COM O CADASTRO (pedido do dono, 2026-09-24).
 *
 * Problema: ao buscar a nota pela chave, quase todo item vinha como "(novo)"
 * mesmo com o produto ja cadastrado -- o reconhecimento automatico exige EAN,
 * ou o codigo que ESSE fornecedor usa, ou NCM + nome IGUAL. Descricao da nota
 * ("PARAFUSO SEXT 1/4 X 2") raramente e' igual a do cadastro.
 *
 * Solucao em duas pontas:
 *  1. A pessoa VINCULA o item a um produto/materia-prima existente (busca
 *     livre + sugestoes por semelhanca), em vez de cadastrar de novo.
 *  2. O vinculo fica GUARDADO como `codigosFornecedor[fornecedorId] = cProd`
 *     no cadastro. Na proxima nota desse fornecedor o sistema vincula sozinho
 *     pela camada do codigo -- o historico que a pessoa pediu.
 *
 * Aqui so' mora a regra pura (sem tela, sem Firestore).
 */

export type TipoCadastro = 'estoque' | 'materia_prima';

export interface ItemDaNotaParaVinculo {
  codigo: string;
  descricao: string;
  ncm: string;
  ean?: string;
}

export interface CadastroParaVinculo {
  id: string;
  codigo: string;
  nome: string;
  codigoBarras?: string;
  ncm?: string;
  codigosFornecedor?: Record<string, string>;
}

export interface SugestaoDeVinculo {
  tipo: TipoCadastro;
  id: string;
  codigo: string;
  nome: string;
  /** 0 a 100. */
  pontuacao: number;
  /** Por que esta sugestao apareceu, em portugues, para a tela mostrar. */
  motivos: string[];
}

// "1KG" e "1 KG", "500ML" e "500 ML" sao a mesma medida escrita de dois jeitos:
// separa numero de letra antes de comparar, senao o nome-base nunca casa.
const palavras = (texto: string): string[] => normalizarTextoDeItem(texto)
  .replace(/(\d)([A-Z])/g, '$1 $2')
  .replace(/([A-Z])(\d)/g, '$1 $2')
  .split(' ')
  .filter((p) => p.length > 0);

/** Coeficiente de Dice sobre as palavras: 2 x em comum / (total das duas listas). */
const semelhancaDeNomes = (a: string, b: string): number => {
  const conjuntoA = new Set(palavras(a));
  const conjuntoB = new Set(palavras(b));
  if (conjuntoA.size === 0 || conjuntoB.size === 0) return 0;
  let emComum = 0;
  conjuntoA.forEach((p) => { if (conjuntoB.has(p)) emComum += 1; });
  return (2 * emComum) / (conjuntoA.size + conjuntoB.size);
};

const digitos = (valor: unknown): string => String(valor ?? '').replace(/\D/g, '');

/** Numeros que aparecem na descricao (500, 2, 1): medidas diferentes indicam produto diferente. */
const numerosDe = (texto: string): string[] => palavras(texto).filter((p) => /^\d+$/.test(p));

const PONTUACAO_MINIMA = 40;

const pontuar = (
  tipo: TipoCadastro,
  item: ItemDaNotaParaVinculo,
  cadastro: CadastroParaVinculo,
  fornecedorId: string,
): SugestaoDeVinculo | null => {
  const motivos: string[] = [];
  let pontuacao = 0;

  const ean = digitos(item.ean);
  if (ean && ean === digitos(cadastro.codigoBarras)) {
    pontuacao = 100;
    motivos.push('mesmo código de barras');
  }

  const cProd = String(item.codigo || '').trim().toLowerCase();
  const codigoDoFornecedor = String(cadastro.codigosFornecedor?.[fornecedorId] || '').trim().toLowerCase();
  if (cProd && codigoDoFornecedor && cProd === codigoDoFornecedor) {
    pontuacao = Math.max(pontuacao, 100);
    motivos.push('já comprado deste fornecedor com o mesmo código');
  }

  const semelhanca = semelhancaDeNomes(item.descricao, cadastro.nome);
  if (semelhanca > 0) {
    let pontosNome = Math.round(semelhanca * 85);
    // Medidas diferentes (500ML x 1L, 2 x 4) sao o erro de vinculo mais caro:
    // o mesmo nome-base com numeros que nao batem perde pontos.
    const numerosItem = numerosDe(item.descricao);
    const numerosCadastro = numerosDe(cadastro.nome);
    const faltaNumero = numerosItem.some((n) => !numerosCadastro.includes(n))
      || numerosCadastro.some((n) => !numerosItem.includes(n));
    if (faltaNumero) pontosNome = Math.round(pontosNome * 0.75);
    if (normalizarTextoDeItem(item.descricao) === normalizarTextoDeItem(cadastro.nome)) {
      pontosNome = 95;
      motivos.push('mesmo nome');
    } else if (pontosNome >= PONTUACAO_MINIMA) {
      motivos.push('nome parecido');
    }
    pontuacao = Math.max(pontuacao, pontosNome);
  }

  const ncmItem = digitos(item.ncm);
  if (ncmItem && ncmItem === digitos(cadastro.ncm) && pontuacao > 0) {
    pontuacao = Math.min(100, pontuacao + 8);
    motivos.push('mesmo NCM');
  }

  if (pontuacao < PONTUACAO_MINIMA) return null;
  return { tipo, id: cadastro.id, codigo: cadastro.codigo, nome: cadastro.nome, pontuacao, motivos };
};

/**
 * Sugestoes de vinculo para um item da nota, das mais provaveis para as
 * menos, entre produtos do estoque e materias-primas. So' sugere -- quem
 * decide e' a pessoa; nada disso vincula sozinho.
 */
export const sugerirVinculos = (
  item: ItemDaNotaParaVinculo,
  produtos: CadastroParaVinculo[],
  materiasPrimas: CadastroParaVinculo[],
  fornecedorId: string,
  limite = 5,
): SugestaoDeVinculo[] => {
  const todas: SugestaoDeVinculo[] = [];
  produtos.forEach((p) => {
    const s = pontuar('estoque', item, p, fornecedorId);
    if (s) todas.push(s);
  });
  materiasPrimas.forEach((m) => {
    const s = pontuar('materia_prima', item, m, fornecedorId);
    if (s) todas.push(s);
  });
  return todas
    .sort((a, b) => b.pontuacao - a.pontuacao || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, Math.max(0, limite));
};

export interface ResultadoDeBusca {
  tipo: TipoCadastro;
  id: string;
  codigo: string;
  nome: string;
  codigoBarras: string;
}

/**
 * Busca livre para o vinculo manual: todas as palavras digitadas precisam
 * aparecer no nome, e tambem casa por codigo ou codigo de barras. Sem
 * acento e sem diferenca de maiuscula.
 */
export const buscarCadastros = (
  termo: string,
  produtos: CadastroParaVinculo[],
  materiasPrimas: CadastroParaVinculo[],
  limite = 20,
): ResultadoDeBusca[] => {
  const palavrasDaBusca = palavras(termo);
  if (palavrasDaBusca.length === 0) return [];
  const termoDigitos = digitos(termo);
  const termoNormalizado = normalizarTextoDeItem(termo);

  const casa = (c: CadastroParaVinculo): boolean => {
    const nome = normalizarTextoDeItem(c.nome);
    if (palavrasDaBusca.every((p) => nome.includes(p))) return true;
    const codigo = normalizarTextoDeItem(c.codigo);
    if (codigo && !termoNormalizado.includes(' ') && codigo.includes(termoNormalizado)) return true;
    return termoDigitos.length >= 4 && digitos(c.codigoBarras).includes(termoDigitos);
  };

  const resultado: ResultadoDeBusca[] = [];
  const juntar = (tipo: TipoCadastro, lista: CadastroParaVinculo[]) => {
    lista.forEach((c) => {
      if (casa(c)) resultado.push({ tipo, id: c.id, codigo: c.codigo, nome: c.nome, codigoBarras: c.codigoBarras || '' });
    });
  };
  juntar('estoque', produtos);
  juntar('materia_prima', materiasPrimas);
  return resultado
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, Math.max(0, limite));
};

export const ROTULO_ORIGEM_VINCULO: Record<OrigemDoVinculoItem, string> = {
  ean: 'reconhecido pelo código de barras',
  codigo_fornecedor: 'reconhecido pelo histórico deste fornecedor',
  nome: 'reconhecido pelo nome e NCM',
  automatico: 'reconhecido automaticamente',
  manual: 'vinculado por você',
};

/** Configuracao do item depois de vinculado a um produto do estoque ou materia-prima. */
export const configDoItemVinculado = (
  alvo: { tipo: TipoCadastro; id: string; fiscal?: ProdutoFiscalAtual },
  valorUnitarioXml: number,
  usaCsosn: boolean,
): ItemEntradaConfig => (
  alvo.tipo === 'estoque'
    ? buildInitialItemEntradaConfig(valorUnitarioXml, alvo.fiscal ?? { id: alvo.id }, null, usaCsosn)
    : buildInitialItemEntradaConfig(valorUnitarioXml, null, alvo.id, usaCsosn)
);

/** Desfaz o vinculo: o item volta a ser cadastro novo. */
export const configDoItemSemVinculo = (valorUnitarioXml: number, usaCsosn: boolean): ItemEntradaConfig => (
  buildInitialItemEntradaConfig(valorUnitarioXml, null, null, usaCsosn)
);

/** GTIN de 8, 12, 13 ou 14 digitos; "SEM GTIN" e afins nao contam. */
const gtinValido = (valor: string): boolean => [8, 12, 13, 14].includes(valor.length);

/**
 * O que a nota ensina ao cadastro vinculado: codigo de barras e NCM que o
 * produto ainda nao tem. NUNCA sobrescreve o que ja esta preenchido -- se o
 * cadastro tem um valor diferente do da nota, quem manda e' o cadastro.
 */
export const dadosFiscaisParaCompletar = (
  item: ItemDaNotaParaVinculo,
  cadastro: { codigoBarras?: string; ncm?: string },
): { codigoBarras?: string; ncm?: string } => {
  const completar: { codigoBarras?: string; ncm?: string } = {};
  const eanDaNota = digitos(item.ean);
  if (!digitos(cadastro.codigoBarras) && gtinValido(eanDaNota)) completar.codigoBarras = eanDaNota;
  const ncmDaNota = digitos(item.ncm);
  if (!digitos(cadastro.ncm) && ncmDaNota.length === 8) completar.ncm = ncmDaNota;
  return completar;
};
