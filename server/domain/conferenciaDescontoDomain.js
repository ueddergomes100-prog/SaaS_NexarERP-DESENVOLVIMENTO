"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.podeLiberarDesconto = exports.lerPedidoDeLiberacao = exports.aprovacaoDoComprovante = exports.MENSAGEM_FALTA_IDENTIFICACAO = exports.MENSAGEM_FALTA_LIBERACAO = exports.problemaDaIdentificacao = exports.problemaDaLiberacao = exports.situacaoDoDescontoTotal = exports.problemaNoDescontoDoItem = exports.exigeIdentificacaoDoVendedor = exports.configDoDesconto = exports.PERMISSAO_LIBERAR_DESCONTO = exports.STATUS_PEDIR_DE_NOVO = exports.TIPO_IDENTIFICACAO = exports.TIPO_LIBERACAO = exports.IDADE_MAXIMA_DO_LOGIN_DO_APROVADOR_S = exports.MINUTOS_DE_VALIDADE = exports.VALIDADE_DO_COMPROVANTE_MS = exports.NOME_DA_TELA = exports.CAMPO_DO_LIMITE = void 0;
/*
 * DESCONTO, LIBERACAO E VENDEDOR CONFERIDOS PELO SERVIDOR (19/10/2026,
 * auditoria "so' a tela protege", decisao do dono: o servidor confere tudo).
 *
 * Com a chave "Venda pelo servidor" ligada, o Finalizar do Pedido de Venda, do
 * PDV e da OS passa pelo servidor, que agora tambem confere:
 *
 *  - o desconto de cada item contra o limite do PRODUTO (sempre bloqueia) e,
 *    no Pedido de Venda com o modo "bloquear", contra o limite da tela;
 *  - o desconto TOTAL contra o limite da tela (Configuracoes), descontado o
 *    que o cadastro do cliente ja autoriza, no modo da empresa
 *    (avisar/bloquear/senha) -- as mesmas regras de descontoDomain.ts;
 *  - no modo "senha", a LIBERACAO: o servidor confere a senha (ou o PIN) do
 *    aprovador e entrega um COMPROVANTE que vale pouco tempo, para aquela
 *    tela e aquele valor, e e' gasto na venda;
 *  - com "Exigir identificacao do vendedor" ligado (Pedido de Venda), que o
 *    vendedor da venda e' quem digitou codigo + senha (outro comprovante).
 *
 * Com a chave desligada, a tela segue conferindo sozinha (fica para a 3e).
 * O PRECO de cada item ainda vem da tela -- conferir preco e' outro passo.
 */
const descontoDomain_1 = require("./descontoDomain");
const roles_1 = require("./roles");
const vendedorPinDomain_1 = require("./vendedorPinDomain");
/** Campo de `configuracoes` com o limite de cada tela (o mesmo que a tela le). */
exports.CAMPO_DO_LIMITE = {
    pedido: 'limiteDescontoPedido',
    pdv: 'limiteDescontoPdv',
    os: 'limiteDescontoOS',
};
exports.NOME_DA_TELA = {
    pedido: 'Pedido de Venda',
    pdv: 'PDV',
    os: 'Ordem de Serviço',
};
/** Comprovante vale 30 minutos: da para fechar o pagamento com calma, mas nao serve no dia seguinte. */
exports.VALIDADE_DO_COMPROVANTE_MS = 30 * 60 * 1000;
exports.MINUTOS_DE_VALIDADE = exports.VALIDADE_DO_COMPROVANTE_MS / 60000;
/** A senha do aprovador tem de ter sido digitada agora (sessao do aprovador com no maximo 5 minutos). */
exports.IDADE_MAXIMA_DO_LOGIN_DO_APROVADOR_S = 5 * 60;
exports.TIPO_LIBERACAO = 'liberacao_desconto';
exports.TIPO_IDENTIFICACAO = 'identificacao_vendedor';
/** Status HTTP de "falta liberacao/identificacao valida": a tela pede de novo. */
exports.STATUS_PEDIR_DE_NOVO = 428;
exports.PERMISSAO_LIBERAR_DESCONTO = 'vendas.liberar_desconto';
const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
};
/** Limite e modo da tela, lidos de `configuracoes` como a tela le. */
const configDoDesconto = (config, tela) => ({
    limite: (0, descontoDomain_1.parseLimiteDescontoConfig)(config ? config[exports.CAMPO_DO_LIMITE[tela]] : undefined),
    modo: (0, descontoDomain_1.parseModoLimiteDesconto)(config ? config.modoLimiteDesconto : undefined),
});
exports.configDoDesconto = configDoDesconto;
/** A empresa exige que o vendedor se identifique (codigo + senha) a cada venda? */
const exigeIdentificacaoDoVendedor = (config) => ((0, vendedorPinDomain_1.parseExigirIdentificacaoVendedor)(config ? config.exigirIdentificacaoVendedor : undefined));
exports.exigeIdentificacaoDoVendedor = exigeIdentificacaoDoVendedor;
const descricaoDoLimite = (limite) => (limite.tipo === 'valor'
    ? `R$ ${limite.valor.toFixed(2).replace('.', ',')}`
    : `${String(limite.valor).replace('.', ',')}%`);
