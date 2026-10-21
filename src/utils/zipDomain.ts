/*
 * ZIP SIMPLES (20/10/2026), para o pacote de XMLs do Relatorio do Contador.
 *
 * Gera um .zip valido "sem compressao" (metodo 0, store): XML e' texto e o
 * pacote de um mes fica em poucos MB -- nao vale trazer uma biblioteca nova so'
 * para isto. Nomes em UTF-8 (flag 0x0800), CRC-32 de cada arquivo, diretorio
 * central e registro final, como o formato PKZIP pede. Abre no Windows, no
 * 7-Zip e nos sistemas de contabilidade.
 *
 * Puro: recebe bytes, devolve bytes.
 */

export interface ArquivoDoZip {
  /** Caminho dentro do zip ("emitidas/NF-e 123.xml"). Sem barra no comeco. */
  nome: string;
  dados: Uint8Array;
}

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export const crc32 = (dados: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < dados.length; i += 1) crc = TABELA_CRC[(crc ^ dados[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** Data/hora no formato do DOS (o zip guarda assim). */
const dataDos = (d: Date): { hora: number; data: number } => ({
  hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  data: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

/** Nomes repetidos ganham " (2)", " (3)"... antes da extensao (o zip aceitaria, mas o Windows nao abre). */
export const nomesSemRepetir = (nomes: readonly string[]): string[] => {
  const vistos = new Map<string, number>();
  return nomes.map((nome) => {
    const chave = nome.toLowerCase();
    const vezes = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, vezes);
    if (vezes === 1) return nome;
    const ponto = nome.lastIndexOf('.');
    return ponto > nome.lastIndexOf('/') ? `${nome.slice(0, ponto)} (${vezes})${nome.slice(ponto)}` : `${nome} (${vezes})`;
  });
};

/** Tira o que o Windows nao aceita em nome de arquivo. */
export const nomeDeArquivoSeguro = (texto: string): string => Array.from(texto.normalize('NFC'))
  .filter((c) => c.charCodeAt(0) >= 32)
  .join('')
  .replace(/[<>:"\\/|?*]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120);

export const montarZip = (arquivos: readonly ArquivoDoZip[], quando = new Date()): Uint8Array<ArrayBuffer> => {
  const codificador = new TextEncoder();
  const { hora, data } = dataDos(quando);
  const nomes = nomesSemRepetir(arquivos.map((a) => a.nome.replace(/^\/+/, '')));
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;

  arquivos.forEach((arquivo, i) => {
    const nome = codificador.encode(nomes[i]);
    const crc = crc32(arquivo.dados);
    const tamanho = arquivo.dados.length;

    const local = new Uint8Array(30 + nome.length + tamanho);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true);
    vl.setUint16(4, 20, true);
    vl.setUint16(6, 0x0800, true);
    vl.setUint16(8, 0, true);
    vl.setUint16(10, hora, true);
    vl.setUint16(12, data, true);
    vl.setUint32(14, crc, true);
    vl.setUint32(18, tamanho, true);
    vl.setUint32(22, tamanho, true);
    vl.setUint16(26, nome.length, true);
    vl.setUint16(28, 0, true);
    local.set(nome, 30);
    local.set(arquivo.dados, 30 + nome.length);
    locais.push(local);

    const central = new Uint8Array(46 + nome.length);
    const vc = new DataView(central.buffer);
    vc.setUint32(0, 0x02014b50, true);
    vc.setUint16(4, 20, true);
    vc.setUint16(6, 20, true);
    vc.setUint16(8, 0x0800, true);
    vc.setUint16(10, 0, true);
    vc.setUint16(12, hora, true);
    vc.setUint16(14, data, true);
    vc.setUint32(16, crc, true);
    vc.setUint32(20, tamanho, true);
    vc.setUint32(24, tamanho, true);
    vc.setUint16(28, nome.length, true);
    vc.setUint32(42, deslocamento, true);
    central.set(nome, 46);
    centrais.push(central);

    deslocamento += local.length;
  });

  const tamanhoCentral = centrais.reduce((s, c) => s + c.length, 0);
  const fim = new Uint8Array(22);
  const vf = new DataView(fim.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, arquivos.length, true);
  vf.setUint16(10, arquivos.length, true);
  vf.setUint32(12, tamanhoCentral, true);
  vf.setUint32(16, deslocamento, true);

  const total = new Uint8Array(deslocamento + tamanhoCentral + fim.length);
  let pos = 0;
  for (const parte of [...locais, ...centrais, fim]) {
    total.set(parte, pos);
    pos += parte.length;
  }
  return total;
};
