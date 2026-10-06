/**
 * FILIAIS (2026-10-06) -- regras puras, usadas pela tela e pelo servidor
 * (compiladas para server/domain por scripts/build-server-domain.mjs).
 *
 * Desenho (docs/PLANO_FILIAIS.md):
 *  - Cada filial e' uma empresa (tenant) propria: vendas, OS, notas,
 *    financeiro, caixa, bancos e numeracao separados.
 *  - As filiais de uma mesma empresa formam um GRUPO (`grupos/{grupoId}`).
 *    A configuracao de cada filial guarda `grupoId` (so' o servidor grava).
 *  - O usuario pertence a uma filial (`usuarios/{uid}.tenantId`, a "casa"
 *    dele) e trabalha na `filialAtiva` (so' o servidor grava). As
 *    firestore.rules e o servidor usam a filial ativa como empresa da vez.
 *  - Quem entra em outras filiais: dono e administrador do grupo (role
 *    Master/Admin), e funcionario com a permissao "Utiliza outras filiais".
 *    Decisao do dono (06/10): as permissoes valem iguais em todas as filiais.
 */

export const PERMISSAO_UTILIZA_OUTRAS_FILIAIS = 'filiais.utilizar';

export type TipoFilial = 'cnpj_proprio' | 'mesmo_cnpj';

export interface FilialDoGrupo {
  tenantId: string;
  /** "10", "20"... -- como no Integra. */
  codigo: string;
  nome: string;
  cnpj: string;
  uf: string;
  cidade: string;
  tipo: TipoFilial;
  matriz: boolean;
  ativa: boolean;
}

export interface GrupoEmpresarial {
  id: string;
  nome: string;
  donoUid: string;
  matrizTenantId: string;
  filiais: FilialDoGrupo[];
  /** Copia dos modulos bloqueados da matriz, para as filiais (o plano e' do grupo). */
  modulosBloqueados: string[];
}

export interface UsuarioDaFilial {
  uid: string;
  role?: string | null;
  permissoes?: unknown;
  /** Filial "casa" do usuario. */
  tenantId?: string | null;
  filialAtiva?: string | null;
}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');
const soDigitos = (valor: unknown): string => String(valor ?? '').replace(/\D/g, '');
const lista = (valor: unknown): string[] => (Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : []);

const PAPEIS_GESTORES = ['Master', 'Admin'];

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
  'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

export const lerFilial = (dados: unknown): FilialDoGrupo | null => {
  const f = (dados && typeof dados === 'object' ? dados : {}) as Record<string, unknown>;
  const tenantId = texto(f.tenantId);
  if (!tenantId) return null;
  return {
    tenantId,
    codigo: texto(f.codigo),
    nome: texto(f.nome).toUpperCase(),
    cnpj: soDigitos(f.cnpj),
    uf: texto(f.uf).toUpperCase(),
    cidade: texto(f.cidade).toUpperCase(),
    tipo: f.tipo === 'mesmo_cnpj' ? 'mesmo_cnpj' : 'cnpj_proprio',
    matriz: f.matriz === true,
    ativa: f.ativa !== false,
  };
};

export const lerGrupo = (id: string, dados: unknown): GrupoEmpresarial => {
  const g = (dados && typeof dados === 'object' ? dados : {}) as Record<string, unknown>;
  const filiais = (Array.isArray(g.filiais) ? g.filiais : [])
    .map(lerFilial)
    .filter((f): f is FilialDoGrupo => Boolean(f))
    .sort((a, b) => ordenarCodigo(a.codigo, b.codigo));
  return {
    id,
    nome: texto(g.nome).toUpperCase(),
    donoUid: texto(g.donoUid),
    matrizTenantId: texto(g.matrizTenantId),
    filiais,
    modulosBloqueados: lista(g.modulosBloqueados),
  };
};

const ordenarCodigo = (a: string, b: string): number => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b);

export const rotuloFilial = (filial: Pick<FilialDoGrupo, 'codigo' | 'nome'> | null | undefined): string => (
  filial ? `${filial.codigo} · ${filial.nome}` : ''
);

