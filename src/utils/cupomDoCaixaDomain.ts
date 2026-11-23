/*
 * CUPOM NO FIM DA VENDA DA FRENTE DE CAIXA (23/11/2026, pedido do dono).
 *
 * Antes a Frente de Caixa so' dizia "Venda finalizada": nao saia papel nenhum.
 * Agora, ao finalizar (venda direta ou pre-venda faturada no caixa), sai:
 *
 *  - CUPOM FISCAL (NFC-e), quando a empresa emite cupom fiscal -- a mesma regra
 *    do Pedido de Venda (documentoFiscalVendaDomain.resolveDocumentoFiscalVenda);
 *  - CUPOM NAO FISCAL, na bobina da impressora termica, nos outros casos:
 *    empresa que nao controla fiscal, empresa que so' emite NF-e (NF-e nao se
 *    emite no balcao: leva destinatario, frete e transporte -- fica na tela
 *    Fiscal) e pre-venda marcada "Sem nota fiscal".
 *
 * O cupom nao fiscal e' montado a partir da VENDA GRAVADA (o que o servidor
 * gravou), nunca do que estava na tela: o papel bate com o banco.
 *
 * Regra pura: sem tela e sem Firestore. Quem imprime e' src/pages/PDV/cupomDoCaixa.ts.
 */
import { resolveDocumentoFiscalVenda, type DocumentosFiscaisEmitidos } from './documentoFiscalVendaDomain';
import { formatCompanyAddress } from './companyAddress';
import { fromCents, toCents } from './financeDomain';
import { formatarTelefoneGravado } from './clienteCadastroMobileDomain';
import { formatarDocumento } from './documentoValidacao';
import { hasModuleAccess } from './roles';
import { normalizeSearchText } from './textSearch';

export type DocumentoDoCupom = 'nfce' | 'nao_fiscal';

/**
 * Qual cupom sai no caixa. `comNotaFiscal` e' a marca "Com nota / Sem nota" da
 * venda (null = nao informado, vale a regra da empresa).
 */
export const documentoDoCupomDoCaixa = (args: {
  controlaFiscal: boolean;
  documentosFiscais: DocumentosFiscaisEmitidos | null | undefined;
  comNotaFiscal: boolean | null | undefined;
}): DocumentoDoCupom => {
  if (args.comNotaFiscal === false) return 'nao_fiscal';
  return resolveDocumentoFiscalVenda(args.controlaFiscal, args.documentosFiscais) === 'nfce' ? 'nfce' : 'nao_fiscal';
};

// ---------------------------------------------------------------------------
// Dados do cupom nao fiscal
// ---------------------------------------------------------------------------

export interface LinhaDoCupom {
  codigo: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  precoUnitarioCentavos: number;
  descontoCentavos: number;
  totalCentavos: number;
}

export interface PagamentoDoCupom {
  forma: string;
  valorCentavos: number;
  /** Cartao de credito parcelado; 1 = a vista. */
  parcelas: number;
}

export interface CupomNaoFiscal {
  empresa: {
    nome: string;
    cnpj: string;
    /** Inscricao estadual (vazio = nao cadastrada). */
    ie: string;
    endereco: string;
    cidade: string;
    telefone: string;
  };
  numeroVenda: string;
  /** "dd/mm/aaaa hh:mm", hora de Brasilia. */
  emitidoEm: string;
  cliente: { nome: string; documento: string };
  vendedor: string;
  operador: string;
  itens: LinhaDoCupom[];
  subtotalCentavos: number;
  descontoCentavos: number;
  acrescimoCentavos: number;
  totalCentavos: number;
  pagamentos: PagamentoDoCupom[];
  observacao: string;
}

type Registro = Record<string, unknown>;

const texto = (valor: unknown): string => String(valor ?? '').trim();
const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const centavos = (emCentavos: unknown, emReais: unknown): number => (
  emCentavos !== undefined && emCentavos !== null && Number.isFinite(Number(emCentavos))
    ? Math.round(Number(emCentavos))
    : toCents(numero(emReais))
);

