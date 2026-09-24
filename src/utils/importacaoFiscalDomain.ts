/*
 * IMPORTACAO DE DADOS FISCAIS DO PRODUTO (codigo de barras, NCM e CEST).
 *
 * Pedido do dono (2026-09-24), implantacao da Sol Life: os produtos entraram
 * sem codigo de barras/NCM/CEST e os dados existem no ERP antigo. Esta
 * importacao ATUALIZA produtos que ja existem -- nunca cria produto.
 *
 * Regras que protegem o cadastro:
 *  - celula vazia na planilha NUNCA apaga o que o produto ja tem;
 *  - valor ja preenchido e diferente NAO e' trocado sem o usuario marcar
 *    "sobrescrever" -- aparece como conflito, com os dois valores;
 *  - valor invalido (codigo de barras que nao fecha o digito verificador,
 *    NCM/CEST com tamanho errado) e' ignorado e explicado, o resto da linha
 *    continua valendo;
 *  - o MESMO codigo de barras em dois produtos e' recusado: o leitor do PDV
 *    nao saberia qual vender.
 *
 * Este arquivo e' so' a parte pura (leitura das linhas, validacao e plano).
 * A leitura do arquivo e a gravacao ficam em pages/Estoque/ImportarDadosFiscais.
 */

export type CampoFiscal = 'codigo' | 'produto' | 'codigoBarras' | 'ncm' | 'cest';
export type MapeamentoFiscal = Record<CampoFiscal, number | null>;

