import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { normalizarCnpj } from './loginIdentidadeDomain';
import { LIMITE_ACESSO_MOBILE_PADRAO, lerLimiteDoPlano, mensagemLimiteDoApp } from './limitesDoPlanoDomain';

export { LIMITE_ACESSO_MOBILE_PADRAO };

/**
 * Acesso ao aplicativo mobile do vendedor externo (Usuarios ou Vendedores de
 * balcao, dependendo de qual cadastro a empresa usa -- ver
 * exigirIdentificacaoVendedor no AuthContext). E' contratado a parte, por
 * isso o padrao quando a empresa nao tem `limiteAcessoMobile` definido e'
 * FECHADO (0), ao contrario do limiteUsuarios (que cai pra 3). Ninguem tem
 * acesso mobile ate o suporte liberar no SuperAdmin.
 */

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
export const checarLimiteAcessoMobile = async (tenantId: string, registroTenantId: string = tenantId): Promise<ChecagemLimiteAcessoMobile> => {
  // O limite contratado mora no registro da empresa (cadastro do dono). Numa
  // filial (2026-10-06), e' o da MATRIZ do grupo -- o plano e' do grupo.
  const tenantSnap = await getDoc(doc(db, 'usuarios', registroTenantId));
  const limite = lerLimiteDoPlano(tenantSnap.exists() ? tenantSnap.data().limiteAcessoMobile : undefined, LIMITE_ACESSO_MOBILE_PADRAO);

  const usados = await contarAcessoMobileAtivo(tenantId);

  // Pre-checagem da tela (resposta rapida); quem confere de verdade e' o servidor (19/10/2026).
  if (usados >= limite) return { ok: false, motivo: mensagemLimiteDoApp(limite) };

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
