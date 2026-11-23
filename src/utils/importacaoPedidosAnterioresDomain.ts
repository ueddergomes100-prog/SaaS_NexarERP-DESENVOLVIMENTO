import type { FinancialNature, PaymentMethod } from './financeDomain';
import { toCents, fromCents } from './financeDomain';
import { STATUS_FINALIZADA, STATUS_PRE_VENDA } from './preVendaDomain';

/**
 * IMPORTAR PEDIDOS DO SISTEMA ANTERIOR (23/11/2026, migracao Embala Minas).
 *
 * Decisoes do dono:
 *  - vendas FATURADAS entram como Pedido de Venda de verdade (status
 *    Finalizada), com o numero do sistema antigo. Sao REGISTRO: nao baixam
 *    estoque, nao lancam caixa nem contas a receber (o saldo de estoque e as
 *    contas em aberto ja foram importados) e entram com comissao zero (a
 *    comissao delas foi paga no sistema antigo -- somar de novo no Relatorio
 *    de Comissoes faria pagar duas vezes);
 *  - PRE-VENDAS em aberto entram como pre-venda aberta, com reserva de
 *    estoque, para o caixa faturar normalmente no Hennder;
 *  - as vendas feitas no Hennder antes da importacao passam a seguir a
 *    numeracao, depois do ultimo numero antigo (planoDeRenumeracao).
 *
 * Um pedido importado nunca pode ser cancelado, devolvido, trocado, ter nota
 * emitida ou o pagamento alterado no Hennder: essas acoes estornariam estoque
 * e financeiro que o Hennder nunca lancou. Ver ehPedidoDoSistemaAnterior e
 * mensagemPedidoDoSistemaAnterior.
 *
 * Arquivo: CSV com uma linha por item (gerado na migracao, ver
 * 11_gerar_pedidos.py). Os numeros vem no formato brasileiro (1.234,56).
 */

export const SITUACAO_FATURADO = 'faturado' as const;
export const SITUACAO_PRE_VENDA = 'pre-venda' as const;
export type SituacaoImportada = typeof SITUACAO_FATURADO | typeof SITUACAO_PRE_VENDA;

/** Os numeros antigos entram com 6 digitos ("093255"): a numeracao do Hennder
 *  acha o maior numero gravado comparando como TEXTO, e "99999" passaria na
 *  frente de "113696". Com o mesmo tamanho, texto e numero dao a mesma ordem. */
export const DIGITOS_NUMERO_IMPORTADO = 6;

export type CampoPedidoImportado =
  | 'situacao' | 'pedido' | 'data' | 'hora' | 'documento' | 'cliente' | 'codigoVendedor' | 'vendedor' | 'observacao'
  | 'pagamentos' | 'descontoPedido' | 'frete' | 'encargos' | 'totalPedido'
  | 'codigoProduto' | 'produto' | 'quantidade' | 'unidade' | 'valorUnitario' | 'descontoItem' | 'valorTotalItem';

export type MapeamentoPedidos = Record<CampoPedidoImportado, number | null>;

const APELIDOS: Record<CampoPedidoImportado, string[]> = {
  situacao: ['situacao', 'status'],
  pedido: ['pedido', 'numero do pedido', 'numero'],
  data: ['data', 'data do pedido', 'emissao'],
  hora: ['hora', 'horario'],
  documento: ['cpf/cnpj', 'cpf cnpj', 'documento'],
  cliente: ['cliente', 'nome do cliente'],
  codigoVendedor: ['codigo do vendedor', 'cod vendedor'],
  vendedor: ['vendedor', 'nome do vendedor'],
  observacao: ['observacao', 'obs'],
  pagamentos: ['pagamentos', 'forma de pagamento', 'formas de pagamento'],
  descontoPedido: ['desconto do pedido', 'desconto geral'],
  frete: ['frete'],
  encargos: ['encargos', 'acrescimo'],
  totalPedido: ['total do pedido', 'valor do pedido'],
  codigoProduto: ['codigo do produto', 'referencia', 'cod produto'],
  produto: ['produto', 'descricao'],
  quantidade: ['quantidade', 'qtd'],
  unidade: ['unidade', 'un'],
  valorUnitario: ['valor unitario', 'preco unitario'],
  descontoItem: ['desconto do item'],
  valorTotalItem: ['valor total do item', 'total do item'],
};

