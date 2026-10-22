import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

/** Dados da filial que vao em cabecalho de documento (PDF de compras, convite ao fornecedor). */
export interface EmpresaResumo {
  nome: string;
  cnpj: string;
  telefone: string;
  endereco: string;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const carregarEmpresaResumo = async (tenantId: string): Promise<EmpresaResumo> => {
  try {
    const snap = await getDoc(doc(db, 'configuracoes', tenantId));
    const c = snap.exists() ? snap.data() : {};
    const endereco = [[texto(c.rua), texto(c.numero)].filter(Boolean).join(', '), texto(c.bairro), [texto(c.cidade) || texto(c.nfseCidadeNome), texto(c.uf) || texto(c.nfseCidadeEstado)].filter(Boolean).join('/')].filter(Boolean).join(' — ');
    return { nome: texto(c.nomeOficina) || texto(c.razaoSocial) || 'Empresa', cnpj: texto(c.cnpj), telefone: texto(c.telefone) || texto(c.whatsapp), endereco };
  } catch {
    return { nome: 'Empresa', cnpj: '', telefone: '', endereco: '' };
  }
};
