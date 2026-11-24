"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fraseDoComprovante = exports.textoDoAcertoNaConta = exports.lerPedidoDeDesfazerAcerto = exports.ROTULO_SITUACAO_ACERTO = exports.erroDeDevedoresDiferentes = exports.erroDaContaNoAcerto = exports.lerPedidoDeAcerto = exports.totalDoLado = exports.reaisDoAcerto = exports.OBSERVACAO_MAX = exports.LIMITE_CONTAS_POR_LADO = exports.FORMA_ACERTO_FORNECEDOR = void 0;
/**
 * ACERTO COM FORNECEDOR: o cliente paga direto o fornecedor (pedido do dono,
 * 24/11/2026, cliente Jomarly).
 *
 * "O cliente deve R$ 1.000 e a loja tem uma conta de R$ 500 com um fornecedor
 * e R$ 500 com outro. A loja pede para o cliente pagar direto os fornecedores."
 *
 * Uma operacao so' baixa as duas pontas: as contas a receber do cliente e as
 * contas a pagar dos fornecedores, pelo MESMO total, com a forma "Acerto com
 * Fornecedor". Nao mexe em caixa nem em banco: o dinheiro nunca passou pela
 * loja. Regras:
 *  - os dois lados somam o mesmo valor (o que o cliente pagou aos fornecedores
 *    e' exatamente o que sai da divida dele);
 *  - cada conta pode entrar por inteiro ou em parte (o resto fica em aberto,
 *    como no pagamento parcial de sempre);
 *  - todas as contas a receber sao do mesmo devedor;
 *  - serve tambem quando a mesma empresa e' cliente e fornecedor (ele deve e
 *    a loja deve a ele);
 *  - desfazer e' o acerto inteiro, com motivo: as duas pontas voltam juntas.
 *
 * A baixa de cada conta e' a de sempre (services/baixaFinanceira.js), em
 * sequencia, como a baixa em lote; o servidor confere tudo antes de gravar.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */
const baixaFinanceiraDomain_1 = require("./baixaFinanceiraDomain");
/** Forma gravada nas duas pontas. Nao e' forma de venda: so' existe na baixa do acerto. */
exports.FORMA_ACERTO_FORNECEDOR = 'Acerto com Fornecedor';
/** Ate' quantas contas de cada lado num acerto (cada uma e' uma gravacao). */
exports.LIMITE_CONTAS_POR_LADO = 20;
exports.OBSERVACAO_MAX = 300;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const reaisDoAcerto = (centavos) => (`R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`);
exports.reaisDoAcerto = reaisDoAcerto;
const objeto = (v) => (v && typeof v === 'object' ? v : {});
const lerLado = (bruto, nome) => {
    const lista = Array.isArray(bruto) ? bruto : [];
    if (lista.length === 0)
        return { erro: `Escolha ao menos uma conta ${nome}.` };
    if (lista.length > exports.LIMITE_CONTAS_POR_LADO) {
        return { erro: `Use no máximo ${exports.LIMITE_CONTAS_POR_LADO} contas ${nome} por acerto. Faça em mais de um acerto.` };
    }
    const vistos = new Set();
    const contas = [];
    for (const item of lista) {
        const c = objeto(item);
        const transacaoId = typeof c.transacaoId === 'string' ? c.transacaoId.trim() : '';
        if (!ID_VALIDO.test(transacaoId))
            return { erro: 'Conta inválida no acerto. Atualize a tela e escolha de novo.' };
        if (vistos.has(transacaoId))
            return { erro: 'A mesma conta apareceu duas vezes no acerto. Atualize a tela e escolha de novo.' };
        vistos.add(transacaoId);
        const valorCentavos = Number(c.valorCentavos);
        if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
            return { erro: `Informe quanto de cada conta ${nome} entra no acerto (valor maior que zero).` };
        }
        contas.push({ transacaoId, valorCentavos });
    }
    return { contas };
};
const totalDoLado = (contas) => (contas.reduce((soma, c) => soma + c.valorCentavos, 0));
exports.totalDoLado = totalDoLado;
/** Confere o pedido que veio da tela. Puro. */
const lerPedidoDeAcerto = (corpo, hoje) => {
    const c = objeto(corpo);
    const idAcerto = typeof c.idAcerto === 'string' ? c.idAcerto.trim() : '';
    if (!ID_VALIDO.test(idAcerto))
        return { erro: 'Acerto inválido. Atualize a tela e tente de novo.' };
    const receber = lerLado(c.receber, 'do cliente');
    if ('erro' in receber)
        return receber;
    const pagar = lerLado(c.pagar, 'de fornecedor');
    if ('erro' in pagar)
        return pagar;
    if (receber.contas.some((r) => pagar.contas.some((p) => p.transacaoId === r.transacaoId))) {
        return { erro: 'A mesma conta está dos dois lados do acerto. Atualize a tela e escolha de novo.' };
    }
    const totalReceber = (0, exports.totalDoLado)(receber.contas);
    const totalPagar = (0, exports.totalDoLado)(pagar.contas);
    if (totalReceber !== totalPagar) {
        return {
            erro: `Os dois lados precisam somar o mesmo valor: as contas do cliente somam ${(0, exports.reaisDoAcerto)(totalReceber)} e as dos fornecedores ${(0, exports.reaisDoAcerto)(totalPagar)}. `
                + 'Ajuste o valor de uma das contas (a diferença fica em aberto nela).',
        };
    }
    const data = typeof c.data === 'string' ? c.data.trim() : '';
    const erroData = (0, baixaFinanceiraDomain_1.validarDataBaixa)(data, hoje);
    if (erroData)
        return { erro: erroData };
    const observacao = String(c.observacao ?? '').replace(/\s+/g, ' ').trim().slice(0, exports.OBSERVACAO_MAX);
    return { pedido: { idAcerto, receber: receber.contas, pagar: pagar.contas, data, observacao } };
};
exports.lerPedidoDeAcerto = lerPedidoDeAcerto;
/** Por que esta conta nao pode entrar no acerto ('' = pode). */
const erroDaContaNoAcerto = (lado, conta, valorCentavos) => {
    const nome = String(conta.descricao || '').trim();
    const rotulo = nome ? `A conta "${nome}"` : 'Uma das contas';
    if (!conta.existe)
        return 'Uma das contas do acerto não existe mais. Atualize a tela e escolha de novo.';
    if (conta.tipo !== (lado === 'receber' ? 'entrada' : 'saida'))
        return `${rotulo} não é uma conta ${lado === 'receber' ? 'a receber' : 'a pagar'}. Atualize a tela.`;
    if (conta.status === 'Paga')
        return `${rotulo} já foi ${lado === 'receber' ? 'recebida' : 'paga'} (talvez por outra pessoa). Atualize a tela.`;
    if (conta.status !== 'Pendente')
        return `${rotulo} está ${String(conta.status || 'sem situação').toLowerCase()} e não pode entrar no acerto.`;
    if (conta.bloqueio)
        return `${rotulo} não pode entrar no acerto: ${conta.bloqueio}`;
    if (valorCentavos > conta.saldoCentavos) {
        return `${rotulo} tem ${(0, exports.reaisDoAcerto)(conta.saldoCentavos)} em aberto; não dá para acertar ${(0, exports.reaisDoAcerto)(valorCentavos)} nela.`;
    }
    return '';
};
exports.erroDaContaNoAcerto = erroDaContaNoAcerto;
/** Todas as contas a receber do acerto sao do mesmo devedor? */
const erroDeDevedoresDiferentes = (chaves) => (new Set(chaves.filter(Boolean)).size > 1
    ? 'As contas a receber do acerto são de clientes diferentes. Faça um acerto para cada cliente.'
    : '');
