import { dataCnab, valorCnab, nossoNumeroSicoobComDv } from './boletoCnabDomain';
import { digitosDoBoleto, zerosAEsquerda } from './boletoDomain';
import { addDaysToDateInput } from './dateTime';

/**
 * ARQUIVO DE REMESSA CNAB240 -- COBRANCA SICOOB (2026-09-22).
 *
 * Monta o arquivo que vai pro banco (header de arquivo, header de lote, um
 * bloco de 4 segmentos -- P/Q/R/S -- por titulo, trailer de lote, trailer
 * de arquivo).
 *
 * ---------------------------------------------------------------------------
 * COMO FOI CONSTRUIDO -- E POR QUE E' TEMPLATE, NAO SO' CAMPO A CAMPO
 * ---------------------------------------------------------------------------
 *
 * Em vez de redeclarar as 240 posicoes de cada linha do zero, cada linha
 * nasce como COPIA LITERAL de uma linha real do arquivo CNAB240 da Sol Life
 * (CNAB240_20000818000429950199.txt, ja aceito pelo banco), e so' os campos
 * que TEM de mudar por titulo/convenio sao substituidos, posicao a posicao.
 *
 * Isso foi decisao deliberada: comparando os 3 titulos do arquivo real lado
 * a lado (mesmo sacado nos 3, so' nosso numero/data/valor mudam) da pra
 * achar com certeza ALTA onde ficam banco, agencia, conta, nosso numero,
 * vencimento, valor, aceite e os dados do sacado (nome/endereco/bairro/
 * CEP/cidade/UF -- esses batem exatamente com a largura padrao publica da
 * FEBRABAN pro Segmento Q). Mas varios trechos (parte do Segmento R --
 * descontos/protesto --, e alguns campos de uso reservado dos headers) NAO
 * dava pra isolar: o arquivo real so' tem UM sacado e UMA configuracao de
 * desconto/multa repetidos nos 3 titulos, entao nao ha' como saber, so'
 * comparando, onde um campo desses termina e o proximo comeca.
 *
 * Usar o template evita o erro mais caro nesse ponto cego: preencher esses
 * trechos incertos com zero ou espaco "no chute" pode nao bater com o que o
 * parser do banco espera (numerico exige zero, alfa exige espaco -- errar
 * o tipo derruba o arquivo). Copiando o trecho de um arquivo que o Sicoob
 * ja' aceitou, o pior caso vira "byte identico ao que ja funcionou", nao
 * "byte inventado".
 *
 * ISSO NAO SUBSTITUI HOMOLOGACAO. Todo banco exige testar o arquivo de
 * remessa antes de liberar cobranca registrada -- o primeiro arquivo
 * gerado aqui tem que ir pro Sicoob como teste, nunca direto pra producao
 * de cobranca real. Se a empresa cedente for outra (CNPJ/nome diferente da
 * Sol Life) ou o convenio exigir um layout de Segmento R diferente, so' a
 * homologacao confirma.
 */

const CRLF = '\r\n';
const BANCO_SICOOB = '756';

// --- Templates, tirados do arquivo real (ver comentario acima) -------------

const TEMPLATE_HEADER_ARQUIVO = '75600000         217926066000100                    03049 00000005121500SOL LIFE PRODUTOS NATURAIS LTDSICOOB                                  10809202618191400176308100000                                                                     ';
const TEMPLATE_HEADER_LOTE = '75600011R01  040 2017926066000100                    03049 0000000512150 SOL LIFE PRODUTOS NATURAIS LTD                                                                                000017630809202600000000                                 ';
const TEMPLATE_SEGMENTO_P = '7560001300001P 010304900000000512150 000001200901016     10 220003535001     0610202600000000005255300000 02N08092026207102026000000000001000000000000000000000000000000000000000000000000000000000200008180004299501       3000   090000000000 ';
const TEMPLATE_SEGMENTO_Q = '7560001300002Q 012006300088000143JURACY DOS SANTOS ARAUJO                RUA DOZE, 109                           CENTRO         35125000TUMIRITINGA    MG0000000000000000                                        000                            ';
const TEMPLATE_SEGMENTO_R = '7560001300003R 01000000000000000000000000000000000000000000000000207102026000000000000200                                                                                                              0000000000000000 000000000000  0         ';
const TEMPLATE_SEGMENTO_S = '7560001300004S 013Apos o Vencimento Multa de RS 10,51.    Apos o Vencimento Mora Diaria de RS 1,75- Ref. NF.: 30212                       PROTESTO NO 7 DIA APOS O VENCIMENTO                                                                   ';
const TEMPLATE_TRAILER_LOTE = '75600015         00001400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000                                                                                                                             ';
const TEMPLATE_TRAILER_ARQUIVO = '75699999         000001000016000000                                                                                                                                                                                                             ';

