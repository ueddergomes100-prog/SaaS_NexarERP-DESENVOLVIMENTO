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
 * ---------------------------------------------------------------------------
 * O QUE O 2o ARQUIVO REAL (2026-09-23) CONFIRMOU E CORRIGIU
 * ---------------------------------------------------------------------------
 *
 * Com um segundo arquivo do Sicoob (1 titulo, outro sacado) e um retorno com
 * 196 titulos, os campos que estavam so' "copiados do template" ganharam
 * significado -- e tres deles estavam ERRADOS na 1a versao (titulo 2, 3...
 * herdava valor do template):
 *
 * - P 48-49 (e o fim do "seu numero", P 196-213) e' o NUMERO DA PARCELA da
 *   venda (01, 02, 03), nao a posicao do titulo no arquivo.
 * - P 61-72 = "22" + numero do documento (8 digitos) + parcela (2).
 * - P 196-213 = "seu numero" (18 digitos): "2000"+AAAA+"0004"+BBBB+parcela.
 *   O banco devolve esse campo no retorno (posicoes 38-62 do CNAB400).
 * - P 118-141 / R 66-89 = juros de mora (10,00% ao mes) e multa (2,00%),
 *   com inicio no dia seguinte ao vencimento. Agora vem do convenio.
 * - Segmento S = 4 mensagens de 40 posicoes: multa em R$, mora diaria em
 *   R$, referencia da nota e a instrucao de protesto.
 * - DV do nosso numero: ver boletoCnabDomain.ts (confirmado pelo retorno).
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
  // CNAB e' ASCII: o banco nao aceita acento (JOAO, nao JOAO com til).
  const semAcento = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ');
  const formatado = tipo === 'num'
    ? zerosAEsquerda(digitosDoBoleto(String(valor ?? '')), largura)
    : tipo === 'alfa'
      ? semAcento(String(valor ?? '')).toUpperCase().slice(0, largura).padEnd(largura, ' ')
      : semAcento(String(valor ?? '')).slice(0, largura).padEnd(largura, ' ');
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
  /** Ultima mensagem do Segmento S -- instrucao de protesto/cobranca impressa
   *  no boleto. Padrao: o texto que o sistema antigo da Sol Life usa. */
  instrucoes?: string;
  /** Multa apos o vencimento, em % (padrao 2). */
  multaPercentual?: number;
  /** Juros de mora ao MES, em % (padrao 10, o que o sistema antigo cobra). */
  jurosMensalPercentual?: number;
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

export const INSTRUCAO_PADRAO_SICOOB = 'PROTESTO NO 7 DIA APOS O VENCIMENTO';
export const MULTA_PADRAO_PERCENTUAL = 2;
export const JUROS_MENSAL_PADRAO_PERCENTUAL = 10;