/** "dd/mm/aaaa hh:mm" no horario de Brasilia. */
export const dataHoraDoCupom = (quando: Date): string => {
  const mapa: Record<string, string> = {};
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(quando).forEach((p) => { mapa[p.type] = p.value; });
  return `${mapa.day}/${mapa.month}/${mapa.year} ${mapa.hour}:${mapa.minute}`;
};

/**
 * Pagamentos agrupados por forma: a venda grava uma linha por parcela do cartao
 * (explodeInstallmentPaymentRecords), mas no cupom "Cartao de Credito 3x R$ 90"
 * e' uma linha so'.
 */
const pagamentosDoCupom = (brutos: unknown): PagamentoDoCupom[] => {
  const lista = Array.isArray(brutos) ? brutos as Registro[] : [];
  const porForma = new Map<string, PagamentoDoCupom>();
  lista.forEach((p) => {
    const forma = texto(p?.formaPagamento || p?.forma) || 'Outros';
    const cartao = (p?.cartao && typeof p.cartao === 'object' ? p.cartao : {}) as Registro;
    const parcelas = Math.max(1, Math.round(numero(cartao.totalParcelas || cartao.parcelas || 1)));
    const atual = porForma.get(forma) || { forma, valorCentavos: 0, parcelas: 1 };
    atual.valorCentavos += centavos(p?.valorCentavos, p?.valor);
    atual.parcelas = Math.max(atual.parcelas, parcelas);
    porForma.set(forma, atual);
  });
  return [...porForma.values()];
};

/** Venda gravada (pedidos_venda) + cadastro da empresa -> o que sai no papel. */
export const montarCupomNaoFiscal = (args: {
  venda: Registro;
  empresa: Registro | null | undefined;
  /** CPF/CNPJ do cliente, quando o cadastro tem. */
  documentoDoCliente?: string;
  operador: string;
  emitidoEm: Date;
}): CupomNaoFiscal => {
  const { venda } = args;
  const empresa = args.empresa || {};
  const itensBrutos = Array.isArray(venda.itens) ? venda.itens as Registro[] : [];
  const itens = itensBrutos.map((item): LinhaDoCupom => {
    const quantidade = numero(item.quantidade);
    const precoUnitarioCentavos = centavos(item.precoUnitarioCentavos, item.precoUnitario);
    const bruto = Math.round(precoUnitarioCentavos * quantidade);
    const descontoCentavos = Math.min(bruto, Math.max(0, centavos(item.descontoCentavos, item.desconto)));
    return {
      codigo: texto(item.codigo),
      descricao: texto(item.nome) || 'ITEM',
      quantidade,
      unidade: texto(item.unidadeMedidaSigla) || 'UN',
      precoUnitarioCentavos,
      descontoCentavos,
      totalCentavos: Math.max(0, bruto - descontoCentavos),
    };
  });
  const subtotalCentavos = venda.valorTotalItensCentavos !== undefined
    ? centavos(venda.valorTotalItensCentavos, venda.valorTotalItens)
    : itens.reduce((soma, item) => soma + Math.round(item.precoUnitarioCentavos * item.quantidade), 0);
  const cidade = [texto(empresa.cidade), texto(empresa.estado || empresa.uf)].filter(Boolean).join('/');
  return {
    empresa: {
      nome: texto(empresa.nomeFantasia || empresa.nomeOficina || empresa.razaoSocial) || 'EMPRESA',
      cnpj: texto(empresa.cnpj),
      ie: texto(empresa.inscricaoEstadual),
      endereco: formatCompanyAddress(empresa),
      cidade,
      telefone: formatarTelefoneGravado(texto(empresa.telefone)),
    },
    numeroVenda: texto(venda.numeroPedido),
    emitidoEm: dataHoraDoCupom(args.emitidoEm),
    cliente: { nome: texto(venda.clienteNome) || 'CONSUMIDOR FINAL', documento: formatarDocumento(texto(args.documentoDoCliente)) },
    vendedor: texto(venda.vendedorNome),
    operador: texto(args.operador),
    itens,
    subtotalCentavos,
    descontoCentavos: centavos(venda.valorTotalDescontosCentavos, venda.valorTotalDescontos),
    acrescimoCentavos: toCents(numero(venda.frete)) + toCents(numero(venda.encargos)),
    totalCentavos: centavos(venda.valorTotalCentavos, venda.valorTotal),
    pagamentos: pagamentosDoCupom(venda.pagamentos),
    observacao: texto(venda.observacao),
  };
};

