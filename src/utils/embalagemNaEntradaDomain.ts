/**
 * EMBALAGENS NA ENTRADA DA NOTA (26/11/2026, pedido do dono).
 *
 * Na Entrada de XML, na Nota Avulsa e no XML importado na Nota Avulsa, alem da
 * conversao (1 CX da nota = 12 UN do estoque), a pessoa:
 *  - ve as embalagens que o produto ja' tem e corrige o custo e o preco delas
 *    (o custo da nota mudou, o saco de 20 kg passa a custar outro valor);
 *  - cadastra a embalagem que o produto ainda nao tem (SC de 20 KG, CX de 12 UN).
 *
 * Grava junto com a entrada, no campo `embalagens` do produto -- o mesmo que o
 * cadastro do produto edita (embalagemDomain.ts). Campo vazio = 0 = "sem valor
 * proprio" (custo: custo da unidade x fator; preco: preco base x fator), a mesma
 * regra do cadastro. Preco com "Estoque: alterar o preco", custo com "Estoque:
 * alterar o custo"; sem elas, o que o cadastro tem nao muda.
 *
 * Regra pura: sem tela, sem Firestore. Nunca devolve chave undefined.
 */
import { normalizeEmbalagens, type Embalagem } from './embalagemDomain';

/** Valores digitados de uma embalagem que o produto ja' tem (texto da tela). */
export interface EdicaoDeEmbalagem {
  id: string;
  precoCusto: string;
  precoVenda: string;
  precoAVista: string;
}

/** Embalagem nova cadastrada na entrada. */
export interface EmbalagemNovaNaEntrada {
  /** Chave so' da tela (lista). */
  chave: string;
  unidadeMedidaId: string;
  sigla: string;
  casasDecimais: number;
  fracionado: boolean;
  /** Quantas unidades do estoque cabem em 1 desta embalagem. */
  fator: string;
  precoCusto: string;
  precoVenda: string;
  precoAVista: string;
}

export interface EdicaoDasEmbalagens {
  existentes: EdicaoDeEmbalagem[];
  novas: EmbalagemNovaNaEntrada[];
}

const texto = (n: number): string => (n > 0 ? String(Math.round(n * 100) / 100).replace('.', ',') : '');

/** Como a tela abre: as embalagens ATIVAS do produto, com os valores de hoje. */
export const edicaoInicialDasEmbalagens = (embalagensDoCadastro: unknown): EdicaoDasEmbalagens => ({
  existentes: normalizeEmbalagens(embalagensDoCadastro).filter((e) => e.ativo).map((e) => ({
    id: e.id,
    precoCusto: texto(e.precoCusto),
    precoVenda: texto(e.precoVenda),
    precoAVista: texto(e.precoAVista),
  })),
  novas: [],
});

/** "12,50" / "12.5" / "" -> numero; vazio = 0; invalido ou negativo = null. */
export const numeroDoCampoDeEmbalagem = (valor: string): number | null => {
  const limpo = String(valor ?? '').trim().replace(/\s/g, '');
  if (limpo === '') return 0;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null;
};

const rotulo = (sigla: string, fator: number) => `${sigla} de ${String(fator).replace('.', ',')}`;

/**
 * O array `embalagens` para gravar no produto, ou null quando nada mudou.
 * `atuais` e' o campo cru do produto (mantem os campos que a entrada nao mexe).
 */
