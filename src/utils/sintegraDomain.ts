/**
 * Gerador do arquivo SINTEGRA (Convenio ICMS 57/95), registros de posicao
 * fixa (126 colunas cada). Cobre o conjunto minimo pra comercio varejista
 * comum: 10 (mestre do estabelecimento), 11 (complementar), 50 (nota
 * fiscal ICMS), 51 (total IPI, so quando ha IPI), 54 (item), 75 (produto)
 * e 90 (totalizacao). So NOTAS DE SAIDA (vendas) -- entrada/compra fica
 * de fora deste MVP (ver plano do modulo Utilitarios).
 *
 * IMPORTANTE: os campos foram levantados de fontes secundarias (o manual
 * oficial do Convenio 57/95 nao pode ser lido diretamente nesta sessao,
 * era um PDF binario ilegivel). O Registro 90 em especial tem uma cauda
 * de posicao com baixa confianca (documentada no codigo). Antes de usar
 * pra uma declaracao real, validar contra o Programa Validador SINTEGRA
 * oficial ou com um contador.
 */

export interface SintegraEmpresa {
  cnpj: string;
  inscricaoEstadual: string;
  nome: string;
  municipio: string;
  uf: string;
  rua: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cep: string;
  nomeContato?: string;
  telefone?: string;
}

export interface SintegraNotaItem {
  codigo: string;
  ncm: string;
  cfop: number;
  /** CST completo (origem + CST, 3 digitos) ou CSOSN (Simples Nacional, ja 3 digitos). */
  cst: string;
  quantidade: number;
  valorTotal: number;
  baseIcms?: number;
  valorIcms?: number;
  aliquotaIcms?: number;
  valorIpi?: number;
}

export interface SintegraNota {
  /** 55 = NF-e, 65 = NFC-e -- modelo eletronico usado direto como codigo do modelo. */
  modelo: 55 | 65;
  serie: string;
  numero: number;
  dataEmissao: string; // YYYY-MM-DD
  situacao: 'normal' | 'cancelada';
  itens: SintegraNotaItem[];
}

export interface SintegraProduto {
  codigo: string;
  ncm: string;
  descricao: string;
  unidade: string;
  aliquotaIcms?: number;
  aliquotaIpi?: number;
  reducaoBaseIcms?: number;
}

export interface SintegraPeriodo {
  dataInicial: string; // YYYY-MM-DD
  dataFinal: string; // YYYY-MM-DD
}

