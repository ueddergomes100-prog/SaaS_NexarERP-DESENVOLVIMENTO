// Checagem de CPF/CNPJ duplicado no cadastro de cliente. Usado tanto no
// cadastro completo (ClienteForm.tsx) quanto no popup rapido de venda
// (CadastroRapidoClienteModal.tsx) -- os dois pontos onde hoje da pra
// cadastrar um cliente com documento repetido sem nenhum aviso.
//
// Busca so por tenantId (sem where composto em "documento") de proposito:
// mesmo padrao ja usado em ImportarClientes.tsx, evita depender de indice
// composto novo no Firestore. A base de clientes por tenant e pequena o
// suficiente pra filtrar do lado do cliente.

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { apenasDigitos } from './documentoValidacao';

export interface ClienteDocumentoDuplicado {
  id: string;
  nome: string;
}

export const buscarClienteDuplicadoPorDocumento = async (
  tenantId: string,
  documentoBruto: string,
  idParaIgnorar?: string
): Promise<ClienteDocumentoDuplicado | null> => {
  const digitos = apenasDigitos(documentoBruto);
  if (!digitos) return null;

  const snap = await getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId)));
  for (const docSnap of snap.docs) {
    if (docSnap.id === idParaIgnorar) continue;
    const data = docSnap.data() as { documento?: string; nome?: string };
    if (apenasDigitos(data.documento || '') === digitos) {
      return { id: docSnap.id, nome: data.nome || 'Cliente sem nome' };
    }
  }
  return null;
};
