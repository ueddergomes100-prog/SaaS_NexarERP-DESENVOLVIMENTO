"use strict";
/**
 * CADASTRO COMPARTILHADO DO GRUPO (Filiais, fase 1 -- 2026-10-06).
 *
 * Decisao do dono: clientes e o cadastro de produtos sao do GRUPO; preco,
 * custo e estoque sao de cada filial. Cada filial e' uma empresa (tenant)
 * propria, entao cada uma guarda uma COPIA de cada cliente e de cada
 * produto, e o servidor mantem as copias iguais (server/services/
 * espelhoCadastros.js). Assim nenhuma tela de venda ou de estoque muda: cada
 * uma continua lendo e baixando o produto da filial em que esta.
 *
 * Como as copias se reconhecem:
 *  - `grupoChave`: a mesma em todas as copias (o id do documento original);
 *  - `filialOrigem`: a filial em que o cadastro nasceu (o filtro "Itens desta
 *    filial" usa isto);
 *  - `cadastroHash`: assinatura dos campos do grupo. Documento cujo conteudo
 *    nao bate com a propria assinatura foi alterado por alguem -> o servidor
 *    espalha a mudanca. Bateu -> e' eco de uma copia que o proprio servidor
 *    gravou, nada a fazer.
 *
 * Este arquivo e' puro (sem Firestore): a tela usa para o filtro e para a
 * trava de edicao; o servidor usa para planejar as gravacoes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mudouCadastroDoGrupo = exports.itemDaFilial = exports.aplicarNoIndice = exports.planejarEspelho = exports.indexar = exports.criarIndice = exports.chaveNatural = exports.idDaCopia = exports.chaveDoGrupo = exports.hashDoCadastro = exports.camposDoGrupo = exports.participaDoEspelho = exports.CAMPOS_DO_PRODUTO_NO_GRUPO = exports.COLECOES_ESPELHADAS = void 0;
/** Na ordem em que o servidor liga o espelho: catalogos antes dos produtos (unidade). */
exports.COLECOES_ESPELHADAS = ['unidades_medida', 'categorias', 'marcas', 'clientes', 'estoque'];
/** Campos de controle de cada copia: nunca sao comparados nem copiados. */
const CAMPOS_DE_CONTROLE = new Set([
    'id', 'tenantId', 'grupoChave', 'filialOrigem', 'cadastroHash',
    'createdAt', 'updatedAt', 'criadoEm', 'criadoPor', 'alteradoEm', 'alteradoPor', 'ultimaAlteracao',
    'createdBy', 'updatedBy', 'createdByName', 'updatedByName',
]);
/**
 * Campos do PRODUTO que sao do grupo. Lista fechada de proposito: campo novo
 * no produto nasce "da filial" ate alguem decidir que e' do grupo -- o erro
 * seguro e' nao espalhar.
 */
exports.CAMPOS_DO_PRODUTO_NO_GRUPO = [
    'codigo', 'codigoAutomatico', 'nome', 'categoria', 'marca', 'referencia', 'codigoBarras',
    'descricaoCurta', 'descricaoCompleta', 'observacoesInternas', 'imagemProduto', 'tags',
    'unidadeMedidaSigla', 'unidadeMedidaNome', 'unidadeMedidaFracionado', 'unidadeMedidaCasasDecimais', 'produtoFracionado',
    'peso', 'altura', 'largura', 'comprimento', 'pesoLiquidoUnitarioKg', 'pesoEnvio',
    'ncm', 'cest', 'origem', 'codigoAnp',
    'skuSistema', 'slugUrl', 'seoTitulo', 'seoDescricao', 'descricaoMarketplace', 'imagensMarketplace',
    'produzidoInternamente', 'produtoServico', 'produtoRevenda', 'controlarEstoque',
    'exigirSerialLote', 'controlarLote', 'permiteCondicional', 'permitirCashback', 'produtoDestaque',
    'ativo', 'statusAtivo',
];
/**
 * Campos do produto que NAO vao para a copia de uma filial nova (o estoque
 * dela comeca zerado). Todo o resto (precos, custo, tributacao, embalagens)
 * comeca igual ao da matriz e cada filial ajusta o seu.
 */
