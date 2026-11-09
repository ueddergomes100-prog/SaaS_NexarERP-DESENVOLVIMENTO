import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dataHoraBrasil,
  diferencasEntre,
  documentoDaDescricao,
  ehAcaoCritica,
  filtrarRegistros,
  montarRegistroHistorico,
  nomeDeQuemFez,
  opcoesDosFiltros,
  origemDaRota,
  resumoDasAlteracoes,
  rotuloDaAcao,
  rotuloDoPapel,
  telaDaRota,
  textoQuemEQuando,
  valorParaHistorico,
  type RegistroLido,
} from '../src/utils/historicoAlteracoesDomain';
import { montarDocumentoHistorico } from '../src/utils/relatorioHistoricoDomain';
import {
  alteracoesDaRota,
  descricaoDaEntrega,
  descricaoDaMontagem,
  pedidosQueMudaramNaRota,
  rotuloDoRomaneioNoHistorico,
} from '../src/utils/romaneioDomain';

const semUndefinedEmLugarNenhum = (valor: unknown, caminho = 'registro'): void => {
  assert.notEqual(valor, undefined, `${caminho} ficou undefined (o Firestore recusa)`);
  if (valor && typeof valor === 'object') {
    Object.entries(valor as Record<string, unknown>).forEach(([k, v]) => semUndefinedEmLugarNenhum(v, `${caminho}.${k}`));
  }
};

test('tela e origem saem do caminho da tela', () => {
  assert.equal(telaDaRota('/operacoes/romaneios/abc123'), 'Romaneio de Entrega');
  assert.equal(telaDaRota('/pedidos-venda/xyz'), 'Pedidos de Venda');
  assert.equal(telaDaRota('/estoque/balanco/contar'), 'Balanço');
  assert.equal(telaDaRota('/estoque'), 'Produtos (Estoque)');
  assert.equal(telaDaRota('/estoquex'), null, 'prefixo so casa na barra');
  assert.equal(telaDaRota('/vendedor/entregas/r1/p1'), 'Entregas (app do motorista)');
  assert.equal(telaDaRota('/financeiro/caixa-registros'), 'Caixa (Sessões PDV)');
  assert.equal(telaDaRota('/financeiro/caixa'), 'Fluxo de Caixa');
  assert.equal(telaDaRota(''), null);

  assert.equal(origemDaRota('/operacoes/romaneios/abc'), 'sistema');
  assert.equal(origemDaRota('/vendedor/pedido/novo'), 'app_vendas');
  assert.equal(origemDaRota('/vendedor/entregas/r1'), 'app_motorista');
  assert.equal(origemDaRota('/vendedor/os/1/atender'), 'app_tecnico');
  assert.equal(origemDaRota('/caixa'), 'frente_caixa');
  assert.equal(origemDaRota(''), 'servidor');
  assert.equal(origemDaRota(undefined), 'servidor');
});

test('papel em portugues', () => {
  assert.equal(rotuloDoPapel('Master'), 'Dono');
  assert.equal(rotuloDoPapel('Admin', 'funcionario', true), 'Dono');
  assert.equal(rotuloDoPapel('Admin'), 'Administrador');
  assert.equal(rotuloDoPapel('Funcionario', 'gerente'), 'Gerente');
  assert.equal(rotuloDoPapel('Funcionario', 'administracao'), 'Gerente');
  assert.equal(rotuloDoPapel('Funcionario'), 'Funcionário');
  assert.equal(rotuloDoPapel('SuperAdmin'), 'Suporte Hennder');
  assert.equal(rotuloDoPapel(null), null);
});

test('registro montado nunca leva undefined e guarda quem, onde e o documento', () => {
  const r = montarRegistroHistorico({
    modulo: 'romaneios',
    acao: 'cancelamento',
    descricao: '  Rota 02 cancelada.  ',
    registroId: 'R1',
    documentosRelacionados: ['p1', undefined, null, 'R1', 'p2'],
    documentoTipo: 'romaneio',
    documentoNumero: 'Rota 02 (saída 04/11/2026)',
    motivo: 'engano',
    alteracoes: [{ campo: 'Situação', valorAnterior: 'Em rota', valorNovo: undefined }],
    rota: '/operacoes/romaneios/R1',
  }, {
    usuarioId: 'u1',
    usuarioEmail: '123-maria@nexar.app',
    usuarioNome: 'MARIA',
    papel: 'Funcionario',
    filialId: 'f1',
  });
  semUndefinedEmLugarNenhum(r);
  assert.equal(r.usuarioNome, 'MARIA');
  assert.equal(r.usuarioPapel, 'Funcionário');
  assert.equal(r.descricao, 'Rota 02 cancelada.');
  assert.equal(r.tela, 'Romaneio de Entrega');
  assert.equal(r.origem, 'sistema');
  assert.deepEqual(r.documentosRelacionados, ['R1', 'p1', 'p2']);
  assert.equal(r.critical, true, 'cancelamento e critico');
  assert.equal(r.alteracoes?.[0].valorNovo, null);
  assert.equal(r.empresaId, null);
  assert.equal(r.snapshotExcluido, null);
});

