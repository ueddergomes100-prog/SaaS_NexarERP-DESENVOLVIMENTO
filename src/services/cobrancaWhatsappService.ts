import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { getDateInputInTimeZone } from '../utils/dateTime';
import { whatsappDoCliente } from '../utils/cobrancaWhatsappDomain';

/*
 * Dados que a cobranca pelo WhatsApp do app precisa e a lista nao traz
 * (28/11/2026): o celular do cliente e o dia de cada compra. Lidos so' quando
 * o vendedor abre o cliente na lista -- assim o toque no botao ja' abre o
 * WhatsApp na hora (o navegador do celular barra janela aberta depois de espera).
 */

export interface DadosDaCobranca {
  /** 55 + DDD + numero, ou null quando o cadastro nao tem celular/telefone com DDD. */
  whatsapp: string | null;
  /** pedidoId -> AAAA-MM-DD da venda. */
  datasDasCompras: Record<string, string>;
}

const MAX_PEDIDOS_LIDOS = 30;

const dataDoCampo = (valor: unknown): string => {
  if (typeof valor === 'string') return /^\d{4}-\d{2}-\d{2}/.test(valor) ? valor.slice(0, 10) : '';
  if (valor && typeof (valor as { toDate?: unknown }).toDate === 'function') {
    return getDateInputInTimeZone((valor as { toDate: () => Date }).toDate());
  }
  return '';
};

export const carregarDadosDaCobranca = async (clienteId: string, pedidoIds: string[]): Promise<DadosDaCobranca> => {
  const ids = [...new Set(pedidoIds.filter(Boolean))].slice(0, MAX_PEDIDOS_LIDOS);
  const [cliente, pedidos] = await Promise.all([
    clienteId ? getDoc(doc(db, 'clientes', clienteId)).catch(() => null) : Promise.resolve(null),
    Promise.all(ids.map((id) => getDoc(doc(db, 'pedidos_venda', id)).catch(() => null))),
  ]);
  const datasDasCompras: Record<string, string> = {};
  pedidos.forEach((snap) => {
    if (!snap || !snap.exists()) return;
    const p = snap.data();
    const data = dataDoCampo(p.dataVenda) || dataDoCampo(p.createdAt);
    if (data) datasDasCompras[snap.id] = data;
  });
  return {
    whatsapp: cliente && cliente.exists() ? whatsappDoCliente(cliente.data()) : null,
    datasDasCompras,
  };
};