export interface TituloRemessaSicoob {
  /** Nosso numero SEM o DV -- a funcao calcula e cola o DV. */
  nossoNumero: number;
  /** Numero do documento que a empresa usa pra identificar o titulo (numero
   *  do pedido). So' os 8 ultimos digitos vao no arquivo. */
  numeroDocumento: string;
  /** Numero da parcela dentro da venda, base 1 (padrao 1). */
  parcela?: number;
  /** "Seu numero" (18 digitos) que o banco devolve no retorno. Padrao:
   *  derivado do documento, do nosso numero e da parcela. */
  seuNumero?: string;
  /** Vai em "Ref. NF.: ..." no Segmento S (numero da nota/pedido). */
  referencia?: string;
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

/** "Seu numero": 2000 + AAAA + 0004 + BBBB + parcela (18 digitos), a forma
 *  do arquivo real. AAAA = final do documento, BBBB = final do nosso numero. */
export const seuNumeroPadrao = (titulo: TituloRemessaSicoob): string => (
  `2000${zerosAEsquerda(digitosDoBoleto(titulo.numeroDocumento).slice(-4), 4)}0004${zerosAEsquerda(String(titulo.nossoNumero).slice(-4), 4)}${zerosAEsquerda(titulo.parcela ?? 1, 2)}`
);

const centavosDeCnab = (percentual: number): number => Math.round(Number(percentual) * 100);

const montarSegmentoP = (
  convenio: ConvenioBoletoSicoob,
  titulo: TituloRemessaSicoob,
  numeroSequencial: number,
  dataGeracao: string,
): string => {
  const parcela = titulo.parcela ?? 1;
  const nossoNumeroComDv = nossoNumeroSicoobComDv(titulo.nossoNumero, {
    cooperativa: convenio.cooperativa,
    conta: convenio.conta,
    contaDv: convenio.contaDv || '0',
  });

  let l = TEMPLATE_SEGMENTO_P;
  l = substituir(l, 9, 13, numeroSequencial, 'num');
  l = substituir(l, 18, 22, convenio.cooperativa, 'num');
  l = substituir(l, 23, 35, convenio.conta, 'num');
  l = substituir(l, 36, 36, convenio.contaDv || '0', 'num');
  l = substituir(l, 38, 47, nossoNumeroComDv, 'num');
  // 48-49: numero da PARCELA da venda (01, 02...). 50-52 ("016") constante.
  l = substituir(l, 48, 49, parcela, 'num');
  l = substituir(l, 61, 72, `22${zerosAEsquerda(digitosDoBoleto(titulo.numeroDocumento).slice(-8), 8)}${zerosAEsquerda(parcela, 2)}`, 'num');
  l = substituir(l, 78, 85, dataCnab(titulo.vencimento), 'num');
  l = substituir(l, 86, 100, valorCnab(titulo.valorCentavos), 'num');
  // 110-117: data de emissao do TITULO = data de geracao do arquivo.
  l = substituir(l, 110, 117, dataCnab(dataGeracao), 'num');
  // 119-126: juros de mora comecam no dia seguinte ao vencimento; 127-141:
  // juros ao mes em % com 2 decimais (10,00% -> 1000).
  l = substituir(l, 119, 126, dataCnab(addDaysToDateInput(titulo.vencimento, 1)), 'num');
  l = substituir(l, 127, 141, centavosDeCnab(convenio.jurosMensalPercentual ?? JUROS_MENSAL_PADRAO_PERCENTUAL), 'num');
  l = substituir(l, 196, 213, titulo.seuNumero || seuNumeroPadrao(titulo), 'num');
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
  convenio: ConvenioBoletoSicoob,
  titulo: TituloRemessaSicoob,
  numeroSequencial: number,
): string => {
  let l = TEMPLATE_SEGMENTO_R;
  l = substituir(l, 9, 13, numeroSequencial, 'num');
  // Multa: comeca no dia seguinte ao vencimento; 75-89 = % com 2 decimais.
  l = substituir(l, 67, 74, dataCnab(addDaysToDateInput(titulo.vencimento, 1)), 'num');
  l = substituir(l, 75, 89, centavosDeCnab(convenio.multaPercentual ?? MULTA_PADRAO_PERCENTUAL), 'num');
  return l;
};

// --- Segmento S (mensagens/instrucoes) --------------------------------------

/** 1234.5 -> "1234,50" (duas casas, virgula, sem separador de milhar -- como
 *  o sistema antigo imprime nas mensagens do boleto). */
const reaisNaMensagem = (valor: number): string => (Math.round(valor * 100) / 100).toFixed(2).replace('.', ',');

/** As 4 mensagens de 40 posicoes do Segmento S: multa em R$, mora diaria em
 *  R$, referencia e a instrucao de protesto. Exportado pra tela mostrar o
 *  mesmo texto que vai no arquivo. */
export const mensagensDoBoleto = (convenio: ConvenioBoletoSicoob, titulo: TituloRemessaSicoob): string[] => {
  const valor = titulo.valorCentavos / 100;
  const multa = valor * ((convenio.multaPercentual ?? MULTA_PADRAO_PERCENTUAL) / 100);
  const moraDiaria = valor * ((convenio.jurosMensalPercentual ?? JUROS_MENSAL_PADRAO_PERCENTUAL) / 100) / 30;
  return [
    `Apos o Vencimento Multa de RS ${reaisNaMensagem(multa)}.`,
    `Apos o Vencimento Mora Diaria de RS ${reaisNaMensagem(moraDiaria)}`,
    titulo.referencia ? `- Ref. NF.: ${titulo.referencia}` : '',
    convenio.instrucoes || INSTRUCAO_PADRAO_SICOOB,
  ];
};

const montarSegmentoS = (
  convenio: ConvenioBoletoSicoob,
  titulo: TituloRemessaSicoob,
  numeroSequencial: number,
): string => {
  let l = TEMPLATE_SEGMENTO_S;
  l = substituir(l, 9, 13, numeroSequencial, 'num');
  // 14-18 ficam do template (S, branco, movimento 01 e o "3" constante). O
  // texto comeca em 19 e PRESERVA maiuscula/minuscula ('texto').
  const texto = mensagensDoBoleto(convenio, titulo).map((m) => m.slice(0, 40).padEnd(40, ' ')).join('');
  l = substituir(l, 19, 240, texto, 'texto');
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
    linhas.push(montarSegmentoP(args.convenio, titulo, baseSequencial, args.dataGeracao));
    linhas.push(montarSegmentoQ(titulo, baseSequencial + 1));
    linhas.push(montarSegmentoR(args.convenio, titulo, baseSequencial + 2));
    linhas.push(montarSegmentoS(args.convenio, titulo, baseSequencial + 3));
  });

  // Quantidade de registros do lote = header de lote + 4 por titulo + trailer de lote.
  const registrosNoLote = 1 + args.titulos.length * 4 + 1;
  linhas.push(montarTrailerLote(registrosNoLote));

  // Quantidade de registros do arquivo = tudo acima + header de arquivo + trailer de arquivo.
  const registrosNoArquivo = registrosNoLote + 2;
  linhas.push(montarTrailerArquivo(1, registrosNoArquivo));

  return linhas.join(CRLF) + CRLF;
};

/** Nome de arquivo sugerido pro download. Extensao .txt, como o sistema
 *  antigo grava (CNAB240_....txt) e o Sicoob aceita. */
export const nomeArquivoRemessaSicoob = (numeroRemessa: number, dataGeracao: string): string => (
  `CNAB240_sicoob_${String(numeroRemessa).padStart(4, '0')}_${dataCnab(dataGeracao)}.txt`
);