test('registro do servidor sem tela vira "Automatico (servidor)" e status invalido vira sucesso', () => {
  const r = montarRegistroHistorico({ modulo: 'x', acao: '', descricao: '', status: 'qualquer' as never }, { usuarioId: '' });
  assert.equal(r.origem, 'servidor');
  assert.equal(r.usuarioId, 'desconhecido');
  assert.equal(r.acao, 'edicao');
  assert.equal(r.status, 'sucesso');
  assert.equal(r.alteracoes, null);
});

test('diferencasEntre compara so o que mudou, com o nome do usuario', () => {
  const m = diferencasEntre(
    { nome: 'ARROZ', preco: 1000, ativo: true, updatedAt: 1 },
    { nome: 'ARROZ', preco: 1200, ativo: true, updatedAt: 2 },
    [{ campo: 'nome', rotulo: 'Nome' }, { campo: 'preco', rotulo: 'Preço' }, 'ativo'],
  );
  assert.deepEqual(m, [{ campo: 'Preço', valorAnterior: 1000, valorNovo: 1200 }]);
  // Sem lista: todos os campos, menos os de controle.
  const todos = diferencasEntre({ a: 1, alteradoEm: 'x' }, { a: 2, alteradoEm: 'y', b: 'novo' });
  assert.deepEqual(todos.map((c) => c.campo), ['a', 'b']);
  // Vazio, null e undefined sao a mesma coisa (nada mudou).
  assert.deepEqual(diferencasEntre({ obs: '' }, { obs: undefined }, ['obs']), []);
});

test('valorParaHistorico: data em ISO, objeto em JSON curto, nada undefined', () => {
  assert.equal(valorParaHistorico(undefined), null);
  assert.equal(valorParaHistorico({ seconds: 0 }), '1970-01-01T00:00:00.000Z');
  assert.equal(valorParaHistorico(Number.NaN), null);
  assert.equal(valorParaHistorico({ a: 1 }), '{"a":1}');
  assert.ok(String(valorParaHistorico('x'.repeat(900))).endsWith('…'));
});

test('aviso "Cancelado por X em dd/mm/aaaa hh:mm" no horario de Brasilia', () => {
  assert.equal(dataHoraBrasil('2026-11-09T17:32:00.000Z'), '09/11/2026 14:32');
  assert.equal(textoQuemEQuando('Cancelado', 'MARIA', '2026-11-09T17:32:00.000Z'), 'Cancelado por MARIA em 09/11/2026 14:32');
  assert.equal(textoQuemEQuando('Cancelado', '', { seconds: Date.UTC(2026, 10, 9, 17, 32) / 1000 }), 'Cancelado em 09/11/2026 14:32');
  assert.equal(textoQuemEQuando('Cancelado', '', null), '');
});

test('acoes: rotulo, destaque e quem fez', () => {
  assert.equal(rotuloDaAcao('cancelamento'), 'Cancelou');
  assert.equal(rotuloDaAcao('pedido_na_rota'), 'Colocou na rota');
  assert.equal(rotuloDaAcao('algo_novo'), 'Algo novo');
  assert.equal(ehAcaoCritica('cancelamento'), true);
  assert.equal(ehAcaoCritica('estorno_baixa'), true);
  assert.equal(ehAcaoCritica('criacao'), false);
  assert.equal(nomeDeQuemFez({ usuarioNome: '', usuario: 'a@b.c' }), 'a@b.c');
});

const lidos: RegistroLido[] = [
  { id: '1', dataHora: '2026-11-04T10:00:00Z', usuarioNome: 'MARIA', usuario: 'm@x', acao: 'cancelamento', descricao: 'Rota 02 cancelada.', documentoNumero: 'Rota 02 (saída 04/11/2026)', tela: 'Romaneio de Entrega' },
  { id: '2', dataHora: '2026-11-04T09:00:00Z', usuarioNome: 'JOÃO', usuario: 'j@x', acao: 'criacao', descricao: 'Venda #375 finalizada', documentoNumero: 'Pedido 0375', modulo: 'vendas' },
  { id: '3', dataHora: '2026-11-03T09:00:00Z', usuario: 'ana@x', acao: 'edicao', descricao: 'Produto alterado', tela: 'Produtos (Estoque)' },
];

test('filtros da tela geral: usuario sem acento, tela, documento por numero, acao', () => {
  assert.deepEqual(filtrarRegistros(lidos, { usuario: 'joao' }).map((r) => r.id), ['2']);
  assert.deepEqual(filtrarRegistros(lidos, { tela: 'Romaneio de Entrega' }).map((r) => r.id), ['1']);
  assert.deepEqual(filtrarRegistros(lidos, { tela: 'Vendas' }).map((r) => r.id), ['2'], 'registro antigo usa o modulo');
  assert.deepEqual(filtrarRegistros(lidos, { documento: 'rota 02' }).map((r) => r.id), ['1']);
  assert.deepEqual(filtrarRegistros(lidos, { documento: '0375' }).map((r) => r.id), ['2']);
  assert.deepEqual(filtrarRegistros(lidos, { documento: '375' }).map((r) => r.id), ['2']);
  assert.deepEqual(filtrarRegistros(lidos, { acao: 'edicao' }).map((r) => r.id), ['3']);
  const opcoes = opcoesDosFiltros(lidos);
  assert.deepEqual(opcoes.telas, ['Produtos (Estoque)', 'Romaneio de Entrega', 'Vendas']);
  assert.deepEqual(opcoes.acoes.map((a) => a.rotulo), ['Alterou', 'Cancelou', 'Criou']);
});

