import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARCADORES_DOS_PACOTES,
  PACOTES_DE_PERMISSOES,
  PERMISSAO_COMPRAS,
  PERMISSAO_FINANCEIRO,
  PERMISSAO_FISCAL,
  PERMISSAO_VENDAS,
  PERMISSAO_CADASTROS,
  PERMISSAO_ESTOQUE,
  PERMISSAO_FILIAIS,
  PERMISSAO_OS,
  PERMISSAO_PRODUCAO,
  PERMISSAO_ADMINISTRACAO,
  PERMISSAO_CONFIG_AREAS,
  PERMISSAO_FILIAIS_GESTAO,
  permissaoDoCampoGeral,
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
import {
  CAMPOS_DO_BLOCO_DA_FILIAL,
  CAMPOS_GERAIS_DA_PERMISSAO,
  avisoDosBlocosTravados,
  blocosTravadosDaFilial,
  camposTravadosDaFilial,
  manterCamposTravados,
  podeAbrirConfigDaFilial,
} from '../src/utils/configuracoesPermissaoDomain';
import { CAMPOS_GERAIS } from '../src/utils/configuracoesGeraisDomain';

const ordenar = (l: string[]) => [...l].sort();
const F = PERMISSAO_FINANCEIRO;
const MARCADOR_FIN = marcadorDoPacote('financeiro-1');
const MARCADOR_FIN2 = marcadorDoPacote('financeiro-2');
/** Todos os marcadores conhecidos: efetivas e o que gravar sempre levam todos. */
const MARCADOR_VENDAS = marcadorDoPacote('vendas-1');
const MARCADOR_ESTOQUE = marcadorDoPacote('estoque-1');
const MARCADOR_ADMINISTRACAO = marcadorDoPacote('administracao-1');
const MARCADORES = [MARCADOR_FIN, MARCADOR_FIN2, MARCADOR_VENDAS, MARCADOR_ESTOQUE, MARCADOR_ADMINISTRACAO];

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
  assert.deepEqual(pacotesGravados(gravadas), ['financeiro-1', 'financeiro-2', 'vendas-1', 'estoque-1', 'administracao-1']);
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

test('pacote estoque-1: quem usa a tela ja tem as novas; o que hoje e so do administrador nao vem', () => {
  const E = PERMISSAO_ESTOQUE;
  const C = PERMISSAO_CADASTROS;
  const salvoNaFaseVendas = permissoesParaGravar(['cadastros.estoque_alterar', 'cadastros.clientes', 'mecanica.os', 'estoque.balanco_gerenciar'])
    .filter((p) => p !== MARCADOR_ESTOQUE);
  const efetivas = permissoesEfetivas(salvoNaFaseVendas);
  for (const p of [E.produtoIncluir, E.estoqueInicial, E.alterarPreco, E.alterarCusto, E.verCusto, E.produtoInativar, E.produtoExcluir,
    E.importar, E.padronizarNomes, C.clientesAlterar, C.clientesInativar, C.clientesLimiteCredito, C.relatorios,
    PERMISSAO_OS.finalizar, PERMISSAO_OS.cancelar, E.balancoFechar, E.balancoCancelar]) {
    assert.ok(efetivas.includes(p), p);
  }
  // Modo Avancado, composicao e trocar o tecnico: nao vem com a tela.
  for (const p of [E.produtoAvancado, E.composicao, E.comissaoDesconto, PERMISSAO_OS.responsavel, FILIAL_SEM_NOTA]) {
    assert.ok(!efetivas.includes(p), `${p} nao vem com a tela`);
  }
  assert.ok(!permissoesEfetivas(['cadastros.estoque']).includes(E.alterarPreco), 'so ver a lista nao mexe em preco');
  assert.ok(permissoesEfetivas(['estoque.relatorio']).includes(E.verCusto));
  assert.ok(permissoesEfetivas(['operacoes.producao']).includes(PERMISSAO_PRODUCAO.estornar));
  assert.ok(permissoesEfetivas(['filiais.utilizar']).includes(PERMISSAO_FILIAIS.transferenciaReceber));
  assert.ok(permissoesEfetivas(['fiscal.entrada']).includes('fiscal.entrada_excluir'));
  // Salvo de novo: desmarcou preco, fica sem.
  const salvo = permissoesParaGravar(permissoesEfetivas(['cadastros.estoque_alterar']).filter((p) => p !== E.alterarPreco));
  assert.ok(!permissoesEfetivas(salvo).includes(E.alterarPreco));
  assert.ok(permissoesEfetivas(salvo).includes(E.alterarCusto));
  [E, C, PERMISSAO_FILIAIS, PERMISSAO_OS, PERMISSAO_PRODUCAO].forEach((grupo) => Object.values(grupo).forEach((p: string) => {
    assert.ok(PERMISSION_CATALOG.some((i) => i.id === p), `${p} no catalogo`);
  }));
  assert.ok(PERMISSION_CATALOG.some((i) => i.id === 'fiscal.entrada_excluir'));
});