/**
 * Problema no desconto de UM item, ou null. Limite do produto sempre bloqueia
 * (como no Pedido e no PDV); o limite da tela por item so' no Pedido de Venda
 * com o modo "bloquear" (o unico lugar onde a tela confere item a item).
 */
const problemaNoDescontoDoItem = (item, tela, { limite, modo }) => {
    if (!(item.descontoCentavos > 0) || !(item.brutoCentavos > 0))
        return null;
    if (item.produto && (0, descontoDomain_1.excedeLimiteItem)(item.produto, item.descontoCentavos, item.brutoCentavos)) {
        return `${item.nome} aceita no máximo ${(0, descontoDomain_1.resolveLimiteItem)(item.produto)}% de desconto, definido no próprio cadastro. Reduza o desconto do item e finalize de novo.`;
    }
    if (tela === 'pedido' && modo === 'bloquear') {
        const checagem = (0, descontoDomain_1.checarLimiteTotal)(limite, item.brutoCentavos, item.descontoCentavos);
        if (checagem.excedeu) {
            return `O desconto de ${item.nome} (${checagem.percentualAplicado.toFixed(1).replace('.', ',')}%) passa do limite de ${descricaoDoLimite(limite)} configurado para ${exports.NOME_DA_TELA[tela]}. Reduza o desconto do item e finalize de novo.`;
        }
    }
    return null;
};
exports.problemaNoDescontoDoItem = problemaNoDescontoDoItem;
const situacaoDoDescontoTotal = (args) => {
    const checagem = (0, descontoDomain_1.checarLimiteComCliente)(args.config.limite, args.baseCentavos, args.descontoCentavos, args.percentualDoCliente);
    const percentual = checagem.percentualAplicado.toFixed(1).replace('.', ',');
    if (!checagem.excedeu)
        return { excedeu: false, percentualAplicado: checagem.percentualAplicado, erro: null, precisaLiberacao: false };
    if (args.config.modo === 'bloquear') {
        return {
            excedeu: true,
            percentualAplicado: checagem.percentualAplicado,
            erro: `O desconto (${percentual}%) passa do limite de ${descricaoDoLimite(args.config.limite)} configurado para ${exports.NOME_DA_TELA[args.tela]}. Reduza o desconto para continuar.`,
            precisaLiberacao: false,
        };
    }
    return { excedeu: true, percentualAplicado: checagem.percentualAplicado, erro: null, precisaLiberacao: args.config.modo === 'senha' };
};
exports.situacaoDoDescontoTotal = situacaoDoDescontoTotal;
const PEDIR_LIBERACAO_DE_NOVO = 'Toque em Finalizar de novo e peça a liberação outra vez.';
const IDENTIFICAR_DE_NOVO = 'Toque em Finalizar de novo e digite o código e a senha do vendedor.';
const problemaBasico = (c, esperado) => {
    if (!c || c.tenantId !== esperado.tenantId || c.tipo !== esperado.tipo || c.emitidoPara !== esperado.emitidoPara)
        return 'nao_vale';
    const expira = numero(c.expiraEmMs);
    if (!Number.isFinite(expira) || esperado.agoraMs > expira)
        return 'venceu';
    return null;
};
/** O comprovante de liberacao cobre este desconto? null = cobre. */
const problemaDaLiberacao = (c, esperado) => {
    const basico = problemaBasico(c, { ...esperado, tipo: exports.TIPO_LIBERACAO });
    if (basico === 'nao_vale' || (c && c.tela !== esperado.tela)) {
        return `A liberação do desconto não vale para esta venda (já foi usada ou foi dada em outra tela). ${PEDIR_LIBERACAO_DE_NOVO}`;
    }
    if (basico === 'venceu')
        return `A liberação do desconto venceu (vale ${exports.MINUTOS_DE_VALIDADE} minutos). ${PEDIR_LIBERACAO_DE_NOVO}`;
    const descontoLiberado = numero(c.descontoCentavos);
    const baseLiberada = numero(c.baseCentavos);
    const percentualLiberado = baseLiberada > 0 ? (descontoLiberado / baseLiberada) * 100 : 0;
    const percentualAgora = esperado.baseCentavos > 0 ? (esperado.descontoCentavos / esperado.baseCentavos) * 100 : 0;
    // 1 centavo de folga, como nos limites (arredondamento).
    if (!(esperado.descontoCentavos <= descontoLiberado + 1) || percentualAgora > percentualLiberado + 0.05) {
        return `O desconto mudou depois da liberação. ${PEDIR_LIBERACAO_DE_NOVO}`;
    }
    return null;
};
exports.problemaDaLiberacao = problemaDaLiberacao;
/** O comprovante de identificacao e' deste vendedor? null = e'. */
const problemaDaIdentificacao = (c, esperado) => {
    const basico = problemaBasico(c, { ...esperado, tipo: exports.TIPO_IDENTIFICACAO });
    if (basico === 'venceu')
        return `A identificação do vendedor venceu (vale ${exports.MINUTOS_DE_VALIDADE} minutos). ${IDENTIFICAR_DE_NOVO}`;
    if (basico === 'nao_vale' || c.pessoaId !== esperado.vendedorId) {
        return `Esta empresa exige que o vendedor se identifique em cada venda, e a identificação desta venda não confere (já foi usada ou é de outro vendedor). ${IDENTIFICAR_DE_NOVO}`;
    }
    return null;
};
exports.problemaDaIdentificacao = problemaDaIdentificacao;
exports.MENSAGEM_FALTA_LIBERACAO = `Este desconto passa do limite e precisa da liberação de um responsável. ${PEDIR_LIBERACAO_DE_NOVO}`;
exports.MENSAGEM_FALTA_IDENTIFICACAO = `Esta empresa exige que o vendedor se identifique em cada venda. ${IDENTIFICAR_DE_NOVO}`;
/** O que fica gravado na venda/OS: quem liberou vem do comprovante, nunca da tela. */
const aprovacaoDoComprovante = (c, comprovanteId) => ({
    modo: 'senha',
    aprovadoPorId: String(c.pessoaId || ''),
    aprovadoPorNome: String(c.pessoaNome || ''),
    aprovadoEm: typeof c.criadoEmIso === 'string' && c.criadoEmIso ? c.criadoEmIso : new Date().toISOString(),
    comprovanteId,
});
exports.aprovacaoDoComprovante = aprovacaoDoComprovante;
const lerPedidoDeLiberacao = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const tela = c.tela === 'pedido' || c.tela === 'pdv' || c.tela === 'os' ? c.tela : null;
    if (!tela)
        return { erro: 'Tela da liberação inválida. Atualize a página e tente de novo.' };
    const baseCentavos = numero(c.baseCentavos);
    const descontoCentavos = numero(c.descontoCentavos);
    if (!Number.isInteger(baseCentavos) || !Number.isInteger(descontoCentavos) || baseCentavos <= 0 || descontoCentavos <= 0 || descontoCentavos > baseCentavos) {
        return { erro: 'Valores do desconto inválidos. Confira o desconto e peça a liberação de novo.' };
    }
    const a = (c.aprovador && typeof c.aprovador === 'object' ? c.aprovador : {});
    if (a.tipo === 'login' && typeof a.idToken === 'string' && a.idToken.length > 20 && a.idToken.length < 5000) {
        return { pedido: { tela, baseCentavos, descontoCentavos, aprovador: { tipo: 'login', idToken: a.idToken } } };
    }
    if (a.tipo === 'vendedor' && typeof a.codigo === 'string' && typeof a.pin === 'string') {
        return { pedido: { tela, baseCentavos, descontoCentavos, aprovador: { tipo: 'vendedor', codigo: a.codigo, pin: a.pin } } };
    }
    return { erro: 'Escolha quem está liberando e digite a senha.' };
};
exports.lerPedidoDeLiberacao = lerPedidoDeLiberacao;
/** Quem pode liberar: dono, Admin/Master ou quem tem "Liberar desconto" (a mesma lista da tela). */
const podeLiberarDesconto = (registro, id, tenantId) => (0, roles_1.hasModuleAccess)({
    role: registro.role,
    isOwner: id === tenantId,
    permissions: Array.isArray(registro.permissoes) ? registro.permissoes.filter((p) => typeof p === 'string') : [],
    requiredPermission: exports.PERMISSAO_LIBERAR_DESCONTO,
});
exports.podeLiberarDesconto = podeLiberarDesconto;
