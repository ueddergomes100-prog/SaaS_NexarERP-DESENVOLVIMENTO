import type { Pendencia, TipoPendencia } from './offlineDomain';

/*
 * FILA OFFLINE NO APARELHO (app do tecnico, fase 4 -- 2026-10-08).
 *
 * IndexedDB puro (sem biblioteca): um banco, uma tabela `pendencias`, com o
 * Blob da foto/assinatura guardado junto. O que entra aqui e' so' o que o
 * Firestore nao faz sozinho offline (numero da OS, reserva de estoque,
 * arquivos) -- ver offlineDomain.ts. Quem le e envia e'
 * services/sincronizacaoOfflineService.ts.
 *
 * localStorage nao serve: foto de 300 KB em base64 estoura o limite em
 * poucas fotos. IndexedDB guarda Blob direto.
 */

export type PendenciaGuardada = Pendencia & { blob?: Blob };

const NOME_BANCO = 'hennder-offline';
const VERSAO = 1;
const TABELA = 'pendencias';

const ouvintes = new Set<() => void>();
const avisar = () => { ouvintes.forEach((f) => { try { f(); } catch { /* ouvinte nao derruba a fila */ } }); };

/** Avisa quando a fila muda (nesta aba), para a tela atualizar o contador. */
export const assinarFilaOffline = (ouvinte: () => void): (() => void) => {
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
};

export const filaOfflineDisponivel = (): boolean => typeof indexedDB !== 'undefined';

const abrir = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!filaOfflineDisponivel()) {
    reject(new Error('Este navegador não guarda dados sem conexão. Use o app instalado (Chrome ou Safari) para trabalhar offline.'));
    return;
  }
  const pedido = indexedDB.open(NOME_BANCO, VERSAO);
  pedido.onupgradeneeded = () => {
    const db = pedido.result;
    if (!db.objectStoreNames.contains(TABELA)) {
      const tabela = db.createObjectStore(TABELA, { keyPath: 'id' });
      tabela.createIndex('porUsuario', ['tenantId', 'usuarioId'], { unique: false });
      tabela.createIndex('porOs', 'osId', { unique: false });
    }
  };
  pedido.onsuccess = () => resolve(pedido.result);
  pedido.onerror = () => reject(pedido.error || new Error('Não foi possível abrir o armazenamento do aparelho.'));
});

const pedir = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('Falha ao ler o armazenamento do aparelho.'));
});

const comTabela = async <T>(modo: IDBTransactionMode, acao: (tabela: IDBObjectStore) => Promise<T>): Promise<T> => {
  const db = await abrir();
  try {
    const tx = db.transaction(TABELA, modo);
    const resultado = await acao(tx.objectStore(TABELA));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Falha ao gravar no armazenamento do aparelho.'));
      tx.onabort = () => reject(tx.error || new Error('Gravação no aparelho cancelada.'));
    });
    return resultado;
  } finally {
    db.close();
  }
};

export const novoIdPendencia = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const adicionarPendencia = async (p: PendenciaGuardada): Promise<void> => {
  await comTabela('readwrite', async (tabela) => { await pedir(tabela.put(p)); });
  avisar();
};

export const listarPendencias = async (tenantId: string, usuarioId: string): Promise<PendenciaGuardada[]> => {
  if (!filaOfflineDisponivel()) return [];
  return comTabela('readonly', async (tabela) => {
    const todas = await pedir(tabela.index('porUsuario').getAll(IDBKeyRange.only([tenantId, usuarioId])));
    return todas as PendenciaGuardada[];
  }).catch(() => []);
};

export const listarPendenciasDaOs = async (osId: string): Promise<PendenciaGuardada[]> => {
  if (!filaOfflineDisponivel()) return [];
  return comTabela('readonly', async (tabela) => (await pedir(tabela.index('porOs').getAll(IDBKeyRange.only(osId)))) as PendenciaGuardada[]).catch(() => []);
};

export const existePendencia = async (osId: string, tipo: TipoPendencia): Promise<boolean> => (
  (await listarPendenciasDaOs(osId)).some((p) => p.tipo === tipo)
);

export const atualizarPendencia = async (id: string, parte: Partial<Pendencia>): Promise<void> => {
  await comTabela('readwrite', async (tabela) => {
    const atual = (await pedir(tabela.get(id))) as PendenciaGuardada | undefined;
    if (!atual) return;
    await pedir(tabela.put({ ...atual, ...parte }));
  });
  avisar();
};

export const removerPendencia = async (id: string): Promise<void> => {
  await comTabela('readwrite', async (tabela) => { await pedir(tabela.delete(id)); });
  avisar();
};