const CAMPOS_ZERADOS_NA_COPIA_DO_PRODUTO = {
    quantidade: 0,
    quantidadeReservada: 0,
    estoqueMinimo: 0,
    estoqueMaximo: 0,
    localizacaoEstoque: '',
    fornecedor: '',
    fornecedorId: '',
    codigoProdutoFornecedor: '',
    dataUltimaCompra: '',
    lote: '',
    validade: '',
};
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const normalizar = (v) => texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');
/** Consumidor final de cada empresa nao e' espelhado: cada filial tem o seu. */
const participaDoEspelho = (colecao, dados) => (!(colecao === 'clientes' && dados.isPadrao === true));
exports.participaDoEspelho = participaDoEspelho;
/** Os campos do cadastro que sao do grupo (iguais em todas as filiais). */
const camposDoGrupo = (colecao, dados) => {
    const resultado = {};
    if (colecao === 'estoque') {
        for (const campo of exports.CAMPOS_DO_PRODUTO_NO_GRUPO) {
            if (dados[campo] !== undefined)
                resultado[campo] = dados[campo];
        }
        return resultado;
    }
    for (const [campo, valor] of Object.entries(dados)) {
        if (CAMPOS_DE_CONTROLE.has(campo) || valor === undefined)
            continue;
        // Referencia de unidade e' id local de cada filial (remapeado pela sigla).
        if (campo === 'unidadeMedidaId')
            continue;
        resultado[campo] = valor;
    }
    return resultado;
};
exports.camposDoGrupo = camposDoGrupo;
/** JSON com chaves em ordem: a mesma informacao sempre gera o mesmo texto. */
const jsonEstavel = (valor) => {
    if (valor === null || typeof valor !== 'object')
        return JSON.stringify(valor ?? null);
    // Timestamp do Firestore (cliente ou Admin SDK): compara pelo instante.
    const t = valor;
    if (typeof t.seconds === 'number' || typeof t._seconds === 'number') {
        return `"ts:${t.seconds ?? t._seconds}.${t.nanoseconds ?? t._nanoseconds ?? 0}"`;
    }
    if (Array.isArray(valor))
        return `[${valor.map(jsonEstavel).join(',')}]`;
    const chaves = Object.keys(valor).filter((k) => valor[k] !== undefined).sort();
    return `{${chaves.map((k) => `${JSON.stringify(k)}:${jsonEstavel(valor[k])}`).join(',')}}`;
};
/** Assinatura curta dos campos do grupo (djb2 em 2 sementes, base 36). */
const hashDoCadastro = (campos) => {
    const s = jsonEstavel(campos);
    let a = 5381;
    let b = 52711;
    for (let i = 0; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        a = ((a << 5) + a + c) | 0;
        b = ((b << 5) + b + c) | 0;
    }
    return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
};
exports.hashDoCadastro = hashDoCadastro;
const chaveDoGrupo = (doc) => texto(doc.dados.grupoChave) || doc.id;
exports.chaveDoGrupo = chaveDoGrupo;
/** Id da copia numa filial (deterministico: reprocessar nunca duplica). */
const idDaCopia = (chave, tenantDestino) => `${chave}_${tenantDestino}`;
exports.idDaCopia = idDaCopia;
/**
 * Chave "natural" para LIGAR um cadastro que ja' existe na filial em vez de
 * criar outro igual (as unidades padrao UN, KG... nascem em toda empresa).
 */
