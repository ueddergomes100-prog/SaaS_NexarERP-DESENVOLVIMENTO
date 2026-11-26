/*
 * PERMISSAO POR ACAO EM VENDAS (item 15 da Embala Minas, fase Vendas, 25/11/2026).
 *
 * Mesmo padrao do Financeiro (permissoesFinanceiro.js): cada acao pede a SUA
 * permissao, conferida pelas EFETIVAS (permissoesNovasDomain.ts, pacote
 * 'vendas-1' -- quem ja' usa a tela tem as novas ate' as permissoes dele serem
 * salvas de novo). Dono e plataforma seguem liberados; o administrador, pelas
 * efetivas (troca do administrador, 25/11/2026).
 *
 * Decisao do dono: falta de permissao para mexer num valor que protege a
 * empresa = o valor fica no PADRAO, travado, conferido aqui -- nunca em branco:
 *  - preco: o do sistema (cadastro, tabela, promocao, atacado), ou o ja'
 *    combinado na pre-venda/orcamento por quem tinha a permissao;
 *  - data: a de hoje;
 *  - vendedor: o identificado (codigo+senha), o da pre-venda/orcamento, ou quem
 *    esta' logado;
 *  - desconto: so' o do cadastro do cliente (ou o ja' gravado na pre-venda por
 *    quem podia dar).
 *
 * Funcoes puras (sem Firestore), para testar sozinhas.
 */
const { podePelasEfetivas, montarMensagemSemPermissao } = require('./permissoesFinanceiro');
const {
  PERMISSAO_VENDAS: PV,
  PERMISSAO_OPERACOES: PO,
  PERMISSAO_CRM: PC,
  permissoesEfetivasDoUsuario,
} = require('../domain/permissoesNovasDomain');
const { PERMISSAO_APP_ALTERAR_PRECO } = require('../domain/permissoesAppDomain');
const { hasTenantFullAccess } = require('../domain/roles');
const { toCents } = require('../domain/financeDomain');

/** Pode, contando as permissoes novas que ja' vem marcadas. */
const podeEmVendas = podePelasEfetivas;

/** O que cada permissao deixa fazer, na frase "Voce nao tem permissao para ...", e o que fazer sem ela. */
const ACOES = {
  [PV.finalizar]: { acao: 'finalizar vendas' },
  [PV.alterarData]: { acao: 'lançar venda com data diferente de hoje', dica: 'Sem ela, a venda sai com a data de hoje.' },
  [PV.alterarVendedor]: { acao: 'escolher o vendedor da venda', dica: 'Sem ela, a venda fica com o vendedor identificado (ou com você).' },
  [PV.alterarPreco]: { acao: 'alterar o preço do item', dica: 'Sem ela, o item vai pelo preço do cadastro.' },
  [PV.desconto]: { acao: 'dar desconto na venda', dica: 'Sem ela, vale só o desconto do cadastro do cliente.' },
  [PV.cancelar]: { acao: 'cancelar ou estornar venda finalizada' },
  [PV.alterarTransporte]: { acao: 'corrigir o transporte de venda finalizada' },
  [PV.alterarNotaFiscal]: { acao: 'trocar o pedido entre com e sem nota fiscal' },
  [PV.devolucaoEstornar]: { acao: 'estornar devolução de venda' },
  [PV.pendenteRecusar]: { acao: 'recusar pedido pendente' },
  [PV.imprimir]: { acao: 'imprimir pedido, recibo e minuta' },
  [PV.documentosCobranca]: { acao: 'emitir promissória, carnê e duplicata' },
  [PV.condicionalSaida]: { acao: 'registrar a saída de condicional' },
  [PV.condicionalDevolucao]: { acao: 'registrar a devolução do condicional' },
  [PV.condicionalFechar]: { acao: 'fechar o condicional' },
  [PV.condicionalCancelar]: { acao: 'cancelar condicional' },
  [PV.trocaAprovar]: { acao: 'aprovar ou recusar trocas' },
  [PV.trocaEntregar]: { acao: 'entregar trocas (baixa o estoque)' },
  [PV.trocaCancelar]: { acao: 'cancelar trocas' },
  [PV.gerenciarPinVendedor]: { acao: 'definir o código e a senha de vendedor' },
  [PO.entregasFuturasRegistrar]: { acao: 'registrar entregas futuras' },
  [PO.expedicaoDivergencia]: { acao: 'fechar conferência com divergência' },
  [PC.agendaCancelar]: { acao: 'cancelar agendamentos' },
  [PC.alertasCancelar]: { acao: 'cancelar lembretes' },
  'vendas.pre_venda_editar': { acao: 'mudar itens ou cliente de pré-venda gravada', dica: 'Sem ela, fature a pré-venda como foi gravada.' },
  'vendas.pedidos_pendentes_editar': { acao: 'editar e finalizar pedido pendente' },
  'vendas.pedidos_pendentes_editar_cliente': { acao: 'trocar o cliente de pedido pendente' },
  'vendas.pedidos_pendentes_alterar_qtd': { acao: 'alterar a quantidade de pedido pendente' },
  'vendas.pedidos_pendentes_adicionar_item': { acao: 'adicionar produto em pedido pendente' },
  'vendas.pedidos_pendentes_excluir_item': { acao: 'excluir item de pedido pendente' },
  'vendas.liberar_desconto': { acao: 'aprovar desconto acima do limite', dica: 'Sem ela, peça a liberação de um responsável (senha) ou reduza o desconto.' },
  'fiscal.emitir': { acao: 'emitir nota fiscal (a nota de remessa é uma nota)' },
};

