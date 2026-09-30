/*
 * IMPORTACAO DE DADOS FISCAIS DO PRODUTO.
 *
 * Pedido do dono (2026-09-24), implantacao da Sol Life: os produtos entraram
 * sem codigo de barras/NCM/CEST e os dados existem no ERP antigo. Esta
 * importacao ATUALIZA produtos que ja existem -- nunca cria produto.
 *
 * 2026-09-30: passou a levar tambem a tributacao (CSOSN/CST de ICMS, CFOP,
 * origem, CST de PIS/COFINS/IPI, enquadramento do IPI e % de tributos
 * aproximados). A NF-e da Sol Life saia com CST 00 sem ICMS, PIS/COFINS 07 e
 * sem tributos aproximados porque o cadastro nao tinha esses dados; corrigir
 * produto a produto na tela seria inviavel (mais de 300). Tambem le o arquivo
 * oficial do IBPT ("De Olho no Imposto"), que vem por NCM e nao por produto:
 * cada produto recebe os percentuais do seu NCM (ver planejarImportacaoIbpt).
 *
 * Regras que protegem o cadastro:
 *  - celula vazia na planilha NUNCA apaga o que o produto ja tem;
 *  - valor ja preenchido e diferente NAO e' trocado sem o usuario marcar
 *    "sobrescrever" -- aparece como conflito, com os dois valores;
 *  - valor invalido (codigo de barras que nao fecha o digito verificador,
 *    NCM/CEST com tamanho errado, CSOSN que nao existe...) e' ignorado e
 *    explicado, o resto da linha continua valendo;
 *  - o MESMO codigo de barras em dois produtos e' recusado: o leitor do PDV
 *    nao saberia qual vender.
 *
 * Este arquivo e' so' a parte pura (leitura das linhas, validacao e plano).
 * A leitura do arquivo e a gravacao ficam em pages/Estoque/ImportarDadosFiscais.
 */

import { CSOSN_OPTIONS, ICMS_CST_OPTIONS, usesCsosn, type RegimeTributario } from './fiscalDomain';

/** Campos de tributacao alem de codigo de barras/NCM/CEST (2026-09-30). */
export const CAMPOS_TRIBUTACAO = [
  'cfop', 'csosn', 'cfopInterestadual', 'csosnInterestadual', 'origem', 'cstPis', 'cstCofins', 'cstIpi', 'enquadramentoIpi',
  'percentualTributosFederal', 'percentualTributosEstadual', 'percentualTributosMunicipal', 'percentualTributos',
] as const;
export type CampoTributacao = typeof CAMPOS_TRIBUTACAO[number];
export type CampoGravavel = 'codigoBarras' | 'ncm' | 'cest' | CampoTributacao;
export type CampoFiscal = 'codigo' | 'produto' | CampoGravavel;
export type MapeamentoFiscal = Record<CampoFiscal, number | null>;

const CAMPOS_PERCENTUAIS: CampoTributacao[] = ['percentualTributosFederal', 'percentualTributosEstadual', 'percentualTributosMunicipal', 'percentualTributos'];

const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
const chaveTexto = (texto: string) => semAcento(String(texto ?? '')).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

/** Chave de comparacao de NOME: sem acento, caixa, hifen/aspas/espaco duplo nao diferenciam. */
export const chaveNomeProduto = (nome: string): string => (
  semAcento(String(nome ?? '')).toUpperCase().replace(/[^A-Z0-9/%,.]+/g, ' ').replace(/\s+/g, ' ').trim()
);

export const mapeamentoVazio = (): MapeamentoFiscal => ({
  codigo: null, produto: null, codigoBarras: null, ncm: null, cest: null,
  cfop: null, csosn: null, cfopInterestadual: null, csosnInterestadual: null, origem: null, cstPis: null, cstCofins: null, cstIpi: null, enquadramentoIpi: null,
  percentualTributosFederal: null, percentualTributosEstadual: null, percentualTributosMunicipal: null, percentualTributos: null,
});