const FILIAL_SEM_NOTA = PERMISSAO_FILIAIS.transferirSemNota;

test('nivel gerente: traz Modo Avancado e sem nota enquanto o pacote nao foi salvo; depois vale o marcado', () => {
  const E = PERMISSAO_ESTOQUE;
  const doGerente = [E.produtoAvancado, E.composicao, E.comissaoDesconto, FILIAL_SEM_NOTA];
  const gerente = permissoesEfetivas(['cadastros.estoque_alterar'], 'gerente');
  doGerente.forEach((p) => assert.ok(gerente.includes(p), p));
  assert.ok(permissoesEfetivas([], 'administracao').includes(FILIAL_SEM_NOTA), 'nome antigo do gerente');
  doGerente.forEach((p) => assert.ok(!permissoesEfetivas(['cadastros.estoque_alterar'], 'funcionario').includes(p), `${p} nao vem para funcionario`));
  doGerente.forEach((p) => assert.ok(!permissoesEfetivas(['cadastros.estoque_alterar'], 'supervisor').includes(p), `${p} nao vem para supervisor`));
  // Salvo de novo sem a permissao: o nivel nao libera mais sozinho.
  const salvoSem = permissoesParaGravar(gerente.filter((p) => p !== FILIAL_SEM_NOTA));
  assert.ok(!permissoesEfetivas(salvoSem, 'gerente').includes(FILIAL_SEM_NOTA));
  assert.ok(permissoesEfetivas(salvoSem, 'gerente').includes(E.produtoAvancado));
  // Idempotente com o nivel.
  assert.deepEqual(ordenar(permissoesEfetivasDoUsuario(permissoesEfetivasDoUsuario(['cadastros.estoque'], 'gerente'), 'gerente')),
    ordenar(permissoesEfetivasDoUsuario(['cadastros.estoque'], 'gerente')));
  // Gerente de equipe (nivel gerente) editando outro gerente: abrir e salvar sem mexer nao "mexe" em nada.
  const alvo = ['cadastros.estoque_alterar'];
  const telaAbre = permissoesEfetivasDoUsuario(alvo, 'gerente');
  assert.deepEqual(mexidasSemTer({ antes: alvo, depois: telaAbre, doGerente: ['cadastros.estoque_alterar', 'administrativo.equipe'], nivelAntes: 'gerente', nivelDoGerente: 'gerente' }), []);
  assert.deepEqual(mudancasDePermissoes(alvo, permissoesParaGravarDoUsuario(telaAbre), 'gerente'), { entraram: [], sairam: [] });
});


// ---------------------------------------------------------------------------
// Fase Administracao (25/11/2026): pacote 'administracao-1'
// ---------------------------------------------------------------------------

const A = PERMISSAO_ADMINISTRACAO;
const CA = PERMISSAO_CONFIG_AREAS;

test('administracao-1: toda permissao nova no catalogo, sem as que ja existem em outros ramos', () => {
  const ids = new Set(PERMISSION_CATALOG.map((i) => i.id));
  [A, CA, PERMISSAO_FILIAIS_GESTAO].forEach((grupo) => Object.values(grupo).forEach((p: string) => assert.ok(ids.has(p), `${p} no catalogo`)));
  for (const proibida of ['vendas.trocar_forma_do_vendedor', 'app.devolucao_destino', 'estoque.nota_avulsa_cheque_cliente']) {
    assert.ok(!ids.has(proibida), `${proibida} nao entra por este ramo`);
  }
  assert.ok(![...ids].some((id) => id.startsWith('vendas.devolucao_') && id !== 'vendas.devolucao_estornar'), 'vendas.devolucao_* nao entra por este ramo');
  assert.equal(PERMISSION_CATALOG.length, ids.size, 'nenhum id repetido no catalogo');
  const pacote = PACOTES_DE_PERMISSOES.find((p) => p.id === 'administracao-1');
  assert.ok(pacote, 'pacote existe');
  Object.values(pacote?.implicacoesSemFiliais || {}).flat().forEach((p) => assert.ok(ids.has(p), p));
  Object.values(pacote?.implicacoesDoNivel || {}).flat().forEach((p) => assert.ok(ids.has(p), p));
});

