import { nivelDeEstoque, type NivelEstoque } from './buscaProdutoOpcaoDomain';
import { resumoDeReserva } from './estoqueReservaDomain';

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
}

export interface LinhaDaFicha {
  id: 'disponivel' | 'reservado' | 'local' | 'unidade' | 'marca' | 'referencia' | 'barras';
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