/** Filial em que o usuario esta trabalhando agora (a ativa ou, sem ela, a casa). */
export const filialAtivaDoUsuario = (usuario: UsuarioDaFilial): string => texto(usuario.filialAtiva) || texto(usuario.tenantId) || usuario.uid;

export const ehGestorDoGrupo = (grupo: GrupoEmpresarial | null, usuario: UsuarioDaFilial): boolean => {
  if (!grupo) return false;
  if (grupo.donoUid && grupo.donoUid === usuario.uid) return true;
  return PAPEIS_GESTORES.includes(texto(usuario.role)) && pertenceAoGrupo(grupo, usuario);
};

export const pertenceAoGrupo = (grupo: GrupoEmpresarial | null, usuario: UsuarioDaFilial): boolean => (
  Boolean(grupo) && grupo!.filiais.some((f) => f.tenantId === texto(usuario.tenantId))
);

export const podeUsarOutrasFiliais = (grupo: GrupoEmpresarial | null, usuario: UsuarioDaFilial): boolean => {
  if (!grupo || !pertenceAoGrupo(grupo, usuario)) return false;
  return ehGestorDoGrupo(grupo, usuario) || lista(usuario.permissoes).includes(PERMISSAO_UTILIZA_OUTRAS_FILIAIS);
};

/** Filiais em que o usuario pode entrar (ativas), na ordem do codigo. Sem a permissao, so' a casa dele. */
export const filiaisDoUsuario = (grupo: GrupoEmpresarial | null, usuario: UsuarioDaFilial): FilialDoGrupo[] => {
  if (!grupo || !pertenceAoGrupo(grupo, usuario)) return [];
  if (podeUsarOutrasFiliais(grupo, usuario)) return grupo.filiais.filter((f) => f.ativa);
  return grupo.filiais.filter((f) => f.tenantId === texto(usuario.tenantId));
};

/** Mensagem para o usuario quando a troca nao pode acontecer; null = pode trocar. */
export const validarTrocaDeFilial = (grupo: GrupoEmpresarial | null, usuario: UsuarioDaFilial, destino: string): string | null => {
  if (!grupo || !pertenceAoGrupo(grupo, usuario)) return 'Sua empresa não tem filiais cadastradas.';
  const filial = grupo.filiais.find((f) => f.tenantId === destino);
  if (!filial) return 'Essa filial não faz parte da sua empresa.';
  if (!podeUsarOutrasFiliais(grupo, usuario) && destino !== texto(usuario.tenantId)) {
    return 'Você não tem a permissão "Utiliza outras filiais". Peça ao responsável para liberar no seu usuário (Administração → Usuários).';
  }
  if (!filial.ativa) return `A filial ${rotuloFilial(filial)} está inativa. Reative em Configurações → Filiais para entrar nela.`;
  return null;
};

/**
 * O que gravar no usuario ao trocar de filial: voltar para a casa apaga o
 * campo (null), outra filial grava o tenant dela.
 */
export const filialAtivaParaGravar = (usuario: UsuarioDaFilial, destino: string): string | null => (
  destino === texto(usuario.tenantId) ? null : destino
);

// ---------------------------------------------------------------------------
// Cadastro de filial
// ---------------------------------------------------------------------------

export interface DadosDaFilial {
  codigo: string;
  nome: string;
  tipo: TipoFilial;
  cnpj: string;
  razaoSocial: string;
  inscricaoEstadual: string;
  uf: string;
  cidade: string;
  rua: string;
  numero: string;
  bairro: string;
  cep: string;
  telefone: string;
  email: string;
}