test('administracao-1: Configuracoes traz a meta; as Gerais so em empresa sem filiais', () => {
  const comFiliais = permissoesEfetivas(['administrativo.config']);
  assert.ok(comFiliais.includes(CA.metas));
  for (const p of [A.configGerais, CA.planoContas, CA.cashbackConfigurar]) {
    assert.ok(!comFiliais.includes(p), `${p} nao vem com filiais (so o dono/administrador do grupo salvava)`);
    assert.ok(permissoesEfetivas(['administrativo.config'], undefined, { semFiliais: true }).includes(p), `${p} vem sem filiais`);
  }
  // Nada da filial vem com "Admin: Configuracoes": a tela era so do dono/administrador.
  for (const p of [A.configFilial, A.dadosEmpresa, A.numeracao, CA.pixPedido, CA.limitesDesconto, CA.fiscalConfigurar, CA.fiscalNumeracao]) {
    assert.ok(!permissoesEfetivas(['administrativo.config'], 'gerente', { semFiliais: true }).includes(p), `${p} nao vem com nada`);
  }
  assert.ok(permissoesEfetivas(['administrativo.logs']).includes(A.logsExportar));
  assert.ok(permissoesEfetivas(['administrativo.relatorios']).includes(A.relatoriosFinanceiros));
  assert.ok(permissoesEfetivas(['administrativo.relatorios']).includes(A.relatoriosVendas));
  // Salvo de novo: vale o marcado, com ou sem filiais.
  const salvo = permissoesParaGravar(['administrativo.config']);
  assert.ok(!permissoesEfetivas(salvo, undefined, { semFiliais: true }).includes(A.configGerais));
});

test('administracao-1: o nivel gerente vira permissao marcada (Equipe, permissoes, trava); com a Equipe, criar/ficha/senha/inativar', () => {
  const gerente = permissoesEfetivas([], 'gerente');
  for (const p of [A.equipe, A.equipePermissoes, A.liberarTrava]) assert.ok(gerente.includes(p), p);
  for (const p of [A.equipeCriar, A.equipeEditar, A.equipeSenha, A.equipeInativar]) {
    assert.ok(!gerente.includes(p), `${p}: o nivel sozinho nao traz (precisava da Equipe gravada)`);
    assert.ok(permissoesEfetivas([A.equipe], 'gerente').includes(p), `${p}: gerente com a Equipe ja fazia`);
    assert.ok(!permissoesEfetivas([A.equipe], 'supervisor').includes(p), `${p}: so a tela, sem ser gerente, nao`);
  }
  for (const p of [A.equipeNivel, A.equipeApp, A.equipeFilialPadrao, A.backupGerar, A.backupBaixar, CA.caixaComputadores, PERMISSAO_FILIAIS_GESTAO.cadastrar]) {
    assert.ok(!permissoesEfetivas([A.equipe], 'gerente', { semFiliais: true }).includes(p), `${p}: so o administrador fazia, nao vem`);
  }
  assert.ok(permissoesEfetivas([], 'administracao').includes(A.liberarTrava), 'nome antigo do gerente');
  // Salvo sem a trava: o nivel nao libera mais.
  const salvoSem = permissoesParaGravar(gerente.filter((p) => p !== A.liberarTrava));
  assert.ok(!permissoesEfetivas(salvoSem, 'gerente').includes(A.liberarTrava));
  assert.ok(permissoesEfetivas(salvoSem, 'gerente').includes(A.equipe));
  // Gerente editando funcionario comum, sem mexer em nada: nao "mexe" no que nao tem (com e sem filiais).
  for (const semFiliais of [false, true]) {
    const alvo = ['administrativo.config', 'vendas.pedidos'];
    const telaAbre = permissoesEfetivasDoUsuario(alvo, 'funcionario', { semFiliais });
    assert.deepEqual(mexidasSemTer({ antes: alvo, depois: telaAbre, doGerente: [A.equipe], nivelAntes: 'funcionario', nivelDoGerente: 'gerente', opcoes: { semFiliais } }), []);
    assert.deepEqual(mudancasDePermissoes(alvo, permissoesParaGravarDoUsuario(telaAbre), 'funcionario', { semFiliais }), { entraram: [], sairam: [] });
  }
});