const mensagemSemPermissao = montarMensagemSemPermissao(ACOES);

/** Das permissoes pedidas, as que o usuario nao tem (efetivas). [] = pode. */
const permissoesQueFaltam = (user, ids) => [...new Set(ids)].filter((id) => !podeEmVendas(user, id));

/**
 * Confere e joga o erro do servico (`Erro(status, mensagem)`) com 403 e a
 * frase em portugues. `antes` = frase que explica o caso, antes da mensagem.
 */
const exigir = (user, ids, Erro, antes = '') => {
  const faltam = permissoesQueFaltam(user, ids);
  if (faltam.length) throw new Erro(403, `${antes}${mensagemSemPermissao(faltam)}`);
};

/**
 * O cadastro de OUTRA pessoa (quem gravou a pre-venda ou o orcamento) tem a
 * permissao? Dono sim; o resto (administrador inclusive) pelas efetivas do cadastro.
 */
const cadastroPode = (uid, registro, permissao) => {
  if (!registro) return false;
  const ehDono = Boolean(uid) && String(registro.tenantId || uid) === String(uid);
  if (hasTenantFullAccess(registro.role, ehDono)) return true;
  // Administrador: pelas efetivas com o papel (todas enquanto o dono nao salvar as dele).
  return permissoesEfetivasDoUsuario(registro.permissoes, registro.nivelAcesso, { papel: registro.role }).includes(permissao);
};

// ---------------------------------------------------------------------------
// Fechamento da venda (Pedido de Venda)
// ---------------------------------------------------------------------------

const reais = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
const maiusculo = (v) => String(v || '').trim().toUpperCase();

/** Quantidade por produto (o mesmo produto pode estar em duas linhas). */
const quantidadesPorProduto = (itens) => {
  const mapa = new Map();
  (Array.isArray(itens) ? itens : []).forEach((i) => {
    if (!i || !i.id) return;
    const id = String(i.id);
    mapa.set(id, (mapa.get(id) || 0) + (Number(i.quantidade) || 0));
  });
  return mapa;
};

/**
 * O que mudou entre o pedido aberto gravado (pre-venda/pedido do agente) e o
 * que a tela mandou faturar. Preco e desconto sao conferidos a parte.
 */
const mudancasNoPedidoAberto = (aberto, pedido) => {
  const gravado = quantidadesPorProduto(aberto && aberto.itens);
  const atual = quantidadesPorProduto(pedido.itens);
  const adicionou = [...atual.keys()].some((id) => !gravado.has(id));
  const removeu = [...gravado.keys()].some((id) => !atual.has(id));
  const alterouQuantidade = [...atual.entries()].some(([id, q]) => gravado.has(id) && Math.abs(gravado.get(id) - q) > 1e-6);
  const idG = String((aberto && aberto.clienteId) || '');
  const idA = String(pedido.clienteId || '');
  const trocouCliente = idG && idA
    ? idG !== idA
    : maiusculo((aberto && aberto.clienteNome) || 'CONSUMIDOR FINAL') !== maiusculo(pedido.clienteNome || 'CONSUMIDOR FINAL');
  return { adicionou, removeu, alterouQuantidade, trocouCliente };
};

/** Permissoes que faturar o pedido aberto pede, pelo que mudou (pre-venda x pedido do agente). */
const permissoesDoPedidoAberto = ({ ehDoAgente, mudancas }) => {
  const mudou = mudancas.adicionou || mudancas.removeu || mudancas.alterouQuantidade || mudancas.trocouCliente;
  if (!ehDoAgente) return mudou ? ['vendas.pre_venda_editar'] : [];
  const ids = ['vendas.pedidos_pendentes_editar', PV.finalizar];
  if (mudancas.trocouCliente) ids.push('vendas.pedidos_pendentes_editar_cliente');
  if (mudancas.alterouQuantidade) ids.push('vendas.pedidos_pendentes_alterar_qtd');
  if (mudancas.adicionou) ids.push('vendas.pedidos_pendentes_adicionar_item');
  if (mudancas.removeu) ids.push('vendas.pedidos_pendentes_excluir_item');
  return ids;
};