export const embalagensParaGravar = (args: {
  atuais: unknown;
  edicao: EdicaoDasEmbalagens | null | undefined;
  /** Sigla da unidade do estoque do produto (para nao cadastrar "UN de 1" no produto em UN). */
  siglaBase: string;
  podePreco: boolean;
  podeCusto: boolean;
  novoId: () => string;
}): { embalagens: Array<Record<string, unknown>> | null; erro: string | null } => {
  const edicao = args.edicao;
  if (!edicao) return { embalagens: null, erro: null };
  const cruas = Array.isArray(args.atuais) ? args.atuais : [];
  const normalizadas = new Map<string, Embalagem>(normalizeEmbalagens(args.atuais).map((e) => [e.id, e]));
  let mudou = false;

  const atualizadas = cruas.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw as Record<string, unknown>;
    const entry = raw as Record<string, unknown>;
    const atual = normalizadas.get(String(entry.id || '').trim());
    const ed = atual ? edicao.existentes.find((e) => e.id === atual.id) : undefined;
    if (!atual || !ed) return entry;
    const campos: Record<string, number> = {};
    const conferir = (campo: 'precoCusto' | 'precoVenda' | 'precoAVista', valor: string, pode: boolean) => {
      if (!pode) return null;
      const n = numeroDoCampoDeEmbalagem(valor);
      if (n === null) return `Confira o ${campo === 'precoCusto' ? 'custo' : campo === 'precoVenda' ? 'preço de venda' : 'preço à vista'} da embalagem ${rotulo(atual.unidadeMedidaSigla, atual.fatorConversao)}: use só números, por exemplo 12,50.`;
      if (Math.abs(n - atual[campo]) >= 0.005) campos[campo] = n;
      return null;
    };
    const erro = conferir('precoCusto', ed.precoCusto, args.podeCusto)
      || conferir('precoVenda', ed.precoVenda, args.podePreco)
      || conferir('precoAVista', ed.precoAVista, args.podePreco);
    if (erro) throw new Error(erro);
    if (Object.keys(campos).length === 0) return entry;
    mudou = true;
    return { ...entry, ...campos };
  });

  const novas: Array<Record<string, unknown>> = [];
  for (const nova of edicao.novas) {
    if (!args.podePreco) {
      return { embalagens: null, erro: 'Cadastrar embalagem pede a permissão "Estoque: alterar o preço". Peça a um responsável liberar no seu cadastro de funcionário.' };
    }
    const sigla = String(nova.sigla || '').trim().toUpperCase();
    if (!sigla || !String(nova.unidadeMedidaId || '').trim()) {
      return { embalagens: null, erro: 'Escolha a unidade da embalagem nova (SC, CX, FD...). Se ela não está na lista, cadastre em Cadastros Auxiliares › Unidades de Medida.' };
    }
    const fator = numeroDoCampoDeEmbalagem(nova.fator);
    if (fator === null || !(fator > 0)) {
      return { embalagens: null, erro: `Informe quantos ${args.siglaBase || 'itens do estoque'} cabem em 1 ${sigla} (maior que zero).` };
    }
    if (sigla === String(args.siglaBase || '').trim().toUpperCase() && Math.abs(fator - 1) < 1e-9) {
      return { embalagens: null, erro: `${sigla} de 1 é a própria unidade do produto: não precisa de embalagem.` };
    }
    const repetida = [...normalizadas.values()].some((e) => e.ativo && e.unidadeMedidaSigla === sigla && Math.abs(e.fatorConversao - fator) < 1e-9)
      || novas.some((n) => n.unidadeMedidaSigla === sigla && Math.abs(Number(n.fatorConversao) - fator) < 1e-9);
    if (repetida) return { embalagens: null, erro: `O produto já tem a embalagem ${rotulo(sigla, fator)}. Corrija o preço dela na lista em vez de cadastrar de novo.` };
    const custo = numeroDoCampoDeEmbalagem(nova.precoCusto);
    const venda = numeroDoCampoDeEmbalagem(nova.precoVenda);
    const vista = numeroDoCampoDeEmbalagem(nova.precoAVista);
    if (custo === null || venda === null || vista === null) {
      return { embalagens: null, erro: `Confira os valores da embalagem ${rotulo(sigla, fator)}: use só números, por exemplo 12,50.` };
    }
    novas.push({
      id: args.novoId(),
      unidadeMedidaId: String(nova.unidadeMedidaId).trim(),
      unidadeMedidaSigla: sigla,
      unidadeMedidaCasasDecimais: Math.max(0, Math.trunc(Number(nova.casasDecimais) || 0)),
      unidadeMedidaFracionado: nova.fracionado === true,
      descricao: '',
      fatorConversao: fator,
      precoVenda: venda,
      precoAVista: vista,
      precoCusto: args.podeCusto ? custo : 0,
      codigoBarras: '',
      ativo: true,
    });
  }

  if (!mudou && novas.length === 0) return { embalagens: null, erro: null };
  return { embalagens: [...atualizadas, ...novas], erro: null };
};

/** Versao que nunca lanca: o erro de valor digitado volta como mensagem. */
export const embalagensParaGravarSemLancar = (args: Parameters<typeof embalagensParaGravar>[0]): ReturnType<typeof embalagensParaGravar> => {
  try {
    return embalagensParaGravar(args);
  } catch (erro) {
    return { embalagens: null, erro: erro instanceof Error ? erro.message : 'Confira os valores das embalagens.' };
  }
};
