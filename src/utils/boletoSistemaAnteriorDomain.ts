import { zerosAEsquerda } from './boletoDomain';
import { dvNossoNumeroSicoob, formatarNossoNumeroSicoobExibicao, type ParametrosNossoNumeroSicoob } from './boletoCnabDomain';

/**
 * BOLETOS DO SISTEMA ANTERIOR (24/11/2026, Embala Minas).
 *
 * As contas a receber da migracao entraram sem o boleto que o sistema antigo
 * ja' tinha registrado no Sicoob. O arquivo de retorno do banco acha o titulo
 * pelo NOSSO NUMERO, entao esses boletos pagos viravam "nao encontrados" e
 * ficavam em aberto aqui.
 *
 * Esta regra liga cada conta migrada (pela chave do sistema antigo, gravada na
 * importacao em `chaveImportacao`) ao nosso numero dela. O boleto entra como
 * "Em remessa" (ja' esta' registrado no banco: NAO vai numa remessa nova) e
 * marcado `sistemaAnterior` (o codigo de barras e' do sistema antigo: a 2a via
 * sai pelo Sicoob, nao por aqui). Depois disso o retorno da' baixa nele como
 * em qualquer boleto emitido pelo sistema.
 *
 * Nada de dinheiro muda: o titulo continua com o mesmo valor e vencimento.
 */

export const LIMITE_DE_BOLETOS_POR_ENVIO = 500;

export interface BoletoAnteriorPedido {
  /** Chave do sistema antigo (ex.: "clidoc-56992"), a mesma da importacao das contas. */
  chave: string;
  /** Nosso numero com o DV colado, 10 digitos (como o sistema grava e o retorno traz). */
  nossoNumero: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  /** AAAA-MM-DD; vazio quando a planilha nao trouxe. */
  emissao: string;
  /** Valor do boleto registrado no banco. */
  valorBoletoCentavos: number;
  /** Arquivo de remessa do sistema antigo (so' informativo). */
  arquivoRemessa: string;
}

export interface LinhaDaPlanilhaDeBoletos extends BoletoAnteriorPedido {
  linha: number;
  cliente: string;
}

// A chave e' a da planilha de contas da migracao (texto livre: "clidoc-56992",
// "SOLNATUS-CR-3778-33427-1/1"...); so' nao pode ter ";" nem passar de 120.
const CHAVE_VALIDA = /^[^;\s](?:[^;]{0,118}[^;\s])?$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const semAcento = (texto: string): string => String(texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * "3978-9" (como o Sicoob imprime) ou "0000039789" (10 digitos, como o sistema
 * grava) -> "0000039789". Qualquer outra coisa: null.
 */
export const normalizarNossoNumeroAnterior = (texto: unknown): string | null => {
  const bruto = String(texto ?? '').trim();
  const comHifen = /^(\d{1,9})-(\d)$/.exec(bruto);
  if (comHifen) return `${zerosAEsquerda(comHifen[1], 9)}${comHifen[2]}`;
  if (/^\d{10}$/.test(bruto)) return bruto;
  return null;
};

/** "03/01/2025" ou "2025-01-03" -> "2025-01-03"; senao ''. */
const dataDaPlanilha = (texto: string): string => {
  const t = String(texto || '').trim();
  if (DATA_ISO.test(t)) return t;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : '';
};

/** "1.234,56" / "285,10" / "R$ 10" -> centavos; invalido -> null. */
const centavosDaPlanilha = (texto: string): number | null => {
  const limpo = String(texto || '').trim().replace(/r\$\s*/i, '').replace(/\s/g, '');
  if (!limpo) return null;
  const numero = Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo);
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero * 100) : null;
};

const COLUNAS: Record<string, string> = {
  chave: 'chave',
  'nosso numero': 'nossoNumero',
  vencimento: 'vencimento',
  emissao: 'emissao',
  'valor do boleto': 'valor',
  valor: 'valor',
  'arquivo de remessa': 'arquivoRemessa',
  cliente: 'cliente',
};

/**
 * Planilha "Chave;Nosso número;Vencimento;Emissão;Valor do boleto;Arquivo de
 * remessa;Cliente" (separada por ponto e virgula; Emissao, Arquivo e Cliente
 * sao opcionais). Linha com problema vai para `erros` (em portugues, com o
 * numero da linha) e nao entra; as outras seguem.
 */