/**
 * Preco de cada linha fora do padrao (sem "Alterar o preco do item").
 * `conferidos` = resultado de conferirPrecos (mesma ordem dos itens).
 * `combinados` = linhas ja' gravadas por quem PODIA mexer no preco (pre-venda
 * aberta, orcamento de origem): mesmo produto e mesmo preco = o combinado.
 * Item sem cadastro (avulso) nao tem preco padrao: sem a permissao, nao entra.
 * Devolve a frase da primeira linha fora do padrao, ou null.
 */
const precoForaDoPadrao = ({ itens, conferidos, combinados = [] }) => {
  for (let i = 0; i < itens.length; i += 1) {
    const item = itens[i];
    if (!item || item.bonificado === true) continue;
    const cobrado = toCents(Number(item.precoUnitario) || 0);
    const combinado = combinados.some((c) => c && String(c.id) === String(item.id) && toCents(Number(c.precoUnitario) || 0) === cobrado);
    if (combinado) continue;
    if (!item.id || item.id === 'avulso') {
      return `${item.nome || 'Item'} não tem cadastro no estoque, então não tem preço padrão. `;
    }
    const sistema = conferidos[i] ? toCents(Number(conferidos[i].precoSistema) || 0) : 0;
    if (sistema > 0 && cobrado !== sistema) {
      return `${item.nome || 'Item'} está a ${reais(cobrado)}, e o preço do sistema é ${reais(sistema)}. `;
    }
  }
  return null;
};

/**
 * Desconto dentro do padrao (sem "Dar desconto"): ate' o percentual do
 * cadastro do cliente, ou ate' o desconto ja' gravado na pre-venda por quem
 * podia dar. 1 centavo de folga para o arredondamento.
 */
const descontoNoPadrao = ({ baseCentavos, descontoCentavos, percentualDoCliente = 0, descontoGravadoCentavos = 0 }) => {
  if (!(descontoCentavos > 0)) return true;
  const doCliente = Math.round(Math.max(0, baseCentavos) * Math.max(0, Number(percentualDoCliente) || 0) / 100);
  return descontoCentavos <= Math.max(doCliente, Math.max(0, descontoGravadoCentavos)) + 1;
};

/** Vendedor dentro do padrao (sem "Escolher o vendedor"). */
const vendedorNoPadrao = ({ vendedorId, padroes, identificado }) => (
  Boolean(identificado) || padroes.filter(Boolean).map(String).includes(String(vendedorId))
);

/**
 * Tudo que o fechamento da venda pede, fora o preco (que depende do cadastro
 * de quem gravou a pre-venda): finalizar, data, vendedor, desconto e
 * mudancas no pedido aberto. Devolve { ids, motivo } -- `motivo`
 * explica o primeiro valor fora do padrao.
 */
const permissoesDoFechamento = ({
  pedido, aberto, ehDoAgente, hoje, vendedorId, vendedoresPadrao, identificado,
  baseCentavos, descontoCentavos, percentualDoCliente, descontoGravadoCentavos, autorPodiaDarDesconto,
}) => {
  const ids = [];
  let motivo = '';
  if (aberto) {
    ids.push(...permissoesDoPedidoAberto({ ehDoAgente, mudancas: mudancasNoPedidoAberto(aberto, pedido) }));
  } else {
    ids.push(PV.finalizar);
  }
  if (pedido.dataVenda !== hoje) {
    ids.push(PV.alterarData);
    motivo = motivo || `A venda está com a data ${pedido.dataVenda.split('-').reverse().join('/')}, e hoje é ${hoje.split('-').reverse().join('/')}. `;
  }
  if (!vendedorNoPadrao({ vendedorId, padroes: vendedoresPadrao, identificado })) ids.push(PV.alterarVendedor);
  if (!descontoNoPadrao({ baseCentavos, descontoCentavos, percentualDoCliente, descontoGravadoCentavos: autorPodiaDarDesconto ? descontoGravadoCentavos : 0 })) {
    ids.push(PV.desconto);
  }
  return { ids, motivo };
};

module.exports = {
  ACOES,
  podeEmVendas,
  permissoesQueFaltam,
  mensagemSemPermissao,
  exigir,
  cadastroPode,
  mudancasNoPedidoAberto,
  permissoesDoPedidoAberto,
  precoForaDoPadrao,
  descontoNoPadrao,
  vendedorNoPadrao,
  permissoesDoFechamento,
  PERMISSAO_APP_ALTERAR_PRECO,
};
