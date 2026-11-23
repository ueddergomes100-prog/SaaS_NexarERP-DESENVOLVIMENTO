import { nivelDeEstoque, type NivelEstoque } from './buscaProdutoOpcaoDomain';
import { resumoDeReserva } from './estoqueReservaDomain';
import { faixasDeAtacadoDoProduto } from './precoVendaDomain';

/**
 * Ficha do produto na janela de consulta ("Buscar produto", 21/11/2026).
 *
 * A janela tem a lista a' esquerda e, a' direita, os dados do produto que
 * esta' em destaque -- preco grande, disponivel, reservado, local, codigo de
 * barras. Aqui fica so' a decisao do QUE aparece; o desenho esta' no
 * componente.
 *
 * Regra unica: campo que o cadastro nao tem NAO aparece. A ficha nunca mostra
 * linha vazia, traco ou "nao informado" -- cadastro incompleto se resolve no
 * cadastro (CLAUDE.md, regra 1), a consulta so' nao inventa.
 *
 * A janela serve varias telas (venda, OS, orcamento, ajuste de estoque,
 * composicao) e nem todo item da lista e' um produto do estoque: por isso
 * tudo aqui e' opcional e lido com cuidado.
 */

export interface ProdutoDaFicha {
  nome?: unknown;
  codigo?: unknown;
  codigoBarras?: unknown;
  skuSistema?: unknown;
  referencia?: unknown;
  marca?: unknown;
  categoria?: unknown;
  precoVenda?: unknown;
  precoAVista?: unknown;
  quantidade?: unknown;
  quantidadeReservada?: unknown;
  unidadeMedidaSigla?: unknown;
  unidadeMedidaCasasDecimais?: unknown;
  localizacaoEstoque?: unknown;
  estoqueConfig?: unknown;
  /** Aba "Atacado" do cadastro (precoVendaDomain.faixasDeAtacadoDoProduto). */
  atacado?: unknown;
}

export interface LinhaDaFicha {
  id: 'disponivel' | 'reservado' | 'atacado' | 'local' | 'unidade' | 'marca' | 'referencia' | 'barras';
  rotulo: string;
  valor: string;
  /** So' a linha do disponivel tem cor (mesmos tres niveis da lista). */
  nivel?: NivelEstoque;
}

export interface FichaDoProduto {
  nome: string;
  /** "Cód. 1508 · FIXTIL · Fixadores": so' com o que existir. */
  subtitulo: string;
  /** Preco de venda do cadastro, em reais; null quando o item nao tem preco. */
  preco: number | null;
  /** Preco a' vista, so' quando existe e e' diferente do preco de venda. */
  precoAVista: number | null;
  /** Sigla da unidade (para "por UN"); vazia quando o cadastro nao tem. */
  unidade: string;
  linhas: LinhaDaFicha[];
}

const texto = (valor: unknown): string => String(valor ?? '').trim();

const numero = (valor: unknown): number | null => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const localDoProduto = (produto: ProdutoDaFicha): string => {
  const direto = texto(produto.localizacaoEstoque);
  if (direto) return direto;
  const config = produto.estoqueConfig;
  return config && typeof config === 'object' ? texto((config as { localizacao?: unknown }).localizacao) : '';
};

const formatarQuantidade = (valor: number, casas: number, unidade: string): string => (
  `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}${unidade ? ` ${unidade}` : ''}`
);

/** Uma faixa de atacado pronta para a busca: preco e a quantidade em texto. */
export interface AtacadoNaBusca {
  preco: number;
  /** "a partir de 20 PCT" ou "de 20 a 49 PCT". */
  quantidade: string;
}

/**
 * PRECO DE ATACADO NA BUSCA (23/11/2026, pedido do dono no treinamento da
 * Embala Minas): o vendedor precisa ver, antes de lancar o item, que o
 * produto tem atacado e a partir de quantas unidades ele vale.
 *
 * As faixas vem da MESMA funcao que o Pedido de Venda usa para aplicar o
 * atacado (faixasDeAtacadoDoProduto), entao o que a busca mostra e' o que a
 * venda cobra. A lista e a ficha mostram o produto na unidade do estoque
 * (fator 1). Produto sem atacado ligado, ou sem faixa com preco, devolve
 * lista vazia e nada aparece. Ordem: da menor quantidade para a maior.
 */
