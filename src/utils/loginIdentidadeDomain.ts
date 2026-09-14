/**
 * Identidade de login do FUNCIONARIO: como o usuario digitado na tela de
 * login vira a chave do indice `usernames/{chave}`.
 *
 * ---------------------------------------------------------------------------
 * O BUG QUE ISTO CORRIGE
 * ---------------------------------------------------------------------------
 *
 * A chave era montada em DOIS lugares, com regras diferentes:
 *
 *   Criacao (UsuarioForm.tsx): CNPJ da empresa, mas caindo pra um slug do
 *     nome da oficina, ou pros 4 primeiros caracteres do tenantId, quando
 *     nao havia CNPJ cadastrado.
 *   Login (AuthPage.tsx): SEMPRE o CNPJ digitado pelo usuario.
 *
 * Empresa cadastrada sem CNPJ => o funcionario era gravado sob uma chave que
 * o login nunca conseguiria gerar. Resultado: ele NUNCA consegue entrar, e a
 * mensagem na tela ("Usuário ou CNPJ da Empresa não encontrado") manda o
 * suporte procurar no lugar errado -- ninguem suspeita do cadastro da
 * empresa.
 *
 * A correcao segue a regra da casa (CLAUDE.md, item 1): em vez de inventar um
 * prefixo alternativo que "faz funcionar", o cadastro BLOQUEIA com mensagem
 * clara quando falta o CNPJ. Cadastro incompleto se resolve no cadastro --
 * nao torcendo a chave de login.
 *
 * Prefixo alternativo aqui nao e' escolha de estilo: ele produz um usuario
 * que existe no banco e nao entra em lugar nenhum. Falhar cedo, no cadastro,
 * e' o unico comportamento honesto.
 */

/** Só dígitos, do jeito que a tela de login normaliza o CNPJ digitado. */
export const normalizarCnpj = (valor: unknown): string =>
  String(valor ?? '').replace(/\D/g, '');

/** CNPJ com máscara (00.000.000/0000-00), cortado nos 14 dígitos -- é o que
 *  limita o que dá pra digitar no campo. Vive aqui, e não em cada tela, pra
 *  login do sistema e app do vendedor mascararem igual. */
export const formatarCnpj = (valor: unknown): string =>
  normalizarCnpj(valor)
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');

/** Chave do CNPJ lembrado entre logins (o mesmo aparelho costuma ser sempre
 *  da mesma empresa). Compartilhada pelo login do sistema e pelo app do
 *  vendedor de propósito: quem já entrou num, não redigita no outro. */
export const CNPJ_LEMBRADO_STORAGE_KEY = 'nexus_login_cnpj';

/** Código do vendedor de balcão lembrado no app do vendedor externo (o
 *  celular é sempre do mesmo vendedor). Só o código -- é o "usuário", não a
 *  senha/PIN, que continua sem gravar. */
export const CODIGO_VENDEDOR_LEMBRADO_STORAGE_KEY = 'nexus_vendedor_codigo';

/** Usuário como o funcionário digita: sem espaços, minúsculo. */
export const normalizarUsername = (valor: unknown): string =>
  String(valor ?? '').trim().toLowerCase().replace(/\s+/g, '');

export const USERNAME_MIN_LENGTH = 3;

/**
 * Chave do indice `usernames`. UM lugar so -- criacao e login chamam esta
 * mesma funcao, entao nao ha como divergirem de novo.
 */
export const montarChaveUsername = (cnpj: unknown, username: unknown): string => {
  const cnpjLimpo = normalizarCnpj(cnpj);
  const usuarioLimpo = normalizarUsername(username);
  if (!cnpjLimpo || !usuarioLimpo) return '';
  return `${cnpjLimpo}-${usuarioLimpo}`;
};

/** Email sintetico do Firebase Auth. O funcionario nunca ve isso. */
export const montarEmailSintetico = (chaveUsername: string): string =>
  `${chaveUsername}@nexar.app`;

export interface ChecagemPrefixo {
  ok: boolean;
  cnpj: string;
  motivo: string;
}

/**
 * A empresa esta apta a cadastrar funcionario?
 *
 * Devolve o CNPJ normalizado, ou o motivo do bloqueio ja escrito pro usuario
 * final -- em portugues, dizendo onde resolver.
 */
export const checarPrefixoDaEmpresa = (cnpjCadastrado: unknown): ChecagemPrefixo => {
  const cnpj = normalizarCnpj(cnpjCadastrado);

  if (!cnpj) {
    return {
      ok: false,
      cnpj: '',
      motivo: 'Esta empresa ainda não tem CNPJ cadastrado, e o CNPJ é o que identifica a empresa na tela de login. '
        + 'Cadastre o CNPJ em Configurações → Configurações Gerais antes de criar funcionários — '
        + 'sem ele, o funcionário seria criado sem conseguir entrar no sistema.',
    };
  }

  if (cnpj.length !== 14) {
    return {
      ok: false,
      cnpj,
      motivo: `O CNPJ cadastrado nesta empresa tem ${cnpj.length} dígitos, e um CNPJ válido tem 14. `
        + 'Corrija em Configurações → Configurações Gerais antes de criar funcionários.',
    };
  }

  return { ok: true, cnpj, motivo: '' };
};

/** Validação do usuário escolhido, com a mensagem pronta. */
export const checarUsername = (username: unknown): { ok: boolean; username: string; motivo: string } => {
  const usuario = normalizarUsername(username);

  if (usuario.length < USERNAME_MIN_LENGTH) {
    return {
      ok: false,
      username: usuario,
      motivo: `O nome de usuário deve ter pelo menos ${USERNAME_MIN_LENGTH} letras.`,
    };
  }

  return { ok: true, username: usuario, motivo: '' };
};
