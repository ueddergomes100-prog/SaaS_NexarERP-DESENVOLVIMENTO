import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARCADORES_DOS_PACOTES,
  PACOTES_DE_PERMISSOES,
  PERMISSAO_FINANCEIRO,
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
  assert.deepEqual(ordenar(pagar), ordenar(['financeiro.pagar', F.pagarBaixar, F.baixaJurosMulta, F.baixaDataAnterior, F.baixaLote, F.categorias, MARCADOR_FIN]));
  assert.deepEqual(permissoesEfetivas(['vendas.pedidos']), ['vendas.pedidos', MARCADOR_FIN]);
  assert.deepEqual(permissoesEfetivas(undefined), [MARCADOR_FIN]);
  assert.deepEqual(permissoesEfetivas(['vendas.pedidos', 7, null]), ['vendas.pedidos', MARCADOR_FIN], 'ignora lixo');
});

test('com o pacote gravado, vale so o que esta marcado; aplicar de novo nao muda nada', () => {
  const gravadas = permissoesParaGravar(['financeiro.receber', F.receberBaixar]);
  assert.deepEqual(ordenar(gravadas), ordenar(['financeiro.receber', F.receberBaixar, MARCADOR_FIN]));
  assert.deepEqual(pacotesGravados(gravadas), ['financeiro-1']);
  assert.deepEqual(pacotesGravados(['financeiro.receber']), []);
  const efetivas = permissoesEfetivas(gravadas);
  assert.deepEqual(ordenar(efetivas), ordenar(gravadas), 'desmarcou baixa em lote: fica sem');
  // Idempotente nos dois casos (o AuthContext entrega as efetivas e a tela aplica de novo).
  assert.deepEqual(ordenar(permissoesEfetivas(efetivas)), ordenar(efetivas));
  const antigas = permissoesEfetivas(['financeiro.receber', 'financeiro.pagar']);
  assert.deepEqual(ordenar(permissoesEfetivas(antigas)), ordenar(antigas));
  // Marcador repetido ou vindo da tela nao duplica.
  assert.deepEqual(ordenar(permissoesParaGravar([MARCADOR_FIN, 'a.b', 'a.b', MARCADOR_FIN])), ordenar(['a.b', MARCADOR_FIN]));
});

test('app + pacotes juntos: efetivas e o que gravar levam os dois marcadores', () => {
  const efetivas = permissoesEfetivasDoUsuario(['financeiro.receber']);
  assert.ok(efetivas.includes(MARCADOR_APP_DEFINIDO));
  assert.ok(efetivas.includes(MARCADOR_FIN));
  assert.ok(efetivas.includes(F.receberBaixar));
  assert.ok(efetivas.includes('app.pedido'), 'chave nova do app continua implicita');
  const gravar = permissoesParaGravarDoUsuario(['financeiro.receber']);
  assert.deepEqual(ordenar(gravar), ordenar(['financeiro.receber', MARCADOR_APP_DEFINIDO, MARCADOR_FIN]));
  assert.deepEqual(ordenar(permissoesEfetivasDoUsuario(gravar)), ordenar(gravar));
  assert.ok(ehMarcadorInterno(MARCADOR_APP_DEFINIDO) && ehMarcadorInterno(MARCADOR_FIN) && !ehMarcadorInterno(F.receberBaixar));
});

test('gerente: as novas implicitas contam como dele; desmarcar conta como tirar', () => {
  const alvoAntes = ['financeiro.receber'];
  const gerenteComReceber = ['financeiro.receber', 'administrativo.equipe'];
  const gerenteSemReceber = ['vendas.pedidos', 'administrativo.equipe'];
  // A tela abre com as efetivas: salvar sem mexer nao "mexe" em nada.
  const semMexer = permissoesEfetivasDoUsuario(alvoAntes);
  assert.deepEqual(mexidasSemTer({ antes: alvoAntes, depois: semMexer, doGerente: gerenteSemReceber }), []);
  // Tirar a baixa em lote: so' quem tem (ainda que implicita).
  const semLote = semMexer.filter((p) => p !== F.baixaLote);
  assert.deepEqual(mexidasSemTer({ antes: alvoAntes, depois: semLote, doGerente: gerenteComReceber }), []);
  assert.deepEqual(mexidasSemTer({ antes: alvoAntes, depois: semLote, doGerente: gerenteSemReceber }), [F.baixaLote]);
  // Sem o marcador na lista (o servidor filtra ids com traco), o desmarcado continua contando.
  const semMarcador = semLote.filter((p) => p !== MARCADOR_FIN);
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