export const atacadoParaBusca = (produto: { atacado?: unknown; unidadeMedidaSigla?: unknown; unidadeMedidaCasasDecimais?: unknown }): AtacadoNaBusca[] => {
  const unidade = texto(produto.unidadeMedidaSigla);
  const casasBrutas = numero(produto.unidadeMedidaCasasDecimais);
  const casas = casasBrutas !== null && casasBrutas >= 0 && casasBrutas <= 4 ? Math.trunc(casasBrutas) : 0;
  const qtd = (valor: number) => valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: Math.max(casas, 3) });
  const sufixo = unidade ? ` ${unidade}` : '';
  return faixasDeAtacadoDoProduto(produto)
    .slice()
    .sort((a, b) => a.aPartirDe - b.aPartirDe)
    .map((faixa) => ({
      preco: faixa.preco,
      quantidade: faixa.ate === null
        ? `a partir de ${qtd(faixa.aPartirDe)}${sufixo}`
        : `de ${qtd(faixa.aPartirDe)} a ${qtd(faixa.ate)}${sufixo}`,
    }));
};

const formatarReais = (valor: number): string => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fichaDoProduto = (produto: ProdutoDaFicha): FichaDoProduto => {
  const unidade = texto(produto.unidadeMedidaSigla);
  const casasBrutas = numero(produto.unidadeMedidaCasasDecimais);
  const casas = casasBrutas !== null && casasBrutas >= 0 && casasBrutas <= 4 ? Math.trunc(casasBrutas) : 0;
  const codigo = texto(produto.codigo) || texto(produto.skuSistema);
  const marca = texto(produto.marca);
  const categoria = texto(produto.categoria);

  const preco = numero(produto.precoVenda);
  const aVista = numero(produto.precoAVista);

  const linhas: LinhaDaFicha[] = [];
  // Estoque so' entra para item que TEM o campo: materia-prima escolhida na
  // composicao, por exemplo, nao traz `quantidade` e nao pode aparecer zerada.
  const quantidade = numero(produto.quantidade);
  if (quantidade !== null) {
    const reserva = resumoDeReserva(produto);
    const disponivel = reserva.temReserva ? reserva.disponivel : quantidade;
    linhas.push({
      id: 'disponivel',
      rotulo: 'Disponível',
      valor: disponivel <= 0 ? 'sem estoque' : formatarQuantidade(disponivel, casas, unidade),
      nivel: nivelDeEstoque(disponivel),
    });
    if (reserva.temReserva) {
      linhas.push({ id: 'reservado', rotulo: 'Reservado', valor: formatarQuantidade(reserva.reservada, casas, unidade) });
    }
  }
  // Atacado logo abaixo do estoque: e' o que decide a quantidade a lancar.
  for (const faixa of atacadoParaBusca(produto)) {
    linhas.push({ id: 'atacado', rotulo: `Atacado ${faixa.quantidade}`, valor: formatarReais(faixa.preco) });
  }
  const local = localDoProduto(produto);
  if (local) linhas.push({ id: 'local', rotulo: 'Local no depósito', valor: local });
  if (unidade) linhas.push({ id: 'unidade', rotulo: 'Unidade de venda', valor: unidade });
  if (marca) linhas.push({ id: 'marca', rotulo: 'Marca', valor: marca });
  const referencia = texto(produto.referencia);
  if (referencia) linhas.push({ id: 'referencia', rotulo: 'Referência', valor: referencia });
  const barras = texto(produto.codigoBarras);
  if (barras) linhas.push({ id: 'barras', rotulo: 'Código de barras', valor: barras });

  return {
    nome: texto(produto.nome),
    subtitulo: [codigo ? `Cód. ${codigo}` : '', marca, categoria].filter(Boolean).join(' · '),
    preco,
    precoAVista: aVista !== null && aVista > 0 && aVista !== preco ? aVista : null,
    unidade,
    linhas,
  };
};
