/*
 * NF-e DE TRANSFERENCIA ENTRE FILIAIS (Filiais, fase 4 -- 2026-10-06).
 * Plano aprovado pelo dono: docs/PLANO_FILIAIS.md, secao 8d.
 *
 *  - Emitida pela filial que ENVIA, pela Spedy, montada no SERVIDOR a partir
 *    do que esta gravado (transferencia, cadastro do produto e configuracao
 *    das duas filiais) -- nunca do corpo da requisicao (server/services/
 *    transferencias.js).
 *  - CFOP escolhido sozinho pela UF das duas filiais: 5152/6152 para
 *    mercadoria de revenda, 5151/6151 para producao propria (produto
 *    "produzido internamente"). Na entrada do destino: 1152/2152 e 1151/2151.
 *  - Valores = custo da origem no envio (o mesmo da transferencia).
 *  - Sem pagamento (tPag 90) e sem consumidor final: o destinatario e' outro
 *    estabelecimento do mesmo dono, contribuinte.
 *  - Tributacao configuravel por filial (Configuracoes): o padrao e' a NAO
 *    INCIDENCIA do ICMS na transferencia entre estabelecimentos do mesmo
 *    titular (STF ADC 49 e LC 204/2023): CST 41 / CSOSN 400 e PIS/COFINS 49
 *    (outras operacoes de saida, sem valor). "Igual a venda" usa a
 *    tributacao do cadastro do produto. O contador confirma por estado.
 *  - Filiais com o MESMO CNPJ nao emitem nota entre si (emitente =
 *    destinatario): a transferencia entre elas e' sem nota.
 *
 * Regra do CLAUDE.md: cadastro incompleto BLOQUEIA com mensagem que diz o que
 * falta e onde corrigir -- nada de nota com dado inventado.
 */
import { usesCsosn, type RegimeTributario } from './fiscalDomain';
import {
  montarItemNotaFiscal,
  produtoFiscalDoCadastro,
  TEXTO_OPTANTE_SIMPLES_NACIONAL,
  type ProdutoFiscal,
} from './notaFiscalItemDomain';

export type TributacaoTransferencia = 'nao_incide' | 'produto';

export const TRIBUTACAO_TRANSFERENCIA_PADRAO: TributacaoTransferencia = 'nao_incide';

export const TRIBUTACAO_TRANSFERENCIA_OPCOES: Array<{ value: TributacaoTransferencia; label: string }> = [
  { value: 'nao_incide', label: 'Sem ICMS na transferência (CST 41 / CSOSN 400)' },
  { value: 'produto', label: 'Igual à venda (tributação do cadastro do produto)' },
];

export const parseTributacaoTransferencia = (valor: unknown): TributacaoTransferencia => (
  valor === 'produto' ? 'produto' : TRIBUTACAO_TRANSFERENCIA_PADRAO
);

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const arred = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** CFOP de saida: producao propria (5151/6151) ou revenda (5152/6152). */
export const cfopDaTransferencia = (produzidoInternamente: boolean, interestadual: boolean): string => {
  if (produzidoInternamente) return interestadual ? '6151' : '5151';
  return interestadual ? '6152' : '5152';
};

/** CFOP de entrada no destino, a partir do de saida (5152 -> 1152, 6151 -> 2151). */
export const cfopDeEntradaDaTransferencia = (cfopSaida: string): string => {
  const c = soDigitos(cfopSaida);
  if (c.startsWith('5')) return `1${c.slice(1)}`;
  if (c.startsWith('6')) return `2${c.slice(1)}`;
  return c;
};

/** Ajusta a tributacao do produto para a transferencia (padrao: nao incidencia). */
export const produtoFiscalNaTransferencia = (
  produto: ProdutoFiscal,
  regime: RegimeTributario,
  tributacao: TributacaoTransferencia,
): ProdutoFiscal => {
  // CFOP interestadual/CSOSN interestadual do cadastro sao da VENDA: nao valem aqui.
  const base: ProdutoFiscal = { ...produto, cfopInterestadual: '', csosnInterestadual: '' };
  if (tributacao === 'produto') return base;
  return {
    ...base,
    csosn: usesCsosn(regime) ? '400' : '41',
    aliquotaIcms: 0,
    reducaoBaseIcms: 0,
    cstPis: '49',
    aliquotaPis: 0,
    cstCofins: '49',
    aliquotaCofins: 0,
  };
};

/** UF da filial pela configuracao (estado do endereco; sem ele, o da cidade fiscal). */
export const ufDaConfiguracao = (config: Record<string, unknown>): string => (
  (texto(config.uf) || texto(config.nfseCidadeEstado)).toUpperCase()
);

