"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resumirImportacao = exports.trocarNumeroNoTexto = exports.planoDeRenumeracao = exports.mensagemPedidoDoSistemaAnterior = exports.ehPedidoDoSistemaAnterior = exports.sementeIdPedidoImportado = exports.montarPedidoImportado = exports.itensDoPedidoImportado = exports.ITEM_AVULSO = exports.sugerirVendedor = exports.chaveDoVendedor = exports.vendedoresDoArquivo = exports.lerPedidosImportados = exports.formatarNumeroImportado = exports.lerPagamentos = exports.lerDataBr = exports.lerNumeroBr = exports.inferirMapeamentoPedidos = exports.CAMPOS_OBRIGATORIOS_PEDIDOS = exports.DIGITOS_NUMERO_IMPORTADO = exports.SITUACAO_PRE_VENDA = exports.SITUACAO_FATURADO = void 0;
const financeDomain_1 = require("./financeDomain");
const preVendaDomain_1 = require("./preVendaDomain");
/**
 * IMPORTAR PEDIDOS DO SISTEMA ANTERIOR (23/11/2026, migracao Embala Minas).
 *
 * Decisoes do dono:
 *  - vendas FATURADAS entram como Pedido de Venda de verdade (status
 *    Finalizada), com o numero do sistema antigo. Sao REGISTRO: nao baixam
 *    estoque, nao lancam caixa nem contas a receber (o saldo de estoque e as
 *    contas em aberto ja foram importados) e entram com comissao zero (a
 *    comissao delas foi paga no sistema antigo -- somar de novo no Relatorio
 *    de Comissoes faria pagar duas vezes);
 *  - PRE-VENDAS em aberto entram como pre-venda aberta, com reserva de
 *    estoque, para o caixa faturar normalmente no Hennder;
 *  - as vendas feitas no Hennder antes da importacao passam a seguir a
 *    numeracao, depois do ultimo numero antigo (planoDeRenumeracao).
 *
 * Um pedido importado nunca pode ser cancelado, devolvido, trocado, ter nota
 * emitida ou o pagamento alterado no Hennder: essas acoes estornariam estoque
 * e financeiro que o Hennder nunca lancou. Ver ehPedidoDoSistemaAnterior e
 * mensagemPedidoDoSistemaAnterior.
 *
 * Arquivo: CSV com uma linha por item (gerado na migracao, ver
 * 11_gerar_pedidos.py). Os numeros vem no formato brasileiro (1.234,56).
 */
exports.SITUACAO_FATURADO = 'faturado';
exports.SITUACAO_PRE_VENDA = 'pre-venda';
/** Os numeros antigos entram com 6 digitos ("093255"): a numeracao do Hennder
 *  acha o maior numero gravado comparando como TEXTO, e "99999" passaria na
 *  frente de "113696". Com o mesmo tamanho, texto e numero dao a mesma ordem. */