export const inferirMapeamentoFiscal = (cabecalho: string[]): MapeamentoFiscal => {
  const mapa = mapeamentoVazio();
  const usados = new Set<number>();
  const achar = (teste: (h: string) => boolean): number | null => {
    const indice = cabecalho.findIndex((h, i) => !usados.has(i) && teste(chaveTexto(h)));
    if (indice >= 0) usados.add(indice);
    return indice >= 0 ? indice : null;
  };
  // Ordem importa: "Codigo de barras" nao pode virar o "Codigo" do produto,
  // e "CST PIS" nao pode virar o CST de ICMS.
  mapa.codigoBarras = achar((h) => /barra|\bean\b|gtin/.test(h));
  mapa.ncm = achar((h) => /^ncm/.test(h));
  mapa.cest = achar((h) => /^cest/.test(h));
  mapa.cstPis = achar((h) => /pis/.test(h) && /cst/.test(h));
  mapa.cstCofins = achar((h) => /cofins/.test(h) && /cst/.test(h));
  mapa.enquadramentoIpi = achar((h) => /enquadr|cenq/.test(h));
  mapa.cstIpi = achar((h) => /ipi/.test(h) && /cst/.test(h));
  mapa.cfopInterestadual = achar((h) => /cfop/.test(h) && /inter/.test(h));
  mapa.csosnInterestadual = achar((h) => /csosn|cst/.test(h) && /inter/.test(h));
  mapa.csosn = achar((h) => /csosn|cst icms|^cst$/.test(h));
  mapa.cfop = achar((h) => /^cfop/.test(h));
  mapa.origem = achar((h) => /^origem/.test(h));
  mapa.percentualTributosFederal = achar((h) => /federa/.test(h));
  mapa.percentualTributosEstadual = achar((h) => /estadua/.test(h));
  mapa.percentualTributosMunicipal = achar((h) => /municipa/.test(h));
  mapa.percentualTributos = achar((h) => /tribut/.test(h));
  mapa.produto = achar((h) => /produto|descri|^nome/.test(h));
  mapa.codigo = achar((h) => /^(codigo|cod|id)( do produto)?$/.test(h) || /^codigo\b/.test(h));
  return mapa;
};

export type LinhaFiscal = { linha: number; codigo: string; produto: string } & Record<CampoGravavel, string>;

export const lerLinhasFiscais = (linhas: string[][], mapa: MapeamentoFiscal): LinhaFiscal[] => {
  const celula = (l: string[], indice: number | null) => (indice === null ? '' : String(l[indice] ?? '').trim());
  const saida: LinhaFiscal[] = [];
  const campos = Object.keys(mapa) as CampoFiscal[];
  linhas.forEach((l, i) => {
    const linha = { linha: i + 2 } as LinhaFiscal;
    campos.forEach((c) => { (linha as Record<string, unknown>)[c] = celula(l, mapa[c]); });
    if (campos.some((c) => (linha as Record<string, string>)[c])) saida.push(linha);
  });
  return saida;
};

// ---------------------------------------------------------------------------
// Normalizacao e validacao de cada campo. Devolvem { valor, erro }: valor ''
// quando a celula veio vazia (nao e' erro) ou quando e' invalida (erro dito).
// ---------------------------------------------------------------------------

export interface CampoNormalizado {
  valor: string;
  erro: string;
}

const soDigitos = (texto: string) => String(texto ?? '').replace(/\D/g, '');
const NOTACAO_CIENTIFICA = /^\d+([.,]\d+)?e[+-]?\d+$/i;

export const gtinValido = (digitos: string): boolean => {
  if (![8, 12, 13, 14].includes(digitos.length)) return false;
  let soma = 0;
  for (let i = 0; i < digitos.length - 1; i += 1) {
    const digito = Number(digitos[digitos.length - 2 - i]);
    soma += digito * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (soma % 10)) % 10 === Number(digitos[digitos.length - 1]);
};