/**
 * Destinatario = a filial que recebe, pelo cadastro dela (Configuracoes da
 * filial). Dado que falta vira mensagem dizendo onde completar.
 */
export const destinatarioDaFilial = (
  config: Record<string, unknown>,
  rotulo: string,
): { ok: true; receiver: Record<string, unknown> } | { ok: false; erros: string[] } => {
  const onde = `Entre na filial ${rotulo} e complete em Configurações (dados da empresa) ou em Configurações → Filiais.`;
  const erros: string[] = [];
  const cnpj = soDigitos(config.cnpj);
  const nome = (texto(config.razaoSocial) || texto(config.nomeOficina)).toUpperCase();
  if (cnpj.length !== 14) erros.push(`A filial ${rotulo} está sem CNPJ válido no cadastro.`);
  if (!nome) erros.push(`A filial ${rotulo} está sem razão social no cadastro.`);

  const ieBruta = texto(config.inscricaoEstadual);
  const ie = /^isento$/i.test(ieBruta) ? 'ISENTO' : soDigitos(ieBruta);
  if (!ie || (ie !== 'ISENTO' && (ie.length < 5 || ie.length > 14))) {
    erros.push(ieBruta
      ? `A inscrição estadual da filial ${rotulo} ("${ieBruta}") não parece válida.`
      : `A filial ${rotulo} está sem inscrição estadual (ou "ISENTO") no cadastro.`);
  }

  const faltando: string[] = [];
  const rua = texto(config.rua) || texto(config.endereco);
  if (!rua) faltando.push('rua');
  if (!texto(config.numero)) faltando.push('número');
  if (!texto(config.bairro)) faltando.push('bairro');
  if (soDigitos(config.cep).length !== 8) faltando.push('CEP');
  const codigoCidade = soDigitos(config.nfseCidadeCodigo || config.codigoIbge);
  if (codigoCidade.length !== 7) faltando.push('cidade (escolhida na busca de cidades, com o código IBGE)');
  const uf = ufDaConfiguracao(config);
  if (uf.length !== 2) faltando.push('estado');
  if (faltando.length > 0) erros.push(`A filial ${rotulo} está sem ${faltando.join(', ')} no cadastro.`);

  if (erros.length > 0) return { ok: false, erros: [...erros, onde] };
  const email = texto(config.email);
  return {
    ok: true,
    receiver: {
      name: nome,
      federalTaxNumber: cnpj,
      stateTaxNumber: ie,
      ...(email ? { email } : {}),
      address: {
        street: rua.toUpperCase(),
        number: texto(config.numero),
        district: texto(config.bairro).toUpperCase(),
        postalCode: soDigitos(config.cep),
        city: {
          code: codigoCidade,
          name: (texto(config.nfseCidadeNome) || texto(config.cidade)).toUpperCase(),
          state: uf,
        },
      },
    },
  };
};

export interface ItemParaNota {
  produtoIdOrigem: string;
  codigo: string;
  nome: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
}

export interface PreparoNotaTransferencia {
  ok: boolean;
  erros: string[];
  avisos: string[];
  receiver?: Record<string, unknown>;
  itens: Array<Record<string, unknown>>;
  interestadual: boolean;
  /** CFOPs usados (saida) e os de entrada correspondentes no destino. */
  cfops: string[];
  cfopsEntrada: string[];
  valorTotal: number;
}

/**
 * Monta (ou recusa) a nota de transferencia. Puro: recebe os documentos ja'
 * lidos. `produtos` = cadastro na ORIGEM, por id.
 */
