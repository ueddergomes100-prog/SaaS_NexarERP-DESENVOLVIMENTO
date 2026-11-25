import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARCADORES_DOS_PACOTES,
  PACOTES_DE_PERMISSOES,
  PERMISSAO_COMPRAS,
  PERMISSAO_FINANCEIRO,
  PERMISSAO_FISCAL,
  PERMISSAO_VENDAS,
  ehMarcadorInterno,
  marcadorDoPacote,
  mexidasSemTer,
  mudancasDePermissoes,
  pacotesGravados,
  permissoesEfetivas,
  permissoesEfetivasDoUsuario,
  permissoesParaGravar,
  permissoesParaGravarDoUsuario,
} from '../src/utils/permissoesNovasDomain';
import { PERMISSION_CATALOG } from '../src/utils/permissionCatalog';
import { MARCADOR_APP_DEFINIDO } from '../src/utils/permissoesAppDomain';

const ordenar = (l: string[]) => [...l].sort();
const F = PERMISSAO_FINANCEIRO;
const MARCADOR_FIN = marcadorDoPacote('financeiro-1');
const MARCADOR_FIN2 = marcadorDoPacote('financeiro-2');
/** Todos os marcadores conhecidos: efetivas e o que gravar sempre levam todos. */
const MARCADOR_VENDAS = marcadorDoPacote('vendas-1');
const MARCADORES = [MARCADOR_FIN, MARCADOR_FIN2, MARCADOR_VENDAS];

test('toda permissao nova esta no catalogo (tem rotulo na tela) e o marcador nao', () => {
  const ids = new Set(PERMISSION_CATALOG.map((i) => i.id));
  for (const pacote of PACOTES_DE_PERMISSOES) {
    for (const [daTela, novas] of Object.entries(pacote.implicacoes)) {
      assert.ok(ids.has(daTela), `${daTela} (permissao de tela) no catalogo`);
      novas.forEach((p) => assert.ok(ids.has(p), `${p} no catalogo`));
    }
  }
  Object.values(F).forEach((p) => assert.ok(ids.has(p), p));
  MARCADORES_DOS_PACOTES.forEach((m) => assert.ok(!ids.has(m), `${m} nao aparece na tela`));
  assert.equal(new Set(PACOTES_DE_PERMISSOES.map((p) => p.id)).size, PACOTES_DE_PERMISSOES.length, 'id de pacote sem repetir');
});

test('quem tem Contas a Receber e nunca foi salvo ganha as novas do Receber (ninguem perde nada)', () => {
  const efetivas = permissoesEfetivas(['financeiro.receber']);
  for (const p of [F.receberBaixar, F.receberLancar, F.receberEditar, F.receberCancelar, F.baixaJurosMulta, F.baixaDataAnterior, F.baixaLote, F.categorias, F.acertoFornecedor]) {
    assert.ok(efetivas.includes(p), p);
  }
  assert.ok(!efetivas.includes(F.pagarBaixar), 'nao ganha o que e do Pagar');
  assert.ok(efetivas.includes(MARCADOR_FIN), 'efetivas sempre levam o marcador');
});

test('quem tem so Contas a Pagar ganha so as do Pagar; quem nao tem nenhuma, nada', () => {
  const pagar = permissoesEfetivas(['financeiro.pagar']);
  assert.deepEqual(ordenar(pagar), ordenar([
    'financeiro.pagar', F.pagarBaixar, F.baixaJurosMulta, F.baixaDataAnterior, F.baixaLote, F.categorias,
    // Pacote 2 (fase 2): lancar/alterar/cancelar despesa, relatorios e importar.
    F.pagarLancar, F.pagarEditar, F.pagarCancelar, F.relatorios, F.importarTitulos,
    ...MARCADORES,
  ]));
  assert.deepEqual(permissoesEfetivas(['vendas.minhas_vendas']), ['vendas.minhas_vendas', ...MARCADORES]);
  assert.deepEqual(permissoesEfetivas(undefined), MARCADORES);
  assert.deepEqual(permissoesEfetivas(['vendas.minhas_vendas', 7, null]), ['vendas.minhas_vendas', ...MARCADORES], 'ignora lixo');
});

