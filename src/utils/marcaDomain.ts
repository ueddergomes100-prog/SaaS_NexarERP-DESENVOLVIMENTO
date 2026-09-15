import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebase';
import { buildDocumentMetadata } from './documentMetadata';

/**
 * Garante que toda marca usada numa lista de produtos/materias-primas
 * exista no cadastro de Marcas -- cria as que faltarem, num unico batch.
 * Usado pelas telas de importacao em massa (Estoque/Materia-Prima) pra o
 * cadastro ja nascer completo, sem o usuario ter que digitar cada marca
 * de novo depois em Cadastros Auxiliares > Marcas.
 */
export const garantirMarcasCadastradas = async (
  nomesMarca: string[],
  tenantId: string,
  userId: string,
  timestamp: unknown,
): Promise<void> => {
  const nomesUnicos = Array.from(new Set(
    nomesMarca.map((nome) => nome.trim().toUpperCase()).filter(Boolean),
  ));
  if (nomesUnicos.length === 0) return;

  const snap = await getDocs(query(collection(db, 'marcas'), where('tenantId', '==', tenantId)));
  const existentes = new Set(snap.docs.map((d) => String(d.data().nome || '').toUpperCase()));

  const faltando = nomesUnicos.filter((nome) => !existentes.has(nome));
  if (faltando.length === 0) return;

  const batch = writeBatch(db);
  faltando.forEach((nome) => {
    const docRef = doc(collection(db, 'marcas'));
    batch.set(docRef, {
      nome,
      tenantId,
      createdAt: timestamp,
      ...buildDocumentMetadata(userId, timestamp),
    });
  });
  await batch.commit();
};
