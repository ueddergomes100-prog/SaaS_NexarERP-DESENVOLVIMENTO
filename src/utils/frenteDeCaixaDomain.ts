/*
 * FRENTE DE CAIXA COMO APP SEPARADO (pedido do dono, 19/10/2026).
 *
 * O PDV (src/pages/PDV/PDV.tsx) passa a abrir tambem sozinho, em /caixa,
 * do mesmo jeito que o app do vendedor abre em /vendedor: entrada HTML
 * propria (caixa.html, instalavel), login proprio com o MESMO usuario e
 * senha do sistema e sem a seta de voltar -- o sistema completo fica em
 * outra aba, se precisar.
 *
 * Quem entra:
 *  - quem ja' usa o PDV dentro do sistema ("Vendas: Frente de Caixa (PDV)");
 *  - o funcionario caixa, com a permissao "Vendas: So' a Frente de Caixa":
 *    para ele o login (no sistema ou no app) cai DIRETO no caixa, e o resto
 *    do sistema nao aparece.
 * Dono, administrador e gestor da plataforma nunca ficam presos ao caixa.
 *
 * O app do caixa NAO entra no controle de sessao unica do sistema
 * (activeSessionId): o caixa fica aberto o dia inteiro e nao pode cair
 * quando a mesma pessoa abre o sistema em outra aba (AuthContext.tsx).
 *
 * Funcoes puras, compiladas para o servidor (scripts/build-server-domain.mjs):
 * server/routes/vendas.routes.js usa PERMISSOES_QUE_OPERAM_O_CAIXA.
 */
import { hasTenantFullAccess } from './roles';
import { administradorComTodas, administradorTemSemPacote } from './papelAdministradorDomain';

/** Permissao de sempre do PDV dentro do sistema. */
export const PERMISSAO_PDV = 'vendas.pdv';
/** Funcionario caixa: entra direto no caixa e so' nele. */
export const PERMISSAO_SO_CAIXA = 'vendas.so_caixa';
/** Qualquer uma destas opera o caixa (abrir/fechar caixa, vender, receber). */
export const PERMISSOES_QUE_OPERAM_O_CAIXA: readonly string[] = [PERMISSAO_PDV, PERMISSAO_SO_CAIXA];
/** Modulo do plano que o caixa usa (bloqueio pelo SuperAdmin, ver moduleCatalog.ts). */
export const MODULO_DO_CAIXA = 'comercial.pedidos';

export const CAMINHO_APP_CAIXA = '/caixa';
export const CAMINHO_LOGIN_CAIXA = '/caixa/login';
/** Arquivo HTML real do app (manifest/icone proprios): start_url do manifest e pagina de instalacao. */
export const CAMINHO_INSTALACAO_CAIXA = '/caixa.html';

/** A pagina aberta e' o app do caixa (e nao o sistema ou o app do vendedor)? */
export const ehAppDoCaixa = (pathname: string): boolean => (
  pathname === CAMINHO_APP_CAIXA || pathname.startsWith(`${CAMINHO_APP_CAIXA}/`) || pathname === CAMINHO_INSTALACAO_CAIXA
);

export interface PerfilParaOCaixa {
  role?: unknown;
  isOwner?: boolean;
  permissoes?: readonly string[] | null;
}

/**
 * Tem a permissao. Troca do administrador (25/11/2026): o administrador cujo
 * pacote o dono ainda nao salvou conta com todas (menos as que restringem),
 * mesmo com o cadastro cru.
 */
const tem = (perfil: PerfilParaOCaixa, permissao: string): boolean => (
  (Array.isArray(perfil.permissoes) && perfil.permissoes.includes(permissao))
  || administradorTemSemPacote(perfil.permissoes, perfil.role, permissao)
);

/** Pode abrir a Frente de Caixa (no sistema ou no app)? */
export const podeUsarFrenteDeCaixa = (perfil: PerfilParaOCaixa): boolean => (
  hasTenantFullAccess(perfil.role, Boolean(perfil.isOwner))
  || PERMISSOES_QUE_OPERAM_O_CAIXA.some((permissao) => tem(perfil, permissao))
);

/**
 * Funcionario caixa: o login cai direto no caixa e o sistema nao aparece.
 * Nunca vale para o dono, nem para o administrador cujo pacote o dono ainda
 * nao salvou (um "So' a Frente de Caixa" que sobrou de quando ele era
 * funcionario nao o prende). Depois de salvo, vale o que o dono marcou.
 */