test('configuracoes gerais: cada campo pede a sua permissao; a tela e o servidor usam o mesmo mapa', () => {
  assert.equal(permissaoDoCampoGeral('planoContasReceitas'), CA.planoContas);
  assert.equal(permissaoDoCampoGeral('cashback'), CA.cashbackConfigurar);
  assert.equal(permissaoDoCampoGeral('trabalhaComLimiteCredito'), A.configGerais);
  const daTela = Object.values(CAMPOS_GERAIS_DA_PERMISSAO).flat().sort();
  assert.deepEqual(daTela, [...CAMPOS_GERAIS].sort(), 'todo campo geral tem bloco na tela');
  for (const [permissao, campos] of Object.entries(CAMPOS_GERAIS_DA_PERMISSAO)) {
    campos.forEach((c) => assert.equal(permissaoDoCampoGeral(c), permissao, c));
  }
});

test('configuracoes da filial: abre com a permissao; bloco sem a sua fica no valor gravado', () => {
  assert.equal(podeAbrirConfigDaFilial({ gestor: true, permissoes: [] }), true);
  assert.equal(podeAbrirConfigDaFilial({ gestor: false, permissoes: ['administrativo.config'] }), false, 'so "Admin: Configuracoes" nao abre a da filial');
  assert.equal(podeAbrirConfigDaFilial({ gestor: false, permissoes: [A.configFilial] }), true);
  assert.deepEqual(blocosTravadosDaFilial({ gestor: true, permissoes: [] }), []);
  const travados = blocosTravadosDaFilial({ gestor: false, permissoes: [A.configFilial, CA.limitesDesconto] });
  assert.ok(!travados.includes(CA.limitesDesconto));
  assert.ok(travados.includes(CA.pixPedido) && travados.includes(A.dadosEmpresa));
  const campos = camposTravadosDaFilial(travados);
  assert.ok(campos.has('pixNoPedidoChave') && campos.has('cnpj'));
  assert.ok(!campos.has('limiteDescontoPdv'));
  assert.ok(!campos.has('bancoPadraoBoletoId'), 'banco padrao do boleto fica com o resto da tela');
  // Um campo so em um bloco.
  const todos = Object.values(CAMPOS_DO_BLOCO_DA_FILIAL).flat();
  assert.equal(new Set(todos).size, todos.length, 'campo em dois blocos');
  // Nenhum campo geral (so muda nas Gerais) aparece na filial.
  CAMPOS_GERAIS.forEach((c) => assert.ok(!todos.includes(c), `${c} e das Gerais`));
  // Guarda: o travado volta ao gravado; o liberado muda; sem gravado, passa.
  const gravado = { pixNoPedidoChave: 'CHAVE', limiteDescontoPdv: { tipo: 'percentual', valor: '5' } };
  const novo = { pixNoPedidoChave: 'OUTRA', limiteDescontoPdv: { tipo: 'percentual', valor: '50' } };
  const r = manterCamposTravados(gravado, novo, campos);
  assert.equal(r.pixNoPedidoChave, 'CHAVE');
  assert.deepEqual(r.limiteDescontoPdv, { tipo: 'percentual', valor: '50' });
  assert.equal(manterCamposTravados(null, novo, campos), novo);
  const igual = { ...novo, pixNoPedidoChave: 'CHAVE' };
  assert.equal(manterCamposTravados(gravado, igual, campos), igual, 'nada mudou: mesmo objeto');
  assert.match(avisoDosBlocosTravados([CA.pixPedido]), /"Financeiro: Chave Pix impressa no pedido"/);
  assert.equal(avisoDosBlocosTravados([]), '');
});

// ---------------------------------------------------------------------------
// Troca do administrador (25/11/2026): pacote 'administrador-1'.
// ---------------------------------------------------------------------------

