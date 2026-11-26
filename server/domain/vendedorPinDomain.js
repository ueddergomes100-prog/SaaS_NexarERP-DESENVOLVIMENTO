"use strict";
/**
 * Identificacao do vendedor na venda: codigo de 2 digitos + PIN de 2 a 10
 * digitos.
 *
 * ---------------------------------------------------------------------------
 * PRA QUE SERVE
 * ---------------------------------------------------------------------------
 *
 * Cenario real do cliente: 10 computadores com o sistema aberto na tela de
 * Pedido de Venda o dia inteiro, cada um logado na propria conta de estacao
 * (`balcao01`, `balcao02`, ...). A cada venda, um popup pede codigo e PIN do
 * VENDEDOR -- a venda e a comissao ficam no nome dele, e a estacao continua
 * logada. Terminou a venda, o sistema esquece: a proxima pede de novo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O PIN NAO E' A SENHA DO FIREBASE AUTH
 * ---------------------------------------------------------------------------
 *
 * O Firebase Auth exige senha de 6+ caracteres, e o PIN aqui pode ter tao
 * pouco quanto 2 digitos.
 * Entao o PIN e' um segredo PROPRIO, guardado fora do alcance do navegador e
 * validado no backend (Admin SDK). Duas consequencias que valem lembrar:
 *
 *  - o navegador NUNCA ve o hash do PIN. Se visse, as combinacoes (100 num PIN
 *    de 2 digitos, 10.000 num de 4) caem em milissegundos -- e ai o PIN nao
 *    valeria nada;
 *  - o codigo de 2 digitos e' PUBLICO por natureza (todo mundo ve o do
 *    colega). Toda a seguranca fica no PIN + no controle de tentativas do
 *    lado servidor.
 *
 * Este modulo tem so as regras PURAS de formato, compartilhadas entre a tela
 * (validacao imediata, sem ida ao servidor) e as mensagens. A validacao que
 * vale e' sempre a do backend.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.avisoCodigoSaiuDosInativos = exports.mensagemCodigoDeOutroAtivo = exports.quemTemOCodigo = exports.nomeDoCadastroComCodigo = exports.cadastroSeguraCodigo = exports.listaGeralDeVendasEscondidaParaFuncionario = exports.minhasVendasNoMenu = exports.parseIdentificacaoEscondeVendas = exports.CHAVE_IDENTIFICACAO_ESCONDE_VENDAS = exports.parseExigirIdentificacaoVendedor = exports.DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR = exports.AJUDA_TAMANHO_PIN = exports.MENSAGEM_PIN_CURTO = exports.MENSAGEM_PIN_FRACO = exports.MENSAGEM_PIN_INVALIDO = exports.MENSAGEM_CODIGO_INVALIDO = exports.isPinVendedorFraco = exports.isPinDigitadoValido = exports.isPinVendedorValido = exports.isCodigoVendedorValido = exports.normalizarCodigoVendedor = exports.MAX_VENDEDORES_COM_CODIGO = exports.PIN_GESTOR_MIN_DIGITOS = exports.PIN_DIGITADO_MIN_DIGITOS = exports.PIN_VENDEDOR_MAX_DIGITOS = exports.PIN_VENDEDOR_MIN_DIGITOS = exports.CODIGO_VENDEDOR_DIGITOS = void 0;
const visibilidadeVendasDomain_1 = require("./visibilidadeVendasDomain");
exports.CODIGO_VENDEDOR_DIGITOS = 2;
/**
 * Faixa de tamanho do PIN.
 *
 * Seguranca, bloco B (25/11/2026, decisao do dono): senha NOVA so' com 4
 * digitos ou mais (`PIN_VENDEDOR_MIN_DIGITOS`). A de 2 ou 3 digitos cadastrada
 * antes (a faixa era de 2 a 10 desde 2026-08-31) continua valendo SO' no balcao
 * e na liberacao de desconto, onde ja' ha' alguem logado -- por isso o campo
 * de digitar do balcao aceita a partir de 2 (`PIN_DIGITADO_MIN_DIGITOS`). No
 * app Vendas e no computador ativado do caixa, so' 4 ou mais; dono e
 * administrador entram por codigo so' com 6 ou mais (`PIN_GESTOR_MIN_DIGITOS`).
 * Quem decide e' o servidor (server/services/vendedorPin.js e terminaisCaixa.js).
 */
exports.PIN_VENDEDOR_MIN_DIGITOS = 4;
exports.PIN_VENDEDOR_MAX_DIGITOS = 10;
exports.PIN_DIGITADO_MIN_DIGITOS = 2;
exports.PIN_GESTOR_MIN_DIGITOS = 6;
/** Teto de funcionarios com codigo por empresa: 00 a 99. */
exports.MAX_VENDEDORES_COM_CODIGO = 10 ** exports.CODIGO_VENDEDOR_DIGITOS;
const somenteDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');
/**
 * Normaliza o codigo digitado pra forma canonica de 2 digitos.
 * "7" e "07" sao o MESMO vendedor -- quem digita rapido no balcao nao vai
 * lembrar do zero a esquerda, e dois cadastros distintos "7" e "07" seriam
 * uma armadilha. Devolve '' quando nao da pra normalizar.
 */
