"use strict";
/**
 * CONFIGURACOES GERAIS x CONFIGURACOES DA FILIAL (pedido do dono, 15/10/2026).
 *
 * Cada filial tem o proprio documento `configuracoes/{filial}` e o sistema le
 * sempre o da filial ativa. A maior parte e' da loja (venda, estoque,
 * pagamento, documentos, numeracao, nota fiscal) e fica em "Configuracoes da
 * filial". Estes campos, porem, mexem com o que e' COMPARTILHADO entre as
 * filiais (cadastro de produto e de cliente, limite de credito do grupo,
 * transferencia entre elas, categorias do resumo do grupo) e por isso tem um
 * valor so' para o grupo inteiro: aparecem so' em "Configuracoes Gerais" e o
 * servidor grava o mesmo valor em todas as filiais de uma vez
 * (POST /api/filiais/configuracoes-gerais). A tela da filial nunca grava
 * estes campos -- e' o que impede uma filial de ficar diferente das outras.
 *
 * Na mudanca (decisao do dono, 15/10/2026), vale o valor da MATRIZ; no plano
 * de contas, nenhuma categoria se perde: a lista geral junta a da matriz com
 * as que so' alguma filial tinha (Painel da Plataforma > Manutencao).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROTULO_DO_CAMPO_GERAL = exports.camposDiferentes = exports.valoresUnificados = exports.semCamposGerais = exports.lerConfiguracoesGerais = exports.juntarCategorias = exports.mensagemPlanoCheio = exports.listaComNovaCategoria = exports.lerNovaCategoria = exports.CAMPO_DO_PLANO_DE_CONTAS = exports.CATEGORIAS_PADRAO_DOS_LANCAMENTOS = exports.LIMITE_DO_NOME_DA_CATEGORIA = exports.LIMITE_DE_CATEGORIAS = exports.CAMPOS_GERAIS = void 0;
const clienteValidacaoDomain_1 = require("./clienteValidacaoDomain");
const notaTransferenciaDomain_1 = require("./notaTransferenciaDomain");
exports.CAMPOS_GERAIS = [
    'planoContasReceitas',
    'planoContasDespesas',
    'validarCadastroProduto',
    'modoValidacaoCliente',
    'trabalhaComLimiteCredito',
    'transferenciaSemNota',
    'transferenciaNfeTributacao',
];
exports.LIMITE_DE_CATEGORIAS = 200;
exports.LIMITE_DO_NOME_DA_CATEGORIA = 60;
/** O que as telas de lancamento (Caixa, Contas a Receber/Pagar) mostram enquanto a empresa nao salvou o plano de contas. */
exports.CATEGORIAS_PADRAO_DOS_LANCAMENTOS = {
    receita: ['Serviços', 'Venda de Peças', 'Outras Receitas'],
    despesa: ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Fornecedores de Peças', 'Outros'],
};
exports.CAMPO_DO_PLANO_DE_CONTAS = {
    receita: 'planoContasReceitas',
    despesa: 'planoContasDespesas',
};
/**
 * CATEGORIA NOVA PELA TELA DE LANCAMENTO (pedido do dono, 19/10/2026): quem
 * lanca a conta cria a categoria ali mesmo, sem ir em Configuracoes. So'
 * acrescenta (nunca apaga nem renomeia) e vale para todas as filiais, como o
 * resto do plano de contas.
 */
const lerNovaCategoria = (tipo, nome) => {
    if (tipo !== 'receita' && tipo !== 'despesa')
        return { ok: false, erro: 'Tipo de categoria inválido. Atualize a tela e tente de novo.' };
    const limpo = typeof nome === 'string' ? nome.trim().replace(/\s+/g, ' ') : '';
    if (!limpo)
        return { ok: false, erro: 'Digite o nome da nova categoria.' };
    if (limpo.length > exports.LIMITE_DO_NOME_DA_CATEGORIA)
        return { ok: false, erro: `O nome da categoria passa de ${exports.LIMITE_DO_NOME_DA_CATEGORIA} letras. Use um nome mais curto.` };
    return { ok: true, tipo, nome: limpo };
};
exports.lerNovaCategoria = lerNovaCategoria;
/**
 * A lista da filial com a categoria nova no fim. Sem plano salvo, parte das
 * categorias que a tela mostrava (para nao sumirem). Ja' existe (maiuscula ou
 * minuscula nao conta) = nada muda.
 */