export const lerDadosDaFilial = (dados: unknown): DadosDaFilial => {
  const d = (dados && typeof dados === 'object' ? dados : {}) as Record<string, unknown>;
  return {
    codigo: soDigitos(d.codigo),
    nome: texto(d.nome).toUpperCase(),
    tipo: d.tipo === 'mesmo_cnpj' ? 'mesmo_cnpj' : 'cnpj_proprio',
    cnpj: soDigitos(d.cnpj),
    razaoSocial: texto(d.razaoSocial).toUpperCase(),
    inscricaoEstadual: texto(d.inscricaoEstadual).toUpperCase(),
    uf: texto(d.uf).toUpperCase(),
    cidade: texto(d.cidade).toUpperCase(),
    rua: texto(d.rua).toUpperCase(),
    numero: texto(d.numero).toUpperCase(),
    bairro: texto(d.bairro).toUpperCase(),
    cep: soDigitos(d.cep),
    telefone: texto(d.telefone),
    email: texto(d.email).toLowerCase(),
  };
};

export const cnpjValido = (valor: unknown): boolean => {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const digito = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
};

/** Proximo codigo livre de 10 em 10 (10, 20, 30...), como no Integra. */
export const proximoCodigoDeFilial = (grupo: GrupoEmpresarial | null): string => {
  const maior = (grupo?.filiais ?? []).reduce((m, f) => Math.max(m, Number(f.codigo) || 0), 0);
  return String(Math.max(10, (Math.floor(maior / 10) + 1) * 10));
};

/**
 * Valida a filial nova (ou a edicao de uma existente, passando `ignorarTenantId`).
 * `cnpjMatriz` e' o CNPJ da empresa que vira (ou ja' e') a matriz.
 */
/** Nome e codigo (o que a edicao de uma filial muda). */
export const validarNomeECodigoDaFilial = (
  dados: Pick<DadosDaFilial, 'nome' | 'codigo'>,
  grupo: GrupoEmpresarial | null,
  ignorarTenantId?: string,
): string | null => {
  const outras = (grupo?.filiais ?? []).filter((f) => f.tenantId !== ignorarTenantId);
  if (!dados.nome) return 'Informe o nome da filial (ex.: o nome da loja ou do bairro).';
  if (!/^\d{1,3}$/.test(dados.codigo)) return 'O código da filial é um número de 1 a 3 dígitos (10, 20, 30...).';
  const mesmoCodigo = outras.find((f) => f.codigo === dados.codigo);
  if (mesmoCodigo) return `O código ${dados.codigo} já é da filial ${rotuloFilial(mesmoCodigo)}. Escolha outro.`;
  return null;
};

export const validarDadosDaFilial = (
  dados: DadosDaFilial,
  grupo: GrupoEmpresarial | null,
  cnpjMatriz: string,
  ignorarTenantId?: string,
): string | null => {
  const outras = (grupo?.filiais ?? []).filter((f) => f.tenantId !== ignorarTenantId);
  const erroNomeCodigo = validarNomeECodigoDaFilial(dados, grupo, ignorarTenantId);
  if (erroNomeCodigo) return erroNomeCodigo;
  if (!UFS.includes(dados.uf)) return 'Escolha o estado (UF) da filial.';
  if (!dados.cidade) return 'Informe a cidade da filial.';
  if (dados.tipo === 'mesmo_cnpj') {
    if (soDigitos(cnpjMatriz) && dados.cnpj && dados.cnpj !== soDigitos(cnpjMatriz)) {
      return 'Filial "mesmo CNPJ" usa o CNPJ da matriz. Para outro CNPJ, escolha "CNPJ próprio".';
    }
    return null;
  }
  if (!cnpjValido(dados.cnpj)) return 'O CNPJ da filial não é válido. Confira os números (14 dígitos).';
  if (dados.cnpj === soDigitos(cnpjMatriz)) {
    return 'Esse é o CNPJ da matriz. Se a filial usa o mesmo CNPJ (loja ou depósito), escolha "Mesmo CNPJ da matriz".';
  }
  const mesmoCnpj = outras.find((f) => f.tipo === 'cnpj_proprio' && f.cnpj === dados.cnpj);
  if (mesmoCnpj) return `Esse CNPJ já é da filial ${rotuloFilial(mesmoCnpj)}.`;
  return null;
};

// ---------------------------------------------------------------------------
// Configuracao inicial da filial (copiada da matriz)
// ---------------------------------------------------------------------------