const normalizarCodigoVendedor = (valor) => {
    const digitos = somenteDigitos(valor);
    if (!digitos || digitos.length > exports.CODIGO_VENDEDOR_DIGITOS)
        return '';
    return digitos.padStart(exports.CODIGO_VENDEDOR_DIGITOS, '0');
};
exports.normalizarCodigoVendedor = normalizarCodigoVendedor;
const isCodigoVendedorValido = (valor) => (0, exports.normalizarCodigoVendedor)(valor) !== '';
exports.isCodigoVendedorValido = isCodigoVendedorValido;
/** Senha NOVA: de MIN a MAX digitos -- nada alem de digito, sem espaco nem letra. */
const isPinVendedorValido = (valor) => {
    const bruto = String(valor ?? '');
    return new RegExp(`^\\d{${exports.PIN_VENDEDOR_MIN_DIGITOS},${exports.PIN_VENDEDOR_MAX_DIGITOS}}$`).test(bruto);
};
exports.isPinVendedorValido = isPinVendedorValido;
/** Senha DIGITADA no balcao: aceita a curta de antes (o servidor diz onde ela vale). */
const isPinDigitadoValido = (valor) => {
    const bruto = String(valor ?? '');
    return new RegExp(`^\\d{${exports.PIN_DIGITADO_MIN_DIGITOS},${exports.PIN_VENDEDOR_MAX_DIGITOS}}$`).test(bruto);
};
exports.isPinDigitadoValido = isPinDigitadoValido;
/**
 * PIN obvio demais. Nao BLOQUEIA (a decisao e' do dono da empresa), mas a
 * tela avisa: com um codigo publico, "1234" e "0000" entregam a conta pro
 * primeiro colega curioso.
 */
const isPinVendedorFraco = (valor) => {
    if (!(0, exports.isPinVendedorValido)(valor))
        return false;
    const pin = String(valor);
    const todosIguais = /^(\d)\1+$/.test(pin);
    const crescente = '0123456789'.includes(pin);
    const decrescente = '9876543210'.includes(pin);
    return todosIguais || crescente || decrescente;
};
exports.isPinVendedorFraco = isPinVendedorFraco;
/** Mensagens de erro prontas, em portugues, pra tela nao inventar cada uma. */
exports.MENSAGEM_CODIGO_INVALIDO = `O código do vendedor tem ${exports.CODIGO_VENDEDOR_DIGITOS} dígitos (de 00 a 99). Confira o código com o responsável.`;
exports.MENSAGEM_PIN_INVALIDO = `A senha do vendedor tem de ${exports.PIN_VENDEDOR_MIN_DIGITOS} a ${exports.PIN_VENDEDOR_MAX_DIGITOS} dígitos numéricos.`;
exports.MENSAGEM_PIN_FRACO = 'Esta senha é fácil de adivinhar (uma sequência como 1234 ou números repetidos como 0000). Como o código do vendedor é visível para os colegas, prefira uma senha menos óbvia.';
/** Aviso de quem ainda usa senha de 2 ou 3 digitos (o servidor marca `pinCurto` ao conferir). */
exports.MENSAGEM_PIN_CURTO = `Senha com menos de ${exports.PIN_VENDEDOR_MIN_DIGITOS} dígitos: vale só no balcão. Cadastre uma senha nova de ${exports.PIN_VENDEDOR_MIN_DIGITOS} dígitos ou mais para ela valer também no aplicativo e no computador do caixa.`;
/** Texto curto de ajuda, pro campo de senha em cada tela dizer o mesmo. */
exports.AJUDA_TAMANHO_PIN = `De ${exports.PIN_VENDEDOR_MIN_DIGITOS} a ${exports.PIN_VENDEDOR_MAX_DIGITOS} dígitos`;
/** Config do tenant: exige identificar o vendedor a cada venda.
 *  Desligado por padrao -- ligar mudaria o fluxo de quem ja vende hoje. */
exports.DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR = false;
const parseExigirIdentificacaoVendedor = (valor) => valor === true;
exports.parseExigirIdentificacaoVendedor = parseExigirIdentificacaoVendedor;
/**
 * "Com a identificacao ligada, cada funcionario ve so' as proprias vendas" (26/11/2026,
 * pedido do dono): a contra-opcao de quem quer exigir o codigo e a senha do vendedor mas
 * deixar todo mundo ver as vendas na tela de Pedidos de Venda. Padrao = esconde (como
 * sempre foi): so' `false` gravado libera.
 */