const chaveNatural = (colecao, dados) => {
    if (colecao === 'unidades_medida')
        return normalizar(dados.sigla) || null;
    if (colecao === 'categorias' || colecao === 'marcas')
        return normalizar(dados.nome) || null;
    if (colecao === 'clientes') {
        const documento = String(dados.documento ?? '').replace(/\D/g, '');
        return documento.length >= 11 ? documento : null;
    }
    return null;
};
exports.chaveNatural = chaveNatural;
const criarIndice = () => ({ porChave: new Map(), porNatural: new Map(), porId: new Map() });
exports.criarIndice = criarIndice;
const indexar = (colecao, indice, doc) => {
    const anterior = indice.porId.get(doc.id);
    if (anterior) {
        indice.porChave.get((0, exports.chaveDoGrupo)(anterior))?.delete(anterior.tenantId);
        const naturalAnterior = (0, exports.chaveNatural)(colecao, anterior.dados);
        if (naturalAnterior && indice.porNatural.get(anterior.tenantId)?.get(naturalAnterior)?.id === anterior.id) {
            indice.porNatural.get(anterior.tenantId).delete(naturalAnterior);
        }
    }
    indice.porId.set(doc.id, doc);
    const chave = (0, exports.chaveDoGrupo)(doc);
    if (!indice.porChave.has(chave))
        indice.porChave.set(chave, new Map());
    indice.porChave.get(chave).set(doc.tenantId, doc);
    const natural = (0, exports.chaveNatural)(colecao, doc.dados);
    if (natural) {
        if (!indice.porNatural.has(doc.tenantId))
            indice.porNatural.set(doc.tenantId, new Map());
        if (!indice.porNatural.get(doc.tenantId).has(natural))
            indice.porNatural.get(doc.tenantId).set(natural, doc);
    }
};
exports.indexar = indexar;
const igualNoGrupo = (a, b) => jsonEstavel(a) === jsonEstavel(b);
/** O que a copia de uma filial precisa receber para ficar igual ao cadastro do grupo. */
const diferencasDoGrupo = (compartilhados, destino) => {
    const mudancas = {};
    for (const [campo, valor] of Object.entries(compartilhados)) {
        if (!igualNoGrupo(valor, destino[campo]))
            mudancas[campo] = valor;
    }
    return mudancas;
};
const unidadeRemapeada = (ctx, tenantId, dados) => {
    if (ctx.colecao !== 'estoque' || !ctx.unidadeNaFilial)
        return {};
    const sigla = texto(dados.unidadeMedidaSigla);
    if (!sigla)
        return {};
    return { unidadeMedidaId: ctx.unidadeNaFilial(tenantId, sigla) ?? '' };
};
/** Documento novo de uma filial, a partir do cadastro (preco e tributacao da matriz quando houver). */
const copiaInicial = (ctx, chave, base, compartilhados, origem, hash, tenantDestino) => {
    const daMatriz = ctx.indice.porChave.get(chave)?.get(ctx.matrizTenantId);
    const modelo = (daMatriz ?? base).dados;
    const copia = {};
    for (const [campo, valor] of Object.entries(modelo)) {
        if (CAMPOS_DE_CONTROLE.has(campo) || valor === undefined)
            continue;
        copia[campo] = valor;
    }
    return {
        ...copia,
        ...(ctx.colecao === 'estoque' ? CAMPOS_ZERADOS_NA_COPIA_DO_PRODUTO : {}),
        ...compartilhados,
        ...unidadeRemapeada(ctx, tenantDestino, compartilhados),
        tenantId: tenantDestino,
        grupoChave: chave,
        filialOrigem: origem,
        cadastroHash: hash,
    };
};
/**
 * Dado um documento que mudou (ou apareceu) numa filial, devolve as
 * gravacoes que deixam o grupo igual:
 *  - o proprio documento ganha grupoChave/filialOrigem/cadastroHash;
 *  - filial sem a copia: cria (ou LIGA um cadastro igual que ja' exista,
 *    pela chave natural);
 *  - copia diferente: so' quando a mudanca e' de alguem (assinatura nao
 *    bate), atualiza os campos do grupo -- eco do proprio servidor nunca
 *    sobrescreve uma edicao que ainda esta para ser processada.
 */