export const lerPlanilhaBoletosAnteriores = (texto: string): { linhas: LinhaDaPlanilhaDeBoletos[]; erros: string[] } => {
  const brutas = String(texto || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const erros: string[] = [];
  const linhas: LinhaDaPlanilhaDeBoletos[] = [];
  const cabecalhoIndice = brutas.findIndex((l) => l.trim().length > 0);
  if (cabecalhoIndice < 0) return { linhas, erros: ['A planilha está vazia.'] };
  const cabecalho = brutas[cabecalhoIndice].split(';').map((c) => COLUNAS[semAcento(c)]);
  const faltam = ['chave', 'nossoNumero', 'vencimento', 'valor']
    .filter((c) => !cabecalho.includes(c))
    .map((c) => ({ chave: 'Chave', nossoNumero: 'Nosso número', vencimento: 'Vencimento', valor: 'Valor do boleto' } as Record<string, string>)[c]);
  if (faltam.length > 0) {
    return { linhas, erros: [`A planilha não tem a(s) coluna(s): ${faltam.join(', ')}. A primeira linha deve ser: Chave;Nosso número;Vencimento;Emissão;Valor do boleto;Arquivo de remessa;Cliente.`] };
  }
  const chaves = new Set<string>();
  const nossosNumeros = new Set<string>();
  brutas.forEach((bruta, indice) => {
    if (indice <= cabecalhoIndice || !bruta.trim()) return;
    const numeroDaLinha = indice + 1;
    const campos: Record<string, string> = {};
    bruta.split(';').forEach((valor, i) => { if (cabecalho[i]) campos[cabecalho[i]] = valor.trim(); });
    const chave = campos.chave || '';
    const nossoNumero = normalizarNossoNumeroAnterior(campos.nossoNumero);
    const vencimento = dataDaPlanilha(campos.vencimento || '');
    const valorBoletoCentavos = centavosDaPlanilha(campos.valor || '');
    const problema = !CHAVE_VALIDA.test(chave) ? `chave "${chave}" inválida`
      : !nossoNumero ? `nosso número "${campos.nossoNumero || ''}" inválido (use o formato 3978-9)`
        : !vencimento ? `vencimento "${campos.vencimento || ''}" inválido (use dd/mm/aaaa)`
          : valorBoletoCentavos === null ? `valor "${campos.valor || ''}" inválido`
            : chaves.has(chave) ? `a chave ${chave} aparece mais de uma vez`
              : nossosNumeros.has(nossoNumero) ? `o nosso número ${formatarNossoNumeroSicoobExibicao(nossoNumero)} aparece mais de uma vez`
                : '';
    if (problema) { erros.push(`Linha ${numeroDaLinha}: ${problema}.`); return; }
    chaves.add(chave);
    nossosNumeros.add(nossoNumero!);
    linhas.push({
      linha: numeroDaLinha,
      chave,
      nossoNumero: nossoNumero!,
      vencimento,
      emissao: dataDaPlanilha(campos.emissao || ''),
      valorBoletoCentavos: valorBoletoCentavos!,
      arquivoRemessa: String(campos.arquivoRemessa || '').slice(0, 120),
      cliente: String(campos.cliente || ''),
    });
  });
  return { linhas, erros };
};

/**
 * Confere o digito do nosso numero com o convenio do banco escolhido. Digito
 * diferente = boleto de outro convenio/banco (ou banco errado na tela): o
 * retorno desse banco nunca traria esse numero, entao nao vincula.
 */
export const erroDoDigitoDoNossoNumero = (nossoNumero: string, convenio: ParametrosNossoNumeroSicoob, nomeDoBanco: string): string | null => {
  const base = Number(nossoNumero.slice(0, -1));
  const esperado = dvNossoNumeroSicoob(base, convenio);
  if (String(esperado) === nossoNumero.slice(-1)) return null;
  return `O nosso número ${formatarNossoNumeroSicoobExibicao(nossoNumero)} não é do convênio do banco ${nomeDoBanco} `
    + `(o dígito seria ${esperado}). Confira se escolheu o banco que emitiu esse boleto.`;
};

/** Pedido que chega no servidor: valida campo a campo (o navegador nao e' confiavel). */
export const lerPedidoDeVinculo = (corpo: unknown): { erro: string } | { bancoId: string; boletos: BoletoAnteriorPedido[] } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const bancoId = String(c.bancoId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(bancoId)) return { erro: 'Escolha o banco que emitiu os boletos.' };
  const lista = Array.isArray(c.boletos) ? c.boletos : [];
  if (lista.length === 0) return { erro: 'Nenhum boleto para vincular.' };
  if (lista.length > LIMITE_DE_BOLETOS_POR_ENVIO) return { erro: `Envie no máximo ${LIMITE_DE_BOLETOS_POR_ENVIO} boletos por vez.` };
  const boletos: BoletoAnteriorPedido[] = [];
  const vistos = new Set<string>();
  for (const item of lista) {
    const b = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const chave = String(b.chave || '').trim();
    const nossoNumero = normalizarNossoNumeroAnterior(b.nossoNumero);
    const vencimento = String(b.vencimento || '').trim();
    const emissao = String(b.emissao || '').trim();
    const valorBoletoCentavos = Number(b.valorBoletoCentavos);
    if (!CHAVE_VALIDA.test(chave) || !nossoNumero || !DATA_ISO.test(vencimento) || (emissao && !DATA_ISO.test(emissao))
      || !Number.isInteger(valorBoletoCentavos) || valorBoletoCentavos <= 0) {
      return { erro: `O boleto da chave "${chave || '?'}" veio incompleto. Confira a planilha e tente de novo.` };
    }
    if (vistos.has(chave) || vistos.has(`nn:${nossoNumero}`)) {
      return { erro: `A chave ${chave} ou o nosso número ${formatarNossoNumeroSicoobExibicao(nossoNumero)} aparece mais de uma vez.` };
    }
    vistos.add(chave);
    vistos.add(`nn:${nossoNumero}`);
    boletos.push({ chave, nossoNumero, vencimento, emissao, valorBoletoCentavos, arquivoRemessa: String(b.arquivoRemessa || '').slice(0, 120) });
  }
  return { bancoId, boletos };
};