exports.erroDeDevedoresDiferentes = erroDeDevedoresDiferentes;
exports.ROTULO_SITUACAO_ACERTO = {
    em_andamento: 'Gravando',
    concluido: 'Feito',
    falhou: 'Não concluído',
    estornado: 'Desfeito',
};
/** Pedido de desfazer o acerto. Puro. */
const lerPedidoDeDesfazerAcerto = (corpo) => {
    const c = objeto(corpo);
    const acertoId = typeof c.acertoId === 'string' ? c.acertoId.trim() : '';
    if (!ID_VALIDO.test(acertoId))
        return { erro: 'Acerto inválido. Atualize a tela e tente de novo.' };
    const erroMotivo = (0, baixaFinanceiraDomain_1.validarMotivoEstorno)(c.motivo);
    if (erroMotivo)
        return { erro: erroMotivo };
    return { pedido: { acertoId, motivo: String(c.motivo).trim() } };
};
exports.lerPedidoDeDesfazerAcerto = lerPedidoDeDesfazerAcerto;
/** Texto que fica em cada conta: quem pagou quem. */
const textoDoAcertoNaConta = (lado, nomes) => {
    const fornecedores = nomes.fornecedores.filter(Boolean).join(', ') || 'fornecedor';
    return lado === 'receber'
        ? `Pago direto a ${fornecedores}`.slice(0, 200)
        : `Pago por ${nomes.cliente || 'cliente'}`.slice(0, 200);
};
exports.textoDoAcertoNaConta = textoDoAcertoNaConta;
/** Linha do recibo/comprovante do acerto. */
const fraseDoComprovante = (args) => (`${args.cliente || 'O cliente'} pagou ${(0, exports.reaisDoAcerto)(args.totalCentavos)} diretamente a ${args.fornecedores.filter(Boolean).join(', ') || 'fornecedor(es)'}, `
    + `por conta e ordem de ${args.empresa || 'nossa empresa'}. O valor foi abatido das contas do cliente e quitou as contas dos fornecedores relacionadas abaixo.`);
exports.fraseDoComprovante = fraseDoComprovante;