// Remove marcas diacriticas (acentos) apos normalizar em forma decomposta
// (NFD): cada caractere acentuado vira letra-base + marca de combinacao
// separada (codigo Unicode 0x0300-0x036F), que descartamos aqui.
const removeDiacritics = (value: string): string =>
  Array.from(value.normalize('NFD'))
    .filter((char) => {
      const code = char.codePointAt(0) || 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join('');

/** Campo numerico (N): so digitos, alinhado a direita, zero a esquerda. */
const padN = (value: string | number | undefined, length: number): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(-length).padStart(length, '0');
};

/** Campo alfanumerico (X): maiusculo, sem acento, alinhado a esquerda, espaco a direita. */
const padX = (value: string | undefined, length: number): string => {
  const clean = removeDiacritics(String(value ?? '').toUpperCase()).slice(0, length);
  return clean.padEnd(length, ' ');
};

const formatDateYYYYMMDD = (isoDate: string): string => isoDate.replace(/-/g, '');

/** Valores monetarios: reais -> centavos, sem ponto decimal. */
const centsField = (valueReais: number, length: number): string =>
  padN(Math.round((valueReais || 0) * 100), length);

/** Aliquotas/percentuais: 2 casas decimais implicitas (18,5% -> "1850"). */
const rateField = (percent: number | undefined, length: number): string =>
  padN(Math.round((percent || 0) * 100), length);

/** Quantidade: 3 casas decimais implicitas (convencao comum do layout). */
const quantityField = (value: number, length: number): string =>
  padN(Math.round((value || 0) * 1000), length);

const assertLength = (registro: string, tipo: string): string => {
  if (registro.length !== 126) {
    throw new Error(`Registro ${tipo} com tamanho invalido: ${registro.length} (esperado 126).`);
  }
  return registro;
};

const buildRegistro10 = (empresa: SintegraEmpresa, periodo: SintegraPeriodo): string => assertLength(
  '10' +
  padN(empresa.cnpj, 14) +
  padX(empresa.inscricaoEstadual, 14) +
  padX(empresa.nome, 35) +
  padX(empresa.municipio, 30) +
  padX(empresa.uf, 2) +
  padN('', 10) + // Fax -- nao coletado, zeros
  formatDateYYYYMMDD(periodo.dataInicial) +
  formatDateYYYYMMDD(periodo.dataFinal) +
  '0' + // Codigo da estrutura -- sem alteracao (simplificacao MVP)
  '0' + // Natureza das operacoes -- nenhuma sistematica diferenciada (simplificacao MVP)
  '0', // Finalidade do arquivo -- normal (simplificacao MVP)
  '10',
);

const buildRegistro11 = (empresa: SintegraEmpresa): string => assertLength(
  '11' +
  padX(empresa.rua, 34) +
  padN(empresa.numero, 5) +
  padX(empresa.complemento, 22) +
  padX(empresa.bairro, 15) +
  padN(empresa.cep, 8) +
  padX(empresa.nomeContato, 28) +
  padN(empresa.telefone, 12),
  '11',
);

interface GrupoCfopAliquota {
  cfop: number;
  aliquotaIcms: number;
  valorTotal: number;
  baseIcms: number;
  valorIcms: number;
}

/** Agrupa itens da nota por CFOP+aliquota -- o Registro 50 exige um
 * registro por combinacao, nao um por nota (regra confirmada em multiplas
 * fontes secundarias: "deve haver um registro 50 para cada CFOP e
 * aliquota que a nota tiver"). */
const agruparPorCfopEAliquota = (itens: SintegraNotaItem[]): GrupoCfopAliquota[] => {
  const grupos = new Map<string, GrupoCfopAliquota>();
  for (const item of itens) {
    const aliquota = item.aliquotaIcms || 0;
    const chave = `${item.cfop}-${aliquota}`;
    const atual = grupos.get(chave) || { cfop: item.cfop, aliquotaIcms: aliquota, valorTotal: 0, baseIcms: 0, valorIcms: 0 };
    atual.valorTotal += item.valorTotal || 0;
    atual.baseIcms += item.baseIcms || 0;
    atual.valorIcms += item.valorIcms || 0;
    grupos.set(chave, atual);
  }
  return Array.from(grupos.values());
};

const buildRegistro50 = (empresa: SintegraEmpresa, nota: SintegraNota, grupo: GrupoCfopAliquota): string => assertLength(
  '50' +
  padN(empresa.cnpj, 14) +
  padX(empresa.inscricaoEstadual, 14) +
  formatDateYYYYMMDD(nota.dataEmissao) +
  padX(empresa.uf, 2) +
  padN(nota.modelo, 2) +
  padX(nota.serie, 3) +
  padN(nota.numero, 6) +
  padN(grupo.cfop, 4) +
  'P' + // Emitente: "P" = proprio (nota de saida, emitida pelo tenant)
  centsField(grupo.valorTotal, 13) +
  centsField(grupo.baseIcms, 13) +
  centsField(grupo.valorIcms, 13) +
  centsField(0, 13) + // Isenta/nao-tributada -- nao discriminado nesta fatia
  centsField(0, 13) + // Outras -- nao discriminado nesta fatia
  rateField(grupo.aliquotaIcms, 4) +
  'N', // Situacao: "N" normal -- notas canceladas sao filtradas antes de chegar aqui (buildSintegraFile)
  '50',
);

const buildRegistro51 = (empresa: SintegraEmpresa, nota: SintegraNota): string => {
  const valorTotal = nota.itens.reduce((acc, item) => acc + (item.valorTotal || 0), 0);
  const valorIpi = nota.itens.reduce((acc, item) => acc + (item.valorIpi || 0), 0);
  return assertLength(
    '51' +
    padN(empresa.cnpj, 14) +
    padX(empresa.inscricaoEstadual, 14) +
    formatDateYYYYMMDD(nota.dataEmissao) +
    padX(empresa.uf, 2) +
    padX(nota.serie, 3) +
    padN(nota.numero, 6) +
    padN(nota.itens[0]?.cfop || 0, 4) +
    centsField(valorTotal, 13) +
    centsField(valorIpi, 13) +
    centsField(0, 13) + // Isenta/nao-tributada IPI -- nao discriminado
    centsField(0, 13) + // Outras IPI -- nao discriminado
    padX('', 20) + // Brancos
    'N', // Situacao normal
    '51',
  );
};

const buildRegistro54 = (empresa: SintegraEmpresa, nota: SintegraNota, item: SintegraNotaItem, numeroItem: number): string => assertLength(
  '54' +
  padN(empresa.cnpj, 14) +
  padN(nota.modelo, 2) +
  padX(nota.serie, 3) +
  padN(nota.numero, 6) +
  padN(item.cfop, 4) +
  padX(item.cst, 3) +
  padN(numeroItem, 3) +
  padX(item.codigo, 14) +
  quantityField(item.quantidade, 11) +
  centsField(item.valorTotal, 12) +
  centsField(0, 12) + // Desconto/despesa acessoria -- nao discriminado nesta fatia
  centsField(item.baseIcms || 0, 12) +
  centsField(0, 12) + // Base ICMS-ST -- fora de escopo (sem substituicao tributaria no MVP)
  centsField(item.valorIpi || 0, 12) +
  rateField(item.aliquotaIcms, 4),
  '54',
);

const buildRegistro75 = (produto: SintegraProduto, periodo: SintegraPeriodo): string => assertLength(
  '75' +
  formatDateYYYYMMDD(periodo.dataInicial) +
  formatDateYYYYMMDD(periodo.dataFinal) +
  padX(produto.codigo, 14) +
  padX(produto.ncm, 8) +
  padX(produto.descricao, 53) +
  padX(produto.unidade || 'UN', 6) +
  rateField(produto.aliquotaIpi, 5) +
  rateField(produto.aliquotaIcms, 4) +
  rateField(produto.reducaoBaseIcms, 5) +
  centsField(0, 13), // Base de calculo ICMS-ST -- fora de escopo (sem ST no MVP)
  '75',
);

/**
 * Registro 90 (totalizacao) -- BAIXA CONFIANCA na cauda de posicao (46 a
 * 125): as fontes secundarias consultadas nao deixaram claro o
 * preenchimento exato dessa faixa. Implementado como bloco de brancos +
 * um digito final fixo em "0", preenchendo o tamanho certo (126), mas
 * ISSO PRECISA SER CONFIRMADO contra o manual oficial ou o Programa
 * Validador SINTEGRA antes de qualquer entrega real.
 */
const buildRegistro90 = (empresa: SintegraEmpresa, tipoATotalizar: string, totalRegistros: number): string => assertLength(
  '90' +
  padN(empresa.cnpj, 14) +
  padX(empresa.inscricaoEstadual, 14) +
  padN(tipoATotalizar, 2) +
  padN(totalRegistros, 8) +
  padX('', 85) +
  '0',
  '90',
);

/**
 * Monta o arquivo SINTEGRA completo (registros concatenados, um por
 * linha, separados por CRLF). So notas de SAIDA (vendas) com `itens`
 * preenchidos -- notas sem snapshot fiscal (emitidas antes da Fatia 0
 * do plano de Utilitarios) devem ser filtradas pelo chamador antes de
 * passar aqui.
 */
export const buildSintegraFile = (
  empresa: SintegraEmpresa,
  notas: SintegraNota[],
  produtos: SintegraProduto[],
  periodo: SintegraPeriodo,
): string => {
  const linhas: string[] = [buildRegistro10(empresa, periodo), buildRegistro11(empresa)];
  const contagem: Record<string, number> = { '10': 1, '11': 1 };

  const notasValidas = notas.filter((nota) => nota.situacao !== 'cancelada' && nota.itens.length > 0);

  for (const nota of notasValidas) {
    const grupos = agruparPorCfopEAliquota(nota.itens);
    for (const grupo of grupos) {
      linhas.push(buildRegistro50(empresa, nota, grupo));
      contagem['50'] = (contagem['50'] || 0) + 1;
    }

    const temIpi = nota.itens.some((item) => (item.valorIpi || 0) > 0);
    if (temIpi) {
      linhas.push(buildRegistro51(empresa, nota));
      contagem['51'] = (contagem['51'] || 0) + 1;
    }

    nota.itens.forEach((item, index) => {
      linhas.push(buildRegistro54(empresa, nota, item, index + 1));
      contagem['54'] = (contagem['54'] || 0) + 1;
    });
  }

  const produtosUnicos = Array.from(new Map(produtos.map((p) => [p.codigo, p])).values());
  for (const produto of produtosUnicos) {
    linhas.push(buildRegistro75(produto, periodo));
    contagem['75'] = (contagem['75'] || 0) + 1;
  }

  for (const [tipo, quantidade] of Object.entries(contagem)) {
    linhas.push(buildRegistro90(empresa, tipo, quantidade));
  }
  linhas.push(buildRegistro90(empresa, '90', Object.keys(contagem).length + 1));

  return linhas.join('\r\n') + '\r\n';
};