exports.DIGITOS_NUMERO_IMPORTADO = 6;
const APELIDOS = {
    situacao: ['situacao', 'status'],
    pedido: ['pedido', 'numero do pedido', 'numero'],
    data: ['data', 'data do pedido', 'emissao'],
    hora: ['hora', 'horario'],
    documento: ['cpf/cnpj', 'cpf cnpj', 'documento'],
    cliente: ['cliente', 'nome do cliente'],
    codigoVendedor: ['codigo do vendedor', 'cod vendedor'],
    vendedor: ['vendedor', 'nome do vendedor'],
    observacao: ['observacao', 'obs'],
    pagamentos: ['pagamentos', 'forma de pagamento', 'formas de pagamento'],
    descontoPedido: ['desconto do pedido', 'desconto geral'],
    frete: ['frete'],
    encargos: ['encargos', 'acrescimo'],
    totalPedido: ['total do pedido', 'valor do pedido'],
    codigoProduto: ['codigo do produto', 'referencia', 'cod produto'],
    produto: ['produto', 'descricao'],
    quantidade: ['quantidade', 'qtd'],
    unidade: ['unidade', 'un'],
    valorUnitario: ['valor unitario', 'preco unitario'],
    descontoItem: ['desconto do item'],
    valorTotalItem: ['valor total do item', 'total do item'],
};
exports.CAMPOS_OBRIGATORIOS_PEDIDOS = ['situacao', 'pedido', 'data', 'produto', 'quantidade', 'valorTotalItem', 'totalPedido'];
const normalizarTexto = (valor) => String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
const inferirMapeamentoPedidos = (cabecalho) => {
    const normalizado = cabecalho.map(normalizarTexto);
    const mapa = {};
    Object.keys(APELIDOS).forEach((campo) => {
        const indice = normalizado.findIndex((col) => APELIDOS[campo].includes(col));
        mapa[campo] = indice >= 0 ? indice : null;
    });
    return mapa;
};
exports.inferirMapeamentoPedidos = inferirMapeamentoPedidos;
/** "1.234,56" -> 1234.56; "" -> 0. Aceita tambem "1234.56". */
const lerNumeroBr = (valor) => {
    const texto = String(valor ?? '').trim();
    if (!texto)
        return 0;
    const limpo = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
    const n = Number(limpo);
    return Number.isFinite(n) ? n : NaN;
};
exports.lerNumeroBr = lerNumeroBr;
/** "01/02/2025" -> "2025-02-01"; formato invalido -> ''. */
const lerDataBr = (valor) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor ?? '').trim());
    if (!m)
        return '';
    const [, d, mes, a] = m;
    const data = new Date(`${a}-${mes}-${d}T12:00:00`);
    if (Number.isNaN(data.getTime()) || data.getUTCDate() !== Number(d))
        return '';
    return `${a}-${mes}-${d}`;
};
exports.lerDataBr = lerDataBr;
const FORMAS_ACEITAS = [
    'Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Cheque',
    'Pagamento a Prazo', 'Crédito de Devolução', 'Cashback', 'Outros',
];
/** "Dinheiro=10,00 | Pix=5,50" -> pagamentos. Forma desconhecida vira "Outros". */
const lerPagamentos = (texto) => {
    const partes = String(texto ?? '').split('|').map((p) => p.trim()).filter(Boolean);
    const somado = new Map();
    partes.forEach((parte) => {
        const [formaBruta, valorBruto] = parte.split('=');
        const valor = (0, exports.lerNumeroBr)(valorBruto);
        if (!Number.isFinite(valor) || valor <= 0)
            return;
        const forma = FORMAS_ACEITAS.find((f) => normalizarTexto(f) === normalizarTexto(formaBruta)) || 'Outros';
        somado.set(forma, Math.round(((somado.get(forma) || 0) + valor) * 100) / 100);
    });
    return [...somado.entries()].map(([forma, valor]) => ({ forma, valor }));
};
exports.lerPagamentos = lerPagamentos;
const arredonda = (v) => Math.round(v * 100) / 100;
const lerSituacao = (valor) => {
    const t = normalizarTexto(valor).replace(/[\s_-]+/g, '');
    if (t === 'faturado' || t === 'finalizado' || t === 'finalizada')
        return exports.SITUACAO_FATURADO;
    if (t === 'prevenda')
        return exports.SITUACAO_PRE_VENDA;
    return null;
};
const formatarNumeroImportado = (valor) => {
    const digitos = String(valor ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return digitos ? digitos.padStart(exports.DIGITOS_NUMERO_IMPORTADO, '0') : '';
};
exports.formatarNumeroImportado = formatarNumeroImportado;
/** Agrupa as linhas (uma por item) em pedidos e confere cada um. */
const lerPedidosImportados = (linhas, mapa) => {
    const celula = (linha, campo) => {
        const i = mapa[campo];
        return i === null || i === undefined ? '' : String(linha[i] ?? '').trim();
    };
    const porNumero = new Map();
    const ordem = [];
    linhas.forEach((linha) => {
        const numero = (0, exports.formatarNumeroImportado)(celula(linha, 'pedido'));
        if (!numero)
            return;
        let pedido = porNumero.get(numero);
        if (!pedido) {
            const situacao = lerSituacao(celula(linha, 'situacao'));
            const data = (0, exports.lerDataBr)(celula(linha, 'data'));
            const numeros = [(0, exports.lerNumeroBr)(celula(linha, 'descontoPedido')), (0, exports.lerNumeroBr)(celula(linha, 'frete')), (0, exports.lerNumeroBr)(celula(linha, 'encargos')), (0, exports.lerNumeroBr)(celula(linha, 'totalPedido'))];
            let problema = '';
            if (!situacao)
                problema = `Situação "${celula(linha, 'situacao')}" desconhecida: use Faturado ou Pré-venda.`;
            else if (!data)
                problema = `Data "${celula(linha, 'data')}" inválida: use dd/mm/aaaa.`;
            else if (numeros.some((n) => !Number.isFinite(n) || n < 0))
                problema = 'Desconto, frete, encargos ou total do pedido com valor inválido.';
            pedido = {
                situacao: situacao || exports.SITUACAO_FATURADO,
                numero,
                data,
                hora: celula(linha, 'hora'),
                documentoCliente: celula(linha, 'documento'),
                nomeCliente: celula(linha, 'cliente').toUpperCase(),
                codigoVendedor: celula(linha, 'codigoVendedor'),
                nomeVendedor: celula(linha, 'vendedor').toUpperCase(),
                observacao: celula(linha, 'observacao'),
                pagamentos: (0, exports.lerPagamentos)(celula(linha, 'pagamentos')),
                descontoPedido: arredonda(numeros[0] || 0),
                frete: arredonda(numeros[1] || 0),
                encargos: arredonda(numeros[2] || 0),
                totalPedido: arredonda(numeros[3] || 0),
                itens: [],
                problema,
            };
            porNumero.set(numero, pedido);
            ordem.push(numero);
        }
        const quantidade = (0, exports.lerNumeroBr)(celula(linha, 'quantidade'));
        const valorTotal = (0, exports.lerNumeroBr)(celula(linha, 'valorTotalItem'));
        const valorUnitario = (0, exports.lerNumeroBr)(celula(linha, 'valorUnitario'));
        const descontoItem = (0, exports.lerNumeroBr)(celula(linha, 'descontoItem'));
        const produto = celula(linha, 'produto').toUpperCase();
        if (!pedido.problema && (!produto || !Number.isFinite(quantidade) || quantidade <= 0 || !Number.isFinite(valorTotal) || valorTotal < 0)) {
            pedido.problema = `Item "${produto || 'sem nome'}" com quantidade ou valor inválido.`;
        }
        pedido.itens.push({
            codigoProduto: celula(linha, 'codigoProduto'),
            produto,
            quantidade: Number.isFinite(quantidade) ? quantidade : 0,
            unidade: celula(linha, 'unidade').toUpperCase(),
            valorUnitario: Number.isFinite(valorUnitario) && valorUnitario > 0 ? valorUnitario : (quantidade > 0 ? arredonda(valorTotal / quantidade) : 0),
            descontoItem: Number.isFinite(descontoItem) && descontoItem > 0 ? arredonda(descontoItem) : 0,
            valorTotal: Number.isFinite(valorTotal) ? arredonda(valorTotal) : 0,
        });
    });
    return ordem.map((numero) => {
        const pedido = porNumero.get(numero);
        if (!pedido.problema) {
            const somaItens = pedido.itens.reduce((s, i) => s + i.valorTotal, 0);
            const calculado = arredonda(somaItens - pedido.descontoPedido + pedido.frete + pedido.encargos);
            if (Math.abs(calculado - pedido.totalPedido) >= 0.02) {
                pedido.problema = `Os itens não fecham com o total do pedido (itens - desconto + frete + encargos = ${calculado.toFixed(2).replace('.', ',')}; total ${pedido.totalPedido.toFixed(2).replace('.', ',')}).`;
            }
        }
        return pedido;
    });
};
exports.lerPedidosImportados = lerPedidosImportados;
const vendedoresDoArquivo = (pedidos) => {
    const porChave = new Map();
    pedidos.forEach((p) => {
        const chave = p.codigoVendedor || p.nomeVendedor;
        if (!chave)
            return;
        const atual = porChave.get(chave) || { codigo: p.codigoVendedor, nome: p.nomeVendedor, pedidos: 0 };
        atual.pedidos += 1;
        porChave.set(chave, atual);
    });
    return [...porChave.values()].sort((a, b) => b.pedidos - a.pedidos || a.nome.localeCompare(b.nome, 'pt-BR'));
};
exports.vendedoresDoArquivo = vendedoresDoArquivo;
/** Chave do vendedor no arquivo (o que vendedoresDoArquivo usa). */
const chaveDoVendedor = (p) => p.codigoVendedor || p.nomeVendedor;
exports.chaveDoVendedor = chaveDoVendedor;
/**
 * Usuario do Hennder com o mesmo nome do vendedor antigo: nome inteiro igual
 * ou, sem isso, o primeiro nome igual a UM so' usuario. '' = criar inativo.
 * E' so' a sugestao inicial: a tela mostra e o dono confirma.
 */
const sugerirVendedor = (nomeAntigo, usuarios) => {
    const alvo = normalizarTexto(nomeAntigo);
    if (!alvo)
        return '';
    const inteiro = usuarios.filter((u) => normalizarTexto(u.nome) === alvo);
    if (inteiro.length === 1)
        return inteiro[0].id;
    const primeiro = alvo.split(' ')[0];
    if (primeiro.length < 3)
        return '';
    const porPrimeiro = usuarios.filter((u) => normalizarTexto(u.nome).split(' ')[0] === primeiro);
    return porPrimeiro.length === 1 ? porPrimeiro[0].id : '';
};
exports.sugerirVendedor = sugerirVendedor;
const NATUREZA = {
    Dinheiro: 'caixa_fisico',
    Pix: 'bancario_digital',
    'Cartão de Crédito': 'bancario_digital',
    'Cartão de Débito': 'bancario_digital',
    Transferência: 'bancario_digital',
    Boleto: 'contas_receber',
    Cheque: 'caixa_fisico',
    'Pagamento a Prazo': 'contas_receber',
    'Crédito de Devolução': 'credito_cliente',
    Cashback: 'credito_cliente',
    Outros: 'bancario_digital',
};
exports.ITEM_AVULSO = 'avulso';
/** Itens no formato do Pedido de Venda. Produto que nao existe mais vira item avulso (so' na venda faturada). */
const itensDoPedidoImportado = (pedido, produtoDoItem) => {
    const semProduto = [];
    const itens = pedido.itens.map((item) => {
        const produto = produtoDoItem(item);
        if (!produto)
            semProduto.push(item.produto);
        const sigla = String(produto?.unidadeMedidaSigla || item.unidade || 'UN').toUpperCase();
        return {
            id: produto ? produto.id : exports.ITEM_AVULSO,
            nome: produto ? produto.nome : item.produto,
            ...(item.codigoProduto ? { codigo: item.codigoProduto } : {}),
            precoUnitario: item.valorUnitario,
            quantidade: item.quantidade,
            desconto: item.descontoItem,
            subtotal: item.valorTotal,
            unidadeMedidaSigla: sigla,
            unidadeMedidaFracionado: produto?.unidadeMedidaFracionado === true,
            unidadeMedidaCasasDecimais: Number.isInteger(produto?.unidadeMedidaCasasDecimais) ? Number(produto?.unidadeMedidaCasasDecimais) : 0,
        };
    });
    return { itens, semProduto };
};
exports.itensDoPedidoImportado = itensDoPedidoImportado;
const rotuloDasFormas = (pagamentos) => {
    if (pagamentos.length === 0)
        return 'Não informado';
    return pagamentos.map((p) => p.forma).join(' + ');
};
/**
 * Documento do pedido importado, sem os carimbos de data (createdAt,
 * importadoEm), que a tela poe com serverTimestamp. Nenhuma chave undefined.
 */
const montarPedidoImportado = (pedido, ctx) => {
    const { itens } = (0, exports.itensDoPedidoImportado)(pedido, ctx.produtoDoItem);
    const faturado = pedido.situacao === exports.SITUACAO_FATURADO;
    const valorTotalItens = arredonda(itens.reduce((s, i) => s + i.subtotal, 0));
    const descontosDosItens = arredonda(itens.reduce((s, i) => s + i.desconto, 0));
    const valorTotal = pedido.totalPedido;
    const aPrazo = pedido.pagamentos.filter((p) => NATUREZA[p.forma] === 'contas_receber').reduce((s, p) => s + p.valor, 0);
    const pagamentos = faturado ? pedido.pagamentos.map((p, indice) => ({
        id: `importado_${indice + 1}`,
        indice,
        formaPagamento: p.forma,
        condicaoPagamento: NATUREZA[p.forma] === 'contas_receber' ? 'aprazo' : 'avista',
        valorCentavos: (0, financeDomain_1.toCents)(p.valor),
        valor: p.valor,
        status: NATUREZA[p.forma] === 'contas_receber' ? 'pendente' : 'confirmado',
        naturezaFinanceira: NATUREZA[p.forma],
        // Registro do que aconteceu no sistema antigo: nao gerou caixa nem conta aqui.
        movimentaCaixaFisico: false,
    })) : [];
    const observacao = [pedido.observacao, `[Importado do sistema anterior: pedido ${pedido.numero.replace(/^0+/, '')}${pedido.hora ? `, ${pedido.hora}` : ''}]`]
        .filter(Boolean).join(' ').slice(0, 1000);
    return {
        numeroPedido: pedido.numero,
        clienteId: ctx.clienteId,
        clienteNome: ctx.clienteNome || 'CONSUMIDOR FINAL',
        observacao,
        itens,
        promocaoIds: [],
        valorTotalItens,
        valorTotalItensCentavos: (0, financeDomain_1.toCents)(valorTotalItens),
        valorTotalDescontos: arredonda(descontosDosItens + pedido.descontoPedido),
        valorTotalDescontosCentavos: (0, financeDomain_1.toCents)(descontosDosItens + pedido.descontoPedido),
        descontoGeral: { tipo: 'valor', valorInformado: pedido.descontoPedido, valorAplicadoCentavos: (0, financeDomain_1.toCents)(pedido.descontoPedido), excedeuLimite: false },
        frete: pedido.frete,
        encargos: pedido.encargos,
        valorTotal,
        valorTotalCentavos: (0, financeDomain_1.toCents)(valorTotal),
        ...(faturado ? {
            formaPagamento: rotuloDasFormas(pedido.pagamentos),
            condicaoPagamento: aPrazo > 0.004 ? 'aprazo' : 'avista',
            pagamentos,
            totalRecebido: arredonda(valorTotal - aPrazo),
            totalRecebidoCentavos: (0, financeDomain_1.toCents)(valorTotal - aPrazo),
            totalPendente: arredonda(aPrazo),
            totalPendenteCentavos: (0, financeDomain_1.toCents)(aPrazo),
            totalTaxasPagamento: 0,
            totalTaxasPagamentoCentavos: 0,
            totalLiquidoFinanceiro: valorTotal,
            totalLiquidoFinanceiroCentavos: (0, financeDomain_1.toCents)(valorTotal),
            // Comissao ja' paga no sistema antigo: zero aqui, para nao pagar de novo.
            comissao: {
                tipo: 'percentual_produtos',
                vendedorId: ctx.vendedorId,
                vendedorNome: ctx.vendedorNome,
                baseOriginalCentavos: 0, baseOriginal: 0, baseAtualCentavos: 0, baseAtual: 0,
                percentual: 0,
                valorOriginalCentavos: 0, valorOriginal: (0, financeDomain_1.fromCents)(0), valorAtualCentavos: 0, valorAtual: 0,
                status: 'nao_aplicavel',
                regraVersion: 1,
                geradaEm: `${pedido.data}T12:00:00.000Z`,
                itens: [],
            },
        } : {}),
        dataVenda: pedido.data,
        status: faturado ? preVendaDomain_1.STATUS_FINALIZADA : preVendaDomain_1.STATUS_PRE_VENDA,
        origem: 'balcao',
        // Venda faturada: nada reservado (estoque ja' veio com o saldo do sistema antigo).
        // Pre-venda: reserva, como qualquer pre-venda do Hennder (a tela aplica no estoque).
        estoqueReservado: !faturado && itens.length > 0,
        entregaFutura: false,
        ...(!faturado && ctx.conferenciaAtiva ? { statusConferencia: 'aguardando' } : {}),
        tenantId: ctx.tenantId,
        usuarioResponsavelId: ctx.usuarioId,
        vendedorId: ctx.vendedorId,
        vendedorNome: ctx.vendedorNome,
        importadoSistemaAnterior: true,
        sistemaAnterior: {
            numero: pedido.numero.replace(/^0+/, ''),
            ...(pedido.hora ? { hora: pedido.hora } : {}),
            situacao: pedido.situacao,
            arquivo: ctx.arquivoOrigem,
        },
    };
};
exports.montarPedidoImportado = montarPedidoImportado;
/** Semente do id fixo do pedido importado: importar o mesmo arquivo de novo nao duplica. */
const sementeIdPedidoImportado = (tenantId, numero) => `${tenantId}|pedido-anterior|${numero}`;
exports.sementeIdPedidoImportado = sementeIdPedidoImportado;
const ehPedidoDoSistemaAnterior = (pedido) => (pedido?.importadoSistemaAnterior === true);
exports.ehPedidoDoSistemaAnterior = ehPedidoDoSistemaAnterior;
/** Texto do bloqueio, igual em toda tela e no servidor. `acao`: "cancelada", "devolvida"... */
const mensagemPedidoDoSistemaAnterior = (acao) => (`Esta venda veio do sistema anterior na migração e não pode ser ${acao} no Hennder: o estoque e o financeiro dela ficaram no sistema antigo. `
    + 'Se precisar corrigir algo, lance um ajuste de estoque ou uma conta à mão.');
exports.mensagemPedidoDoSistemaAnterior = mensagemPedidoDoSistemaAnterior;
/**
 * As vendas feitas no Hennder ANTES da importacao (decisao do dono: "deixar os
 * que fizeram hoje na sequencia") passam a vir logo depois do ultimo numero
 * antigo, na ordem em que foram criadas. Devolve so' quem muda de numero.
 */
const planoDeRenumeracao = (pedidos, ultimoImportado) => {
    const ordenados = [...pedidos].sort((a, b) => (a.criadoEmMs - b.criadoEmMs) || (Number(a.numeroPedido.replace(/\D/g, '')) - Number(b.numeroPedido.replace(/\D/g, ''))));
    return ordenados.map((p, i) => ({ id: p.id, de: p.numeroPedido, para: String(ultimoImportado + 1 + i).padStart(exports.DIGITOS_NUMERO_IMPORTADO, '0') }))
        .filter((r) => r.de !== r.para);
};
exports.planoDeRenumeracao = planoDeRenumeracao;
/** Troca "#0012" por "#113697" num texto (descricao de lancamento), so' o numero inteiro. */
const trocarNumeroNoTexto = (texto, de, para) => {
    if (!texto || !de)
        return texto;
    const semZeros = de.replace(/^0+(?=\d)/, '');
    const alvos = [...new Set([de, semZeros])].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return texto.replace(new RegExp(`#(?:${alvos.join('|')})(?!\\d)`, 'g'), `#${para}`);
};
exports.trocarNumeroNoTexto = trocarNumeroNoTexto;
const resumirImportacao = (pedidos) => {
    const certos = pedidos.filter((p) => !p.problema && !p.fora);
    const fat = certos.filter((p) => p.situacao === exports.SITUACAO_FATURADO);
    const pre = certos.filter((p) => p.situacao === exports.SITUACAO_PRE_VENDA);
    return {
        faturados: fat.length,
        faturadosValor: arredonda(fat.reduce((s, p) => s + p.totalPedido, 0)),
        preVendas: pre.length,
        preVendasValor: arredonda(pre.reduce((s, p) => s + p.totalPedido, 0)),
        comProblema: pedidos.length - certos.length,
    };
};
exports.resumirImportacao = resumirImportacao;