export const normalizarCodigoBarras = (bruto: string): CampoNormalizado => {
  const texto = String(bruto ?? '').trim();
  if (!texto) return { valor: '', erro: '' };
  if (NOTACAO_CIENTIFICA.test(texto)) {
    return { valor: '', erro: `Código de barras "${texto}" veio em notação científica (o Excel cortou os dígitos). Formate a coluna como Texto e digite de novo.` };
  }
  let digitos = soDigitos(texto);
  // EAN-13 gravado com um zero a mais na frente (14 digitos).
  if (digitos.length === 14 && digitos.startsWith('0') && gtinValido(digitos.slice(1))) digitos = digitos.slice(1);
  if (!gtinValido(digitos)) {
    return { valor: '', erro: `Código de barras "${texto}" inválido (tamanho ou dígito verificador não conferem).` };
  }
  return { valor: digitos, erro: '' };
};

export const normalizarNcm = (bruto: string): CampoNormalizado => {
  const texto = String(bruto ?? '').trim();
  if (!texto) return { valor: '', erro: '' };
  let digitos = soDigitos(texto);
  // O Excel come o zero da frente de NCM numerico (08132010 vira 8132010).
  if (digitos.length === 7) digitos = `0${digitos}`;
  if (digitos.length !== 8 || /^0+$/.test(digitos)) {
    return { valor: '', erro: `NCM "${texto}" inválido: precisa ter 8 dígitos.` };
  }
  return { valor: digitos, erro: '' };
};

export const normalizarCest = (bruto: string): CampoNormalizado => {
  const texto = String(bruto ?? '').trim();
  if (!texto) return { valor: '', erro: '' };
  let digitos = soDigitos(texto);
  if (digitos.length === 6) digitos = `0${digitos}`;
  if (digitos.length !== 7 || /^0+$/.test(digitos)) {
    return { valor: '', erro: `CEST "${texto}" inválido: precisa ter 7 dígitos.` };
  }
  return { valor: digitos, erro: '' };
};

const PIS_COFINS_SAIDA = ['01', '02', '04', '05', '06', '07', '08', '09', '49', '99'];
const IPI_SAIDA = ['50', '51', '52', '53', '54', '55', '99'];
const ORIGENS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];

/** Codigo com zeros a esquerda ate o tamanho ("1" -> "01" no CST de PIS; "0" -> "00" no CST de ICMS). */
const codigo = (texto: string, tamanho: number) => {
  const d = soDigitos(texto);
  return d ? d.padStart(tamanho, '0') : '';
};

/**
 * CSOSN (3 digitos) ou CST de ICMS (2 digitos), conforme o regime da empresa.
 * "5.1020" e "5.102" do ERP antigo sao aceitos no CFOP; "060" do CST vira "60".
 */
export const normalizarCsosnOuCst = (bruto: string, regime?: RegimeTributario): CampoNormalizado => {
  const texto = String(bruto ?? '').trim();
  if (!texto) return { valor: '', erro: '' };
  const d = soDigitos(texto);
  const csosn = CSOSN_OPTIONS.some((o) => o.value === d);
  const cst = d.length <= 3 ? d.padStart(3, '0').slice(-2) : '';
  const cstValido = ICMS_CST_OPTIONS.some((o) => o.value === cst);
  if (regime && usesCsosn(regime)) {
    return csosn ? { valor: d, erro: '' } : { valor: '', erro: `"${texto}" não é um CSOSN do Simples Nacional (${CSOSN_OPTIONS.map((o) => o.value).join(', ')}). A empresa está no Simples.` };
  }
  if (regime) {
    return d.length <= 3 && cstValido && !csosn ? { valor: cst, erro: '' } : { valor: '', erro: `"${texto}" não é um CST de ICMS (${ICMS_CST_OPTIONS.map((o) => o.value).join(', ')}). A empresa não está no Simples.` };
  }
  if (csosn) return { valor: d, erro: '' };
  if (cstValido) return { valor: cst, erro: '' };
  return { valor: '', erro: `"${texto}" não é CSOSN nem CST de ICMS.` };
};

export const normalizarCfop = (bruto: string): CampoNormalizado => {
  const texto = String(bruto ?? '').trim();
  if (!texto) return { valor: '', erro: '' };
  // ERP antigo grava "5.1020"; vale so' os 4 primeiros digitos.
  const d = soDigitos(texto).slice(0, 4);
  if (d.length !== 4 || !/^[567]/.test(d)) return { valor: '', erro: `CFOP "${texto}" inválido: precisa ser um CFOP de saída (5xxx, 6xxx ou 7xxx).` };
  return { valor: d, erro: '' };
};