export const CAMPOS_OBRIGATORIOS_PEDIDOS: CampoPedidoImportado[] = ['situacao', 'pedido', 'data', 'produto', 'quantidade', 'valorTotalItem', 'totalPedido'];

const normalizarTexto = (valor: unknown): string => String(valor ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

export const inferirMapeamentoPedidos = (cabecalho: string[]): MapeamentoPedidos => {
  const normalizado = cabecalho.map(normalizarTexto);
  const mapa = {} as MapeamentoPedidos;
  (Object.keys(APELIDOS) as CampoPedidoImportado[]).forEach((campo) => {
    const indice = normalizado.findIndex((col) => APELIDOS[campo].includes(col));
    mapa[campo] = indice >= 0 ? indice : null;
  });
  return mapa;
};

/** "1.234,56" -> 1234.56; "" -> 0. Aceita tambem "1234.56". */
export const lerNumeroBr = (valor: unknown): number => {
  const texto = String(valor ?? '').trim();
  if (!texto) return 0;
  const limpo = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
};

/** "01/02/2025" -> "2025-02-01"; formato invalido -> ''. */
export const lerDataBr = (valor: unknown): string => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor ?? '').trim());
  if (!m) return '';
  const [, d, mes, a] = m;
  const data = new Date(`${a}-${mes}-${d}T12:00:00`);
  if (Number.isNaN(data.getTime()) || data.getUTCDate() !== Number(d)) return '';
  return `${a}-${mes}-${d}`;
};

const FORMAS_ACEITAS: PaymentMethod[] = [
  'Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Cheque',
  'Pagamento a Prazo', 'Crédito de Devolução', 'Cashback', 'Outros',
];

export interface PagamentoImportado {
  forma: PaymentMethod;
  valor: number;
}

/** "Dinheiro=10,00 | Pix=5,50" -> pagamentos. Forma desconhecida vira "Outros". */
export const lerPagamentos = (texto: unknown): PagamentoImportado[] => {
  const partes = String(texto ?? '').split('|').map((p) => p.trim()).filter(Boolean);
  const somado = new Map<PaymentMethod, number>();
  partes.forEach((parte) => {
    const [formaBruta, valorBruto] = parte.split('=');
    const valor = lerNumeroBr(valorBruto);
    if (!Number.isFinite(valor) || valor <= 0) return;
    const forma = FORMAS_ACEITAS.find((f) => normalizarTexto(f) === normalizarTexto(formaBruta)) || 'Outros';
    somado.set(forma, Math.round(((somado.get(forma) || 0) + valor) * 100) / 100);
  });
  return [...somado.entries()].map(([forma, valor]) => ({ forma, valor }));
};

export interface ItemImportadoLido {
  codigoProduto: string;
  produto: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  descontoItem: number;
  valorTotal: number;
}

export interface PedidoImportadoLido {
  situacao: SituacaoImportada;
  /** Numero com 6 digitos (DIGITOS_NUMERO_IMPORTADO). */
  numero: string;
  data: string;
  hora: string;
  documentoCliente: string;
  nomeCliente: string;
  codigoVendedor: string;
  nomeVendedor: string;
  observacao: string;
  pagamentos: PagamentoImportado[];
  descontoPedido: number;
  frete: number;
  encargos: number;
  totalPedido: number;
  itens: ItemImportadoLido[];
  /** '' = pedido certo; senao o motivo de ficar de fora, em portugues. */
  problema: string;
}

const arredonda = (v: number) => Math.round(v * 100) / 100;

const lerSituacao = (valor: unknown): SituacaoImportada | null => {
  const t = normalizarTexto(valor).replace(/[\s_-]+/g, '');
  if (t === 'faturado' || t === 'finalizado' || t === 'finalizada') return SITUACAO_FATURADO;
  if (t === 'prevenda') return SITUACAO_PRE_VENDA;
  return null;
};