/** Sobrescreve um trecho (posicoes 1-based, inclusive) de uma linha-template
 *  de 240 posicoes. `num` alinha a direita com zero a esquerda; `alfa`
 *  alinha a esquerda com espaco a direita -- mesma convencao de
 *  montarLinhaCnab, so' que aplicada em cima de uma base real em vez de
 *  uma linha em branco. */
const substituir = (
  base: string,
  de: number,
  ate: number,
  valor: string | number,
  // 'texto' e' como 'alfa' mas SEM maiusculizar -- o Segmento S (mensagens)
  // e' a unica excecao no arquivo real: o resto do CNAB e' numerico ou
  // codigo fixo, mas o texto livre do Segmento S saiu do sistema antigo em
  // maiusculas/minusculas misturadas e assim foi aceito pelo banco.
  tipo: 'num' | 'alfa' | 'texto' = 'num',
): string => {
  const largura = ate - de + 1;
  const formatado = tipo === 'num'
    ? zerosAEsquerda(digitosDoBoleto(String(valor ?? '')), largura)
    : tipo === 'alfa'
      ? String(valor ?? '').toUpperCase().slice(0, largura).padEnd(largura, ' ')
      : String(valor ?? '').slice(0, largura).padEnd(largura, ' ');
  return base.slice(0, de - 1) + formatado + base.slice(ate);
};

export interface ConvenioBoletoSicoob {
  /** Cooperativa (agencia), sem digito. */
  cooperativa: string;
  conta: string;
  contaDv?: string;
  /** CNPJ da empresa cedente, so' digitos. */
  cnpjCedente: string;
  nomeCedente: string;
  /** Texto que sai no Segmento S -- instrucoes impressas no boleto. */
  instrucoes?: string;
  /** Numero sequencial deste arquivo (Seq.Remessa do cadastro do banco). */
  numeroRemessa: number;
}

export type TipoDocumentoSacado = 'CPF' | 'CNPJ';

export interface SacadoRemessa {
  tipoDocumento: TipoDocumentoSacado;
  documento: string;
  nome: string;
  endereco?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
}

export interface TituloRemessaSicoob {
  /** Nosso numero SEM o DV -- a funcao calcula e cola o DV. */
  nossoNumero: number;
  /** Numero do documento que a empresa usa pra identificar o titulo (ex.: numero do pedido). */
  numeroDocumento: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  valorCentavos: number;
  sacado: SacadoRemessa;
}

// --- Header de arquivo -------------------------------------------------

const montarHeaderArquivo = (convenio: ConvenioBoletoSicoob, dataGeracao: string, horaGeracao: string): string => {
  let l = TEMPLATE_HEADER_ARQUIVO;
  l = substituir(l, 19, 32, convenio.cnpjCedente, 'num');
  l = substituir(l, 53, 57, convenio.cooperativa, 'num');
  l = substituir(l, 59, 70, convenio.conta, 'num');
  l = substituir(l, 71, 71, convenio.contaDv || '0', 'num');
  l = substituir(l, 73, 102, convenio.nomeCedente, 'alfa');
  l = substituir(l, 144, 151, dataCnab(dataGeracao), 'num');
  l = substituir(l, 152, 157, horaGeracao, 'num');
  l = substituir(l, 158, 163, String(convenio.numeroRemessa), 'num');
  return l;
};

// --- Header de lote ------------------------------------------------------