const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
const chaveTexto = (texto: string) => semAcento(String(texto ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Chave de comparacao de NOME: sem acento, caixa, hifen/aspas/espaco duplo nao diferenciam. */
export const chaveNomeProduto = (nome: string): string => (
  semAcento(String(nome ?? '')).toUpperCase().replace(/[^A-Z0-9/%,.]+/g, ' ').replace(/\s+/g, ' ').trim()
);

export const inferirMapeamentoFiscal = (cabecalho: string[]): MapeamentoFiscal => {
  const mapa: MapeamentoFiscal = { codigo: null, produto: null, codigoBarras: null, ncm: null, cest: null };
  const usados = new Set<number>();
  const achar = (teste: (h: string) => boolean): number | null => {
    const indice = cabecalho.findIndex((h, i) => !usados.has(i) && teste(chaveTexto(h)));
    if (indice >= 0) usados.add(indice);
    return indice >= 0 ? indice : null;
  };
  // Ordem importa: "Codigo de barras" nao pode virar o "Codigo" do produto.
  mapa.codigoBarras = achar((h) => /barra|\bean\b|gtin/.test(h));
  mapa.ncm = achar((h) => /^ncm/.test(h));
  mapa.cest = achar((h) => /^cest/.test(h));
  mapa.produto = achar((h) => /produto|descri|^nome/.test(h));
  mapa.codigo = achar((h) => /^(codigo|cod|id)( do produto)?$/.test(h) || /^codigo\b/.test(h));
  return mapa;
};

export interface LinhaFiscal {
  /** Linha no arquivo (cabecalho = 1), para mensagens. */
  linha: number;
  codigo: string;
  produto: string;
  codigoBarras: string;
  ncm: string;
  cest: string;
}

export const lerLinhasFiscais = (linhas: string[][], mapa: MapeamentoFiscal): LinhaFiscal[] => {
  const celula = (l: string[], indice: number | null) => (indice === null ? '' : String(l[indice] ?? '').trim());
  const saida: LinhaFiscal[] = [];
  linhas.forEach((l, i) => {
    const linha: LinhaFiscal = {
      linha: i + 2,
      codigo: celula(l, mapa.codigo),
      produto: celula(l, mapa.produto),
      codigoBarras: celula(l, mapa.codigoBarras),
      ncm: celula(l, mapa.ncm),
      cest: celula(l, mapa.cest),
    };
    if (linha.codigo || linha.produto || linha.codigoBarras || linha.ncm || linha.cest) saida.push(linha);
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

// ---------------------------------------------------------------------------
// Plano: o que sera gravado, produto a produto.
// ---------------------------------------------------------------------------

export interface ProdutoFiscalAtual {
  id: string;
  codigo: string;
  nome: string;
  codigoBarras: string;
  ncm: string;
  cest: string;
  /** Codigos de barras das embalagens: tambem contam como "ja usado". */
  embalagensBarras: string[];
}

export type StatusLinhaFiscal = 'atualizar' | 'sem_mudanca' | 'conflito' | 'erro' | 'nao_encontrado' | 'ambiguo';

export interface MudancaFiscal {
  campo: 'codigoBarras' | 'ncm' | 'cest';
  antes: string;
  depois: string;
  tipo: 'preencher' | 'trocar';
}

export interface ResultadoLinhaFiscal {
  linha: LinhaFiscal;
  status: StatusLinhaFiscal;
  produto: ProdutoFiscalAtual | null;
  /** Campos que vao para o produto. So' tem chave do que muda. */
  grava: Partial<Record<'codigoBarras' | 'ncm' | 'cest', string>>;
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

export const planejarImportacaoFiscal = (args: {
  linhas: LinhaFiscal[];
  produtos: ProdutoFiscalAtual[];
  sobrescrever: boolean;
}): { resultados: ResultadoLinhaFiscal[]; resumo: ResumoFiscal } => {
  const { linhas, produtos, sobrescrever } = args;

  const porCodigo = new Map<string, ProdutoFiscalAtual[]>();
  const porNome = new Map<string, ProdutoFiscalAtual[]>();
  produtos.forEach((p) => {
    const codigo = semZerosEsquerda(String(p.codigo || '').trim());
    if (codigo) porCodigo.set(codigo, [...(porCodigo.get(codigo) || []), p]);
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

  // 1a passada: achar o produto de cada linha e o codigo de barras normalizado.
  interface Preparada {
    linha: LinhaFiscal;
    produto: ProdutoFiscalAtual | null;
    achado: 'ok' | 'nao_encontrado' | 'ambiguo';
    problemas: string[];
    barras: CampoNormalizado;
    ncm: CampoNormalizado;
    cest: CampoNormalizado;
  }
  const preparadas: Preparada[] = linhas.map((linha) => {
    const problemas: string[] = [];
    let produto: ProdutoFiscalAtual | null = null;
    let achado: Preparada['achado'] = 'nao_encontrado';
    const codigo = semZerosEsquerda(linha.codigo);
    if (codigo) {
      const candidatos = porCodigo.get(codigo) || [];
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
    return { linha, produto, achado, problemas, barras: normalizarCodigoBarras(linha.codigoBarras), ncm: normalizarNcm(linha.ncm), cest: normalizarCest(linha.cest) };
  });

  // 2a: o mesmo codigo de barras em dois produtos DENTRO do arquivo.
  const linhasPorBarra = new Map<string, Preparada[]>();
  preparadas.forEach((p) => {
    if (p.produto && p.barras.valor) linhasPorBarra.set(p.barras.valor, [...(linhasPorBarra.get(p.barras.valor) || []), p]);
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

    [p.barras, p.ncm, p.cest].forEach((c) => { if (c.erro) { problemas.push(c.erro); bloqueios += 1; } });

    const decidir = (campo: MudancaFiscal['campo'], novo: string, atual: string) => {
      if (!novo) return null;
      if (novo === atual) return null;
      if (!atual) return 'preencher' as const;
      if (sobrescrever) return 'trocar' as const;
      conflitos += 1;
      problemas.push(`${nomeCampo(campo)} já preenchido (${atual}) e diferente da planilha (${novo}). Marque "sobrescrever" para trocar.`);
      return null;
    };

    // codigo de barras
    let barras = p.barras.valor;
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
    const tipoBarras = decidir('codigoBarras', barras, soDigitos(produto.codigoBarras));
    if (tipoBarras) { grava.codigoBarras = barras; mudancas.push({ campo: 'codigoBarras', antes: produto.codigoBarras, depois: barras, tipo: tipoBarras }); }

    const tipoNcm = decidir('ncm', p.ncm.valor, soDigitos(produto.ncm));
    if (tipoNcm) { grava.ncm = p.ncm.valor; mudancas.push({ campo: 'ncm', antes: produto.ncm, depois: p.ncm.valor, tipo: tipoNcm }); }

    const tipoCest = decidir('cest', p.cest.valor, soDigitos(produto.cest));
    if (tipoCest) { grava.cest = p.cest.valor; mudancas.push({ campo: 'cest', antes: produto.cest, depois: p.cest.valor, tipo: tipoCest }); }

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

  const conta = (s: StatusLinhaFiscal) => resultados.filter((r) => r.status === s).length;
  return {
    resultados,
    resumo: {
      total: resultados.length,
      atualizar: conta('atualizar'),
      semMudanca: conta('sem_mudanca'),
      conflito: conta('conflito'),
      erro: conta('erro'),
      naoEncontrado: conta('nao_encontrado'),
      ambiguo: conta('ambiguo'),
      comAviso: resultados.filter((r) => r.status === 'atualizar' && r.problemas.length > 0).length,
    },
  };
};

export const nomeCampo = (campo: MudancaFiscal['campo'] | CampoFiscal): string => (
  campo === 'codigoBarras' ? 'Código de barras' : campo === 'ncm' ? 'NCM' : campo === 'cest' ? 'CEST' : campo === 'produto' ? 'Produto' : 'Código'
);

export const ROTULO_STATUS_FISCAL: Record<StatusLinhaFiscal, string> = {
  atualizar: 'Vai atualizar',
  sem_mudanca: 'Já está igual',
  conflito: 'Conflito',
  erro: 'Com problema',
  nao_encontrado: 'Produto não encontrado',
  ambiguo: 'Mais de um produto',
};

export const CABECALHO_MODELO_FISCAL = ['Código', 'Produto', 'Código de barras', 'NCM', 'CEST'];