const normalizarDaLista = (bruto: string, tamanho: number, lista: string[], nome: string): CampoNormalizado => {
  const texto = String(bruto ?? '').trim();
  if (!texto) return { valor: '', erro: '' };
  const c = codigo(texto, tamanho);
  return lista.includes(c) ? { valor: c, erro: '' } : { valor: '', erro: `${nome} "${texto}" não existe na tabela de saída.` };
};

export const normalizarPercentual = (bruto: string, nome: string): CampoNormalizado => {
  const texto = String(bruto ?? '').trim().replace('%', '');
  if (!texto) return { valor: '', erro: '' };
  const n = Number(texto.replace(/\./g, texto.includes(',') ? '' : '.').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) return { valor: '', erro: `${nome} "${bruto}" inválido: use um percentual entre 0 e 100.` };
  return { valor: String(Math.round(n * 100) / 100), erro: '' };
};

const normalizarCampo = (campo: CampoGravavel, bruto: string, regime?: RegimeTributario): CampoNormalizado => {
  switch (campo) {
    case 'codigoBarras': return normalizarCodigoBarras(bruto);
    case 'ncm': return normalizarNcm(bruto);
    case 'cest': return normalizarCest(bruto);
    case 'cfop': return normalizarCfop(bruto);
    case 'csosn': return normalizarCsosnOuCst(bruto, regime);
    case 'csosnInterestadual': return normalizarCsosnOuCst(bruto, regime);
    case 'cfopInterestadual': {
      const r = normalizarCfop(bruto);
      return r.valor && !r.valor.startsWith('6') ? { valor: '', erro: `CFOP interestadual "${bruto}" inválido: venda para outro estado usa 6xxx.` } : r;
    }
    case 'origem': return normalizarDaLista(bruto, 1, ORIGENS, 'Origem');
    case 'cstPis': return normalizarDaLista(bruto, 2, PIS_COFINS_SAIDA, 'CST de PIS');
    case 'cstCofins': return normalizarDaLista(bruto, 2, PIS_COFINS_SAIDA, 'CST de COFINS');
    case 'cstIpi': return normalizarDaLista(bruto, 2, IPI_SAIDA, 'CST de IPI');
    case 'enquadramentoIpi': {
      const texto = String(bruto ?? '').trim();
      if (!texto) return { valor: '', erro: '' };
      const d = soDigitos(texto);
      return d.length > 0 && d.length <= 3 ? { valor: d.padStart(3, '0'), erro: '' } : { valor: '', erro: `Enquadramento do IPI "${texto}" inválido: são 3 dígitos (ex.: 999).` };
    }
    default: return normalizarPercentual(bruto, nomeCampo(campo));
  }
};

// ---------------------------------------------------------------------------
// Plano: o que sera gravado, produto a produto.
// ---------------------------------------------------------------------------

export type ProdutoFiscalAtual = {
  id: string;
  codigo: string;
  nome: string;
  /** Codigos de barras das embalagens: tambem contam como "ja usado". */
  embalagensBarras: string[];
  /**
   * Produto inativo NAO se edita (firestore.rules, cadastroInativo): se entrar
   * no lote, o Firestore recusa o lote INTEIRO. A Sol Life tinha 21 inativos e
   * a importacao de 2026-09-30 falhou toda por isso.
   */
  inativo?: boolean;
} & { codigoBarras: string; ncm: string; cest: string } & Partial<Record<CampoTributacao, string>>;

export type StatusLinhaFiscal = 'atualizar' | 'sem_mudanca' | 'conflito' | 'erro' | 'nao_encontrado' | 'ambiguo';

export interface MudancaFiscal {
  campo: CampoGravavel;
  antes: string;
  depois: string;
  tipo: 'preencher' | 'trocar';
}