export const prepararNotaTransferencia = (a: {
  itens: ItemParaNota[];
  produtos: Record<string, Record<string, unknown>>;
  configOrigem: Record<string, unknown>;
  configDestino: Record<string, unknown>;
  rotuloOrigem: string;
  rotuloDestino: string;
  regime: RegimeTributario;
  tributacao: TributacaoTransferencia;
}): PreparoNotaTransferencia => {
  const vazio = { itens: [], interestadual: false, cfops: [], cfopsEntrada: [], valorTotal: 0, avisos: [] };
  const cnpjOrigem = soDigitos(a.configOrigem.cnpj);
  const cnpjDestino = soDigitos(a.configDestino.cnpj);
  if (cnpjOrigem && cnpjOrigem === cnpjDestino) {
    return { ok: false, erros: [`As filiais ${a.rotuloOrigem} e ${a.rotuloDestino} têm o mesmo CNPJ: nota fiscal não sai de um CNPJ para ele mesmo. Use a transferência sem nota.`], ...vazio };
  }
  const ufOrigem = ufDaConfiguracao(a.configOrigem);
  if (ufOrigem.length !== 2) {
    return { ok: false, erros: [`A filial ${a.rotuloOrigem} (a que envia) está sem estado no cadastro. Entre nela e escolha a cidade da empresa em Configurações (o estado vem junto).`], ...vazio };
  }
  const destinatario = destinatarioDaFilial(a.configDestino, a.rotuloDestino);
  if (!destinatario.ok) return { ok: false, erros: destinatario.erros, ...vazio };
  const ufDestino = String((destinatario.receiver.address as { city: { state: string } }).city.state);
  const interestadual = ufOrigem !== ufDestino;

  const erros: string[] = [];
  const avisos: string[] = [];
  const itens: Array<Record<string, unknown>> = [];
  const cfops = new Set<string>();
  let valorTotal = 0;
  for (const item of a.itens) {
    const cadastro = a.produtos[item.produtoIdOrigem];
    if (!cadastro) { erros.push(`O produto "${item.nome}" não foi encontrado no cadastro da filial ${a.rotuloOrigem}.`); continue; }
    if (!(Number(item.custoUnitario) > 0)) {
      erros.push(`O produto "${item.nome}" está sem preço de custo. A nota de transferência sai pelo custo: informe o custo em Estoque e tente de novo.`);
      continue;
    }
    const cfop = cfopDaTransferencia(cadastro.produzidoInternamente === true, interestadual);
    const fiscal = produtoFiscalNaTransferencia(produtoFiscalDoCadastro(cadastro), a.regime, a.tributacao);
    const r = montarItemNotaFiscal({
      produto: { ...fiscal, nome: item.nome || fiscal.nome },
      venda: { quantidade: item.quantidade, precoUnitario: item.custoUnitario, desconto: 0, unidadeSigla: item.unidade },
      contexto: { regime: a.regime, interestadual, cfopDaOperacao: cfop },
      codigoItem: item.codigo || item.produtoIdOrigem,
    });
    if (!r.ok) { erros.push(r.erro); continue; }
    // Tributos aproximados (Lei 12.741) sao para venda ao consumidor: fora daqui.
    const taxes = { ...(r.item.taxes as Record<string, unknown>) };
    delete taxes.totalTax;
    itens.push({ ...r.item, taxes });
    avisos.push(...r.avisos.filter((x) => !x.includes('tributos aproximados')));
    cfops.add(cfop);
    valorTotal += Number(r.item.totalAmount) || 0;
  }
  if (itens.length === 0 && erros.length === 0) erros.push('A transferência não tem itens para a nota.');
  if (erros.length > 0) return { ok: false, erros, ...vazio, avisos };
  const lista = [...cfops].sort();
  return {
    ok: true,
    erros: [],
    avisos: [...new Set(avisos)],
    receiver: destinatario.receiver,
    itens,
    interestadual,
    cfops: lista,
    cfopsEntrada: lista.map(cfopDeEntradaDaTransferencia),
    valorTotal: arred(valorTotal),
  };
};

/** Corpo do POST /product-invoices da Spedy. */
export const montarPayloadTransferencia = (a: {
  integrationId: string;
  preparo: PreparoNotaTransferencia;
  regime: RegimeTributario;
  tributacao: TributacaoTransferencia;
  numeroTransferencia: string;
  rotuloOrigem: string;
  rotuloDestino: string;
}): Record<string, unknown> => {
  const p = a.preparo;
  const soProducao = p.cfops.length > 0 && p.cfops.every((c) => c.endsWith('151'));
  const informacoes = [
    `Transferência entre estabelecimentos do mesmo titular nº ${a.numeroTransferencia}: filial ${a.rotuloOrigem} para filial ${a.rotuloDestino}.`,
    a.tributacao === 'nao_incide' ? 'Não incidência do ICMS na transferência (STF ADC 49 e LC 204/2023).' : '',
    usesCsosn(a.regime) ? TEXTO_OPTANTE_SIMPLES_NACIONAL : '',
  ].filter(Boolean).join(' ');
  const icmsBaseTax = arred(p.itens.reduce((s, i) => s + (Number(((i.taxes as Record<string, Record<string, number>>)?.icms || {}).baseTax) || 0), 0));
  const icmsAmount = arred(p.itens.reduce((s, i) => s + (Number(((i.taxes as Record<string, Record<string, number>>)?.icms || {}).amount) || 0), 0));
  return {
    integrationId: a.integrationId,
    isFinalCustomer: false,
    operationType: 'outgoing',
    destination: p.interestadual ? 'interstate' : 'internal',
    presenceType: 'none',
    operationNature: soProducao ? 'Transferência de produção do estabelecimento' : 'Transferência de mercadoria',
    additionalInformation: informacoes,
    sendEmailToCustomer: false,
    receiver: p.receiver,
    items: p.itens,
    payments: [{ method: 'noPayment', amount: 0 }],
    total: {
      invoiceAmount: p.valorTotal,
      productAmount: p.valorTotal,
      ...(icmsBaseTax > 0 ? { icmsBaseTax, icmsAmount } : {}),
    },
  };
};