exports.CHAVE_IDENTIFICACAO_ESCONDE_VENDAS = 'identificacaoEscondeVendas';
const parseIdentificacaoEscondeVendas = (valor) => valor !== false;
exports.parseIdentificacaoEscondeVendas = parseIdentificacaoEscondeVendas;
/**
 * "Minhas Vendas" no menu acompanha: some so' quando a empresa exige a identificacao
 * e deixa todos verem as vendas (ai' a lista geral ja' mostra tudo). Sem identificacao,
 * como sempre (pela permissao).
 */
const minhasVendasNoMenu = (args) => (!(args.exigirIdentificacaoVendedor && !args.escondeVendas));
exports.minhasVendasNoMenu = minhasVendasNoMenu;
/**
 * A lista geral de "Pedidos de Venda" fica escondida da TELA (nao do
 * Firestore) pra quem nao tem acesso total, quando a empresa liga "Exigir
 * identificacao do vendedor a cada venda"?
 *
 * Por que esconder: no balcao compartilhado, cada venda e' gravada sob o
 * UID da ESTACAO (balcao01...), nao do vendedor real -- a lista geral
 * misturaria venda de todo mundo sem dizer "quem vendeu o que" de um jeito
 * confiavel pra quem nao e' gestor. Quem tem acesso total (dono, Master,
 * Admin, SuperAdmin -- hasTenantFullAccess) continua vendo tudo, igual
 * hoje; o funcionario comum passa a usar "Minhas Vendas" (MinhasVendas.tsx),
 * que se identifica pelo mesmo PIN e mostra so as vendas dele.
 *
 * IMPORTANTE: isto e' uma barreira de FLUXO/TELA, nao blindagem de
 * Firestore. As regras continuam permitindo a query por tenantId pra
 * qualquer autenticado do tenant, igual antes -- esconder a lista aqui e'
 * so gestao de UX, nao seguranca de dado. Escopo aceito nesta fatia;
 * blindagem de verdade (regras + reescrita de query) fica pra outra
 * fatia, se um dia for necessaria.
 */
const listaGeralDeVendasEscondidaParaFuncionario = (args) => {
    if (!args.exigirIdentificacaoVendedor)
        return false;
    if (args.escondeVendas === false)
        return false;
    // Antes esta regra olhava SO o papel (Master/Admin) enquanto a outra trava
    // de visibilidade olhava o nivel de acesso. Dava o pior dos dois mundos:
    // marcar o gerente no nivel de cima nao devolvia a lista pra ele, e nao
    // existia tela nenhuma no sistema pra promover alguem a Admin. As duas
    // travas passam a responder a mesma pergunta.
    return !(0, visibilidadeVendasDomain_1.podeVerVendasDeTodos)({
        nivelAcesso: args.nivelAcesso,
        role: args.role,
        isOwner: args.isOwner,
    });
};
exports.listaGeralDeVendasEscondidaParaFuncionario = listaGeralDeVendasEscondidaParaFuncionario;
/** So' 'Ativo' (ou sem situacao gravada, como os cadastros antigos) segura o codigo. */
const cadastroSeguraCodigo = (cadastro) => {
    const situacao = String(cadastro?.status ?? '').trim();
    return situacao === '' || situacao === 'Ativo';
};
exports.cadastroSeguraCodigo = cadastroSeguraCodigo;
const nomeDoCadastroComCodigo = (cadastro) => (String(cadastro.nome || cadastro.nomeResponsavel || cadastro.email || 'um funcionário sem nome').trim());
exports.nomeDoCadastroComCodigo = nomeDoCadastroComCodigo;
/** Quem, alem de `ignorarId`, tem o codigo: o ativo (bloqueia) e os inativos (perdem o codigo). */
const quemTemOCodigo = (registros, codigo, ignorarId) => {
    const procurado = (0, exports.normalizarCodigoVendedor)(codigo);
    if (!procurado)
        return { ativo: null, inativos: [] };
    const mesmos = registros.filter((r) => r.id !== ignorarId && (0, exports.normalizarCodigoVendedor)(r.codigoVendedor) === procurado);
    return {
        ativo: mesmos.find((r) => (0, exports.cadastroSeguraCodigo)(r)) || null,
        inativos: mesmos.filter((r) => !(0, exports.cadastroSeguraCodigo)(r)),
    };
};
exports.quemTemOCodigo = quemTemOCodigo;
const mensagemCodigoDeOutroAtivo = (codigo, nome) => (`O código ${codigo} já é de ${nome}, que está ativo. Escolha outro código; se ${nome} não trabalha mais aí, inative o cadastro dele e use o código de novo.`);
exports.mensagemCodigoDeOutroAtivo = mensagemCodigoDeOutroAtivo;
const avisoCodigoSaiuDosInativos = (codigo, nomes) => (nomes.length === 0 ? '' : `O código ${codigo} estava no cadastro inativo de ${nomes.join(', ')} e saiu de lá.`);
exports.avisoCodigoSaiuDosInativos = avisoCodigoSaiuDosInativos;
