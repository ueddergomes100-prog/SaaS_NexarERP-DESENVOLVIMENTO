"use strict";
// Funcoes puras de Limite de Credito (venda a prazo em Pedido de Venda, OS,
// Orcamento e PDV). Sem Firestore -- a busca do saldo em aberto do cliente
// fica nas telas que consomem isto (mesmo filtro de transacoes usado em
// ContasReceber.tsx: status 'Pendente', exclui Cartao de Credito/Debito).
//
// So entra em jogo quando a config `trabalhaComLimiteCredito` esta ligada E
// a venda e' a prazo (condicaoPagamento === 'aprazo', calculado em
// financeDomain.ts). Bloqueia direto, sem modo de aviso/senha -- diferente
// do desconto maximo, aqui o pedido do usuario foi um toggle simples
// sim/nao.
Object.defineProperty(exports, "__esModule", { value: true });
exports.distribuirConsumoCredito = exports.somarCreditosCentavos = exports.MENSAGEM_CREDITO_CONCORRENTE = exports.creditoFoiAlteradoDurante = exports.parseCreditoVersao = exports.CAMPO_CREDITO_VERSAO = exports.parseTrabalhaComLimiteCredito = exports.excedeLimiteCredito = void 0;
const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
/**
 * Confere se uma venda a prazo pode ser finalizada.
 * `limiteDeCreditoCents`: limite cadastrado no cliente, null/undefined/<=0 =
 * sem limite cadastrado.
 * `saldoEmAbertoCents`: soma das transacoes pendentes do cliente, ja em
 * centavos (sem contar a venda atual).
 * `valorVendaCents`: valor da venda que esta sendo finalizada, em centavos.
 */
const excedeLimiteCredito = (limiteDeCreditoCents, saldoEmAbertoCents, valorVendaCents) => {
    const limite = toFiniteNumber(limiteDeCreditoCents);
    if (limite <= 0)
        return { bloqueado: true, motivo: 'sem_limite' };
    const totalCents = Math.max(0, toFiniteNumber(saldoEmAbertoCents)) + Math.max(0, toFiniteNumber(valorVendaCents));
    if (totalCents > limite)
        return { bloqueado: true, motivo: 'limite_excedido' };
    return { bloqueado: false, motivo: null };
};
exports.excedeLimiteCredito = excedeLimiteCredito;
const parseTrabalhaComLimiteCredito = (raw) => raw === true;
exports.parseTrabalhaComLimiteCredito = parseTrabalhaComLimiteCredito;
// ---------------------------------------------------------------------------
// Guarda de concorrencia da venda a prazo
// ---------------------------------------------------------------------------
//
// O saldo em aberto vem de uma CONSULTA na colecao `transacoes`
// (contasReceberQuery.ts), e o SDK cliente do Firestore nao aceita consulta
// dentro de transacao -- `Transaction.get()` so recebe DocumentReference.
// Ou seja: e' impossivel ler o saldo dentro da transacao que grava a venda.
//
// Sem guarda, existe esta janela: dois vendedores atendem o MESMO cliente a
// prazo ao mesmo tempo, os dois leem o mesmo saldo, os dois passam na
// checagem e os dois gravam -- estourando o limite de credito.
//
// A guarda fecha isso sem denormalizar dinheiro nenhum: o cliente carrega um
// contador `creditoVersao`, lido junto com o saldo e conferido DENTRO da
// transacao. Se outra venda a prazo do mesmo cliente entrou nesse meio tempo,
// o numero mudou, a gravacao para e o vendedor refaz com o saldo atual.
//
// Por que contador em vez de guardar o proprio saldo no cliente: saldo
// duplicado precisaria ser mantido em todo lugar que cria, baixa, cancela ou
// devolve titulo -- e um saldo duplicado que sai de sincronia erra nos DOIS
// sentidos (barra venda boa, ou libera venda que estourou). O contador so
// precisa mudar, nao precisa estar certo.
//
// So a venda a prazo incrementa. Recebimento em ContasReceber diminui o saldo
// e NAO mexe aqui de proposito: se acontecer durante a janela, a checagem usa
// um saldo maior que o real e no maximo bloqueia uma venda que caberia -- erra
// para o lado seguro, e o vendedor resolve refazendo.
/** Nome do campo no documento do cliente. */
exports.CAMPO_CREDITO_VERSAO = 'creditoVersao';
/** Cliente antigo (sem o campo) ou valor corrompido comeca em 0. */
const parseCreditoVersao = (raw) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};
exports.parseCreditoVersao = parseCreditoVersao;
/**
 * `true` quando outra venda a prazo do mesmo cliente foi gravada entre a
 * leitura do saldo e esta gravacao -- ou seja, o saldo em maos esta velho.
 */
const creditoFoiAlteradoDurante = (versaoNaChecagem, versaoNaGravacao) => (0, exports.parseCreditoVersao)(versaoNaChecagem) !== (0, exports.parseCreditoVersao)(versaoNaGravacao);
exports.creditoFoiAlteradoDurante = creditoFoiAlteradoDurante;
/** Mensagem unica das telas que vendem a prazo (Pedido de Venda e OS). */
exports.MENSAGEM_CREDITO_CONCORRENTE = 'Outra venda a prazo para este cliente foi finalizada agora há pouco, e o saldo em aberto mudou. Nada foi gravado: finalize novamente para o limite de crédito ser conferido com o saldo atual.';
const somarCreditosCentavos = (creditos) => creditos
    .reduce((total, credito) => total + Math.max(0, toFiniteNumber(credito.saldoDisponivelCentavos)), 0);
exports.somarCreditosCentavos = somarCreditosCentavos;
/**
 * Distribui `valorCentavos` entre os creditos disponiveis, do mais antigo
 * pro mais novo (a ordem da lista recebida). Devolve so os creditos que
 * foram efetivamente tocados.
 *
 * Lanca quando o valor pedido nao cabe no saldo total -- e' dinheiro: e'
 * melhor a venda falhar e o operador reabrir do que gravar um abatimento
 * maior do que o credito que o cliente tinha.
 */
const distribuirConsumoCredito = (creditos, valorCentavos) => {
    const pedido = Math.max(0, toFiniteNumber(valorCentavos));
    if (pedido === 0)
        return [];
    if (pedido > (0, exports.somarCreditosCentavos)(creditos)) {
        throw new Error('O saldo de crédito disponível é menor que o valor informado.');
    }
    let restante = pedido;
    const consumos = [];
    for (const credito of creditos) {
        if (restante <= 0)
            break;
        const disponivel = Math.max(0, toFiniteNumber(credito.saldoDisponivelCentavos));
        if (disponivel <= 0)
            continue;
        const usado = Math.min(disponivel, restante);
        consumos.push({
            id: credito.id,
            usadoCentavos: usado,
            saldoRestanteCentavos: disponivel - usado,
        });
        restante -= usado;
    }
    return consumos;
};
exports.distribuirConsumoCredito = distribuirConsumoCredito;