test('com o pacote gravado, vale so o que esta marcado; aplicar de novo nao muda nada', () => {
  const gravadas = permissoesParaGravar(['financeiro.receber', F.receberBaixar]);
  assert.deepEqual(ordenar(gravadas), ordenar(['financeiro.receber', F.receberBaixar, ...MARCADORES]));
  assert.deepEqual(pacotesGravados(gravadas), ['financeiro-1', 'financeiro-2', 'vendas-1']);
  assert.deepEqual(pacotesGravados(['financeiro.receber']), []);
  const efetivas = permissoesEfetivas(gravadas);
  assert.deepEqual(ordenar(efetivas), ordenar(gravadas), 'desmarcou baixa em lote: fica sem');
  // Idempotente nos dois casos (o AuthContext entrega as efetivas e a tela aplica de novo).
  assert.deepEqual(ordenar(permissoesEfetivas(efetivas)), ordenar(efetivas));
  const antigas = permissoesEfetivas(['financeiro.receber', 'financeiro.pagar']);
  assert.deepEqual(ordenar(permissoesEfetivas(antigas)), ordenar(antigas));
  // Marcador repetido ou vindo da tela nao duplica.
  assert.deepEqual(ordenar(permissoesParaGravar([MARCADOR_FIN, 'a.b', 'a.b', MARCADOR_FIN])), ordenar(['a.b', ...MARCADORES]));
});

test('app + pacotes juntos: efetivas e o que gravar levam os dois marcadores', () => {
  const efetivas = permissoesEfetivasDoUsuario(['financeiro.receber']);
  assert.ok(efetivas.includes(MARCADOR_APP_DEFINIDO));
  assert.ok(efetivas.includes(MARCADOR_FIN));
  assert.ok(efetivas.includes(F.receberBaixar));
  assert.ok(efetivas.includes('app.pedido'), 'chave nova do app continua implicita');
  const gravar = permissoesParaGravarDoUsuario(['financeiro.receber']);
  assert.deepEqual(ordenar(gravar), ordenar(['financeiro.receber', MARCADOR_APP_DEFINIDO, ...MARCADORES]));
  assert.deepEqual(ordenar(permissoesEfetivasDoUsuario(gravar)), ordenar(gravar));
  assert.ok(ehMarcadorInterno(MARCADOR_APP_DEFINIDO) && ehMarcadorInterno(MARCADOR_FIN) && !ehMarcadorInterno(F.receberBaixar));
});

test('gerente: as novas implicitas contam como dele; desmarcar conta como tirar', () => {
  const alvoAntes = ['financeiro.receber'];
  const gerenteComReceber = ['financeiro.receber', 'administrativo.equipe'];
  const gerenteSemReceber = ['vendas.minhas_vendas', 'administrativo.equipe'];
  // A tela abre com as efetivas: salvar sem mexer nao "mexe" em nada.
  const semMexer = permissoesEfetivasDoUsuario(alvoAntes);
  assert.deepEqual(mexidasSemTer({ antes: alvoAntes, depois: semMexer, doGerente: gerenteSemReceber }), []);
  // Tirar a baixa em lote: so' quem tem (ainda que implicita).
  const semLote = semMexer.filter((p) => p !== F.baixaLote);
  assert.deepEqual(mexidasSemTer({ antes: alvoAntes, depois: semLote, doGerente: gerenteComReceber }), []);
  assert.deepEqual(mexidasSemTer({ antes: alvoAntes, depois: semLote, doGerente: gerenteSemReceber }), [F.baixaLote]);
  // Sem o marcador na lista (o servidor filtra ids com traco), o desmarcado continua contando.
  const semMarcador = semLote.filter((p) => !MARCADORES.includes(p));
  assert.deepEqual(mexidasSemTer({ antes: alvoAntes, depois: semMarcador, doGerente: gerenteSemReceber }), [F.baixaLote]);
});

test('historico: so o que mudou de verdade, sem marcadores', () => {
  // Salvar pela primeira vez sem mexer: as implicitas viram gravadas, nada "entra".
  const antes = ['financeiro.receber'];
  const depois = permissoesParaGravarDoUsuario(permissoesEfetivasDoUsuario(antes));
  assert.deepEqual(mudancasDePermissoes(antes, depois), { entraram: [], sairam: [] });
  const semBaixa = permissoesParaGravarDoUsuario(permissoesEfetivasDoUsuario(antes).filter((p) => p !== F.receberBaixar));
  assert.deepEqual(mudancasDePermissoes(antes, semBaixa), { entraram: [], sairam: [F.receberBaixar] });
});