test('administrador sem o marcador tem todas as permissoes do catalogo (menos as que restringem); funcionario nao', async () => {
  const nd = await import('../src/utils/permissoesNovasDomain');
  const { PERMISSION_CATALOG } = await import('../src/utils/permissionCatalog');
  const efetivas = new Set(nd.permissoesEfetivasDoUsuario([], 'funcionario', { papel: 'Admin' }));
  for (const { id } of PERMISSION_CATALOG) {
    if (nd.PERMISSOES_QUE_RESTRINGEM.includes(id)) assert.ok(!efetivas.has(id), `${id} restringe: nao vem`);
    else assert.ok(efetivas.has(id), `${id} para o administrador`);
  }
  assert.ok(efetivas.has(nd.MARCADOR_ADMINISTRADOR), 'leva o marcador: aplicar de novo nao muda nada');
  assert.deepEqual(
    [...nd.permissoesEfetivasDoUsuario([...efetivas], 'funcionario', { papel: 'Admin' })].sort(),
    [...efetivas].sort(),
  );
  // Master que nao e' o dono tambem e' administrador; funcionario e sem papel, nao.
  assert.ok(nd.permissoesEfetivasDoUsuario([], undefined, { papel: 'Master' }).includes('financeiro.pagar'));
  assert.ok(!nd.permissoesEfetivasDoUsuario([], undefined, { papel: 'Funcionario' }).includes('financeiro.pagar'));
  assert.ok(!nd.permissoesEfetivasDoUsuario([]).includes('financeiro.pagar'));
  // Nivel: ve as vendas de todos ate' o dono salvar; depois, o escolhido.
  assert.equal(nd.nivelAcessoEfetivo('funcionario', 'Admin', []), 'gerente');
  assert.equal(nd.nivelAcessoEfetivo('supervisor', 'Admin', [nd.MARCADOR_ADMINISTRADOR]), 'supervisor');
  assert.equal(nd.nivelAcessoEfetivo(undefined, 'Funcionario', []), 'funcionario');
  assert.equal(nd.nivelAcessoEfetivo('administracao', 'Funcionario', []), 'gerente');
});

test('administrador salvo pelo dono: vale so o marcado; o marcador so vai para administrador', async () => {
  const nd = await import('../src/utils/permissoesNovasDomain');
  const gravadas = nd.permissoesParaGravarDoUsuario(['vendas.pedidos'], 'Admin');
  assert.ok(gravadas.includes(nd.MARCADOR_ADMINISTRADOR));
  MARCADORES_DOS_PACOTES.forEach((m) => assert.ok(gravadas.includes(m), m));
  const efetivas = nd.permissoesEfetivasDoUsuario(gravadas, 'gerente', { papel: 'Admin' });
  assert.ok(efetivas.includes('vendas.pedidos'));
  assert.ok(!efetivas.includes('financeiro.pagar'), 'desmarcada pelo dono, fica sem');
  assert.ok(!efetivas.includes(PERMISSAO_ESTOQUE.produtoAvancado), 'o nivel gerente nao traz nada depois de salvo');
  assert.ok(!nd.permissoesParaGravarDoUsuario(['vendas.pedidos'], 'Funcionario').includes(nd.MARCADOR_ADMINISTRADOR));
  assert.ok(!nd.permissoesParaGravarDoUsuario(['vendas.pedidos']).includes(nd.MARCADOR_ADMINISTRADOR));
  assert.ok(nd.ehMarcadorInterno(nd.MARCADOR_ADMINISTRADOR), 'nao aparece na tela nem no historico');
  // Gerente/administrador so' da' o que tem: o administrador salvo sem Contas a Pagar nao da'.
  const semTer = nd.mexidasSemTer({ antes: [], depois: ['financeiro.pagar'], doGerente: gravadas, papelDoGerente: 'Admin' });
  assert.ok(semTer.includes('financeiro.pagar'));
  assert.deepEqual(nd.mexidasSemTer({ antes: [], depois: ['financeiro.pagar'], doGerente: [], papelDoGerente: 'Admin' }), [], 'sem o pacote: tem todas');
});

test('papel sozinho nao libera mais: hasTenantFullAccess so o dono e a plataforma; hasModuleAccess olha o pacote', async () => {
  const { hasTenantFullAccess, hasModuleAccess } = await import('../src/utils/roles');
  assert.equal(hasTenantFullAccess('Admin', false), false);
  assert.equal(hasTenantFullAccess('Master', false), false);
  assert.equal(hasTenantFullAccess('Master', true), true);
  assert.equal(hasTenantFullAccess('NexarAdmin', false), true);
  const pode = (permissions: string[]) => hasModuleAccess({ role: 'Admin', isOwner: false, permissions, requiredPermission: 'cadastros.bancos' });
  assert.equal(pode([]), true, 'administrador sem o pacote: todas');
  assert.equal(pode(['pacote.administrador-1']), false);
  assert.equal(pode(['pacote.administrador-1', 'cadastros.bancos']), true);
  assert.equal(hasModuleAccess({ role: 'Funcionario', isOwner: false, permissions: [], requiredPermission: 'cadastros.bancos' }), false);
});