/**
 * Campos que sao a IDENTIDADE da empresa (ou segredos dela) e por isso nunca
 * sao copiados da matriz para a filial: CNPJ, razao social, IE, endereco,
 * contato, Spedy e NFS-e (inscricao municipal e cidade). O resto (formas de
 * pagamento, regras de venda, modelos de impressao, plano de contas...) vem da
 * matriz e a filial ajusta depois.
 */
export const CAMPOS_DE_IDENTIDADE_DA_EMPRESA = [
  'tenantId', 'grupoId', 'filialCodigo', 'createdAt', 'updatedAt', 'alteradoPor', 'alteradoEm', 'ultimaAlteracao',
  'nomeOficina', 'razaoSocial', 'nomeFantasia', 'nomeUsuario', 'cnpj', 'inscricaoEstadual',
  'telefone', 'whatsapp', 'instagram', 'email',
  'rua', 'numero', 'complemento', 'bairro', 'cep', 'endereco', 'cidade', 'uf', 'codigoIbge',
  'spedyEnabled', 'spedyApiKey', 'spedyEnvironment', 'spedyCompanyId',
  'nfseCidadeCodigo', 'nfseCidadeNome', 'nfseCidadeEstado', 'nfseInscricaoMunicipal',
];

export const configuracaoInicialDaFilial = (
  configMatriz: Record<string, unknown>,
  dados: DadosDaFilial,
  contexto: { tenantId: string; grupoId: string; cnpjMatriz: string; razaoSocialMatriz: string },
): Record<string, unknown> => {
  const copia: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(configMatriz || {})) {
    if (CAMPOS_DE_IDENTIDADE_DA_EMPRESA.includes(campo) || valor === undefined) continue;
    copia[campo] = valor;
  }
  const mesmoCnpj = dados.tipo === 'mesmo_cnpj';
  return {
    ...copia,
    tenantId: contexto.tenantId,
    grupoId: contexto.grupoId,
    filialCodigo: dados.codigo,
    nomeOficina: dados.nome,
    nomeFantasia: dados.nome,
    razaoSocial: mesmoCnpj ? contexto.razaoSocialMatriz : (dados.razaoSocial || dados.nome),
    cnpj: mesmoCnpj ? soDigitos(contexto.cnpjMatriz) : dados.cnpj,
    inscricaoEstadual: dados.inscricaoEstadual,
    uf: dados.uf,
    cidade: dados.cidade,
    rua: dados.rua,
    numero: dados.numero,
    bairro: dados.bairro,
    cep: dados.cep,
    telefone: dados.telefone,
    email: dados.email,
    // A filial precisa ser cadastrada na Spedy (CNPJ dela) antes de emitir nota.
    spedyEnabled: false,
  };
};

/** Entrada da filial no documento do grupo. */
export const filialParaGravar = (
  tenantId: string,
  dados: DadosDaFilial,
  cnpjMatriz: string,
  matriz: boolean,
): FilialDoGrupo => ({
  tenantId,
  codigo: dados.codigo,
  nome: dados.nome,
  cnpj: dados.tipo === 'mesmo_cnpj' ? soDigitos(cnpjMatriz) : dados.cnpj,
  uf: dados.uf,
  cidade: dados.cidade,
  tipo: dados.tipo,
  matriz,
  ativa: true,
});

/** A empresa atual vira a matriz (codigo 10) quando a primeira filial e' criada. */
export const matrizAPartirDaConfiguracao = (tenantId: string, config: Record<string, unknown>): FilialDoGrupo => ({
  tenantId,
  codigo: '10',
  nome: (texto(config.nomeOficina) || texto(config.nomeFantasia) || texto(config.razaoSocial) || 'MATRIZ').toUpperCase(),
  cnpj: soDigitos(config.cnpj),
  uf: texto(config.uf).toUpperCase(),
  cidade: texto(config.cidade).toUpperCase(),
  tipo: 'cnpj_proprio',
  matriz: true,
  ativa: true,
});