export interface ResultadoLinhaFiscal {
  linha: LinhaFiscal;
  status: StatusLinhaFiscal;
  produto: ProdutoFiscalAtual | null;
  /** Campos que vao para o produto. So' tem chave do que muda (percentual vai como numero). */
  grava: Partial<Record<CampoGravavel, string | number>>;
  mudancas: MudancaFiscal[];
  /** Tudo que a pessoa precisa saber desta linha, em portugues. */
  problemas: string[];
}

export interface ResumoFiscal {
  total: number;
  atualizar: number;
  semMudanca: number;
  conflito: number;
  erro: number;
  naoEncontrado: number;
  ambiguo: number;
  comAviso: number;
}

const semZerosEsquerda = (texto: string) => texto.replace(/^0+(?=\d)/, '');

/** Valor atual do produto, na mesma forma do valor normalizado da planilha (pra comparar). */
const valorAtual = (produto: ProdutoFiscalAtual, campo: CampoGravavel): string => {
  const bruto = String(produto[campo] ?? '').trim();
  if (!bruto) return '';
  if (CAMPOS_PERCENTUAIS.includes(campo as CampoTributacao)) {
    const n = Number(bruto);
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : bruto;
  }
  if (campo === 'codigoBarras' || campo === 'ncm' || campo === 'cest') return soDigitos(bruto);
  return bruto;
};

const resumir = (resultados: ResultadoLinhaFiscal[]): ResumoFiscal => {
  const conta = (s: StatusLinhaFiscal) => resultados.filter((r) => r.status === s).length;
  return {
    total: resultados.length,
    atualizar: conta('atualizar'),
    semMudanca: conta('sem_mudanca'),
    conflito: conta('conflito'),
    erro: conta('erro'),
    naoEncontrado: conta('nao_encontrado'),
    ambiguo: conta('ambiguo'),
    comAviso: resultados.filter((r) => r.status === 'atualizar' && r.problemas.length > 0).length,
  };
};

const PROBLEMA_INATIVO = 'Produto inativo: não é alterado. Se ele ainda é vendido, reative em Estoque e importe de novo.';

