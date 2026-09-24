/*
 * LEITOR DE XML SEM DEPENDENCIA DE NAVEGADOR (2026-09-24).
 *
 * A entrada de NF-e lia o XML com DOMParser, que so' existe no navegador: a
 * regra de leitura da nota ficava sem teste automatico. Este leitor pequeno
 * (o XML da NF-e e' regular: sem DTD, sem entidade propria) roda igual no
 * navegador e no teste, e ignora o prefixo de namespace (`nfe:infNFe`).
 */

export interface NoXml {
  /** Nome local da tag, sem prefixo de namespace. */
  nome: string;
  atributos: Record<string, string>;
  filhos: NoXml[];
  /** Texto direto do no (sem o dos filhos), ja decodificado e sem espacos nas pontas. */
  texto: string;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodificar = (texto: string): string => texto.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (inteiro, corpo: string) => {
  if (corpo[0] === '#') {
    const codigo = corpo[1] === 'x' || corpo[1] === 'X' ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10);
    return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteiro;
  }
  return ENTIDADES[corpo] ?? inteiro;
});

const semPrefixo = (nome: string): string => nome.slice(nome.indexOf(':') + 1);

const lerAtributos = (texto: string): Record<string, string> => {
  const atributos: Record<string, string> = {};
  const regex = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let achado: RegExpExecArray | null = regex.exec(texto);
  while (achado) {
    atributos[semPrefixo(achado[1])] = decodificar(achado[2] ?? achado[3] ?? '');
    achado = regex.exec(texto);
  }
  return atributos;
};

/** Le o XML e devolve a raiz. Lanca `Error` em portugues quando o arquivo nao e' XML valido. */
export const lerXml = (entrada: string): NoXml => {
  const xml = String(entrada ?? '').replace(/^\uFEFF/, '');
  const raiz: NoXml = { nome: '#raiz', atributos: {}, filhos: [], texto: '' };
  const pilha: NoXml[] = [raiz];
  const textos = new Map<NoXml, string[]>([[raiz, []]]);
  let posicao = 0;

  const invalido = (): never => { throw new Error('Formato do arquivo XML corrompido ou inválido.'); };

  while (posicao < xml.length) {
    const abre = xml.indexOf('<', posicao);
    if (abre === -1) {
      textos.get(pilha[pilha.length - 1])?.push(xml.slice(posicao));
      break;
    }
    if (abre > posicao) textos.get(pilha[pilha.length - 1])?.push(decodificar(xml.slice(posicao, abre)));

    if (xml.startsWith('<!--', abre)) {
      const fim = xml.indexOf('-->', abre + 4);
      if (fim === -1) invalido();
      posicao = fim + 3;
    } else if (xml.startsWith('<![CDATA[', abre)) {
      const fim = xml.indexOf(']]>', abre + 9);
      if (fim === -1) invalido();
      textos.get(pilha[pilha.length - 1])?.push(xml.slice(abre + 9, fim));
      posicao = fim + 3;
    } else if (xml.startsWith('<?', abre)) {
      const fim = xml.indexOf('?>', abre + 2);
      if (fim === -1) invalido();
      posicao = fim + 2;
    } else if (xml.startsWith('<!', abre)) {
      const fim = xml.indexOf('>', abre + 2);
      if (fim === -1) invalido();
      posicao = fim + 1;
    } else if (xml.startsWith('</', abre)) {
      const fim = xml.indexOf('>', abre + 2);
      if (fim === -1) invalido();
      const nome = semPrefixo(xml.slice(abre + 2, fim).trim());
      const atual = pilha[pilha.length - 1];
      if (pilha.length < 2 || atual.nome !== nome) invalido();
      atual.texto = (textos.get(atual) ?? []).join('').trim();
      pilha.pop();
      posicao = fim + 1;
    } else {
      // Tag de abertura: o `>` pode aparecer dentro de um valor de atributo entre aspas.
      let fim = abre + 1;
      let aspas = '';
      while (fim < xml.length) {
        const c = xml[fim];
        if (aspas) { if (c === aspas) aspas = ''; } else if (c === '"' || c === "'") aspas = c; else if (c === '>') break;
        fim += 1;
      }
      if (fim >= xml.length) invalido();
      let corpo = xml.slice(abre + 1, fim);
      const autoFechada = corpo.endsWith('/');
      if (autoFechada) corpo = corpo.slice(0, -1);
      const espaco = corpo.search(/\s/);
      const nomeBruto = (espaco === -1 ? corpo : corpo.slice(0, espaco)).trim();
      if (!nomeBruto) invalido();
      const no: NoXml = {
        nome: semPrefixo(nomeBruto),
        atributos: espaco === -1 ? {} : lerAtributos(corpo.slice(espaco)),
        filhos: [],
        texto: '',
      };
      pilha[pilha.length - 1].filhos.push(no);
      textos.set(no, []);
      if (!autoFechada) pilha.push(no);
      posicao = fim + 1;
    }
  }

  if (pilha.length !== 1) invalido();
  if (raiz.filhos.length !== 1) invalido();
  return raiz.filhos[0];
};

/** Primeiro filho direto com este nome. */
export const filho = (no: NoXml | undefined, nome: string): NoXml | undefined => no?.filhos.find((f) => f.nome === nome);

/** Todos os filhos diretos com este nome. */
export const filhos = (no: NoXml | undefined, nome: string): NoXml[] => (no ? no.filhos.filter((f) => f.nome === nome) : []);

/** Caminho de filhos: `caminho(no, 'total', 'ICMSTot')`. */
export const caminho = (no: NoXml | undefined, ...nomes: string[]): NoXml | undefined => (
  nomes.reduce<NoXml | undefined>((atual, nome) => filho(atual, nome), no)
);

/** Primeiro descendente (em qualquer profundidade) com este nome. */
export const descendente = (no: NoXml | undefined, nome: string): NoXml | undefined => {
  if (!no) return undefined;
  for (const f of no.filhos) {
    if (f.nome === nome) return f;
    const dentro = descendente(f, nome);
    if (dentro) return dentro;
  }
  return undefined;
};

/** Texto de um filho direto (ou de um caminho de filhos). Vazio se nao existir. */
export const textoDe = (no: NoXml | undefined, ...nomes: string[]): string => caminho(no, ...nomes)?.texto ?? '';

/** Numero de um filho; 0 quando ausente ou nao numerico. XML usa ponto decimal. */
export const numeroDe = (no: NoXml | undefined, ...nomes: string[]): number => {
  const valor = Number(textoDe(no, ...nomes));
  return Number.isFinite(valor) ? valor : 0;
};
