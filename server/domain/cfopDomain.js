"use strict";
/*
 * TABELA DE CFOP DO SISTEMA (pedido do dono, 20/10/2026).
 *
 * Decisoes do dono (caixinhas de 20/10):
 *  - A tabela e' UNICA do sistema (a Hennder mantem, aqui no codigo): codigo,
 *    descricao oficial e a FUNCAO de cada CFOP. A empresa so' ativa/desativa os
 *    que usa (`cfopsDesativados` na configuracao, gravado pelo servidor em todas
 *    as filiais do grupo). Ninguem edita a funcao: marcar uma venda como "nao
 *    mexe no estoque" estragaria estoque, financeiro e nota.
 *  - O CFOP escolhido DECIDE o que acontece na entrada e na emissao: estoque
 *    (entra/sai/nada), financeiro (pagar/receber/abater/nada) e se conta como
 *    faturamento.
 *
 * Fonte: lista de naturezas que o dono mandou (PDF do sistema antigo do
 * Shopping Rural) -- so' os CFOPs oficiais de 4 digitos; as variacoes internas
 * daquele sistema ("1102.4.1", "5102C") nao sao CFOP -- mais os que o sistema
 * ja' emite (transferencia, devolucao, exportacao, servico). Descricoes pela
 * tabela oficial do Ajuste SINIEF 07/2001 (o PDF trazia 1.911 e 6.101 com a
 * descricao trocada).
 *
 * Puro: usado pela tela, pela entrada/emissao e pelo servidor (server/domain).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resumoDaFuncao = exports.naturezaDaOperacaoPelosCfops = exports.acaoDaEntrada = exports.problemaDoCfop = exports.cfopInterestadualEquivalente = exports.cfopEhDeSaida = exports.cfopEntradaSugerido = exports.NATUREZAS_DO_PRODUTO = exports.cfopsParaEscolha = exports.lerCfopsDesativados = exports.ROTULO_AMBITO = exports.ROTULO_TIPO = exports.cfopPorCodigo = exports.CFOPS = exports.formatarCodigoCfop = exports.normalizarCodigoCfop = exports.ROTULO_DESTINO = exports.ROTULO_FINANCEIRO = exports.ROTULO_ESTOQUE = exports.ROTULO_NATUREZA = exports.FUNCAO_DA_NATUREZA = void 0;
exports.FUNCAO_DA_NATUREZA = {
    venda: { estoque: 'sai', financeiro: 'receber', receita: true, destino: 'nenhum' },
    servico_prestado: { estoque: 'nenhum', financeiro: 'receber', receita: true, destino: 'nenhum' },
    devolucao_de_compra: { estoque: 'sai', financeiro: 'abate_pagar', receita: false, destino: 'nenhum' },
    transferencia_saida: { estoque: 'sai', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
    remessa_bonificacao: { estoque: 'sai', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
    remessa_conserto: { estoque: 'sai', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
    perda: { estoque: 'sai', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
    // O cupom (NFC-e/ECF) ja' baixou o estoque e gerou a receita: a nota so' acompanha.
    cupom_fiscal: { estoque: 'nenhum', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
    outras_saidas: { estoque: 'sai', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
    // Venda para entrega futura: a 5.922 cobra e conta como faturamento (estoque fica reservado);
    // a 5.116/5.117 e' a entrega: baixa o estoque sem financeiro nem receita de novo.
    faturamento_venda_entrega_futura: { estoque: 'nenhum', financeiro: 'receber', receita: true, destino: 'nenhum' },
    remessa_entrega_futura: { estoque: 'sai', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
    compra: { estoque: 'entra', financeiro: 'pagar', receita: false, destino: 'estoque' },
    compra_uso_consumo: { estoque: 'entra', financeiro: 'pagar', receita: false, destino: 'insumo' },
    compra_ativo: { estoque: 'nenhum', financeiro: 'pagar', receita: false, destino: 'nenhum' },
    servico_tomado: { estoque: 'nenhum', financeiro: 'pagar', receita: false, destino: 'nenhum' },
    // Compra para recebimento futuro: a 1.922 paga (sem mercadoria), a 1.117 entrega (sem pagar de novo).
    faturamento_entrega_futura: { estoque: 'nenhum', financeiro: 'pagar', receita: false, destino: 'nenhum' },
    entrega_futura: { estoque: 'entra', financeiro: 'nenhum', receita: false, destino: 'estoque' },
    venda_a_ordem: { estoque: 'entra', financeiro: 'nenhum', receita: false, destino: 'estoque' },
    devolucao_de_venda: { estoque: 'entra', financeiro: 'abate_receber', receita: false, destino: 'estoque' },
    transferencia_entrada: { estoque: 'entra', financeiro: 'nenhum', receita: false, destino: 'estoque' },
    entrada_bonificacao: { estoque: 'entra', financeiro: 'nenhum', receita: false, destino: 'estoque' },
    retorno: { estoque: 'entra', financeiro: 'nenhum', receita: false, destino: 'estoque' },
    outras_entradas: { estoque: 'entra', financeiro: 'nenhum', receita: false, destino: 'estoque' },
    // Kit/desagregacao: quem movimenta e' a producao/kit, a nota so' registra.
    reclassificacao: { estoque: 'nenhum', financeiro: 'nenhum', receita: false, destino: 'nenhum' },
};
exports.ROTULO_NATUREZA = {
    venda: 'Venda',
    servico_prestado: 'Prestação de serviço',
    devolucao_de_compra: 'Devolução de compra',
    transferencia_saida: 'Transferência (saída)',
    remessa_bonificacao: 'Bonificação, doação ou brinde (saída)',
    remessa_conserto: 'Remessa para conserto',
    perda: 'Perda, roubo ou deterioração',
    cupom_fiscal: 'Nota de cupom fiscal já emitido',
    outras_saidas: 'Outras saídas',
    faturamento_venda_entrega_futura: 'Venda para entrega futura (faturamento)',
    remessa_entrega_futura: 'Entrega de venda faturada antes',
    compra: 'Compra para revenda/industrialização',
    compra_uso_consumo: 'Compra para uso e consumo',
    compra_ativo: 'Compra para o ativo imobilizado',
    servico_tomado: 'Serviço contratado (energia, comunicação, transporte, ISS)',
    faturamento_entrega_futura: 'Faturamento de compra para entrega futura',
    entrega_futura: 'Entrega de compra faturada antes',
    venda_a_ordem: 'Mercadoria recebida em venda à ordem',
    devolucao_de_venda: 'Devolução de venda',
    transferencia_entrada: 'Transferência (entrada)',
    entrada_bonificacao: 'Bonificação, doação, brinde ou amostra (entrada)',
    retorno: 'Retorno de conserto ou exposição',
    outras_entradas: 'Outras entradas',
    reclassificacao: 'Reclassificação (kit)',
};
exports.ROTULO_ESTOQUE = {
    entra: 'Entra no estoque',
    sai: 'Baixa o estoque',
    nenhum: 'Não mexe no estoque',
};
exports.ROTULO_FINANCEIRO = {
    receber: 'Gera conta a receber',
    pagar: 'Gera conta a pagar',
    abate_receber: 'Abate do cliente (crédito)',
    abate_pagar: 'Abate do fornecedor (crédito)',
    nenhum: 'Sem financeiro',
};
exports.ROTULO_DESTINO = {
    estoque: 'Estoque (produto)',
    insumo: 'Insumo (uso e consumo)',
    nenhum: 'Não vai para o estoque',
};
/** [codigo, natureza, descricao oficial] */
const CATALOGO = [
    // ---- Entradas do estado (1) ----
    ['1101', 'compra', 'Compra para industrialização ou produção rural'],
    ['1102', 'compra', 'Compra para comercialização'],
    ['1117', 'entrega_futura', 'Compra para comercialização originada de encomenda para recebimento futuro'],
    ['1151', 'transferencia_entrada', 'Transferência para industrialização ou produção rural'],
    ['1152', 'transferencia_entrada', 'Transferência para comercialização'],
    ['1201', 'devolucao_de_venda', 'Devolução de venda de produção do estabelecimento'],
    ['1202', 'devolucao_de_venda', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros'],
    ['1253', 'servico_tomado', 'Compra de energia elétrica por estabelecimento comercial'],
    ['1303', 'servico_tomado', 'Aquisição de serviço de comunicação por estabelecimento comercial'],
    ['1351', 'servico_tomado', 'Aquisição de serviço de transporte para execução de serviço da mesma natureza'],
    ['1353', 'servico_tomado', 'Aquisição de serviço de transporte por estabelecimento comercial'],
    ['1403', 'compra', 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['1407', 'compra_uso_consumo', 'Compra de mercadoria para uso ou consumo cuja mercadoria está sujeita ao regime de substituição tributária'],
    ['1410', 'devolucao_de_venda', 'Devolução de venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária'],
    ['1411', 'devolucao_de_venda', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['1551', 'compra_ativo', 'Compra de bem para o ativo imobilizado'],
    ['1556', 'compra_uso_consumo', 'Compra de material para uso ou consumo'],
    ['1652', 'compra', 'Compra de combustível ou lubrificante para comercialização'],
    ['1653', 'compra_uso_consumo', 'Compra de combustível ou lubrificante por consumidor ou usuário final'],
    ['1910', 'entrada_bonificacao', 'Entrada de bonificação, doação ou brinde'],
    ['1911', 'entrada_bonificacao', 'Entrada de amostra grátis'],
    ['1914', 'retorno', 'Retorno de mercadoria ou bem remetido para exposição ou feira'],
    ['1916', 'retorno', 'Retorno de mercadoria ou bem remetido para conserto ou reparo'],
    ['1922', 'faturamento_entrega_futura', 'Lançamento efetuado a título de simples faturamento decorrente de compra para recebimento futuro'],
    ['1923', 'venda_a_ordem', 'Entrada de mercadoria recebida do vendedor remetente, em venda à ordem'],
    ['1926', 'reclassificacao', 'Lançamento efetuado a título de reclassificação de mercadoria decorrente de formação de kit ou de sua desagregação'],
    ['1933', 'servico_tomado', 'Aquisição de serviço tributado pelo ISSQN'],
    ['1949', 'outras_entradas', 'Outra entrada de mercadoria ou prestação de serviço não especificada'],
    // ---- Entradas de outro estado (2) ----
    ['2101', 'compra', 'Compra para industrialização ou produção rural'],
    ['2102', 'compra', 'Compra para comercialização'],
    ['2117', 'entrega_futura', 'Compra para comercialização originada de encomenda para recebimento futuro'],
    ['2151', 'transferencia_entrada', 'Transferência para industrialização ou produção rural'],
    ['2152', 'transferencia_entrada', 'Transferência para comercialização'],
    ['2201', 'devolucao_de_venda', 'Devolução de venda de produção do estabelecimento'],
    ['2202', 'devolucao_de_venda', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros'],
    ['2303', 'servico_tomado', 'Aquisição de serviço de comunicação por estabelecimento comercial'],
    ['2351', 'servico_tomado', 'Aquisição de serviço de transporte para execução de serviço da mesma natureza'],
    ['2353', 'servico_tomado', 'Aquisição de serviço de transporte por estabelecimento comercial'],
    ['2403', 'compra', 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['2407', 'compra_uso_consumo', 'Compra de mercadoria para uso ou consumo cuja mercadoria está sujeita ao regime de substituição tributária'],
    ['2410', 'devolucao_de_venda', 'Devolução de venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária'],
    ['2411', 'devolucao_de_venda', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['2551', 'compra_ativo', 'Compra de bem para o ativo imobilizado'],
    ['2556', 'compra_uso_consumo', 'Compra de material para uso ou consumo'],
    ['2653', 'compra_uso_consumo', 'Compra de combustível ou lubrificante por consumidor ou usuário final'],
    ['2910', 'entrada_bonificacao', 'Entrada de bonificação, doação ou brinde'],
    ['2911', 'entrada_bonificacao', 'Entrada de amostra grátis'],
    ['2914', 'retorno', 'Retorno de mercadoria ou bem remetido para exposição ou feira'],
    ['2916', 'retorno', 'Retorno de mercadoria ou bem remetido para conserto ou reparo'],
    ['2922', 'faturamento_entrega_futura', 'Lançamento efetuado a título de simples faturamento decorrente de compra para recebimento futuro'],
    ['2923', 'venda_a_ordem', 'Entrada de mercadoria recebida do vendedor remetente, em venda à ordem'],
    ['2933', 'servico_tomado', 'Aquisição de serviço tributado pelo ISSQN'],
    ['2949', 'outras_entradas', 'Outra entrada de mercadoria ou prestação de serviço não especificada'],
    // ---- Saidas do estado (5) ----
    ['5101', 'venda', 'Venda de produção do estabelecimento'],
    ['5102', 'venda', 'Venda de mercadoria adquirida ou recebida de terceiros'],
    ['5116', 'remessa_entrega_futura', 'Venda de produção do estabelecimento originada de encomenda para entrega futura'],
    ['5117', 'remessa_entrega_futura', 'Venda de mercadoria adquirida ou recebida de terceiros, originada de encomenda para entrega futura'],
    ['5151', 'transferencia_saida', 'Transferência de produção do estabelecimento'],
    ['5152', 'transferencia_saida', 'Transferência de mercadoria adquirida ou recebida de terceiros'],
    ['5201', 'devolucao_de_compra', 'Devolução de compra para industrialização ou produção rural'],
    ['5202', 'devolucao_de_compra', 'Devolução de compra para comercialização'],
    ['5401', 'venda', 'Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto'],
    ['5403', 'venda', 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto'],
    ['5405', 'venda', 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído'],
    // Venda a comercial exportadora / trading (27/10/2026): a mercadoria vai para o exterior pela compradora.
    ['5501', 'venda', 'Remessa de produção do estabelecimento, com fim específico de exportação'],
    ['5502', 'venda', 'Remessa de mercadoria adquirida ou recebida de terceiros, com fim específico de exportação'],
    ['5410', 'devolucao_de_compra', 'Devolução de compra para industrialização ou produção rural em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['5411', 'devolucao_de_compra', 'Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['5910', 'remessa_bonificacao', 'Remessa em bonificação, doação ou brinde'],
    ['5915', 'remessa_conserto', 'Remessa de mercadoria ou bem para conserto ou reparo'],
    ['5922', 'faturamento_venda_entrega_futura', 'Lançamento efetuado a título de simples faturamento decorrente de venda para entrega futura'],
    ['5926', 'reclassificacao', 'Lançamento efetuado a título de reclassificação de mercadoria decorrente de formação de kit ou de sua desagregação'],
    ['5927', 'perda', 'Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração'],
    ['5929', 'cupom_fiscal', 'Lançamento efetuado em decorrência de emissão de documento fiscal relativo a operação ou prestação também registrada em equipamento Emissor de Cupom Fiscal - ECF'],
    ['5933', 'servico_prestado', 'Prestação de serviço tributado pelo ISSQN'],
    ['5949', 'outras_saidas', 'Outra saída de mercadoria ou prestação de serviço não especificado'],
    // ---- Saidas para outro estado (6) ----
    ['6101', 'venda', 'Venda de produção do estabelecimento'],
    ['6102', 'venda', 'Venda de mercadoria adquirida ou recebida de terceiros'],
    ['6107', 'venda', 'Venda de produção do estabelecimento, destinada a não contribuinte'],
    ['6108', 'venda', 'Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte'],
    ['6116', 'remessa_entrega_futura', 'Venda de produção do estabelecimento originada de encomenda para entrega futura'],
    ['6117', 'remessa_entrega_futura', 'Venda de mercadoria adquirida ou recebida de terceiros, originada de encomenda para entrega futura'],
    ['6151', 'transferencia_saida', 'Transferência de produção do estabelecimento'],
    ['6152', 'transferencia_saida', 'Transferência de mercadoria adquirida ou recebida de terceiros'],
    ['6201', 'devolucao_de_compra', 'Devolução de compra para industrialização ou produção rural'],
    ['6202', 'devolucao_de_compra', 'Devolução de compra para comercialização'],
    ['6401', 'venda', 'Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto'],
    ['6403', 'venda', 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto'],
    ['6404', 'venda', 'Venda de mercadoria sujeita ao regime de substituição tributária, cujo imposto já tenha sido retido anteriormente'],
    ['6501', 'venda', 'Remessa de produção do estabelecimento, com fim específico de exportação'],
    ['6502', 'venda', 'Remessa de mercadoria adquirida ou recebida de terceiros, com fim específico de exportação'],
    ['6410', 'devolucao_de_compra', 'Devolução de compra para industrialização ou produção rural em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['6411', 'devolucao_de_compra', 'Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária'],
    ['6910', 'remessa_bonificacao', 'Remessa em bonificação, doação ou brinde'],
    ['6915', 'remessa_conserto', 'Remessa de mercadoria ou bem para conserto ou reparo'],
    ['6922', 'faturamento_venda_entrega_futura', 'Lançamento efetuado a título de simples faturamento decorrente de venda para entrega futura'],
    ['6929', 'cupom_fiscal', 'Lançamento efetuado em decorrência de emissão de documento fiscal relativo a operação ou prestação também registrada em equipamento Emissor de Cupom Fiscal - ECF'],
    ['6933', 'servico_prestado', 'Prestação de serviço tributado pelo ISSQN'],
    ['6949', 'outras_saidas', 'Outra saída de mercadoria ou prestação de serviço não especificado'],
    // ---- Exterior (7) ----
    ['7101', 'venda', 'Venda de produção do estabelecimento'],
    ['7102', 'venda', 'Venda de mercadoria adquirida ou recebida de terceiros'],
];
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
/** CFOP so' com digitos ("5.102" -> "5102"); vazio sem 4 digitos. */
const normalizarCodigoCfop = (v) => {
    const d = soDigitos(v);
    return d.length === 4 ? d : '';
};
exports.normalizarCodigoCfop = normalizarCodigoCfop;
/** "5102" -> "5.102". */
const formatarCodigoCfop = (codigo) => (codigo.length === 4 ? `${codigo[0]}.${codigo.slice(1)}` : codigo);
exports.formatarCodigoCfop = formatarCodigoCfop;
const tipoDoCodigo = (codigo) => (['1', '2', '3'].includes(codigo[0]) ? 'entrada' : 'saida');
const ambitoDoCodigo = (codigo) => (codigo[0] === '1' || codigo[0] === '5' ? 'estadual' : codigo[0] === '2' || codigo[0] === '6' ? 'interestadual' : 'exterior');
exports.CFOPS = CATALOGO.map(([codigo, natureza, descricao]) => ({
    codigo,
    descricao,
    natureza,
    tipo: tipoDoCodigo(codigo),
    ambito: ambitoDoCodigo(codigo),
    st: codigo[1] === '4',
    ...exports.FUNCAO_DA_NATUREZA[natureza],
}));
const POR_CODIGO = new Map(exports.CFOPS.map((c) => [c.codigo, c]));
const cfopPorCodigo = (codigo) => POR_CODIGO.get((0, exports.normalizarCodigoCfop)(codigo)) ?? null;
exports.cfopPorCodigo = cfopPorCodigo;
exports.ROTULO_TIPO = { entrada: 'Entrada', saida: 'Saída' };
exports.ROTULO_AMBITO = { estadual: 'Dentro do estado', interestadual: 'Outro estado', exterior: 'Exterior' };
/** Os codigos desativados pela empresa, limpos (so' os que existem na tabela). */
const lerCfopsDesativados = (valor) => (Array.isArray(valor) ? [...new Set(valor.map(exports.normalizarCodigoCfop).filter((c) => POR_CODIGO.has(c)))].sort() : []);
exports.lerCfopsDesativados = lerCfopsDesativados;
/**
 * CFOPs que a empresa pode escolher, com filtro. `manter` entra mesmo
 * desativado (o que ja' esta' gravado no produto/nota nao some da tela).
 */
const cfopsParaEscolha = (opcoes = {}) => {
    const desativados = new Set(opcoes.desativados ?? []);
    const manter = (0, exports.normalizarCodigoCfop)(opcoes.manter);
    return exports.CFOPS.filter((c) => ((c.codigo === manter || !desativados.has(c.codigo))
        && (!opcoes.tipo || c.tipo === opcoes.tipo)
        && (!opcoes.ambitos || opcoes.ambitos.includes(c.ambito))
        && (!opcoes.naturezas || opcoes.naturezas.includes(c.natureza))));
};
exports.cfopsParaEscolha = cfopsParaEscolha;
/** Naturezas de saida que um produto pode ter como "CFOP padrao" (o que a venda usa). */
exports.NATUREZAS_DO_PRODUTO = ['venda', 'servico_prestado'];
/*
 * DE-PARA: CFOP do FORNECEDOR (saida dele) -> CFOP de ENTRADA da empresa.
 * Pelo grupo (os 3 ultimos digitos). O primeiro digito segue o ambito
 * (5->1, 6->2, 7->3). A venda com ST do fornecedor (x.401/x.403/x.404/x.405)
 * vira compra com ST (x.403) -- nao "1.405", que nao existe.
 */
const DE_PARA_GRUPO = {
    101: '102', 102: '102', 103: '102', 104: '102', 105: '102', 106: '102', 107: '102', 108: '102',
    401: '403', 402: '403', 403: '403', 404: '403', 405: '403',
    116: '117', 117: '117', 922: '922', 923: '923',
    151: '152', 152: '152',
    201: '201', 202: '202', 410: '410', 411: '411',
    910: '910', 911: '911', 916: '916', 914: '914',
    933: '933', 949: '949',
};
/** Item classificado como insumo (uso e consumo): o grupo muda. */
const GRUPO_USO_CONSUMO = (st) => (st ? '407' : '556');
/**
 * CFOP de entrada sugerido para o item da nota do fornecedor. `destino`
 * 'insumo' troca para uso e consumo (1.556, ou 1.407 com ST). Vazio quando nao
 * ha' equivalente na tabela (a pessoa escolhe).
 */
const cfopEntradaSugerido = (cfopFornecedor, destino) => {
    const c = (0, exports.normalizarCodigoCfop)(cfopFornecedor);
    if (!c)
        return '';
    if (tipoDoCodigo(c) === 'entrada')
        return POR_CODIGO.has(c) ? c : '';
    const primeiro = { 5: '1', 6: '2', 7: '3' }[c[0]];
    if (!primeiro)
        return '';
    const grupo = c.slice(1);
    const st = grupo[0] === '4';
    const grupoEntrada = destino === 'insumo' ? GRUPO_USO_CONSUMO(st) : DE_PARA_GRUPO[grupo];
    if (!grupoEntrada)
        return '';
    const sugerido = `${primeiro}${grupoEntrada}`;
    return POR_CODIGO.has(sugerido) ? sugerido : '';
};
exports.cfopEntradaSugerido = cfopEntradaSugerido;
/** CFOP de saida valido no formato (5/6/7 + 3 numeros), esteja ou nao na tabela do sistema. */
const cfopEhDeSaida = (cfop) => /^[567]\d{3}$/.test((0, exports.normalizarCodigoCfop)(cfop));
exports.cfopEhDeSaida = cfopEhDeSaida;
/** Saida do estado -> mesma operacao para outro estado (5102 -> 6102); vazio se nao existir. */
const cfopInterestadualEquivalente = (cfop) => {
    const c = (0, exports.normalizarCodigoCfop)(cfop);
    if (!c || c[0] !== '5')
        return '';
    const grupo = c.slice(1);
    const candidato = grupo === '405' ? '6404' : `6${grupo}`;
    return POR_CODIGO.has(candidato) ? candidato : '';
};
exports.cfopInterestadualEquivalente = cfopInterestadualEquivalente;
/**
 * Confere se o CFOP serve para o uso pedido. Mensagem em portugues dizendo o
 * que fazer; null quando serve.
 */
const problemaDoCfop = (codigo, uso) => {
    const c = (0, exports.normalizarCodigoCfop)(codigo);
    if (!c)
        return `Informe o CFOP ${uso.onde} (4 números, como 5.102).`;
    const cfop = POR_CODIGO.get(c);
    if (!cfop)
        return `O CFOP ${(0, exports.formatarCodigoCfop)(c)} ${uso.onde} não está na tabela de CFOP do sistema. Escolha um da lista (Fiscal › Tabelas Fiscais).`;
    if (cfop.tipo !== uso.tipo) {
        return `O CFOP ${(0, exports.formatarCodigoCfop)(c)} ${uso.onde} é de ${exports.ROTULO_TIPO[cfop.tipo].toLowerCase()}, e aqui precisa ser de ${exports.ROTULO_TIPO[uso.tipo].toLowerCase()}.`;
    }
    if (uso.ambitos && !uso.ambitos.includes(cfop.ambito)) {
        return `O CFOP ${(0, exports.formatarCodigoCfop)(c)} ${uso.onde} é para operação "${exports.ROTULO_AMBITO[cfop.ambito].toLowerCase()}". Escolha um CFOP ${uso.ambitos.map((a) => `"${exports.ROTULO_AMBITO[a].toLowerCase()}"`).join(' ou ')}.`;
    }
    if (uso.naturezas && !uso.naturezas.includes(cfop.natureza)) {
        return `O CFOP ${(0, exports.formatarCodigoCfop)(c)} (${exports.ROTULO_NATUREZA[cfop.natureza].toLowerCase()}) não serve ${uso.onde}. Use ${uso.naturezas.map((n) => exports.ROTULO_NATUREZA[n].toLowerCase()).join(' ou ')}.`;
    }
    if (uso.desativados?.includes(c)) {
        return `O CFOP ${(0, exports.formatarCodigoCfop)(c)} está desativado nesta empresa. Ative em Fiscal › Tabelas Fiscais ou escolha outro.`;
    }
    return null;
};
exports.problemaDoCfop = problemaDoCfop;
const AVISO_DA_ENTRADA = {
    compra_ativo: 'Ativo imobilizado não entra no estoque: a nota fica registrada e gera só a conta a pagar.',
    servico_tomado: 'Serviço não entra no estoque: a nota fica registrada e gera só a conta a pagar.',
    faturamento_entrega_futura: 'Simples faturamento: gera a conta a pagar; a mercadoria entra depois, na nota de entrega (1.117/2.117).',
    entrega_futura: 'Entrega de compra já faturada: entra no estoque sem nova conta a pagar.',
    venda_a_ordem: 'Venda à ordem: entra no estoque sem conta a pagar (o pagamento é da nota do vendedor).',
    entrada_bonificacao: 'Bonificação, brinde ou amostra: entra no estoque sem conta a pagar.',
    retorno: 'Retorno: volta para o estoque sem conta a pagar.',
    outras_entradas: 'Outras entradas: entra no estoque sem conta a pagar.',
    devolucao_de_venda: 'Devolução de venda: o estoque e o crédito do cliente se lançam em Vendas › Devolução. Aqui a nota fica só registrada.',
    transferencia_entrada: 'Transferência entre filiais: o estoque entra pela tela Transferências. Aqui a nota fica só registrada.',
    reclassificacao: 'Reclassificação de kit: a nota fica só registrada (o kit/produção movimenta o estoque).',
};
/** O que a entrada faz com o item, pelo CFOP de entrada. Null quando o CFOP nao serve para entrada. */
const acaoDaEntrada = (codigo) => {
    const cfop = (0, exports.cfopPorCodigo)(codigo);
    if (!cfop || cfop.tipo !== 'entrada')
        return null;
    const temTelaPropria = cfop.natureza === 'devolucao_de_venda' || cfop.natureza === 'transferencia_entrada';
    return {
        cfop,
        movimentaEstoque: cfop.estoque === 'entra' && !temTelaPropria,
        geraContaAPagar: cfop.financeiro === 'pagar',
        exigeInsumo: cfop.destino === 'insumo',
        aviso: AVISO_DA_ENTRADA[cfop.natureza] ?? '',
    };
};
exports.acaoDaEntrada = acaoDaEntrada;
/*
 * EMISSAO (fase 3, 20/10/2026): a natureza da operacao da nota (natOp) sai do
 * CFOP dos itens -- antes era sempre "Venda de Mercadoria", ate' em remessa
 * para conserto ou bonificacao.
 */
const NATUREZA_DA_NOTA = {
    venda: 'Venda de Mercadoria',
    servico_prestado: 'Prestação de Serviço',
    devolucao_de_compra: 'Devolução de Compra',
    transferencia_saida: 'Transferência de Mercadoria',
    remessa_bonificacao: 'Remessa em Bonificação, Doação ou Brinde',
    remessa_conserto: 'Remessa para Conserto ou Reparo',
    perda: 'Baixa de Estoque por Perda, Roubo ou Deterioração',
    cupom_fiscal: 'Lançamento decorrente de Cupom Fiscal',
    outras_saidas: 'Outra Saída de Mercadoria',
    reclassificacao: 'Reclassificação de Mercadoria',
    faturamento_venda_entrega_futura: 'Simples Faturamento - Venda para Entrega Futura',
    remessa_entrega_futura: 'Remessa - Venda para Entrega Futura',
};
/**
 * Natureza da operacao pelos CFOPs dos itens. Nota de cupom (chave
 * referenciada) e' sempre "Lancamento decorrente de Cupom Fiscal". Com venda
 * no meio (venda + bonificacao, por exemplo), fica "Venda de Mercadoria"; sem
 * venda, a natureza do primeiro CFOP conhecido. Sem CFOP conhecido: venda.
 */
const naturezaDaOperacaoPelosCfops = (cfops, opcoes = {}) => {
    if (opcoes.cupom)
        return NATUREZA_DA_NOTA.cupom_fiscal;
    // Exportacao (27/10/2026): direta (7.xxx) ou pela trading (x.501/x.502), quando a nota e' toda dela.
    const codigos = cfops.map(exports.normalizarCodigoCfop);
    if (codigos.length > 0 && codigos.every((c) => /^[56]50[12]$/.test(c)))
        return 'Venda com Fim Específico de Exportação';
    if (codigos.length > 0 && codigos.every((c) => /^7/.test(c)))
        return 'Venda para o Exterior - Exportação';
    const naturezas = cfops.map((c) => (0, exports.cfopPorCodigo)(c)?.natureza).filter((n) => Boolean(n));
    if (naturezas.length === 0 || naturezas.includes('venda'))
        return NATUREZA_DA_NOTA.venda;
    return NATUREZA_DA_NOTA[naturezas[0]] ?? NATUREZA_DA_NOTA.venda;
};
exports.naturezaDaOperacaoPelosCfops = naturezaDaOperacaoPelosCfops;
/** Texto curto da funcao, para a tela ("Baixa o estoque · Gera conta a receber · Faturamento"). */
const resumoDaFuncao = (cfop) => [
    exports.ROTULO_ESTOQUE[cfop.estoque],
    exports.ROTULO_FINANCEIRO[cfop.financeiro],
    cfop.receita ? 'Conta como faturamento' : '',
    cfop.tipo === 'entrada' && cfop.destino === 'insumo' ? 'Vai para Insumos' : '',
].filter(Boolean).join(' · ');
exports.resumoDaFuncao = resumoDaFuncao;