test('resumo das alteracoes em uma linha', () => {
  assert.equal(
    resumoDasAlteracoes([{ campo: 'Situação', valorAnterior: 'Em rota', valorNovo: 'Cancelado' }, { campo: 'Ativo', valorAnterior: true, valorNovo: null }]),
    'Situação: Em rota → Cancelado; Ativo: Sim → (vazio)',
  );
  assert.equal(resumoDasAlteracoes(null), '');
});

test('relatorio do historico: indicadores e uma secao com os registros', () => {
  const doc = montarDocumentoHistorico(lidos, { titulo: 'Histórico de alterações — Rota 02', filtros: ['Usuário: maria'] });
  assert.equal(doc.titulo, 'Histórico de alterações — Rota 02');
  assert.equal(doc.indicadores[0].valor, '3');
  assert.equal(doc.indicadores[2].valor, '1');
  assert.equal(doc.secoes[0].linhas.length, 3);
  const colunaQuem = doc.secoes[0].colunas.find((c) => c.id === 'usuario');
  assert.equal(colunaQuem?.valor(lidos[2]), 'ana@x');
});

test('romaneio no historico: rotulo com a data, pedidos que entraram e sairam, o que mudou', () => {
  assert.equal(rotuloDoRomaneioNoHistorico(2, '', '2026-11-04'), 'Rota 02 (saída 04/11/2026)');
  assert.equal(rotuloDoRomaneioNoHistorico(4, 'daniela', ''), 'Rota 04 DANIELA');
  const mud = pedidosQueMudaramNaRota(
    [{ pedidoId: 'a', numeroPedido: '0375' }, { pedidoId: 'b', numeroPedido: '0374' }],
    [{ pedidoId: 'b', numeroPedido: '0374' }, { pedidoId: 'c', numeroPedido: '0369' }],
  );
  assert.deepEqual(mud, { entraram: ['#0369'], sairam: ['#0375'] });
  assert.equal(descricaoDaMontagem('Rota 02', false, mud, 2), 'Rota 02 alterada: entraram #0369; saíram #0375. 2 pedido(s) na rota.');
  assert.equal(descricaoDaMontagem('Rota 02', true, { entraram: ['#1'], sairam: [] }, 1), 'Rota 02 criada com 1 pedido(s): #1.');
  const alt = alteracoesDaRota(
    { nome: 'x', motoristaNome: 'DIRCEU', veiculoDescricao: 'SPLINTER', veiculoPlaca: 'LTY', dataSaida: '2026-11-04', kmSaida: 1, acerto: [] },
    { nome: 'x', motoristaNome: 'PEDRO', veiculoDescricao: 'SPLINTER', veiculoPlaca: 'LTY', dataSaida: '2026-11-05', kmSaida: 1, acerto: [{ tipo: 'Combustível', natureza: 'despesa', descricao: '', valorCentavos: 5000 }] },
  );
  assert.deepEqual(alt.map((a) => a.campo), ['Motorista', 'Data de saída', 'Acerto']);
  assert.equal(alt[1].valorNovo, '05/11/2026');
  assert.ok(String(alt[2].valorNovo).includes('Combustível'));
  assert.equal(
    descricaoDaEntrega({ numeroPedido: '0375', clienteNome: 'MERCEARIA' }, { status: 'nao_entregue', motivo: 'Fechado' }),
    'Pedido #0375 (MERCEARIA): Não entregue, motivo: Fechado.',
  );
});

test('numero do documento tirado da frase, para registros que nao informam', () => {
  assert.equal(documentoDaDescricao('Venda Direta #375 CANCELADA e estoque estornado.'), 'Venda Direta #375');
  assert.equal(documentoDaDescricao('Pré-venda #0375 cancelada.'), 'Pré-venda #0375');
  assert.equal(documentoDaDescricao('OS #12 cancelada'), 'OS #12');
  assert.equal(documentoDaDescricao('Orçamento #0012 recusado.'), 'Orçamento #0012');
  assert.equal(documentoDaDescricao('Rota 02 DANIELA cancelada.'), 'Rota #02');
  assert.equal(documentoDaDescricao('Caixa BALCAO criado.'), null);
  assert.equal(documentoDaDescricao('POSTO 4 abastecido'), null, 'OS dentro de outra palavra nao conta');
  const r = montarRegistroHistorico({ modulo: 'vendas', acao: 'criacao', descricao: 'Venda #0375 finalizada' }, { usuarioId: 'u' });
  assert.equal(r.documentoNumero, 'Venda #0375');
});
