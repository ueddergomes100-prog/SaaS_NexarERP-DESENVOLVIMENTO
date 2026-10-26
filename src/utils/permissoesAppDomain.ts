import { hasTenantFullAccess } from './roles';

/**
 * PERMISSOES DO APLICATIVO MOBILE (26/10/2026, pedido do dono).
 *
 * O que o dono pediu: em Equipe e Acessos, um bloco so' do app, com uma chave
 * por tela, para liberar e bloquear cada usuario sem caçar opcao espalhada
 * (uma em Vendas, outra em Estoque...). Novo Pedido, Orcamento, Consultar
 * preco e Clientes nem tinham chave: quem entrava no app via tudo.
 *
 * Chaves novas `app.*` para as telas que nao tinham chave so' do app. As que ja'
 * eram do app (OS no app, Entregas, pedir Troca) continuam com o id de sempre e
 * so' mudam de lugar na tela (grupo "Aplicativo mobile" em permissionCatalog.ts).
 *
 * QUEM JA' USA O APP NAO PERDE NADA (decisao do dono: "ja' vem marcado"): usuario
 * que nunca teve as permissoes do app gravadas -- sem o marcador
 * `app.definido` -- conta como tendo TODAS as chaves novas. Ao salvar as
 * permissoes dele (pelo servidor), as chaves passam a ser gravadas de verdade,
 * junto com o marcador, e dai' em diante vale o que esta' marcado.
 *
 * Algumas telas tambem dependem da permissao do sistema (Contas a Pagar no app
 * precisa de "Financeiro: Contas a Pagar"; Emitir nota precisa de "Fiscal:
 * emitir"...): a chave do app so' liga/desliga a tela no celular, nunca da' o que
 * a pessoa nao tem no sistema.
 */

export const MARCADOR_APP_DEFINIDO = 'app.definido';

export const PERMISSAO_APP = {
  pedido: 'app.pedido',
  orcamento: 'app.orcamento',
  preco: 'app.preco',
  clientes: 'app.clientes',
  conferencia: 'app.conferencia',
  balanco: 'app.balanco',
  liberacoes: 'app.liberacoes',
  contasPagar: 'app.contas_pagar',
  contasReceber: 'app.contas_receber',
  emitirNota: 'app.emitir_nota',
} as const;

/** Chaves novas: quem nunca teve as permissoes do app gravadas conta com todas. */
export const CHAVES_APP_NOVAS: string[] = Object.values(PERMISSAO_APP);

const lista = (permissoes: unknown): string[] => (
  Array.isArray(permissoes) ? permissoes.filter((p): p is string => typeof p === 'string') : []
);

/** Ja' teve as permissoes do app gravadas (marcador presente)? */
export const appDefinido = (permissoes: unknown): boolean => lista(permissoes).includes(MARCADOR_APP_DEFINIDO);

/**
 * Permissoes que valem de verdade: as gravadas + (sem o marcador) as chaves
 * novas do app. O resultado SEMPRE leva o marcador, para aplicar de novo nao
 * mudar nada: o AuthContext ja' entrega as efetivas e a tela chama podeNoApp em
 * cima delas (a primeira versao tirava o marcador e a segunda passada liberava
 * todas as chaves de novo -- pego no teste do app). O catalogo nao lista o
 * marcador, entao ele nao aparece na tela.
 */
export const permissoesEfetivas = (permissoes: unknown): string[] => {
  const gravadas = lista(permissoes);
  const base = appDefinido(gravadas) ? gravadas : [...gravadas, ...CHAVES_APP_NOVAS];
  return [...new Set([...base, MARCADOR_APP_DEFINIDO])];
};

/** O que gravar: o que a tela marcou + o marcador (dai' em diante nada e' implicito). */
export const permissoesParaGravar = (marcadas: unknown): string[] => (
  [...new Set([...lista(marcadas).filter((p) => p !== MARCADOR_APP_DEFINIDO), MARCADOR_APP_DEFINIDO])]
);

/** Dono/gestor sempre; o resto, pela chave do app (contando as implicitas). */
export const podeNoApp = (chave: string, args: { role: unknown; isOwner: boolean; permissoes: unknown }): boolean => (
  hasTenantFullAccess(args.role, args.isOwner) || permissoesEfetivas(args.permissoes).includes(chave)
);

/**
 * Gerente so' da' e tira o que ELE MESMO tem (decisao de 19/10/2026), agora
 * contando as chaves implicitas do app dos dois lados. Devolve as permissoes
 * que ele mexeu sem ter ([] = tudo certo).
 */
export const mexidasSemTer = (args: { antes: unknown; depois: unknown; doGerente: unknown }): string[] => {
  const antes = new Set(permissoesEfetivas(args.antes));
  const depois = new Set(permissoesEfetivas(args.depois));
  const dele = new Set(permissoesEfetivas(args.doGerente));
  const mexidas = [...depois].filter((p) => !antes.has(p)).concat([...antes].filter((p) => !depois.has(p)));
  return mexidas.filter((p) => !dele.has(p));
};

/**
 * Id de permissao aceito (dominio.acao). Aceita maiusculas: ha' ids antigos em
 * camelCase ('estoque.ajusteManual', 'estoque.relatorioAjustes') -- a primeira
 * versao so' com minusculas apagava essas permissoes ao salvar (pego no teste).
 */
export const permissaoValida = (p: unknown): p is string => typeof p === 'string' && /^[A-Za-z0-9_]+\.[A-Za-z0-9_.]+$/.test(p) && p.length <= 80;