const listaComNovaCategoria = (listaGravada, tipo, nome) => {
    const gravada = Array.isArray(listaGravada)
        ? listaGravada
        : typeof listaGravada === 'string' ? listaGravada.split('\n') : [];
    const atual = (0, exports.juntarCategorias)(gravada);
    const base = atual.length > 0 ? atual : exports.CATEGORIAS_PADRAO_DOS_LANCAMENTOS[tipo];
    const jaExistia = base.some((c) => c.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'));
    if (jaExistia)
        return { lista: base, jaExistia: true, cheia: false };
    if (base.length >= exports.LIMITE_DE_CATEGORIAS)
        return { lista: base, jaExistia: false, cheia: true };
    return { lista: (0, exports.juntarCategorias)(base, [nome]), jaExistia: false, cheia: false };
};
exports.listaComNovaCategoria = listaComNovaCategoria;
const mensagemPlanoCheio = (tipo) => (`O plano de contas aceita até ${exports.LIMITE_DE_CATEGORIAS} categorias de ${tipo}. Junte as parecidas em Configurações › Plano de Contas antes de criar outra.`);
exports.mensagemPlanoCheio = mensagemPlanoCheio;
const MODOS_VALIDACAO_CLIENTE = ['permitir', 'bloquear', 'perguntar'];
const TRIBUTACOES = notaTransferenciaDomain_1.TRIBUTACAO_TRANSFERENCIA_OPCOES.map((o) => o.value);
const nomeDaCategoria = (valor) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '');
/** Junta listas de categorias sem repetir (maiusculas/minusculas e espacos nao contam), na ordem em que aparecem. */
const juntarCategorias = (...listas) => {
    const vistas = new Set();
    const juntas = [];
    for (const lista of listas) {
        if (!Array.isArray(lista))
            continue;
        for (const item of lista) {
            const nome = nomeDaCategoria(item);
            const chave = nome.toLocaleLowerCase('pt-BR');
            if (!nome || vistas.has(chave))
                continue;
            vistas.add(chave);
            juntas.push(nome);
        }
    }
    return juntas;
};
exports.juntarCategorias = juntarCategorias;
const lerCategorias = (valor, rotulo) => {
    if (!Array.isArray(valor)) {
        return { ok: false, erro: `A lista de categorias de ${rotulo} chegou incompleta. Recarregue a tela e tente de novo.` };
    }
    const longa = valor.map(nomeDaCategoria).find((nome) => nome.length > exports.LIMITE_DO_NOME_DA_CATEGORIA);
    if (longa) {
        return { ok: false, erro: `A categoria "${longa.slice(0, 30)}..." passa de ${exports.LIMITE_DO_NOME_DA_CATEGORIA} letras. Use um nome mais curto.` };
    }
    const lista = (0, exports.juntarCategorias)(valor);
    if (lista.length > exports.LIMITE_DE_CATEGORIAS) {
        return { ok: false, erro: `O plano de contas aceita até ${exports.LIMITE_DE_CATEGORIAS} categorias de ${rotulo}. Junte as parecidas antes de salvar.` };
    }
    return { ok: true, valor: lista };
};
const lerSimNao = (valor, rotulo) => (typeof valor === 'boolean'
    ? { ok: true, valor }
    : { ok: false, erro: `A opção "${rotulo}" chegou sem valor. Recarregue a tela e tente de novo.` });