export const planejarImportacaoFiscal = (args: {
  linhas: LinhaFiscal[];
  produtos: ProdutoFiscalAtual[];
  sobrescrever: boolean;
  /** Regime da empresa: decide se a coluna CSOSN/CST aceita CSOSN ou CST. */
  regime?: RegimeTributario;
}): { resultados: ResultadoLinhaFiscal[]; resumo: ResumoFiscal } => {
  const { linhas, produtos, sobrescrever, regime } = args;

  const porCodigo = new Map<string, ProdutoFiscalAtual[]>();
  const porNome = new Map<string, ProdutoFiscalAtual[]>();
  produtos.forEach((p) => {
    const cod = semZerosEsquerda(String(p.codigo || '').trim());
    if (cod) porCodigo.set(cod, [...(porCodigo.get(cod) || []), p]);
    const nome = chaveNomeProduto(p.nome);
    if (nome) porNome.set(nome, [...(porNome.get(nome) || []), p]);
  });

  // Quem ja usa cada codigo de barras na base (produto e embalagens).
  const donoDoCodigo = new Map<string, ProdutoFiscalAtual>();
  produtos.forEach((p) => {
    [p.codigoBarras, ...p.embalagensBarras].forEach((c) => {
      const d = soDigitos(c);
      if (d && !donoDoCodigo.has(d)) donoDoCodigo.set(d, p);
    });
  });

  const camposGravaveis: CampoGravavel[] = ['codigoBarras', 'ncm', 'cest', ...CAMPOS_TRIBUTACAO];

  // 1a passada: achar o produto de cada linha e normalizar os campos.
  interface Preparada {
    linha: LinhaFiscal;
    produto: ProdutoFiscalAtual | null;
    achado: 'ok' | 'nao_encontrado' | 'ambiguo';
    problemas: string[];
    campos: Record<CampoGravavel, CampoNormalizado>;
  }
  const preparadas: Preparada[] = linhas.map((linha) => {
    const problemas: string[] = [];
    let produto: ProdutoFiscalAtual | null = null;
    let achado: Preparada['achado'] = 'nao_encontrado';
    const cod = semZerosEsquerda(linha.codigo);
    if (cod) {
      const candidatos = porCodigo.get(cod) || [];
      if (candidatos.length === 1) { produto = candidatos[0]; achado = 'ok'; }
      else if (candidatos.length > 1) { achado = 'ambiguo'; problemas.push(`Há ${candidatos.length} produtos com o código ${linha.codigo} no cadastro.`); }
      else problemas.push(`Nenhum produto com o código ${linha.codigo} no cadastro.`);
    } else if (linha.produto) {
      const candidatos = porNome.get(chaveNomeProduto(linha.produto)) || [];
      if (candidatos.length === 1) { produto = candidatos[0]; achado = 'ok'; }
      else if (candidatos.length > 1) { achado = 'ambiguo'; problemas.push(`Há ${candidatos.length} produtos com o nome "${linha.produto}". Use a coluna Código para escolher.`); }
      else problemas.push(`Nenhum produto com o nome "${linha.produto}" no cadastro.`);
    } else {
      problemas.push('Linha sem código nem nome do produto.');
    }
    const campos = {} as Record<CampoGravavel, CampoNormalizado>;
    camposGravaveis.forEach((c) => { campos[c] = normalizarCampo(c, linha[c] ?? '', regime); });
    return { linha, produto, achado, problemas, campos };
  });

  // 2a: o mesmo codigo de barras em dois produtos DENTRO do arquivo.
  const linhasPorBarra = new Map<string, Preparada[]>();
  preparadas.forEach((p) => {
    const b = p.campos.codigoBarras.valor;
    if (p.produto && b) linhasPorBarra.set(b, [...(linhasPorBarra.get(b) || []), p]);
  });

  const resultados: ResultadoLinhaFiscal[] = preparadas.map((p) => {
    const { linha, produto } = p;
    const problemas = [...p.problemas];
    const grava: ResultadoLinhaFiscal['grava'] = {};
    const mudancas: MudancaFiscal[] = [];
    let conflitos = 0;
    let bloqueios = 0;

    if (!produto) {
      return { linha, status: p.achado === 'ambiguo' ? 'ambiguo' : 'nao_encontrado', produto: null, grava, mudancas, problemas };
    }
    if (produto.inativo) {
      return { linha, status: 'erro', produto, grava, mudancas, problemas: [...problemas, PROBLEMA_INATIVO] };
    }

    camposGravaveis.forEach((c) => { if (p.campos[c].erro) { problemas.push(p.campos[c].erro); bloqueios += 1; } });

    const decidir = (campo: CampoGravavel, novo: string) => {
      const atual = valorAtual(produto, campo);
      if (!novo) return;
      if (novo === atual) return;
      let tipo: MudancaFiscal['tipo'];
      if (!atual) tipo = 'preencher';
      else if (sobrescrever) tipo = 'trocar';
      else {
        conflitos += 1;
        problemas.push(`${nomeCampo(campo)} já preenchido (${atual}) e diferente da planilha (${novo}). Marque "sobrescrever" para trocar.`);
        return;
      }
      grava[campo] = CAMPOS_PERCENTUAIS.includes(campo as CampoTributacao) ? Number(novo) : novo;
      mudancas.push({ campo, antes: String(produto[campo] ?? ''), depois: novo, tipo });
    };

    // codigo de barras
    let barras = p.campos.codigoBarras.valor;
    if (barras) {
      const usoNoArquivo = (linhasPorBarra.get(barras) || []).filter((o) => o.produto && o.produto.id !== produto.id);
      const dono = donoDoCodigo.get(barras);
      if (usoNoArquivo.length > 0) {
        problemas.push(`O código de barras ${barras} também está na linha ${usoNoArquivo.map((o) => o.linha.linha).join(', ')} (${usoNoArquivo[0].produto?.nome}). Dois produtos não podem ter o mesmo código: corrija a planilha.`);
        bloqueios += 1;
        barras = '';
      } else if (dono && dono.id !== produto.id) {
        problemas.push(`O código de barras ${barras} já pertence a "${dono.nome}" (código ${dono.codigo}). Dois produtos não podem ter o mesmo código.`);
        bloqueios += 1;
        barras = '';
      }
    }
    decidir('codigoBarras', barras);
    camposGravaveis.filter((c) => c !== 'codigoBarras').forEach((c) => decidir(c, p.campos[c].valor));

    if (grava.cest && !grava.ncm && !soDigitos(produto.ncm)) {
      problemas.push('Tem CEST mas o produto não tem NCM. Preencha o NCM também.');
    }

    let status: StatusLinhaFiscal;
    if (mudancas.length > 0) status = 'atualizar';
    else if (bloqueios > 0) status = 'erro';
    else if (conflitos > 0) status = 'conflito';
    else status = 'sem_mudanca';
    return { linha, status, produto, grava, mudancas, problemas };
  });

  return { resultados, resumo: resumir(resultados) };
};