export interface TituloParaVinculo {
  id: string;
  tipo?: string;
  status?: string;
  descricao?: string;
  clienteNome?: string;
  valorCentavos?: number;
  valor?: number;
  origemImportacao?: string | null;
  boleto?: { nossoNumero?: string } | null;
}

export type PlanoDoVinculo =
  | { acao: 'vincular'; boleto: Record<string, unknown>; aviso?: string }
  | { acao: 'ja_vinculado' }
  | { acao: 'ja_pago' }
  | { acao: 'recusar'; motivo: string };

const centavosDoTitulo = (t: TituloParaVinculo): number => (
  Number.isInteger(t.valorCentavos) ? Number(t.valorCentavos) : Math.round(Number(t.valor || 0) * 100)
);

const reais = (centavos: number): string => `R$ ${(centavos / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/**
 * O que fazer com UMA linha. `titulo` = a conta migrada achada pela chave (null =
 * nao achou); `outroComONumero` = outro titulo da empresa que ja' usa esse nosso
 * numero (null = livre).
 */
export const planejarVinculo = (
  pedido: BoletoAnteriorPedido,
  titulo: TituloParaVinculo | null,
  outroComONumero: TituloParaVinculo | null,
  hoje: string,
): PlanoDoVinculo => {
  const nn = formatarNossoNumeroSicoobExibicao(pedido.nossoNumero);
  if (!titulo) {
    return { acao: 'recusar', motivo: `Boleto ${nn}: a conta a receber da chave ${pedido.chave} não foi encontrada. Confira se as contas da migração foram importadas nesta empresa.` };
  }
  const nome = `"${titulo.descricao || titulo.id}"${titulo.clienteNome ? ` (${titulo.clienteNome})` : ''}`;
  if (titulo.tipo !== 'entrada' || !titulo.origemImportacao) {
    return { acao: 'recusar', motivo: `Boleto ${nn}: ${nome} não é uma conta a receber importada do sistema anterior.` };
  }
  if (titulo.boleto) {
    if (titulo.boleto.nossoNumero === pedido.nossoNumero) return { acao: 'ja_vinculado' };
    return { acao: 'recusar', motivo: `Boleto ${nn}: ${nome} já tem outro boleto (nosso número ${formatarNossoNumeroSicoobExibicao(String(titulo.boleto.nossoNumero || ''))}).` };
  }
  if (titulo.status === 'Paga') return { acao: 'ja_pago' };
  if (titulo.status !== 'Pendente') {
    return { acao: 'recusar', motivo: `Boleto ${nn}: ${nome} está ${String(titulo.status || 'sem situação').toLowerCase()} e não recebe boleto.` };
  }
  if (outroComONumero && outroComONumero.id !== titulo.id) {
    return { acao: 'recusar', motivo: `Boleto ${nn}: esse nosso número já está no título "${outroComONumero.descricao || outroComONumero.id}". Confira no Sicoob qual dos dois é o certo.` };
  }
  const valorTitulo = centavosDoTitulo(titulo);
  const boleto: Record<string, unknown> = {
    nossoNumero: pedido.nossoNumero,
    linhaDigitavel: '',
    codigoBarras: '',
    vencimento: pedido.vencimento,
    dataEmissao: pedido.emissao || hoje,
    // Ja' registrado no banco pelo sistema anterior: fora da proxima remessa.
    status: 'em_remessa',
    numeroRemessa: 0,
    sistemaAnterior: true,
    ...(pedido.arquivoRemessa ? { remessaSistemaAnterior: pedido.arquivoRemessa } : {}),
    ...(pedido.valorBoletoCentavos !== valorTitulo ? { valorNoBancoCentavos: pedido.valorBoletoCentavos } : {}),
  };
  const aviso = pedido.valorBoletoCentavos !== valorTitulo
    ? `Boleto ${nn} de ${nome}: no banco ele vale ${reais(pedido.valorBoletoCentavos)} e a conta aqui está em ${reais(valorTitulo)} (parte já paga no sistema anterior). Se o cliente pagar o boleto inteiro, entra no banco o valor pago.`
    : undefined;
  return { acao: 'vincular', boleto, ...(aviso ? { aviso } : {}) };
};

/** Texto da 2a via de boleto do sistema anterior (o codigo de barras nao e' deste sistema). */
export const AVISO_SEGUNDA_VIA_SISTEMA_ANTERIOR = 'Este boleto foi emitido pelo sistema anterior e já está registrado no Sicoob. '
  + 'A 2ª via sai pelo aplicativo ou site do Sicoob, com o mesmo nosso número.';
