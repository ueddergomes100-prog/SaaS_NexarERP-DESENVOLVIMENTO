import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { normalizarCnpj } from './loginIdentidadeDomain';

/**
 * Acesso ao aplicativo mobile do vendedor externo (Usuarios ou Vendedores de
 * balcao, dependendo de qual cadastro a empresa usa -- ver
 * exigirIdentificacaoVendedor no AuthContext). E' contratado a parte, por
 * isso o padrao quando a empresa nao tem `limiteAcessoMobile` definido e'
 * FECHADO (0), ao contrario do limiteUsuarios (que cai pra 3). Ninguem tem
 * acesso mobile ate o suporte liberar no SuperAdmin.
 */
export const LIMITE_ACESSO_MOBILE_PADRAO = 0;

/** Quantos registros desta empresa (Usuario com login OU Vendedor de balcao)
 *  estao com o acesso mobile ligado agora. */
export const contarAcessoMobileAtivo = async (tenantId: string): Promise<number> => {
  const snap = await getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId)));
  return snap.docs.filter((documento) => documento.data().acessoAppMobile === true).length;
};

export interface ChecagemLimiteAcessoMobile {
  ok: boolean;
  motivo: string;
}

/**
 * Chame ANTES de gravar `acessoAppMobile: true` num registro que ainda nao
 * tinha o acesso ligado -- editar outros campos de quem ja tem acesso nao
 * precisa passar por aqui de novo, so a ativacao de uma vaga nova.
 */
export const checarLimiteAcessoMobile = async (tenantId: string): Promise<ChecagemLimiteAcessoMobile> => {
  const tenantSnap = await getDoc(doc(db, 'usuarios', tenantId));
  const limite = tenantSnap.exists() && tenantSnap.data().limiteAcessoMobile !== undefined
    ? tenantSnap.data().limiteAcessoMobile
    : LIMITE_ACESSO_MOBILE_PADRAO;

  const usados = await contarAcessoMobileAtivo(tenantId);

  if (usados >= limite) {
    const motivo = limite === 0
      ? 'Sua empresa ainda não tem o aplicativo mobile contratado. Fale com o suporte para contratar o acesso antes de liberar para alguém.'
      : `Sua empresa atingiu o limite de ${limite} acesso${limite === 1 ? '' : 's'} ao aplicativo mobile contratado${limite === 1 ? '' : 's'}. Fale com o suporte para aumentar o limite do seu plano.`;
    return { ok: false, motivo };
  }

  return { ok: true, motivo: '' };
};

/**
 * Chave do indice `vendedores_mobile_login/{chave}` -- o mesmo par que o
 * vendedor de balcao digita no login do app mobile (CNPJ da empresa +
 * codigo dele). Mesmo espirito de montarChaveUsername em
 * loginIdentidadeDomain.ts: UMA funcao so, usada na escrita do indice E
 * (replicada em JS puro) no backend que le pra logar -- ver
 * server/routes/vendedorMobileAuth.routes.js.
 */
export const montarChaveVendedorMobileLogin = (cnpj: unknown, codigoVendedor: unknown): string => {
  const cnpjLimpo = normalizarCnpj(cnpj);
  const codigo = String(codigoVendedor ?? '').trim();
  if (!cnpjLimpo || !codigo) return '';
  return `${cnpjLimpo}-${codigo}`;
};