// ---------------------------------------------------------------------------
// Tabela do IBPT ("De Olho no Imposto"): percentuais por NCM.
// Colunas oficiais: codigo;ex;tipo;descricao;nacionalfederal;importadosfederal;
// estadual;municipal;vigenciainicio;vigenciafim;chave;versao;fonte
// ---------------------------------------------------------------------------

/** O cabecalho e' o do arquivo do IBPT? */
export const ehTabelaIbpt = (cabecalho: string[]): boolean => {
  const h = cabecalho.map((c) => chaveTexto(c));
  return h.includes('nacionalfederal') && h.includes('estadual') && h.includes('codigo');
};

export interface TabelaIbpt {
  porNcm: Map<string, { nacionalFederal: number; importadosFederal: number; estadual: number; municipal: number }>;
  versao: string;
  vigenciaFim: string;
}

const numeroIbpt = (v: string) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const lerTabelaIbpt = (cabecalho: string[], linhas: string[][]): TabelaIbpt => {
  const h = cabecalho.map((c) => chaveTexto(c));
  const col = (nome: string) => h.indexOf(nome);
  const iCod = col('codigo'); const iEx = col('ex'); const iTipo = col('tipo');
  const iNac = col('nacionalfederal'); const iImp = col('importadosfederal'); const iEst = col('estadual'); const iMun = col('municipal');
  const iVer = col('versao'); const iFim = col('vigenciafim');
  const porNcm: TabelaIbpt['porNcm'] = new Map();
  let versao = ''; let vigenciaFim = '';
  linhas.forEach((l) => {
    const tipo = iTipo >= 0 ? String(l[iTipo] ?? '').trim() : '0';
    const ex = iEx >= 0 ? String(l[iEx] ?? '').trim() : '';
    // Tipo 0 = NCM (1 e 2 sao servicos). Linha com "ex" e' excecao da TIPI: fica de fora.
    if (tipo !== '0' || ex) return;
    let ncm = soDigitos(String(l[iCod] ?? ''));
    if (ncm.length === 7) ncm = `0${ncm}`;
    if (ncm.length !== 8) return;
    porNcm.set(ncm, {
      nacionalFederal: numeroIbpt(l[iNac]),
      importadosFederal: iImp >= 0 ? numeroIbpt(l[iImp]) : numeroIbpt(l[iNac]),
      estadual: numeroIbpt(l[iEst]),
      municipal: iMun >= 0 ? numeroIbpt(l[iMun]) : 0,
    });
    if (!versao && iVer >= 0) versao = String(l[iVer] ?? '').trim();
    if (!vigenciaFim && iFim >= 0) vigenciaFim = String(l[iFim] ?? '').trim();
  });
  return { porNcm, versao, vigenciaFim };
};

/** Origem estrangeira (1, 2, 3, 8 e as de importacao 6/7) usa o percentual federal de importados. */
const origemImportada = (origem: string) => ['1', '2', '3', '6', '7', '8'].includes(String(origem ?? '').trim());

/**
 * Plano da tabela IBPT: cada produto com NCM na tabela recebe os tres
 * percentuais. Aqui SEMPRE substitui (tabela nova do IBPT e' atualizacao, nao
 * conflito) e zera o "total" avulso -- os tres separados passam a valer.
 */
