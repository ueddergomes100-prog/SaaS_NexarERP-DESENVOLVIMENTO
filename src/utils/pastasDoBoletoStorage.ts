import { chaveDoArquivo, lembrarArquivos, type ArquivoDaPasta, type TipoDePasta } from './pastasDoBoletoDomain';

/**
 * Onde o computador guarda as pastas dos boletos (25/11/2026). A pasta escolhida
 * (um "handle" do navegador) e a lista dos retornos ja' vistos ficam no banco
 * interno do navegador deste computador, por empresa. Nada vai para o servidor:
 * a pasta e' deste computador. Regras em pastasDoBoletoDomain.ts.
 *
 * Nada aqui derruba a tela: navegador sem suporte ou sem armazenamento so'
 * significa que a funcao nao aparece / nao lembra.
 */

type Permissao = 'granted' | 'prompt' | 'denied';

interface PastaComPermissao {
  name: string;
  queryPermission?: (opcoes: { mode: 'read' | 'readwrite' }) => Promise<Permissao>;
  requestPermission?: (opcoes: { mode: 'read' | 'readwrite' }) => Promise<Permissao>;
  values?: () => AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> }>;
  getFileHandle?: (nome: string, opcoes: { create: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (dado: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

const BANCO = 'hennder-boletos';
const TABELA = 'pastas';

/** O navegador deixa escolher pasta? (Chrome e Edge no computador, sim.) */
export const suportaPastas = (): boolean => typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

const abrirBanco = (): Promise<IDBDatabase | null> => new Promise((resolve) => {
  try {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const pedido = indexedDB.open(BANCO, 1);
    pedido.onupgradeneeded = () => { pedido.result.createObjectStore(TABELA); };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => resolve(null);
    pedido.onblocked = () => resolve(null);
  } catch {
    resolve(null);
  }
});

const noBanco = async <T>(modo: IDBTransactionMode, acao: (t: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const banco = await abrirBanco();
  if (!banco) return null;
  return new Promise((resolve) => {
    try {
      const pedido = acao(banco.transaction(TABELA, modo).objectStore(TABELA));
      pedido.onsuccess = () => { resolve((pedido.result ?? null) as T | null); banco.close(); };
      pedido.onerror = () => { resolve(null); banco.close(); };
    } catch {
      resolve(null);
      banco.close();
    }
  });
};

const chavePasta = (tipo: TipoDePasta, tenantId: string) => `${tipo}:${tenantId}`;
const chaveVistos = (tenantId: string) => `retornosVistos:${tenantId}`;

export const lerPasta = async (tipo: TipoDePasta, tenantId: string): Promise<PastaComPermissao | null> => (
  (await noBanco<PastaComPermissao>('readonly', (t) => t.get(chavePasta(tipo, tenantId)) as IDBRequest<PastaComPermissao>)) || null
);

/** Abre o seletor de pasta do Windows. Precisa vir do clique da pessoa. null = desistiu. */
export const escolherPasta = async (tipo: TipoDePasta, tenantId: string): Promise<PastaComPermissao | null> => {
  const seletor = (window as unknown as { showDirectoryPicker: (o: { id: string; mode: 'read' | 'readwrite' }) => Promise<PastaComPermissao> }).showDirectoryPicker;
  try {
    const pasta = await seletor({ id: `hennder-${tipo}`, mode: tipo === 'remessa' ? 'readwrite' : 'read' });
    await noBanco('readwrite', (t) => t.put(pasta, chavePasta(tipo, tenantId)));
    return pasta;
  } catch {
    return null;
  }
};

export const esquecerPasta = async (tipo: TipoDePasta, tenantId: string): Promise<void> => {
  await noBanco('readwrite', (t) => t.delete(chavePasta(tipo, tenantId)));
};

const modoDa = (tipo: TipoDePasta): 'read' | 'readwrite' => (tipo === 'remessa' ? 'readwrite' : 'read');

/** Situacao da liberacao (sem perguntar nada). */
export const permissaoDaPasta = async (pasta: PastaComPermissao | null, tipo: TipoDePasta): Promise<Permissao | null> => {
  if (!pasta || !pasta.queryPermission) return null;
  try { return await pasta.queryPermission({ mode: modoDa(tipo) }); } catch { return null; }
};

/** Pede a liberacao (precisa vir do clique da pessoa). */
export const liberarPasta = async (pasta: PastaComPermissao | null, tipo: TipoDePasta): Promise<Permissao | null> => {
  if (!pasta || !pasta.requestPermission) return null;
  try { return await pasta.requestPermission({ mode: modoDa(tipo) }); } catch { return null; }
};

/** Grava o arquivo na pasta (ja' liberada). Falha = false, e a tela baixa do jeito normal. */
export const gravarNaPasta = async (pasta: PastaComPermissao, nome: string, conteudo: Blob): Promise<boolean> => {
  try {
    if (!pasta.getFileHandle) return false;
    const arquivo = await pasta.getFileHandle(nome, { create: true });
    const escrita = await arquivo.createWritable();
    await escrita.write(conteudo);
    await escrita.close();
    return true;
  } catch {
    return false;
  }
};

/** Arquivos da pasta (so' o primeiro nivel). Sem liberacao ou com erro = lista vazia. */
export const arquivosDaPasta = async (pasta: PastaComPermissao): Promise<File[]> => {
  const arquivos: File[] = [];
  try {
    if (!pasta.values) return arquivos;
    for await (const item of pasta.values()) {
      if (item.kind === 'file' && item.getFile) arquivos.push(await item.getFile());
    }
  } catch {
    return [];
  }
  return arquivos;
};

export const retornosJaVistos = async (tenantId: string): Promise<Set<string>> => {
  const lista = await noBanco<string[]>('readonly', (t) => t.get(chaveVistos(tenantId)) as IDBRequest<string[]>);
  return new Set(Array.isArray(lista) ? lista : []);
};

/** Marca retornos como vistos (importados ou dispensados) neste computador. */
export const marcarRetornosVistos = async (tenantId: string, arquivos: ArquivoDaPasta[]): Promise<void> => {
  const atual = await noBanco<string[]>('readonly', (t) => t.get(chaveVistos(tenantId)) as IDBRequest<string[]>);
  const novos = arquivos.map(chaveDoArquivo);
  await noBanco('readwrite', (t) => t.put(lembrarArquivos(Array.isArray(atual) ? atual : [], novos), chaveVistos(tenantId)));
};

export type { PastaComPermissao, Permissao };