const planejarEspelho = (ctx, doc) => {
    if (!(0, exports.participaDoEspelho)(ctx.colecao, doc.dados))
        return [];
    const compartilhados = (0, exports.camposDoGrupo)(ctx.colecao, doc.dados);
    const hash = (0, exports.hashDoCadastro)(compartilhados);
    const chave = (0, exports.chaveDoGrupo)(doc);
    const origem = texto(doc.dados.filialOrigem) || doc.tenantId;
    const alteradoPorAlguem = texto(doc.dados.cadastroHash) !== hash;
    const gravacoes = [];
    if (texto(doc.dados.grupoChave) !== chave || texto(doc.dados.filialOrigem) !== origem || alteradoPorAlguem) {
        gravacoes.push({ tipo: 'atualizar', tenantId: doc.tenantId, id: doc.id, campos: { grupoChave: chave, filialOrigem: origem, cadastroHash: hash } });
    }
    for (const tenantDestino of ctx.filiais) {
        if (tenantDestino === doc.tenantId)
            continue;
        const irmao = ctx.indice.porChave.get(chave)?.get(tenantDestino);
        if (irmao) {
            if (!alteradoPorAlguem || texto(irmao.dados.cadastroHash) === hash)
                continue;
            const mudancas = diferencasDoGrupo(compartilhados, irmao.dados);
            gravacoes.push({
                tipo: 'atualizar',
                tenantId: tenantDestino,
                id: irmao.id,
                campos: { ...mudancas, ...unidadeRemapeada(ctx, tenantDestino, compartilhados), cadastroHash: hash },
            });
            continue;
        }
        // Sem copia na filial: liga um cadastro igual (mesma chave natural, ainda solto) ou cria.
        const natural = (0, exports.chaveNatural)(ctx.colecao, doc.dados);
        const candidato = natural ? ctx.indice.porNatural.get(tenantDestino)?.get(natural) : undefined;
        const candidatoSolto = candidato && (!texto(candidato.dados.grupoChave) || texto(candidato.dados.grupoChave) === candidato.id)
            && (ctx.indice.porChave.get((0, exports.chaveDoGrupo)(candidato))?.size ?? 0) <= 1;
        if (candidato && candidatoSolto) {
            gravacoes.push({
                tipo: 'atualizar',
                tenantId: tenantDestino,
                id: candidato.id,
                campos: { ...diferencasDoGrupo(compartilhados, candidato.dados), grupoChave: chave, filialOrigem: origem, cadastroHash: hash },
            });
            continue;
        }
        gravacoes.push({
            tipo: 'criar',
            tenantId: tenantDestino,
            id: (0, exports.idDaCopia)(chave, tenantDestino),
            campos: copiaInicial(ctx, chave, doc, compartilhados, origem, hash, tenantDestino),
        });
    }
    return gravacoes;
};
exports.planejarEspelho = planejarEspelho;
/** Aplica as gravacoes planejadas no indice, para o proximo planejamento ja' enxergar. */
const aplicarNoIndice = (colecao, indice, gravacoes) => {
    for (const g of gravacoes) {
        const atual = indice.porId.get(g.id);
        const dados = g.tipo === 'criar' ? { ...g.campos } : { ...(atual?.dados ?? {}), ...g.campos };
        (0, exports.indexar)(colecao, indice, { id: g.id, tenantId: g.tenantId, dados });
    }
};
exports.aplicarNoIndice = aplicarNoIndice;
// ---------------------------------------------------------------------------
// Na tela: filtro "Itens desta filial" e trava de edicao
// ---------------------------------------------------------------------------
/**
 * O item "e' desta filial": cadastrado nela, ou com estoque nela (recebido
 * por transferencia ou nota -- decisao do dono, 06/10). Item sem
 * filialOrigem (empresa sem filiais, ou antes do espelho) conta como desta.
 */
const itemDaFilial = (produto, tenantId) => {
    const origem = texto(produto.filialOrigem);
    if (!origem || !tenantId || origem === tenantId)
        return true;
    return Number(produto.quantidade) > 0;
};
exports.itemDaFilial = itemDaFilial;
/** O cadastro (parte do grupo) mudou entre o que foi aberto e o que vai ser salvo? */
const mudouCadastroDoGrupo = (colecao, antes, depois) => ((0, exports.hashDoCadastro)((0, exports.camposDoGrupo)(colecao, antes)) !== (0, exports.hashDoCadastro)((0, exports.camposDoGrupo)(colecao, depois)));
exports.mudouCadastroDoGrupo = mudouCadastroDoGrupo;