const montarHeaderLote = (convenio: ConvenioBoletoSicoob, dataGeracao: string): string => {
  let l = TEMPLATE_HEADER_LOTE;
  // Larguras DIFERENTES do Header de Arquivo pros mesmos campos -- conferido
  // byte a byte contra o arquivo real, nao e' erro de digitacao repetir a
  // logica com posicoes diferentes.
  l = substituir(l, 19, 33, convenio.cnpjCedente, 'num'); // 15 posicoes aqui (14 no header de arquivo)
  l = substituir(l, 54, 58, convenio.cooperativa, 'num');
  l = substituir(l, 60, 71, convenio.conta, 'num');
  l = substituir(l, 72, 72, convenio.contaDv || '0', 'num');
  l = substituir(l, 74, 103, convenio.nomeCedente, 'alfa');
  l = substituir(l, 184, 191, String(convenio.numeroRemessa), 'num');
  l = substituir(l, 192, 199, dataCnab(dataGeracao), 'num');
  return l;
};

// --- Segmento P (dados do titulo) -----------------------------------------

const montarSegmentoP = (
  convenio: ConvenioBoletoSicoob,
  titulo: TituloRemessaSicoob,
  numeroSequencial: number,
  /** Posicao do titulo dentro da remessa, base 1 (1o titulo=1, 2o=2...). */
  posicaoNoLote: number,
  dataGeracao: string,
): string => {
  const nossoNumeroComDv = nossoNumeroSicoobComDv(titulo.nossoNumero, {
    cooperativa: convenio.cooperativa,
    conta: convenio.conta,
  });

  let l = TEMPLATE_SEGMENTO_P;
  l = substituir(l, 9, 13, numeroSequencial, 'num');
  l = substituir(l, 18, 22, convenio.cooperativa, 'num');
  l = substituir(l, 23, 35, convenio.conta, 'num');
  l = substituir(l, 36, 36, convenio.contaDv || '0', 'num');
  l = substituir(l, 38, 47, nossoNumeroComDv, 'num');
  // 48-49: posicao do titulo dentro da remessa (01, 02, 03...) -- 50-52
  // ("016") fica constante do template, significado exato nao confirmado.
  l = substituir(l, 48, 49, posicaoNoLote, 'num');
  l = substituir(l, 61, 72, titulo.numeroDocumento, 'num');
  l = substituir(l, 78, 85, dataCnab(titulo.vencimento), 'num');
  l = substituir(l, 86, 100, valorCnab(titulo.valorCentavos), 'num');
  // 110-117: data de emissao do TITULO (a data que o arquivo foi gerado),
  // nao o vencimento -- constante entre todos os titulos de uma mesma
  // remessa no arquivo real.
  l = substituir(l, 110, 117, dataCnab(dataGeracao), 'num');
  // 119-126: vencimento + 1 dia -- mesmo campo (e mesma incerteza sobre o
  // significado exato) que aparece no Segmento R. Ver ressalva no topo.
  l = substituir(l, 119, 126, dataCnab(addDaysToDateInput(titulo.vencimento, 1)), 'num');
  // 213: 1 digito que acompanha a posicao do titulo na remessa (1, 2, 3...)
  // no arquivo real -- significado exato nao confirmado (ver ressalva).
  l = substituir(l, 213, 213, posicaoNoLote, 'num');
  return l;
};

// --- Segmento Q (dados do sacado) -----------------------------------------

const montarSegmentoQ = (
  titulo: TituloRemessaSicoob,
  numeroSequencial: number,
): string => {
  let l = TEMPLATE_SEGMENTO_Q;
  l = substituir(l, 9, 13, numeroSequencial, 'num');
  l = substituir(l, 18, 18, titulo.sacado.tipoDocumento === 'CNPJ' ? '2' : '1', 'num');
  l = substituir(l, 19, 33, titulo.sacado.documento, 'num');
  l = substituir(l, 34, 73, titulo.sacado.nome, 'alfa');
  l = substituir(l, 74, 113, titulo.sacado.endereco || '', 'alfa');
  l = substituir(l, 114, 128, titulo.sacado.bairro || '', 'alfa');
  l = substituir(l, 129, 136, digitosDoBoleto(titulo.sacado.cep || ''), 'num');
  l = substituir(l, 137, 151, titulo.sacado.cidade || '', 'alfa');
  l = substituir(l, 152, 153, titulo.sacado.uf || '', 'alfa');
  return l;
};

// --- Segmento R (descontos/multa/protesto -- ver ressalva no topo) --------

