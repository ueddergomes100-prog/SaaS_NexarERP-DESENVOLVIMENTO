import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from './firebase';
import {
  escolherCadastroDoCliente,
  idDoClienteDoDocumento,
  nomeDoClienteDoDocumento,
  type ReferenciaDoCliente,
} from '../utils/clienteDoDocumentoDomain';

/**
 * Cadastro do cliente para o cabecalho de pedido, orcamento ou OS impresso
 * (23/11/2026). Pelo clienteId que o documento guardou; pelo nome so' quando
 * nao ha' id e o nome e' unico. Regra em clienteDoDocumentoDomain.ts.
 *
 * Nao achar o cadastro nao trava a impressao: devolve null e o cabecalho sai
 * so' com o nome que o documento guardou.
 */
export async function buscarClienteDoDocumento(
  tenantId: string,
  documento: ReferenciaDoCliente | null | undefined,
): Promise<any | null> {
  const id = idDoClienteDoDocumento(documento);
  let porId: any | null = null;
  if (id) {
    try {
      const snap = await getDoc(doc(db, 'clientes', id));
      if (snap.exists()) porId = snap.data();
    } catch (error) {
      // Cadastro de outra empresa ou sem permissao: segue para o nome.
      console.error('Erro ao buscar o cliente do documento pelo id:', error);
    }
  }
  if (porId && porId.tenantId === tenantId) return porId;

  const nome = nomeDoClienteDoDocumento(documento);
  if (!nome) return null;
  // limit(2): basta saber se ha' mais de um com o mesmo nome.
  const snapNome = await getDocs(query(
    collection(db, 'clientes'),
    where('tenantId', '==', tenantId),
    where('nome', '==', nome),
    limit(2),
  ));
  return escolherCadastroDoCliente({ tenantId, porId, porNome: snapNome.docs.map((d) => d.data()) });
}
