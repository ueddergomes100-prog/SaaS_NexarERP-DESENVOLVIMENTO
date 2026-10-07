"use strict";
/**
 * TRANSFERENCIA DE ESTOQUE ENTRE FILIAIS (Filiais, fase 3 -- 2026-10-06).
 *
 * Fluxo (docs/PLANO_FILIAIS.md, secao 8c):
 *   Enviada  -> baixa na ORIGEM, mercadoria fica "em transito"
 *   Recebida -> entrada no DESTINO, com conferencia (a falta volta para a origem)
 *   Recusada (destino) / Cancelada (origem) -> tudo volta para a origem
 *
 * Sem nota: so' com "Transferencia sem nota" ligada na filial de origem e so'
 * dono ou gerente (decisao do dono). Com nota: fase 4.
 *
 * O produto e' o MESMO cadastro do grupo nas duas filiais (espelho, fase 1):
 * a copia no destino tem id previsivel (chave do grupo + filial).
 *
 * Puro (sem Firestore), compilado tambem para o servidor. O FEFO e o custo
 * medio repetem as regras de loteDomain.ts (escolherLotesFefo) e
 * custoEntradaDomain.ts (custoMedioPonderado) -- aqui sem as dependencias
 * deles, para o servidor nao carregar o resto do front.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.proximoStatusPermitido = exports.retornoCompleto = exports.planejarRecebimento = exports.planejarEnvio = exports.escolherLotesParaEnvio = exports.custoMedioDepoisDaEntrada = exports.idDoProdutoNaFilial = exports.podeTransferirSemNota = exports.parseTransferenciaSemNota = exports.MOTIVO_TRANSFERENCIA_RETORNO = exports.MOTIVO_TRANSFERENCIA_ENTRADA = exports.MOTIVO_TRANSFERENCIA_SAIDA = exports.ROTULO_STATUS_TRANSFERENCIA = void 0;
exports.ROTULO_STATUS_TRANSFERENCIA = {
    em_transito: 'Em trânsito',
    recebida: 'Recebida',
    recusada: 'Recusada',
    cancelada: 'Cancelada',
};
/** Motivos gravados em ajustes_estoque (Relatorio de Ajustes). */
exports.MOTIVO_TRANSFERENCIA_SAIDA = 'transferencia_saida';
exports.MOTIVO_TRANSFERENCIA_ENTRADA = 'transferencia_entrada';
exports.MOTIVO_TRANSFERENCIA_RETORNO = 'transferencia_retorno';
const parseTransferenciaSemNota = (valor) => valor === true;
exports.parseTransferenciaSemNota = parseTransferenciaSemNota;
/** Sem nota: so' dono/administrador ou funcionario de nivel gerente (decisao do dono). */
const podeTransferirSemNota = (usuario) => (['Master', 'Admin'].includes(String(usuario.role ?? '')) || ['gerente', 'administracao'].includes(String(usuario.nivelAcesso ?? '')));
exports.podeTransferirSemNota = podeTransferirSemNota;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
/** Id do produto numa filial: a filial onde o cadastro nasceu guarda o original (id = chave). */
const idDoProdutoNaFilial = (chave, filialOrigemDoCadastro, tenantId) => (tenantId === filialOrigemDoCadastro ? chave : `${chave}_${tenantId}`);
exports.idDoProdutoNaFilial = idDoProdutoNaFilial;
/** Custo medio ponderado depois da entrada (mesma regra de custoMedioPonderado). */
const custoMedioDepoisDaEntrada = (qtdAtual, custoAtual, qtdEntrada, custoEntrada) => {
    const atual = Number(qtdAtual) || 0;
    const entrada = Number(qtdEntrada) || 0;
    if (entrada <= 0)
        return r4(custoAtual);
    if (atual <= 0)
        return r4(custoEntrada);
    return r4((atual * (Number(custoAtual) || 0) + entrada * (Number(custoEntrada) || 0)) / (atual + entrada));
};
exports.custoMedioDepoisDaEntrada = custoMedioDepoisDaEntrada;
const diaDaData = (validade) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(validade ?? ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
/** FEFO: vence primeiro sai primeiro; vencido so' quando os vigentes nao cobrem. */
const escolherLotesParaEnvio = (quantidade, lotes, hoje) => {
    const diaHoje = diaDaData(hoje);
    const ordenados = lotes
        .filter((l) => Number(l.quantidade) > 0)
        .sort((a, b) => {
        const va = diaDaData(a.validade);
        const vb = diaDaData(b.validade);
        if (va === null && vb !== null)
            return 1;
        if (va !== null && vb === null)
            return -1;
        if (va !== null && vb !== null && va !== vb)
            return va - vb;
        return String(a.lote).localeCompare(String(b.lote), 'pt-BR', { numeric: true });
    });
    const vencido = (l) => { const d = diaDaData(l.validade); return d !== null && diaHoje !== null && d < diaHoje; };
    let restante = r4(quantidade);
    const movidos = [];
    for (const lote of [...ordenados.filter((l) => !vencido(l)), ...ordenados.filter(vencido)]) {
        if (restante <= 0)
            break;
        const usar = r4(Math.min(restante, Number(lote.quantidade)));
        if (usar <= 0)
            continue;
        movidos.push({ loteIdOrigem: lote.id, lote: lote.lote, validade: lote.validade ? String(lote.validade) : null, quantidade: usar });
        restante = r4(restante - usar);
    }
    return { lotes: movidos, semLote: restante > 0 ? restante : 0 };
};
exports.escolherLotesParaEnvio = escolherLotesParaEnvio;
const quantidadeValida = (q, produto) => {
    if (!(q > 0))
        return false;
    if (produto.unidadeMedidaFracionado !== true)
        return Number.isInteger(q);
    const casas = Math.max(0, Math.min(6, Number(produto.unidadeMedidaCasasDecimais ?? 3)));
    return Math.abs(q * 10 ** casas - Math.round(q * 10 ** casas)) < 1e-6;
};
const planejarEnvio = (params) => {
    const erros = [];
    // Mesma linha repetida vira uma so'.
    const somados = new Map();
    for (const p of params.pedidos) {
        const q = r4(Number(p.quantidade));
        if (!p.produtoId)
            continue;
        somados.set(p.produtoId, r4((somados.get(p.produtoId) || 0) + q));
    }
    if (somados.size === 0)
        return { ok: false, erros: ['Escolha ao menos um produto para transferir.'] };
    const itens = [];
    const baixas = [];
    const lotes = [];
    const saldoDoLote = new Map();
    let valorCentavos = 0;
    for (const [produtoId, quantidade] of somados) {
        const produto = params.produtos[produtoId];
        if (!produto || produto.tenantId !== params.origem) {
            erros.push('Um dos produtos não foi encontrado nesta filial. Atualize a tela e tente de novo.');
            continue;
        }
        const nome = texto(produto.nome) || 'produto';
        if (produto.ativo === false || produto.statusAtivo === false) {
            erros.push(`${nome} está inativo e não pode ser transferido.`);
            continue;
        }
        if (!quantidadeValida(quantidade, produto)) {
            erros.push(produto.unidadeMedidaFracionado
                ? `Quantidade inválida para ${nome}.`
                : `${nome} está na unidade ${produto.unidadeMedidaSigla || 'UN'}, que não aceita quantidade quebrada. Use um número inteiro.`);
            continue;
        }
        const saldo = Number(produto.quantidade) || 0;
        const disponivel = r4(saldo - Math.max(0, Number(produto.quantidadeReservada) || 0));
        if (quantidade > disponivel) {
            erros.push(`Estoque insuficiente de ${nome}: disponível ${disponivel}, pedido ${quantidade}.`);
            continue;
        }
        const chave = texto(produto.grupoChave) || produto.id;
        const filialDoCadastro = texto(produto.filialOrigem) || produto.tenantId;
        let movidos = [];
        let semLote = quantidade;
        if (produto.controlarLote === true) {
            const disponiveis = (params.lotesPorProduto[produtoId] || []).map((l) => ({ ...l, quantidade: saldoDoLote.get(l.id) ?? Number(l.quantidade) }));
            const escolha = (0, exports.escolherLotesParaEnvio)(quantidade, disponiveis, params.hoje);
            movidos = escolha.lotes;
            semLote = escolha.semLote;
            movidos.forEach((m) => {
                const depois = r4((saldoDoLote.get(m.loteIdOrigem) ?? Number(disponiveis.find((l) => l.id === m.loteIdOrigem)?.quantidade)) - m.quantidade);
                saldoDoLote.set(m.loteIdOrigem, depois);
            });
        }
        const custoUnitario = r4(Number(produto.precoCusto) || 0);
        valorCentavos += Math.round(custoUnitario * quantidade * 100);
        itens.push({
            chave,
            produtoIdOrigem: produto.id,
            produtoIdDestino: (0, exports.idDoProdutoNaFilial)(chave, filialDoCadastro, params.destino),
            codigo: texto(produto.codigo),
            nome,
            unidade: texto(produto.unidadeMedidaSigla) || 'UN',
            quantidade,
            custoUnitario,
            lotes: movidos,
            semLote: produto.controlarLote === true ? semLote : 0,
        });
        baixas.push({ produtoId, quantidadeAntes: saldo, quantidadeDepois: r4(saldo - quantidade), nome, codigo: texto(produto.codigo), quantidade });
    }
    saldoDoLote.forEach((quantidadeDepois, id) => lotes.push({ id, quantidadeDepois }));
    if (erros.length > 0)
        return { ok: false, erros };
    return { ok: true, itens, baixas, lotes, valorCentavos };
};
exports.planejarEnvio = planejarEnvio;
// ---------------------------------------------------------------------------
// Recebimento (com conferencia) e retorno
// ---------------------------------------------------------------------------
/** Reparte a quantidade recebida pelos lotes enviados, na ordem do envio; o resto e' o que faltou. */
const repartirRecebido = (item, recebida) => {
    let restante = r4(recebida);
    const chegou = [];
    const voltou = [];
    for (const lote of item.lotes) {
        const usar = r4(Math.min(restante, lote.quantidade));
        if (usar > 0)
            chegou.push({ ...lote, quantidade: usar });
        if (r4(lote.quantidade - usar) > 0)
            voltou.push({ ...lote, quantidade: r4(lote.quantidade - usar) });
        restante = r4(restante - usar);
    }
    const semLote = item.lotes.length > 0 || item.semLote > 0 ? item.semLote : item.quantidade;
    const chegouSemLote = r4(Math.min(restante, semLote));
    return { chegou, chegouSemLote, voltou, voltouSemLote: r4(semLote - chegouSemLote) };
};
const planejarRecebimento = (params) => {
    const erros = [];
    const itensFinais = [];
    const entradas = [];
    const lotesSomar = new Map();
    const lotesCriar = [];
    const retornos = [];
    const saldoNoDestino = new Map();
    params.itens.forEach((item, indice) => {
        const informada = params.recebidas[indice];
        const recebida = informada === undefined ? item.quantidade : r4(Number(informada));
        if (!(recebida >= 0) || recebida > item.quantidade) {
            erros.push(`Quantidade recebida de ${item.nome} precisa ficar entre 0 e ${item.quantidade}.`);
            return;
        }
        const produto = params.produtosDestino[item.produtoIdDestino];
        if (recebida > 0 && !produto) {
            erros.push(`O cadastro de ${item.nome} ainda não chegou nesta filial. Aguarde alguns segundos e tente de novo.`);
            return;
        }
        const partes = repartirRecebido(item, recebida);
        if (recebida > 0 && produto) {
            const atual = saldoNoDestino.get(produto.id) ?? { quantidade: Number(produto.quantidade) || 0, custo: Number(produto.precoCusto) || 0 };
            const depois = { quantidade: r4(atual.quantidade + recebida), custo: (0, exports.custoMedioDepoisDaEntrada)(atual.quantidade, atual.custo, recebida, item.custoUnitario) };
            saldoNoDestino.set(produto.id, depois);
            entradas.push({ produtoId: produto.id, quantidadeAntes: atual.quantidade, quantidadeDepois: depois.quantidade, precoCustoDepois: depois.custo, nome: item.nome, codigo: item.codigo, quantidade: recebida });
            for (const lote of partes.chegou) {
                const existente = (params.lotesDestino[produto.id] || []).find((l) => l.lote.toUpperCase() === lote.lote.toUpperCase() && (l.validade || null) === (lote.validade || null));
                if (existente)
                    lotesSomar.set(existente.id, r4((lotesSomar.get(existente.id) ?? Number(existente.quantidade)) + lote.quantidade));
                else {
                    const igual = lotesCriar.find((l) => l.produtoId === produto.id && l.lote === lote.lote && l.validade === lote.validade);
                    if (igual)
                        igual.quantidade = r4(igual.quantidade + lote.quantidade);
                    else
                        lotesCriar.push({ produtoId: produto.id, lote: lote.lote, validade: lote.validade, quantidade: lote.quantidade });
                }
            }
        }
        const faltou = r4(item.quantidade - recebida);
        if (faltou > 0)
            retornos.push({ produtoId: item.produtoIdOrigem, nome: item.nome, codigo: item.codigo, quantidade: faltou, lotes: partes.voltou });
        itensFinais.push({ ...item, quantidadeRecebida: recebida });
    });
    if (erros.length > 0)
        return { ok: false, erros };
    return {
        ok: true,
        itensFinais,
        entradas,
        lotesSomar: [...lotesSomar.entries()].map(([id, quantidadeDepois]) => ({ id, quantidadeDepois })),
        lotesCriar,
        retornos,
        divergente: retornos.length > 0,
    };
};
exports.planejarRecebimento = planejarRecebimento;
/** Tudo volta para a origem (recusa no destino ou cancelamento na origem). */
const retornoCompleto = (itens) => itens.map((item) => ({
    produtoId: item.produtoIdOrigem,
    nome: item.nome,
    codigo: item.codigo,
    quantidade: item.quantidade,
    lotes: item.lotes,
}));
exports.retornoCompleto = retornoCompleto;
const proximoStatusPermitido = (atual, proximo) => {
    if (atual !== 'em_transito')
        return `Esta transferência já está ${exports.ROTULO_STATUS_TRANSFERENCIA[atual].toLowerCase()}.`;
    if (!['recebida', 'recusada', 'cancelada'].includes(proximo))
        return 'Ação inválida para esta transferência.';
    return null;
};
exports.proximoStatusPermitido = proximoStatusPermitido;