/**
 * Situacoes da nota em que ela nao vale (pode emitir de novo). Alem das da
 * SEFAZ: "nao_emitida" (a Spedy recusou o pedido ou o cadastro impediu; nada foi criado) e
 * "falha_envio" (sem resposta da Spedy; a nova tentativa usa o MESMO
 * integrationId, entao a Spedy nao cria nota dobrada).
 */
export const STATUS_NOTA_SEM_VALOR = ['rejected', 'denied', 'canceled', 'nao_emitida', 'falha_envio'];

/** Reserva ("sendo emitida") mais velha que isto conta como falha de envio. */
export const VALIDADE_RESERVA_NOTA_MS = 5 * 60 * 1000;

/** Situacao que vale para as regras: reserva esquecida (servidor caiu no meio) vira falha_envio. */
export const statusEfetivoDaNota = (nota: { status?: unknown; reservadoEmMs?: unknown } | null | undefined, agoraMs: number): string => {
  const s = String(nota?.status ?? '');
  if (s === 'reservada' && agoraMs - (Number(nota?.reservadoEmMs) || 0) > VALIDADE_RESERVA_NOTA_MS) return 'falha_envio';
  return s;
};

export const notaDaTransferenciaVigente = (status: unknown): boolean => {
  const s = String(status ?? '').trim();
  return Boolean(s) && s !== 'reservada' && !STATUS_NOTA_SEM_VALOR.includes(s);
};

const ROTULO_STATUS_NOTA: Record<string, string> = {
  reservada: 'sendo emitida',
  created: 'enviada',
  enqueued: 'na fila da SEFAZ',
  processing: 'em processamento na SEFAZ',
  authorized: 'autorizada',
  rejected: 'rejeitada',
  denied: 'denegada',
  canceled: 'cancelada',
  nao_emitida: 'não emitida',
  falha_envio: 'sem confirmação da Spedy',
};

export const rotuloStatusNota = (status: unknown): string => ROTULO_STATUS_NOTA[String(status ?? '')] || 'sem nota';

/**
 * Recebimento de transferencia COM nota: so' depois da nota autorizada.
 * Devolve a mensagem que impede, ou null.
 */
export const bloqueioDoRecebimentoComNota = (status: unknown, numeroTransferencia: string): string | null => {
  const s = String(status ?? '');
  if (s === 'authorized') return null;
  if (!s) return `A transferência nº ${numeroTransferencia} é com nota fiscal e a nota ainda não foi emitida. A filial que enviou precisa emitir a nota antes do recebimento.`;
  if (STATUS_NOTA_SEM_VALOR.includes(s)) {
    return `A nota fiscal da transferência nº ${numeroTransferencia} não vale (situação: ${rotuloStatusNota(s)}). A filial que enviou precisa emitir a nota de novo (ou cancelar a transferência) antes do recebimento.`;
  }
  return `A nota fiscal da transferência nº ${numeroTransferencia} ainda não foi autorizada (situação: ${rotuloStatusNota(s)}). Aguarde a autorização para receber.`;
};

/**
 * Cancelar ou recusar transferencia COM nota: com a nota valendo (ou a
 * caminho da SEFAZ), o estoque nao pode voltar so' no controle.
 */
export const bloqueioDoDesfazerComNota = (status: unknown, acao: 'cancelar' | 'recusar', numeroNota: unknown): string | null => {
  const s = String(status ?? '');
  if (!s || STATUS_NOTA_SEM_VALOR.includes(s)) return null;
  if (s !== 'authorized') {
    return 'A nota fiscal desta transferência ainda está na SEFAZ. Aguarde o resultado (autorizada ou rejeitada) e tente de novo.';
  }
  const numero = numeroNota ? ` nº ${numeroNota}` : '';
  return acao === 'cancelar'
    ? `A nota fiscal${numero} desta transferência já foi autorizada. Cancele a nota em Fiscal → Notas Fiscais (até 24 horas depois da autorização) e depois cancele a transferência. Passado o prazo, receba no destino e faça uma transferência de volta, com nota.`
    : `A nota fiscal${numero} desta transferência já foi autorizada. Para recusar, a filial que enviou precisa cancelar a nota primeiro; passado o prazo de cancelamento, receba e faça uma transferência de volta, com nota.`;
};