/** Confere o que a tela mandou salvar. Mensagem em portugues quando algo nao serve. */
const lerConfiguracoesGerais = (corpo) => {
    const dados = (corpo && typeof corpo === 'object' ? corpo : {});
    const receitas = lerCategorias(dados.planoContasReceitas, 'receita');
    if (!receitas.ok)
        return { ok: false, erro: receitas.erro };
    const despesas = lerCategorias(dados.planoContasDespesas, 'despesa');
    if (!despesas.ok)
        return { ok: false, erro: despesas.erro };
    const validarProduto = lerSimNao(dados.validarCadastroProduto, 'Validar cadastro de produto');
    if (!validarProduto.ok)
        return { ok: false, erro: validarProduto.erro };
    const limiteCredito = lerSimNao(dados.trabalhaComLimiteCredito, 'Trabalha com limite de crédito');
    if (!limiteCredito.ok)
        return { ok: false, erro: limiteCredito.erro };
    const semNota = lerSimNao(dados.transferenciaSemNota, 'Permitir transferência sem nota');
    if (!semNota.ok)
        return { ok: false, erro: semNota.erro };
    if (!MODOS_VALIDACAO_CLIENTE.includes(dados.modoValidacaoCliente)) {
        return { ok: false, erro: 'Escolha o que fazer com cliente não cadastrado: permitir, bloquear ou perguntar.' };
    }
    if (!TRIBUTACOES.includes(dados.transferenciaNfeTributacao)) {
        return { ok: false, erro: 'Escolha a tributação da nota de transferência entre as opções da lista.' };
    }
    return {
        ok: true,
        valores: {
            planoContasReceitas: receitas.valor,
            planoContasDespesas: despesas.valor,
            validarCadastroProduto: validarProduto.valor,
            modoValidacaoCliente: dados.modoValidacaoCliente,
            trabalhaComLimiteCredito: limiteCredito.valor,
            transferenciaSemNota: semNota.valor,
            transferenciaNfeTributacao: dados.transferenciaNfeTributacao,
        },
    };
};
exports.lerConfiguracoesGerais = lerConfiguracoesGerais;
/** Tira os campos gerais do que a tela da filial grava: eles so' mudam por Configuracoes Gerais. */
const semCamposGerais = (dados) => {
    const copia = { ...dados };
    for (const campo of exports.CAMPOS_GERAIS)
        delete copia[campo];
    return copia;
};
exports.semCamposGerais = semCamposGerais;
/** Como cada campo geral e' lido pelo sistema (mesmos padroes das telas que os usam). */
const lerCampoDoDocumento = (campo, valor) => {
    switch (campo) {
        case 'planoContasReceitas':
        case 'planoContasDespesas':
            return (0, exports.juntarCategorias)(valor);
        case 'modoValidacaoCliente':
            return (0, clienteValidacaoDomain_1.parseModoValidacaoCliente)(valor);
        case 'transferenciaNfeTributacao':
            return (0, notaTransferenciaDomain_1.parseTributacaoTransferencia)(valor);
        default:
            return valor === true;
    }
};
/**
 * Unificacao (15/10/2026): o valor que todas as filiais do grupo passam a ter.
 * Vale o da matriz; campo que a matriz nunca gravou fica de fora (cada filial
 * segue com o seu). Plano de contas: o da matriz primeiro e, depois, as
 * categorias que so' alguma filial tinha -- nada se perde.
 */
const valoresUnificados = (matriz, filiais) => {
    const valores = {};
    for (const campo of exports.CAMPOS_GERAIS) {
        if (campo === 'planoContasReceitas' || campo === 'planoContasDespesas') {
            const listas = [matriz[campo], ...filiais.map((f) => f[campo])];
            if (listas.some(Array.isArray))
                valores[campo] = (0, exports.juntarCategorias)(...listas);
            continue;
        }
        if (matriz[campo] !== undefined)
            valores[campo] = lerCampoDoDocumento(campo, matriz[campo]);
    }
    return valores;
};
exports.valoresUnificados = valoresUnificados;
/** Campos em que a filial esta diferente do valor unificado (vazio = nada a gravar nela). */
const camposDiferentes = (config, unificados) => (exports.CAMPOS_GERAIS.filter((campo) => (campo in unificados
    && (config[campo] === undefined
        || JSON.stringify(lerCampoDoDocumento(campo, config[campo])) !== JSON.stringify(unificados[campo])))));
exports.camposDiferentes = camposDiferentes;
exports.ROTULO_DO_CAMPO_GERAL = {
    planoContasReceitas: 'categorias de receita',
    planoContasDespesas: 'categorias de despesa',
    validarCadastroProduto: 'validar cadastro de produto',
    modoValidacaoCliente: 'cliente não cadastrado',
    trabalhaComLimiteCredito: 'limite de crédito',
    transferenciaSemNota: 'transferência sem nota',
    transferenciaNfeTributacao: 'tributação da transferência',
};