export const formatarNumeroImportado = (valor: unknown): string => {
  const digitos = String(valor ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digitos ? digitos.padStart(DIGITOS_NUMERO_IMPORTADO, '0') : '';
};

/** Agrupa as linhas (uma por item) em pedidos e confere cada um. */
export const lerPedidosImportados = (linhas: string[][], mapa: MapeamentoPedidos): PedidoImportadoLido[] => {
  const celula = (linha: string[], campo: CampoPedidoImportado): string => {
    const i = mapa[campo];
    return i === null || i === undefined ? '' : String(linha[i] ?? '').trim();
  };
  const porNumero = new Map<string, PedidoImportadoLido>();
  const ordem: string[] = [];
  linhas.forEach((linha) => {
    const numero = formatarNumeroImportado(celula(linha, 'pedido'));
    if (!numero) return;
    let pedido = porNumero.get(numero);
    if (!pedido) {
      const situacao = lerSituacao(celula(linha, 'situacao'));
      const data = lerDataBr(celula(linha, 'data'));
      const numeros = [lerNumeroBr(celula(linha, 'descontoPedido')), lerNumeroBr(celula(linha, 'frete')), lerNumeroBr(celula(linha, 'encargos')), lerNumeroBr(celula(linha, 'totalPedido'))];
      let problema = '';
      if (!situacao) problema = `Situação "${celula(linha, 'situacao')}" desconhecida: use Faturado ou Pré-venda.`;
      else if (!data) problema = `Data "${celula(linha, 'data')}" inválida: use dd/mm/aaaa.`;
      else if (numeros.some((n) => !Number.isFinite(n) || n < 0)) problema = 'Desconto, frete, encargos ou total do pedido com valor inválido.';
      pedido = {
        situacao: situacao || SITUACAO_FATURADO,
        numero,
        data,
        hora: celula(linha, 'hora'),
        documentoCliente: celula(linha, 'documento'),
        nomeCliente: celula(linha, 'cliente').toUpperCase(),
        codigoVendedor: celula(linha, 'codigoVendedor'),
        nomeVendedor: celula(linha, 'vendedor').toUpperCase(),
        observacao: celula(linha, 'observacao'),
        pagamentos: lerPagamentos(celula(linha, 'pagamentos')),
        descontoPedido: arredonda(numeros[0] || 0),
        frete: arredonda(numeros[1] || 0),
        encargos: arredonda(numeros[2] || 0),
        totalPedido: arredonda(numeros[3] || 0),
        itens: [],
        problema,
      };
      porNumero.set(numero, pedido);
      ordem.push(numero);
    }
    const quantidade = lerNumeroBr(celula(linha, 'quantidade'));
    const valorTotal = lerNumeroBr(celula(linha, 'valorTotalItem'));
    const valorUnitario = lerNumeroBr(celula(linha, 'valorUnitario'));
    const descontoItem = lerNumeroBr(celula(linha, 'descontoItem'));
    const produto = celula(linha, 'produto').toUpperCase();
    if (!pedido.problema && (!produto || !Number.isFinite(quantidade) || quantidade <= 0 || !Number.isFinite(valorTotal) || valorTotal < 0)) {
      pedido.problema = `Item "${produto || 'sem nome'}" com quantidade ou valor inválido.`;
    }
    pedido.itens.push({
      codigoProduto: celula(linha, 'codigoProduto'),
      produto,
      quantidade: Number.isFinite(quantidade) ? quantidade : 0,
      unidade: celula(linha, 'unidade').toUpperCase(),
      valorUnitario: Number.isFinite(valorUnitario) && valorUnitario > 0 ? valorUnitario : (quantidade > 0 ? arredonda(valorTotal / quantidade) : 0),
      descontoItem: Number.isFinite(descontoItem) && descontoItem > 0 ? arredonda(descontoItem) : 0,
      valorTotal: Number.isFinite(valorTotal) ? arredonda(valorTotal) : 0,
    });
  });
  return ordem.map((numero) => {
    const pedido = porNumero.get(numero) as PedidoImportadoLido;
    if (!pedido.problema) {
      const somaItens = pedido.itens.reduce((s, i) => s + i.valorTotal, 0);
      const calculado = arredonda(somaItens - pedido.descontoPedido + pedido.frete + pedido.encargos);
      if (Math.abs(calculado - pedido.totalPedido) >= 0.02) {
        pedido.problema = `Os itens não fecham com o total do pedido (itens - desconto + frete + encargos = ${calculado.toFixed(2).replace('.', ',')}; total ${pedido.totalPedido.toFixed(2).replace('.', ',')}).`;
      }
    }
    return pedido;
  });
};

export interface VendedorDoArquivo {
  codigo: string;
  nome: string;
  pedidos: number;
}

export const vendedoresDoArquivo = (pedidos: PedidoImportadoLido[]): VendedorDoArquivo[] => {
  const porChave = new Map<string, VendedorDoArquivo>();
  pedidos.forEach((p) => {
    const chave = p.codigoVendedor || p.nomeVendedor;
    if (!chave) return;
    const atual = porChave.get(chave) || { codigo: p.codigoVendedor, nome: p.nomeVendedor, pedidos: 0 };
    atual.pedidos += 1;
    porChave.set(chave, atual);
  });
  return [...porChave.values()].sort((a, b) => b.pedidos - a.pedidos || a.nome.localeCompare(b.nome, 'pt-BR'));
};

/** Chave do vendedor no arquivo (o que vendedoresDoArquivo usa). */
export const chaveDoVendedor = (p: { codigoVendedor: string; nomeVendedor: string }): string => p.codigoVendedor || p.nomeVendedor;

/**
 * Usuario do Hennder com o mesmo nome do vendedor antigo: nome inteiro igual
 * ou, sem isso, o primeiro nome igual a UM so' usuario. '' = criar inativo.
 * E' so' a sugestao inicial: a tela mostra e o dono confirma.
 */
export const sugerirVendedor = (nomeAntigo: string, usuarios: Array<{ id: string; nome: string }>): string => {
  const alvo = normalizarTexto(nomeAntigo);
  if (!alvo) return '';
  const inteiro = usuarios.filter((u) => normalizarTexto(u.nome) === alvo);
  if (inteiro.length === 1) return inteiro[0].id;
  const primeiro = alvo.split(' ')[0];
  if (primeiro.length < 3) return '';
  const porPrimeiro = usuarios.filter((u) => normalizarTexto(u.nome).split(' ')[0] === primeiro);
  return porPrimeiro.length === 1 ? porPrimeiro[0].id : '';
};

const NATUREZA: Record<PaymentMethod, FinancialNature> = {
  Dinheiro: 'caixa_fisico',
  Pix: 'bancario_digital',
  'Cartão de Crédito': 'bancario_digital',
  'Cartão de Débito': 'bancario_digital',
  Transferência: 'bancario_digital',
  Boleto: 'contas_receber',
  Cheque: 'caixa_fisico',
  'Pagamento a Prazo': 'contas_receber',
  'Crédito de Devolução': 'credito_cliente',
  Cashback: 'credito_cliente',
  Outros: 'bancario_digital',
};

export interface ProdutoParaImportar {
  id: string;
  nome: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
}

export interface ContextoDoPedidoImportado {
  tenantId: string;
  usuarioId: string;
  arquivoOrigem: string;
  clienteId: string | null;
  clienteNome: string;
  vendedorId: string;
  vendedorNome: string;
  /** Produto pela Referencia (codigo antigo) ou pelo codigo. */
  produtoDoItem: (item: ItemImportadoLido) => ProdutoParaImportar | null;
  /** Pre-venda nasce 'aguardando' na fila de conferencia quando a empresa usa conferencia. */
  conferenciaAtiva: boolean;
}

export interface ItemDoPedidoImportado {
  id: string;
  nome: string;
  codigo?: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  subtotal: number;
  unidadeMedidaSigla: string;
  unidadeMedidaFracionado: boolean;
  unidadeMedidaCasasDecimais: number;
}

export const ITEM_AVULSO = 'avulso';

/** Itens no formato do Pedido de Venda. Produto que nao existe mais vira item avulso (so' na venda faturada). */
export const itensDoPedidoImportado = (pedido: PedidoImportadoLido, produtoDoItem: ContextoDoPedidoImportado['produtoDoItem']): { itens: ItemDoPedidoImportado[]; semProduto: string[] } => {
  const semProduto: string[] = [];
  const itens = pedido.itens.map((item) => {
    const produto = produtoDoItem(item);
    if (!produto) semProduto.push(item.produto);
    const sigla = String(produto?.unidadeMedidaSigla || item.unidade || 'UN').toUpperCase();
    return {
      id: produto ? produto.id : ITEM_AVULSO,
      nome: produto ? produto.nome : item.produto,
      ...(item.codigoProduto ? { codigo: item.codigoProduto } : {}),
      precoUnitario: item.valorUnitario,
      quantidade: item.quantidade,
      desconto: item.descontoItem,
      subtotal: item.valorTotal,
      unidadeMedidaSigla: sigla,
      unidadeMedidaFracionado: produto?.unidadeMedidaFracionado === true,
      unidadeMedidaCasasDecimais: Number.isInteger(produto?.unidadeMedidaCasasDecimais) ? Number(produto?.unidadeMedidaCasasDecimais) : 0,
    };
  });
  return { itens, semProduto };
};

const rotuloDasFormas = (pagamentos: PagamentoImportado[]): string => {
  if (pagamentos.length === 0) return 'Não informado';
  return pagamentos.map((p) => p.forma).join(' + ');
};

/**
 * Documento do pedido importado, sem os carimbos de data (createdAt,
 * importadoEm), que a tela poe com serverTimestamp. Nenhuma chave undefined.
 */
export const montarPedidoImportado = (pedido: PedidoImportadoLido, ctx: ContextoDoPedidoImportado) => {
  const { itens } = itensDoPedidoImportado(pedido, ctx.produtoDoItem);
  const faturado = pedido.situacao === SITUACAO_FATURADO;
  const valorTotalItens = arredonda(itens.reduce((s, i) => s + i.subtotal, 0));
  const descontosDosItens = arredonda(itens.reduce((s, i) => s + i.desconto, 0));
  const valorTotal = pedido.totalPedido;
  const aPrazo = pedido.pagamentos.filter((p) => NATUREZA[p.forma] === 'contas_receber').reduce((s, p) => s + p.valor, 0);
  const pagamentos = faturado ? pedido.pagamentos.map((p, indice) => ({
    id: `importado_${indice + 1}`,
    indice,
    formaPagamento: p.forma,
    condicaoPagamento: NATUREZA[p.forma] === 'contas_receber' ? 'aprazo' as const : 'avista' as const,
    valorCentavos: toCents(p.valor),
    valor: p.valor,
    status: NATUREZA[p.forma] === 'contas_receber' ? 'pendente' as const : 'confirmado' as const,
    naturezaFinanceira: NATUREZA[p.forma],
    // Registro do que aconteceu no sistema antigo: nao gerou caixa nem conta aqui.
    movimentaCaixaFisico: false,
  })) : [];
  const observacao = [pedido.observacao, `[Importado do sistema anterior: pedido ${pedido.numero.replace(/^0+/, '')}${pedido.hora ? `, ${pedido.hora}` : ''}]`]
    .filter(Boolean).join(' ').slice(0, 1000);
  return {
    numeroPedido: pedido.numero,
    clienteId: ctx.clienteId,
    clienteNome: ctx.clienteNome || 'CONSUMIDOR FINAL',
    observacao,
    itens,
    promocaoIds: [] as string[],
    valorTotalItens,
    valorTotalItensCentavos: toCents(valorTotalItens),
    valorTotalDescontos: arredonda(descontosDosItens + pedido.descontoPedido),
    valorTotalDescontosCentavos: toCents(descontosDosItens + pedido.descontoPedido),
    descontoGeral: { tipo: 'valor' as const, valorInformado: pedido.descontoPedido, valorAplicadoCentavos: toCents(pedido.descontoPedido), excedeuLimite: false },
    frete: pedido.frete,
    encargos: pedido.encargos,
    valorTotal,
    valorTotalCentavos: toCents(valorTotal),
    ...(faturado ? {
      formaPagamento: rotuloDasFormas(pedido.pagamentos),
      condicaoPagamento: aPrazo > 0.004 ? 'aprazo' : 'avista',
      pagamentos,
      totalRecebido: arredonda(valorTotal - aPrazo),
      totalRecebidoCentavos: toCents(valorTotal - aPrazo),
      totalPendente: arredonda(aPrazo),
      totalPendenteCentavos: toCents(aPrazo),
      totalTaxasPagamento: 0,
      totalTaxasPagamentoCentavos: 0,
      totalLiquidoFinanceiro: valorTotal,
      totalLiquidoFinanceiroCentavos: toCents(valorTotal),
      // Comissao ja' paga no sistema antigo: zero aqui, para nao pagar de novo.
      comissao: {
        tipo: 'percentual_produtos' as const,
        vendedorId: ctx.vendedorId,
        vendedorNome: ctx.vendedorNome,
        baseOriginalCentavos: 0, baseOriginal: 0, baseAtualCentavos: 0, baseAtual: 0,
        percentual: 0,
        valorOriginalCentavos: 0, valorOriginal: fromCents(0), valorAtualCentavos: 0, valorAtual: 0,
        status: 'nao_aplicavel' as const,
        regraVersion: 1,
        geradaEm: `${pedido.data}T12:00:00.000Z`,
        itens: [],
      },
    } : {}),
    dataVenda: pedido.data,
    status: faturado ? STATUS_FINALIZADA : STATUS_PRE_VENDA,
    origem: 'balcao' as const,
    // Venda faturada: nada reservado (estoque ja' veio com o saldo do sistema antigo).
    // Pre-venda: reserva, como qualquer pre-venda do Hennder (a tela aplica no estoque).
    estoqueReservado: !faturado && itens.length > 0,
    entregaFutura: false,
    ...(!faturado && ctx.conferenciaAtiva ? { statusConferencia: 'aguardando' as const } : {}),
    tenantId: ctx.tenantId,
    usuarioResponsavelId: ctx.usuarioId,
    vendedorId: ctx.vendedorId,
    vendedorNome: ctx.vendedorNome,
    importadoSistemaAnterior: true,
    sistemaAnterior: {
      numero: pedido.numero.replace(/^0+/, ''),
      ...(pedido.hora ? { hora: pedido.hora } : {}),
      situacao: pedido.situacao,
      arquivo: ctx.arquivoOrigem,
    },
  };
};

/** Semente do id fixo do pedido importado: importar o mesmo arquivo de novo nao duplica. */
export const sementeIdPedidoImportado = (tenantId: string, numero: string): string => `${tenantId}|pedido-anterior|${numero}`;

export const ehPedidoDoSistemaAnterior = (pedido: { importadoSistemaAnterior?: unknown } | null | undefined): boolean => (
  pedido?.importadoSistemaAnterior === true
);

/** Texto do bloqueio, igual em toda tela e no servidor. `acao`: "cancelada", "devolvida"... */
export const mensagemPedidoDoSistemaAnterior = (acao: string): string => (
  `Esta venda veio do sistema anterior na migração e não pode ser ${acao} no Hennder: o estoque e o financeiro dela ficaram no sistema antigo. `
  + 'Se precisar corrigir algo, lance um ajuste de estoque ou uma conta à mão.'
);

export interface PedidoParaRenumerar {
  id: string;
  numeroPedido: string;
  /** Quando foi criado (ms); desempata pelo numero. */
  criadoEmMs: number;
}

export interface Renumeracao {
  id: string;
  de: string;
  para: string;
}

/**
 * As vendas feitas no Hennder ANTES da importacao (decisao do dono: "deixar os
 * que fizeram hoje na sequencia") passam a vir logo depois do ultimo numero
 * antigo, na ordem em que foram criadas. Devolve so' quem muda de numero.
 */
export const planoDeRenumeracao = (pedidos: PedidoParaRenumerar[], ultimoImportado: number): Renumeracao[] => {
  const ordenados = [...pedidos].sort((a, b) => (a.criadoEmMs - b.criadoEmMs) || (Number(a.numeroPedido.replace(/\D/g, '')) - Number(b.numeroPedido.replace(/\D/g, ''))));
  return ordenados.map((p, i) => ({ id: p.id, de: p.numeroPedido, para: String(ultimoImportado + 1 + i).padStart(DIGITOS_NUMERO_IMPORTADO, '0') }))
    .filter((r) => r.de !== r.para);
};

/** Troca "#0012" por "#113697" num texto (descricao de lancamento), so' o numero inteiro. */
export const trocarNumeroNoTexto = (texto: string, de: string, para: string): string => {
  if (!texto || !de) return texto;
  const semZeros = de.replace(/^0+(?=\d)/, '');
  const alvos = [...new Set([de, semZeros])].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return texto.replace(new RegExp(`#(?:${alvos.join('|')})(?!\\d)`, 'g'), `#${para}`);
};

export interface ResumoDaImportacao {
  faturados: number;
  faturadosValor: number;
  preVendas: number;
  preVendasValor: number;
  comProblema: number;
}

export const resumirImportacao = (pedidos: Array<PedidoImportadoLido & { fora?: string }>): ResumoDaImportacao => {
  const certos = pedidos.filter((p) => !p.problema && !p.fora);
  const fat = certos.filter((p) => p.situacao === SITUACAO_FATURADO);
  const pre = certos.filter((p) => p.situacao === SITUACAO_PRE_VENDA);
  return {
    faturados: fat.length,
    faturadosValor: arredonda(fat.reduce((s, p) => s + p.totalPedido, 0)),
    preVendas: pre.length,
    preVendasValor: arredonda(pre.reduce((s, p) => s + p.totalPedido, 0)),
    comProblema: pedidos.length - certos.length,
  };
};
