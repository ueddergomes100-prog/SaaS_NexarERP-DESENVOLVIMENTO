"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissaoValida = exports.mexidasSemTer = exports.podeNoApp = exports.permissoesParaGravar = exports.permissoesEfetivas = exports.appDefinido = exports.CHAVES_APP_NOVAS = exports.PERMISSAO_APP = exports.MARCADOR_APP_DEFINIDO = void 0;
const roles_1 = require("./roles");
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
exports.MARCADOR_APP_DEFINIDO = 'app.definido';
exports.PERMISSAO_APP = {
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
};
/** Chaves novas: quem nunca teve as permissoes do app gravadas conta com todas. */
exports.CHAVES_APP_NOVAS = Object.values(exports.PERMISSAO_APP);
const lista = (permissoes) => (Array.isArray(permissoes) ? permissoes.filter((p) => typeof p === 'string') : []);
/** Ja' teve as permissoes do app gravadas (marcador presente)? */
const appDefinido = (permissoes) => lista(permissoes).includes(exports.MARCADOR_APP_DEFINIDO);
exports.appDefinido = appDefinido;
/**
 * Permissoes que valem de verdade: as gravadas + (sem o marcador) as chaves
 * novas do app. O resultado SEMPRE leva o marcador, para aplicar de novo nao
 * mudar nada: o AuthContext ja' entrega as efetivas e a tela chama podeNoApp em
 * cima delas (a primeira versao tirava o marcador e a segunda passada liberava
 * todas as chaves de novo -- pego no teste do app). O catalogo nao lista o
 * marcador, entao ele nao aparece na tela.
 */
const permissoesEfetivas = (permissoes) => {
    const gravadas = lista(permissoes);
    const base = (0, exports.appDefinido)(gravadas) ? gravadas : [...gravadas, ...exports.CHAVES_APP_NOVAS];
    return [...new Set([...base, exports.MARCADOR_APP_DEFINIDO])];
};
exports.permissoesEfetivas = permissoesEfetivas;
/** O que gravar: o que a tela marcou + o marcador (dai' em diante nada e' implicito). */
const permissoesParaGravar = (marcadas) => ([...new Set([...lista(marcadas).filter((p) => p !== exports.MARCADOR_APP_DEFINIDO), exports.MARCADOR_APP_DEFINIDO])]);
exports.permissoesParaGravar = permissoesParaGravar;
/** Dono/gestor sempre; o resto, pela chave do app (contando as implicitas). */
const podeNoApp = (chave, args) => ((0, roles_1.hasTenantFullAccess)(args.role, args.isOwner) || (0, exports.permissoesEfetivas)(args.permissoes).includes(chave));
exports.podeNoApp = podeNoApp;
/**
 * Gerente so' da' e tira o que ELE MESMO tem (decisao de 19/10/2026), agora
 * contando as chaves implicitas do app dos dois lados. Devolve as permissoes
 * que ele mexeu sem ter ([] = tudo certo).
 */
const mexidasSemTer = (args) => {
    const antes = new Set((0, exports.permissoesEfetivas)(args.antes));
    const depois = new Set((0, exports.permissoesEfetivas)(args.depois));
    const dele = new Set((0, exports.permissoesEfetivas)(args.doGerente));
    const mexidas = [...depois].filter((p) => !antes.has(p)).concat([...antes].filter((p) => !depois.has(p)));
    return mexidas.filter((p) => !dele.has(p));
};
exports.mexidasSemTer = mexidasSemTer;
/**
 * Id de permissao aceito (dominio.acao). Aceita maiusculas: ha' ids antigos em
 * camelCase ('estoque.ajusteManual', 'estoque.relatorioAjustes') -- a primeira
 * versao so' com minusculas apagava essas permissoes ao salvar (pego no teste).
 */
const permissaoValida = (p) => typeof p === 'string' && /^[A-Za-z0-9_]+\.[A-Za-z0-9_.]+$/.test(p) && p.length <= 80;
exports.permissaoValida = permissaoValida;