// ---------------------------------------------------------------------------
// Papel (HTML para a impressora termica)
// ---------------------------------------------------------------------------

export type LarguraDaBobina = 80 | 58;

const escapar = (valor: string): string => valor
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const reais = (emCentavos: number): string => fromCents(emCentavos).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantidadeEscrita = (q: number): string => q.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * Pagina completa (HTML) do cupom nao fiscal, no tamanho da bobina. Fica num
 * quadro escondido da Frente de Caixa e vai direto para a impressao -- o caixa
 * nao sai da tela. Tudo o que vem do banco e' escapado.
 *
 * LAYOUT (modelo enviado pelo dono em 23/11/2026): o do cupom de 80 mm que todo
 * caixa conhece -- cabecalho da empresa, "Detalhe da venda" em colunas
 * (codigo/descricao, qtd, un, vl. unit., vl. total), totais com o VALOR TOTAL
 * em destaque, formas de pagamento, consumidor, numero/data e area de mensagem.
 * As partes que so' existem no documento FISCAL (titulo "DANFE NFC-e", chave de
 * acesso, QR Code, protocolo, serie, tributos) ficam de fora de proposito: um
 * cupom nao fiscal com elas se passaria por nota fiscal. No lugar, em destaque,
 * "DOCUMENTO SEM VALOR FISCAL".
 */