test('pacote 2 (fase 2): salvo antes (so com o pacote 1) ganha as novas pelas permissoes de tela', () => {
  const salvoNaFase1 = ['financeiro.receber', 'financeiro.pagar', 'fiscal.emitir', 'compras.cotacoes', F.receberBaixar, MARCADOR_FIN];
  const efetivas = permissoesEfetivas(salvoNaFase1);
  for (const p of [F.baixaCreditoCliente, F.recibo, F.cobrarWhatsapp, F.relatorios, F.importarTitulos, F.pagarLancar, F.pagarEditar, F.pagarCancelar]) {
    assert.ok(efetivas.includes(p), p);
  }
  for (const p of Object.values(PERMISSAO_FISCAL)) assert.ok(efetivas.includes(p), p);
  assert.ok(efetivas.includes(PERMISSAO_COMPRAS.gerarPedido));
  // Do pacote 1 vale so' o que foi gravado (baixa em lote foi desmarcada naquela vez).
  assert.ok(!efetivas.includes(F.baixaLote));
  // Relatorios tambem vem com as outras telas do Financeiro; o fiscal nao vem com o Financeiro.
  assert.ok(permissoesEfetivas(['financeiro.cheques']).includes(F.relatorios));
  assert.ok(!permissoesEfetivas(['financeiro.receber']).includes(PERMISSAO_FISCAL.inutilizar));
  // Salvo de novo depois da fase 2: vale o marcado.
  const salvoNaFase2 = permissoesParaGravar(['fiscal.emitir', PERMISSAO_FISCAL.cartaCorrecao]);
  const efetivas2 = permissoesEfetivas(salvoNaFase2);
  assert.ok(efetivas2.includes(PERMISSAO_FISCAL.cartaCorrecao));
  assert.ok(!efetivas2.includes(PERMISSAO_FISCAL.inutilizar), 'desmarcou inutilizar: fica sem');
  [...Object.values(PERMISSAO_FISCAL), ...Object.values(PERMISSAO_COMPRAS)].forEach((p: string) => {
    assert.ok(PERMISSION_CATALOG.some((i) => i.id === p), `${p} no catalogo`);
  });
});

test('pacote vendas-1: quem usa a tela ja tem as novas; o que hoje e so do administrador nao vem', () => {
  const V = PERMISSAO_VENDAS;
  const salvoNaFase2 = permissoesParaGravar(['vendas.pedidos', 'vendas.alterar', 'vendas.devolucao', 'cadastros.vendedores_incluir'])
    .filter((p) => p !== MARCADOR_VENDAS);
  const efetivas = permissoesEfetivas(salvoNaFase2);
  for (const p of [V.finalizar, V.alterarData, V.alterarVendedor, V.alterarPreco, V.desconto, V.imprimir, V.documentosCobranca,
    V.cancelar, V.alterarTransporte, V.alterarNotaFiscal, V.devolucaoEstornar, V.gerenciarPinVendedor]) {
    assert.ok(efetivas.includes(p), p);
  }
  for (const p of [V.importar, V.preVendaRelatorioValores, 'vendas.liberar_desconto', 'operacoes.rotas_configurar']) {
    assert.ok(!efetivas.includes(p), `${p} nao vem com nada`);
  }
  assert.ok(!permissoesEfetivas(['vendas.minhas_vendas']).includes(V.finalizar), 'Minhas Vendas nao fatura');
  assert.ok(permissoesEfetivas(['vendas.condicional']).includes(V.condicionalCancelar));
  assert.ok(permissoesEfetivas(['vendas.troca_gerenciar']).includes(V.trocaEntregar));
  assert.ok(permissoesEfetivas(['operacoes.rotas']).includes('operacoes.frota'));
  // Salvo de novo: desmarcou alterar preco, fica sem.
  const salvo = permissoesParaGravar(permissoesEfetivas(['vendas.pedidos']).filter((p) => p !== V.alterarPreco));
  assert.ok(!permissoesEfetivas(salvo).includes(V.alterarPreco));
  assert.ok(permissoesEfetivas(salvo).includes(V.desconto));
  Object.values(V).forEach((p: string) => assert.ok(PERMISSION_CATALOG.some((i) => i.id === p), `${p} no catalogo`));
});