export const planejarImportacaoIbpt = (args: {
  tabela: TabelaIbpt;
  produtos: ProdutoFiscalAtual[];
}): { resultados: ResultadoLinhaFiscal[]; resumo: ResumoFiscal } => {
  const resultados: ResultadoLinhaFiscal[] = args.produtos.map((produto, i) => {
    const linha = { linha: i + 1, codigo: produto.codigo, produto: produto.nome } as LinhaFiscal;
    const ncm = soDigitos(produto.ncm);
    const vazio = { linha, produto, grava: {}, mudancas: [] as MudancaFiscal[] };
    if (produto.inativo) return { ...vazio, status: 'erro' as const, problemas: [PROBLEMA_INATIVO] };
    if (ncm.length !== 8) {
      return { ...vazio, status: 'erro' as const, problemas: ['Produto sem NCM: cadastre o NCM para receber os percentuais do IBPT.'] };
    }
    const faixa = args.tabela.porNcm.get(ncm);
    if (!faixa) {
      return { ...vazio, status: 'erro' as const, problemas: [`O NCM ${ncm} não está na tabela do IBPT enviada (confira o NCM do produto).`] };
    }
    const novos: Partial<Record<CampoTributacao, number>> = {
      percentualTributosFederal: origemImportada(produto.origem || '') ? faixa.importadosFederal : faixa.nacionalFederal,
      percentualTributosEstadual: faixa.estadual,
      percentualTributosMunicipal: faixa.municipal,
    };
    const grava: ResultadoLinhaFiscal['grava'] = {};
    const mudancas: MudancaFiscal[] = [];
    (Object.keys(novos) as CampoTributacao[]).forEach((campo) => {
      const depois = String(Math.round(Number(novos[campo]) * 100) / 100);
      const antes = valorAtual(produto, campo);
      if (antes === depois) return;
      grava[campo] = Number(depois);
      mudancas.push({ campo, antes: String(produto[campo] ?? ''), depois, tipo: antes ? 'trocar' : 'preencher' });
    });
    if (mudancas.length > 0 && valorAtual(produto, 'percentualTributos')) {
      grava.percentualTributos = 0;
      mudancas.push({ campo: 'percentualTributos', antes: String(produto.percentualTributos ?? ''), depois: '0', tipo: 'trocar' });
    }
    return { linha, produto, grava, mudancas, problemas: [], status: mudancas.length > 0 ? 'atualizar' as const : 'sem_mudanca' as const };
  });
  return { resultados, resumo: resumir(resultados) };
};

const NOMES_CAMPOS: Record<CampoFiscal, string> = {
  codigo: 'Código',
  produto: 'Produto',
  codigoBarras: 'Código de barras',
  ncm: 'NCM',
  cest: 'CEST',
  cfop: 'CFOP',
  csosn: 'CSOSN/CST ICMS',
  cfopInterestadual: 'CFOP interestadual',
  csosnInterestadual: 'CSOSN/CST interestadual',
  origem: 'Origem',
  cstPis: 'CST PIS',
  cstCofins: 'CST COFINS',
  cstIpi: 'CST IPI',
  enquadramentoIpi: 'Enquadramento IPI',
  percentualTributosFederal: '% Tributos federais',
  percentualTributosEstadual: '% Tributos estaduais',
  percentualTributosMunicipal: '% Tributos municipais',
  percentualTributos: '% Tributos (total)',
};

export const nomeCampo = (campo: CampoFiscal): string => NOMES_CAMPOS[campo] || campo;

export const ROTULO_STATUS_FISCAL: Record<StatusLinhaFiscal, string> = {
  atualizar: 'Vai atualizar',
  sem_mudanca: 'Já está igual',
  conflito: 'Conflito',
  erro: 'Com problema',
  nao_encontrado: 'Produto não encontrado',
  ambiguo: 'Mais de um produto',
};

export const CABECALHO_MODELO_FISCAL = [
  'Código', 'Produto', 'Código de barras', 'NCM', 'CEST',
  'CFOP', 'CSOSN/CST ICMS', 'CFOP interestadual', 'CSOSN/CST interestadual', 'Origem', 'CST PIS', 'CST COFINS', 'CST IPI', 'Enquadramento IPI', '% Tributos',
];