export const entraDiretoNoCaixa = (perfil: PerfilParaOCaixa): boolean => (
  !hasTenantFullAccess(perfil.role, Boolean(perfil.isOwner))
  && !administradorComTodas(perfil.permissoes, perfil.role)
  && tem(perfil, PERMISSAO_SO_CAIXA)
);

/** Para onde o login do sistema manda a pessoa. */
export const destinoAposLogin = (perfil: PerfilParaOCaixa, loginDaPlataforma: boolean): string => {
  if (loginDaPlataforma) return '/superadmin';
  return entraDiretoNoCaixa(perfil) ? CAMINHO_APP_CAIXA : '/dashboard';
};

/**
 * Nome do operador do caixa (pedido do dono, 20/10/2026): o do CADASTRO do
 * usuario. Antes ia o displayName/e-mail do login ("50672123000147-uedder"),
 * que nao diz quem e' a pessoa. Sem cadastro legivel, fica o que foi gravado.
 */
export const nomeDoOperador = (
  perfil: { nome?: unknown; nomeResponsavel?: unknown } | null | undefined,
  gravado: string,
): string => {
  const nome = typeof perfil?.nome === 'string' ? perfil.nome.trim() : '';
  if (nome) return nome;
  const responsavel = typeof perfil?.nomeResponsavel === 'string' ? perfil.nomeResponsavel.trim() : '';
  return responsavel || gravado;
};

export const MENSAGEM_SEM_ACESSO_AO_CAIXA = 'Este login não tem acesso à Frente de Caixa. Peça ao administrador para liberar "Vendas: Frente de Caixa (PDV)" ou "Vendas: Só a Frente de Caixa" no seu usuário.';

/*
 * TROCO NA FRENTE DE CAIXA (25/11/2026, video da Jomarly: "deu 160, a pessoa
 * deu 200 -- qual o troco? A pessoa nao tem que ficar na calculadora").
 * Decisao do dono: para todos, sem chave. So' o DINHEIRO pode passar do total:
 * o que passa e' o troco, e a venda e o caixa ficam com o valor da venda (o
 * troco sai da gaveta na hora). Pix, cartao e cheque continuam exatos.
 */
export interface PagamentoParaTroco {
  forma: string;
  valorCentavos: number;
}

export interface ContaDoTroco {
  pagoCentavos: number;
  /** Quanto falta pagar (0 se pago). */
  faltaCentavos: number;
  /** Dinheiro a mais que volta ao cliente. */
  trocoCentavos: number;
  /** Excesso que NAO pode virar troco (passou do total sem ser dinheiro). */
  excessoSemTrocoCentavos: number;
}

const centavos = (valor: unknown): number => Math.max(0, Math.round(Number(valor) || 0));

export const contaDoTroco = (totalCentavos: number, pagamentos: PagamentoParaTroco[]): ContaDoTroco => {
  const total = centavos(totalCentavos);
  const pago = pagamentos.reduce((soma, p) => soma + centavos(p.valorCentavos), 0);
  const dinheiro = pagamentos.filter((p) => p.forma === 'Dinheiro').reduce((soma, p) => soma + centavos(p.valorCentavos), 0);
  const outros = pago - dinheiro;
  const excesso = Math.max(0, pago - total);
  // Troco so' sai do dinheiro: as outras formas sozinhas nao podem passar do total.
  const excessoSemTroco = Math.max(0, outros - total);
  const troco = Math.min(Math.max(0, excesso - excessoSemTroco), dinheiro);
  return {
    pagoCentavos: pago,
    faltaCentavos: Math.max(0, total - pago),
    trocoCentavos: troco,
    excessoSemTrocoCentavos: excesso - troco,
  };
};

/**
 * Os pagamentos como ficam gravados: o troco sai do dinheiro (do ultimo para
 * o primeiro), para a venda somar exatamente o total. Dinheiro que zera sai
 * da lista.
 */
export const pagamentosSemOTroco = <T extends PagamentoParaTroco>(pagamentos: T[], trocoCentavos: number): T[] => {
  let resta = centavos(trocoCentavos);
  const ajustados = [...pagamentos];
  for (let i = ajustados.length - 1; i >= 0 && resta > 0; i -= 1) {
    if (ajustados[i].forma !== 'Dinheiro') continue;
    const tirar = Math.min(resta, centavos(ajustados[i].valorCentavos));
    ajustados[i] = { ...ajustados[i], valorCentavos: centavos(ajustados[i].valorCentavos) - tirar };
    resta -= tirar;
  }
  return ajustados.filter((p) => !(p.forma === 'Dinheiro' && p.valorCentavos === 0));
};