const montarSegmentoR = (
  titulo: TituloRemessaSicoob,
  numeroSequencial: number,
): string => {
  let l = TEMPLATE_SEGMENTO_R;
  l = substituir(l, 9, 13, numeroSequencial, 'num');
  // Vencimento + 1 dia, nao o vencimento em si -- e' o que o arquivo real
  // tem nesta posicao pros 3 titulos (provavelmente inicio da multa/mora
  // "no dia seguinte ao vencimento"; ver ressalva no topo do arquivo).
  l = substituir(l, 67, 74, dataCnab(addDaysToDateInput(titulo.vencimento, 1)), 'num');
  return l;
};

// --- Segmento S (mensagens/instrucoes) --------------------------------------

const montarSegmentoS = (
  convenio: ConvenioBoletoSicoob,
  numeroSequencial: number,
): string => {
  let l = TEMPLATE_SEGMENTO_S;
  l = substituir(l, 9, 13, numeroSequencial, 'num');
  // 14-18 ficam do template (S, branco, codigo de movimento 01, e um "3"
  // cujo significado exato nao foi confirmado -- constante nos 3 titulos
  // do arquivo real). O texto livre comeca em 19 e PRESERVA maiuscula/
  // minuscula (tipo 'texto'), diferente do resto do CNAB.
  l = substituir(l, 19, 240, convenio.instrucoes || '', 'texto');
  return l;
};

// --- Trailers --------------------------------------------------------------

const montarTrailerLote = (quantidadeRegistros: number): string => (
  substituir(TEMPLATE_TRAILER_LOTE, 18, 23, quantidadeRegistros, 'num')
);

const montarTrailerArquivo = (quantidadeLotes: number, quantidadeRegistros: number): string => {
  let l = TEMPLATE_TRAILER_ARQUIVO;
  l = substituir(l, 18, 23, quantidadeLotes, 'num');
  l = substituir(l, 24, 29, quantidadeRegistros, 'num');
  return l;
};

export interface MontarRemessaSicoobArgs {
  convenio: ConvenioBoletoSicoob;
  titulos: TituloRemessaSicoob[];
  /** AAAA-MM-DD -- hoje, normalmente. */
  dataGeracao: string;
  /** HHMMSS -- hora local no momento de gerar. */
  horaGeracao: string;
}

/**
 * Monta o arquivo de remessa inteiro (todas as linhas, com CRLF, terminando
 * em CRLF -- e' o que o arquivo real da Sol Life usa e o que a maioria dos
 * bancos espera num .REM).
 */
export const montarRemessaSicoob = (args: MontarRemessaSicoobArgs): string => {
  if (args.titulos.length === 0) {
    throw new Error('Selecione ao menos um boleto emitido para gerar a remessa.');
  }

  const linhas: string[] = [
    montarHeaderArquivo(args.convenio, args.dataGeracao, args.horaGeracao),
    montarHeaderLote(args.convenio, args.dataGeracao),
  ];

  args.titulos.forEach((titulo, indice) => {
    const baseSequencial = indice * 4 + 1;
    linhas.push(montarSegmentoP(args.convenio, titulo, baseSequencial, indice + 1, args.dataGeracao));
    linhas.push(montarSegmentoQ(titulo, baseSequencial + 1));
    linhas.push(montarSegmentoR(titulo, baseSequencial + 2));
    linhas.push(montarSegmentoS(args.convenio, baseSequencial + 3));
  });

  // Quantidade de registros do lote = header de lote + 4 por titulo + trailer de lote.
  const registrosNoLote = 1 + args.titulos.length * 4 + 1;
  linhas.push(montarTrailerLote(registrosNoLote));

  // Quantidade de registros do arquivo = tudo acima + header de arquivo + trailer de arquivo.
  const registrosNoArquivo = registrosNoLote + 2;
  linhas.push(montarTrailerArquivo(1, registrosNoArquivo));

  return linhas.join(CRLF) + CRLF;
};

/** Nome de arquivo sugerido pro download (.REM e' a extensao que os bancos esperam). */
export const nomeArquivoRemessaSicoob = (numeroRemessa: number, dataGeracao: string): string => (
  `remessa_sicoob_${String(numeroRemessa).padStart(4, '0')}_${dataCnab(dataGeracao)}.rem`
);