export const htmlDoCupomNaoFiscal = (
  cupom: CupomNaoFiscal,
  largura: LarguraDaBobina = 80,
  /** Reimpressao pelo historico do caixa: "2a VIA" e quando foi reimpresso ("dd/mm/aaaa hh:mm"). */
  segundaVia: { reimpressoEm: string } | null = null,
): string => {
  const e = (v: string) => escapar(v);
  const vazio = '- - -';
  const linha = (rotulo: string, valor: string, classe = '') => (
    `<div class="lin ${classe}"><span>${rotulo}</span><span>${valor}</span></div>`
  );
  const totalDeItens = cupom.itens.length;
  const itens = cupom.itens.map((item) => `
      <tr>
        <td class="desc">${item.codigo ? `${e(item.codigo)} ` : ''}${e(item.descricao)}</td>
        <td class="num">${quantidadeEscrita(item.quantidade)}</td>
        <td class="un">${e(item.unidade)}</td>
        <td class="num">${reais(item.precoUnitarioCentavos)}</td>
        <td class="num">${reais(Math.round(item.precoUnitarioCentavos * item.quantidade))}</td>
      </tr>`).join('');
  const pagamentos = cupom.pagamentos.map((p) => linha(
    `${e(p.forma)}${p.parcelas > 1 ? ` (${p.parcelas}x)` : ''}`,
    reais(p.valorCentavos),
    'pag',
  )).join('');
  const consumidorIdentificado = cupom.cliente.nome && cupom.cliente.nome.toUpperCase() !== 'CONSUMIDOR FINAL';
  const enderecoEFone = [cupom.empresa.endereco, cupom.empresa.cidade].filter(Boolean).join(' - ')
    + (cupom.empresa.telefone ? ` - Fone ${cupom.empresa.telefone}` : '');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Cupom ${e(cupom.numeroVenda)}</title>
<style>
  @page { size: ${largura}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${largura}mm; padding: 3mm ${largura === 58 ? 2 : 3.5}mm 8mm; font-family: Arial, Helvetica, sans-serif; font-size: ${largura === 58 ? 9.5 : 11}px; line-height: 1.25; }
  .centro { text-align: center; }
  .forte { font-weight: 700; }
  .peq { font-size: 0.85em; }
  .sep { border-top: 1px dashed #000; margin: 4px 0; }
  .empresa { font-size: 1.35em; }
  .lin { display: flex; justify-content: space-between; gap: 6px; }
  .lin span:last-child { white-space: nowrap; text-align: right; }
  .lin.rot { font-size: 0.85em; font-weight: 700; text-transform: uppercase; }
  .lin.total { font-size: 1.45em; font-weight: 700; margin-top: 2px; }
  .lin.pag { font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 0.8em; font-weight: 700; text-align: left; padding: 0 0 2px; text-transform: uppercase; }
  td { padding: 1px 0; vertical-align: top; }
  th.num, td.num { text-align: right; padding-left: 4px; white-space: nowrap; }
  th.un, td.un { text-align: center; padding-left: 4px; }
  td.desc { word-break: break-word; }
  .numero { font-size: 1.35em; font-weight: 700; }
  .aviso { font-size: 1.1em; font-weight: 700; }
  .grande2 { font-size: 1.2em; margin-top: 2px; }
  p { margin: 0; }
</style></head>
<body>
  <div class="centro empresa">${e(cupom.empresa.nome)}</div>
  ${cupom.empresa.cnpj || cupom.empresa.ie ? `<div class="centro">${cupom.empresa.cnpj ? `CNPJ ${e(cupom.empresa.cnpj)}` : ''}${cupom.empresa.cnpj && cupom.empresa.ie ? ' ' : ''}${cupom.empresa.ie ? `I.E. ${e(cupom.empresa.ie)}` : ''}</div>` : ''}
  ${enderecoEFone ? `<div class="centro">${e(enderecoEFone)}</div>` : ''}
  <div class="sep"></div>
  <div class="centro forte">CUPOM NÃO FISCAL</div>
  <div class="centro forte">Comprovante de venda ao consumidor</div>
  <div class="centro forte">Não tem valor fiscal</div>
  ${segundaVia ? `<div class="centro forte grande2">2ª VIA</div><div class="centro peq">Reimpresso em ${e(segundaVia.reimpressoEm)}</div>` : ''}
  <div class="sep"></div>
  <div class="centro forte">DETALHE DA VENDA</div>
  <table>
    <thead><tr><th>Código Descrição</th><th class="num">Qtd</th><th class="un">Un</th><th class="num">Vl Un</th><th class="num">Vl Tot</th></tr></thead>
    <tbody>${itens}
    </tbody>
  </table>
  ${linha('Qtd. total de itens', String(totalDeItens), 'rot')}
  ${linha('Valor dos produtos', reais(cupom.subtotalCentavos), 'rot')}
  ${linha('Desconto', cupom.descontoCentavos > 0 ? `- ${reais(cupom.descontoCentavos)}` : vazio, 'rot')}
  ${linha('Outras despesas', cupom.acrescimoCentavos > 0 ? reais(cupom.acrescimoCentavos) : vazio, 'rot')}
  ${linha('VALOR TOTAL R$', reais(cupom.totalCentavos), 'total')}
  ${linha('Formas de pagamento', 'Valor pago', 'rot')}
  ${pagamentos}
  <div class="sep"></div>
  <div class="centro forte">CONSUMIDOR</div>
  <div class="centro forte">NOME: ${consumidorIdentificado ? e(cupom.cliente.nome) : 'NÃO IDENTIFICADO'}</div>
  ${consumidorIdentificado && cupom.cliente.documento ? `<div class="centro forte">CPF/CNPJ: ${e(cupom.cliente.documento)}</div>` : ''}
  <div class="sep"></div>
  <div class="centro numero">Venda Nº ${e(cupom.numeroVenda)}</div>
  <div class="centro forte">${e(cupom.emitidoEm)} - Via Consumidor</div>
  ${cupom.vendedor ? `<div class="centro peq">Vendedor: ${e(cupom.vendedor)}</div>` : ''}
  ${cupom.operador ? `<div class="centro peq">Caixa: ${e(cupom.operador)}</div>` : ''}
  <div class="sep"></div>
  <div class="centro peq forte">ÁREA DE MENSAGEM DE INTERESSE DO CONTRIBUINTE</div>
  ${cupom.observacao ? `<p>Obs.: ${e(cupom.observacao)}</p>` : ''}
  <p class="aviso">DOCUMENTO SEM VALOR FISCAL</p>
  <p class="centro peq" style="margin-top:6px">Obrigado pela preferência!</p>
</body></html>`;
};

// ---------------------------------------------------------------------------
// Permissao para a NFC-e no caixa
// ---------------------------------------------------------------------------

/** A mesma permissao que o servidor confere para emitir (e baixar o PDF da) nota: server/services/spedyAcesso.js. */
export const PERMISSAO_EMITIR_NOTA = 'fiscal.emitir';

export const podeEmitirCupomFiscal = (perfil: { role: unknown; isOwner: boolean; permissoes: string[] | null | undefined }): boolean => (
  hasModuleAccess({ role: perfil.role, isOwner: perfil.isOwner, permissions: perfil.permissoes, requiredPermission: PERMISSAO_EMITIR_NOTA })
);

/** Cadastro do usuario incompleto para a NFC-e: bloqueia com o que fazer (CLAUDE.md: nunca contornar). */
export const MENSAGEM_SEM_PERMISSAO_NFCE = 'Este usuário não tem permissão para emitir cupom fiscal. Peça ao dono ou ao gerente para liberar "Fiscal: Emitir Nota Fiscal" no seu usuário, em Equipe & Acessos.';

// ---------------------------------------------------------------------------
// Historico de vendas do caixa (reimprimir)
// ---------------------------------------------------------------------------

export type SituacaoDaNotaNoCaixa = 'autorizada' | 'aguardando' | 'rejeitada';

export interface NotaDaVendaNoCaixa {
  spedyId: string;
  numero: string;
  situacao: SituacaoDaNotaNoCaixa;
}

export interface VendaDoCaixa {
  id: string;
  numeroPedido: string;
  /** Quando a venda foi fechada no caixa (Date) -- null se nao der para saber. */
  quando: Date | null;
  clienteId: string | null;
  clienteNome: string;
  vendedorNome: string;
  totalCentavos: number;
  /** "Dinheiro + Pix", "Cartão de Crédito (3x)". */
  formas: string;
  cancelada: boolean;
  /** "Com nota / Sem nota" da venda (null = nao informado). */
  comNotaFiscal: boolean | null;
  /** A melhor nota da venda (autorizada vence aguardando, que vence rejeitada). */
  nota: NotaDaVendaNoCaixa | null;
}

const paraData = (valor: unknown): Date | null => {
  if (!valor) return null;
  const comToDate = valor as { toDate?: () => Date; seconds?: number };
  if (typeof comToDate.toDate === 'function') return comToDate.toDate();
  if (typeof comToDate.seconds === 'number') return new Date(comToDate.seconds * 1000);
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? null : data;
};

/**
 * Quando a venda aconteceu no caixa. Venda direta: quando foi criada. Pre-venda
 * faturada no caixa: o documento nasceu antes (na pre-venda), entao vale a
 * ultima alteracao -- a do faturamento.
 */
export const quandoDaVendaNoCaixa = (venda: Registro): Date | null => (
  venda.faturadoNoCaixa === true
    ? paraData(venda.alteradoEm) || paraData(venda.updatedAt) || paraData(venda.criadoEm) || paraData(venda.createdAt)
    : paraData(venda.criadoEm) || paraData(venda.createdAt)
);

const situacaoDaNota = (status: unknown): SituacaoDaNotaNoCaixa | null => {
  const s = texto(status);
  if (s === 'authorized') return 'autorizada';
  if (s === 'rejected' || s === 'denied') return 'rejeitada';
  if (s === 'enqueued' || s === 'processing' || s === 'created') return 'aguardando';
  return null;
};
const PESO_DA_SITUACAO: Record<SituacaoDaNotaNoCaixa, number> = { autorizada: 0, aguardando: 1, rejeitada: 2 };

/**
 * Vendas do caixa aberto, da mais nova para a mais antiga, com a nota de cada
 * uma (notas de devolucao e canceladas ficam de fora: o cupom da venda e' o que
 * se reimprime).
 */
export const vendasDoCaixa = (
  vendas: ReadonlyArray<Registro & { id: string }>,
  notas: ReadonlyArray<Registro> = [],
): VendaDoCaixa[] => {
  const notaPorPedido = new Map<string, NotaDaVendaNoCaixa>();
  notas.forEach((n) => {
    if (texto(n.tipo) !== 'NFC-e' || n.finalidade === 'devolucao') return;
    const pedidoId = texto(n.pedidoId);
    const situacao = situacaoDaNota(n.status);
    if (!pedidoId || !situacao) return;
    const nota: NotaDaVendaNoCaixa = { spedyId: texto(n.spedyId), numero: texto(n.number), situacao };
    const atual = notaPorPedido.get(pedidoId);
    if (!atual || PESO_DA_SITUACAO[situacao] < PESO_DA_SITUACAO[atual.situacao]) notaPorPedido.set(pedidoId, nota);
  });
  return vendas
    .map((v): VendaDoCaixa => ({
      id: v.id,
      numeroPedido: texto(v.numeroPedido),
      quando: quandoDaVendaNoCaixa(v),
      clienteId: texto(v.clienteId) || null,
      clienteNome: texto(v.clienteNome) || 'CONSUMIDOR FINAL',
      vendedorNome: texto(v.vendedorNome),
      totalCentavos: centavos(v.valorTotalCentavos, v.valorTotal),
      formas: pagamentosDoCupom(v.pagamentos).map((p) => `${p.forma}${p.parcelas > 1 ? ` (${p.parcelas}x)` : ''}`).join(' + '),
      cancelada: texto(v.status) === 'Cancelada',
      comNotaFiscal: typeof v.comNotaFiscal === 'boolean' ? v.comNotaFiscal : null,
      nota: notaPorPedido.get(v.id) || null,
    }))
    .sort((a, b) => (b.quando?.getTime() || 0) - (a.quando?.getTime() || 0) || b.numeroPedido.localeCompare(a.numeroPedido));
};

/** Busca do historico: numero da venda (sem os zeros da frente) ou cliente, sem acento. */
export const filtrarVendasDoCaixa = (vendas: ReadonlyArray<VendaDoCaixa>, busca: string): VendaDoCaixa[] => {
  const termo = normalizeSearchText(String(busca || '').replace(/^\s*#/, ''));
  if (!termo) return [...vendas];
  const soNumero = /^\d+$/.test(termo) ? termo.replace(/^0+(?=\d)/, '') : '';
  return vendas.filter((v) => (
    (soNumero !== '' && v.numeroPedido.replace(/^0+(?=\d)/, '').includes(soNumero))
    || normalizeSearchText(v.clienteNome).includes(termo)
  ));
};

export type AcaoDeReimpressao =
  | { tipo: 'pdf_nfce'; spedyId: string }
  | { tipo: 'nao_fiscal' }
  | { tipo: 'bloqueada'; motivo: string };

/**
 * O que "Reimprimir" faz: com NFC-e autorizada, reabre o cupom FISCAL (nao se
 * imprime nao fiscal de venda que tem nota); sem nota, a 2a via do nao fiscal.
 * Venda cancelada nao reimprime.
 */
export const acaoDeReimpressao = (venda: VendaDoCaixa): AcaoDeReimpressao => {
  if (venda.cancelada) return { tipo: 'bloqueada', motivo: `A venda #${venda.numeroPedido} foi cancelada: não se reimprime cupom de venda cancelada.` };
  if (venda.nota?.situacao === 'autorizada' && venda.nota.spedyId) return { tipo: 'pdf_nfce', spedyId: venda.nota.spedyId };
  return { tipo: 'nao_fiscal' };
};

/**
 * Oferece "Emitir cupom fiscal" na venda: empresa que emite NFC-e, venda nao
 * cancelada, nao marcada "Sem nota" e sem nota autorizada ou ainda na SEFAZ
 * (a emissao falhou ou foi rejeitada na hora da venda).
 */
export const ofereceEmitirCupomFiscal = (venda: VendaDoCaixa, documentoDaEmpresa: DocumentoDoCupom): boolean => (
  documentoDaEmpresa === 'nfce'
  && !venda.cancelada
  && venda.comNotaFiscal !== false
  && venda.nota?.situacao !== 'autorizada'
  && venda.nota?.situacao !== 'aguardando'
);
