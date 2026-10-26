import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alteracoesDesdeOFechamento,
  aplicarRegistros,
  caminhosDoRegistro,
  cancelamentoDesfazEntregas,
  contagemDoPlano,
  despesasDoAcerto,
  despesasJaLancadas,
  erroDoMotivo,
  erroParaReabrir,
  fotoDoFechamento,
  planoDeDespesas,
  planoDeReabertura,
  romaneioDoDocumento,
  textoDoPlano,
  travaLivreOuDestaRota,
  centavosDoTexto,
  diferencaDoRecebido,
  entregasDaBusca,
  formaRecebidaPadrao,
  erroDoPedidoParaRomaneio,
  erroDoRegistroDeEntrega,
  linkDoMapa,
  precisaJustificarValor,
  registroParaGravar,
  separarEntregas,
  textoDaDiferenca,
  textoDosCentavos,
  erroParaCancelar,
  erroParaFechar,
  erroParaLiberar,
  linhasDoAcerto,
  montarDocumentoRelatorioRomaneios,
  montarDocumentoRomaneio,
  montarEntregaDoPedido,
  moverEntrega,
  parseMotivosNaoEntrega,
  parseTiposAcerto,
  resumoDoRomaneio,
  situacaoDoPedidoAoEncerrar,
  tituloDoRomaneio,
  TIPOS_ACERTO_PADRAO,
  type EntregaRomaneio,
  type Romaneio,
} from '../src/utils/romaneioDomain';

const entrega = (numero: string, mudanca: Partial<EntregaRomaneio> = {}): EntregaRomaneio => ({
  ...montarEntregaDoPedido(
    { id: `p${numero}`, numeroPedido: numero, status: 'Finalizada', clienteNome: `cliente ${numero}`, valorTotal: 100 },
    { codigo: '10', cidade: 'Manhuaçu', estado: 'MG', endereco: 'Rua A', numero: '5', bairro: 'Centro' },
    null,
  ),
  ...mudanca,
});

const romaneio = (mudanca: Partial<Romaneio> = {}): Romaneio => ({
  numero: 4,
  nome: 'Daniela',
  status: 'montagem',
  dataSaida: '2026-10-01',
  horarioSaida: '07:00',
  motoristaId: 'm1',
  motoristaNome: 'DIRCEU',
  veiculoId: 'v1',
  veiculoDescricao: 'VW DELIVERY — SPT-R001',
  veiculoPlaca: 'SPTR001',
  kmSaida: null,
  kmChegada: null,
  horarioChegada: '',
  observacao: '',
  entregas: [entrega('75543'), entrega('75565')],
  acerto: [],
  observacaoAcerto: '',
  ...mudanca,
});

test('título da rota: número com 2 dígitos e nome em maiúscula, como a loja escreve', () => {
  assert.equal(tituloDoRomaneio(4, 'Daniela'), 'Rota 04 DANIELA');
  assert.equal(tituloDoRomaneio(12, ''), 'Rota 12');
  assert.equal(tituloDoRomaneio(0, 'x'), 'Rota -- X');
});

test('só pedido faturado entra na rota; pré-venda e cancelado dizem o porquê', () => {
  assert.equal(erroDoPedidoParaRomaneio({ id: 'a', numeroPedido: '1', status: 'Finalizada' }), null);
  assert.match(erroDoPedidoParaRomaneio({ id: 'a', numeroPedido: '2', status: 'Pré-venda' }) || '', /ainda não foi faturado/);
  assert.match(erroDoPedidoParaRomaneio({ id: 'a', numeroPedido: '3', status: 'Cancelada' }) || '', /cancelado/);
});

test('entrega montada do pedido: endereço, cidade, nota e nenhum campo undefined', () => {
  const e = montarEntregaDoPedido(
    { id: 'p1', numeroPedido: '75543', status: 'Finalizada', clienteNome: 'elizabete', valorTotal: 410.6, valorTotalDescontos: 0 },
    { codigo: '4023', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Manhuaçu', estado: 'MG', celular: '33999990000' },
    { numero: 16756, tipo: 'NF-e' },
  );
  assert.equal(e.notaNumero, '16756');
  assert.equal(e.clienteNome, 'ELIZABETE');
  assert.equal(e.endereco, 'RUA DAS FLORES, 10 - CENTRO');
  assert.equal(e.cidade, 'MANHUAÇU/MG');
  assert.equal(e.valorTotalCentavos, 41060);
  assert.equal(e.status, 'pendente');
  assert.ok(Object.values(e).every((v) => v !== undefined));
  const semNota = montarEntregaDoPedido({ id: 'p2' }, null, null);
  assert.equal(semNota.notaNumero, '');
  assert.ok(Object.values(semNota).every((v) => v !== undefined));
});

test('mover entrega troca a posição e não sai do limite', () => {
  const lista = [entrega('1'), entrega('2'), entrega('3')];
  assert.deepEqual(moverEntrega(lista, 2, -1).map((e) => e.numeroPedido), ['1', '3', '2']);
  assert.equal(moverEntrega(lista, 0, -1), lista);
});

test('liberar exige motorista, data e pelo menos um pedido', () => {
  assert.equal(erroParaLiberar(romaneio()), null);
  assert.match(erroParaLiberar(romaneio({ motoristaId: '' })) || '', /motorista/);
  assert.match(erroParaLiberar(romaneio({ entregas: [] })) || '', /pelo menos um pedido/);
  assert.match(erroParaLiberar(romaneio({ status: 'em_rota' })) || '', /em montagem/);
});

test('registro da entrega: entregue pede quem recebeu; não entregue pede motivo; recebido pede a forma', () => {
  assert.equal(erroDoRegistroDeEntrega({ status: 'entregue', recebedorNome: 'Maria' }), null);
  assert.match(erroDoRegistroDeEntrega({ status: 'entregue', recebedorNome: ' ' }) || '', /quem recebeu/);
  assert.match(erroDoRegistroDeEntrega({ status: 'nao_entregue' }) || '', /motivo/);
  assert.match(erroDoRegistroDeEntrega({ status: 'entregue', recebedorNome: 'M', recebidoCentavos: 500 }) || '', /como o motorista recebeu/);
});

test('fechar exige desfecho de toda entrega e KM de chegada coerente', () => {
  const emRota = romaneio({ status: 'em_rota' });
  assert.match(erroParaFechar(emRota) || '', /2 entrega/);
  const resolvido = romaneio({
    status: 'em_rota',
    entregas: [entrega('1', { status: 'entregue', recebedorNome: 'A' }), entrega('2', { status: 'nao_entregue', motivo: 'CLIENTE RECUSOU' })],
  });
  assert.equal(erroParaFechar(resolvido), null);
  assert.match(erroParaFechar({ ...resolvido, kmSaida: 1000, kmChegada: 900 }) || '', /KM de chegada/);
});

test('cancelar só antes de qualquer entrega registrada', () => {
  assert.equal(erroParaCancelar(romaneio()), null);
  assert.match(erroParaCancelar(romaneio({ entregas: [entrega('1', { status: 'entregue', recebedorNome: 'A' })] })) || '', /não pode mais ser cancelada/);
});

test('com a permissão própria, cancela rota fechada ou com entrega (desfaz tudo); cancelada não cancela de novo', () => {
  const comEntrega = romaneio({ status: 'em_rota', entregas: [entrega('1', { status: 'entregue', recebedorNome: 'A' })] });
  const fechado = romaneio({ status: 'fechado' });
  assert.equal(cancelamentoDesfazEntregas(romaneio()), false);
  assert.equal(cancelamentoDesfazEntregas(comEntrega), true);
  assert.equal(cancelamentoDesfazEntregas(fechado), true);
  assert.match(erroParaCancelar(fechado) || '', /já foi fechado.*permissão "Romaneio de Entrega: reabrir e cancelar depois de fechado"/);
  assert.equal(erroParaCancelar(fechado, { podeDesfazer: true }), null);
  assert.equal(erroParaCancelar(comEntrega, { podeDesfazer: true }), null);
  assert.match(erroParaCancelar(romaneio({ status: 'cancelado' }), { podeDesfazer: true }) || '', /já foi cancelado/);
});

test('reabrir só rota fechada; motivo obrigatório com pelo menos 10 letras', () => {
  assert.equal(erroParaReabrir({ status: 'fechado' }), null);
  assert.match(erroParaReabrir({ status: 'cancelado' }) || '', /não volta/);
  assert.match(erroParaReabrir({ status: 'em_rota' }) || '', /acerto fechado/);
  assert.match(erroDoMotivo('  esqueci ') || '', /pelo menos 10/);
  assert.equal(erroDoMotivo('Esqueci as despesas do motorista'), null);
});

test('reabrir: pedido não entregue que já entrou em outra rota fica de fora; livre ou desta rota continua', () => {
  const entregas = [entrega('1', { status: 'entregue' }), entrega('2', { status: 'nao_entregue' }), entrega('3', { status: 'nao_entregue' }), entrega('4')];
  const plano = planoDeReabertura('R1', entregas, {
    p1: { romaneioId: 'R1', situacao: 'entregue' },
    p2: { romaneioId: 'R9', romaneioTitulo: 'Rota 09 CENTRO', situacao: 'em_romaneio' },
    p3: { romaneioId: 'R9', situacao: 'liberado' },
  });
  assert.deepEqual(plano.ficam.map((e) => e.numeroPedido), ['1', '3', '4']);
  assert.deepEqual(plano.saem.map((s) => [s.entrega.numeroPedido, s.outraRota]), [['2', 'Rota 09 CENTRO']]);
  assert.equal(travaLivreOuDestaRota('R1', null), true);
  assert.equal(travaLivreOuDestaRota('R1', { romaneioId: 'R2', situacao: 'entregue' }), false);
});

test('despesas: o financeiro acompanha o acerto (corrige, lança o que faltou, cancela o que saiu)', () => {
  const acerto = [
    { tipo: 'Combustível', natureza: 'despesa' as const, descricao: 'posto', valorCentavos: 25000 },
    { tipo: 'Hotel', natureza: 'despesa' as const, descricao: '', valorCentavos: 12000 },
    { tipo: 'Vale', natureza: 'adiantamento' as const, descricao: '', valorCentavos: 50000 },
    { tipo: 'Pedágio', natureza: 'despesa' as const, descricao: '', valorCentavos: 0 },
  ];
  const desejadas = despesasDoAcerto(acerto);
  assert.deepEqual(desejadas.map((d) => [d.tipo, d.valor]), [['Combustível', 250], ['Hotel', 120]]);

  const rota = {
    despesas: [
      { tipo: 'COMBUSTIVEL', descricao: 'posto', valor: 200, comprovante: '' },
      { tipo: 'Diária', descricao: '', valor: 80, comprovante: '' },
      { tipo: 'Hotel', descricao: '', valor: 120, comprovante: '' },
    ],
    transacaoIds: ['t1', 't2', 't3'],
  };
  // t3 (hotel) foi cancelado no Financeiro: o acerto lanca de novo.
  const lancadas = despesasJaLancadas(rota, (id) => id !== 't3');
  assert.deepEqual(lancadas.map((l) => [l.transacaoId, l.ativa]), [['t1', true], ['t2', true], ['t3', false]]);
  const plano = planoDeDespesas(desejadas, lancadas);
  assert.deepEqual(plano.linhas.map((l) => [l.despesa.tipo, l.transacaoId, l.alterada]), [['Combustível', 't1', true], ['Hotel', '', false]]);
  assert.deepEqual(plano.cancelar, ['t2']);
  assert.deepEqual(contagemDoPlano(plano), { novas: 1, alteradas: 1, canceladas: 1 });
  assert.equal(textoDoPlano(contagemDoPlano(plano)), '1 despesa(s) lançada(s), 1 corrigida(s), 1 cancelada(s)');
  assert.equal(textoDoPlano({ novas: 0, alteradas: 0, canceladas: 0 }), '');

  // Nada mudou: mantem os mesmos lancamentos, sem alteracao.
  const igual = planoDeDespesas(desejadas, despesasJaLancadas({ despesas: desejadas, transacaoIds: ['a', 'b'] }, () => true));
  assert.deepEqual(igual.linhas.map((l) => [l.transacaoId, l.alterada]), [['a', false], ['b', false]]);
  assert.deepEqual(igual.cancelar, []);
  // Sem despesa no acerto: cancela tudo o que estava ativo.
  assert.deepEqual(planoDeDespesas([], lancadas).cancelar, ['t1', 't2']);
  // Rota antiga sem a lista: nada lancado.
  assert.deepEqual(despesasJaLancadas(null, () => true), []);
});

test('log do novo fechamento: diz o que mudou desde o fechamento anterior, em português', () => {
  const antes = romaneio({
    status: 'fechado', kmSaida: 1000, kmChegada: 1200,
    acerto: [{ tipo: 'Combustível', natureza: 'despesa', descricao: '', valorCentavos: 20000 }],
    entregas: [entrega('1', { status: 'entregue' }), entrega('2', { status: 'nao_entregue' })],
  });
  const foto = fotoDoFechamento(antes);
  const depois = romaneio({
    ...antes,
    kmChegada: 1250,
    acerto: [
      { tipo: 'Combustível', natureza: 'despesa', descricao: '', valorCentavos: 20000 },
      { tipo: 'Hotel', natureza: 'despesa', descricao: 'pousada', valorCentavos: 12000 },
    ],
    entregas: [entrega('1', { status: 'entregue' })],
  });
  const mudou = alteracoesDesdeOFechamento(foto, depois).map((a) => `${a.campo}: ${a.valorAnterior} -> ${a.valorNovo}`);
  assert.deepEqual(mudou.map((m) => m.replace(/\u00a0/g, ' ')), [
    'KM de chegada: 1.200 -> 1.250',
    'Acerto: Hotel: — -> R$ 120,00 (pousada)',
    'Pedido #2: Não entregue -> Fora da rota',
  ]);
  assert.deepEqual(alteracoesDesdeOFechamento(foto, antes), []);
});

test('documento lido: rota de despesas e histórico, sem lixo', () => {
  const lido = romaneioDoDocumento({
    status: 'fechado',
    despesasRotaId: 'rota1',
    historico: [{ acao: 'reaberto', motivo: ' esqueci  as despesas ', usuarioNome: 'Ana', emIso: '2026-10-15T10:00:00.000Z' }, { acao: 'xx' }, null],
  });
  assert.equal(lido.despesasRotaId, 'rota1');
  assert.deepEqual(lido.historico, [{ acao: 'reaberto', motivo: 'esqueci as despesas', usuarioNome: 'Ana', emIso: '2026-10-15T10:00:00.000Z' }]);
  assert.equal(romaneioDoDocumento({}).despesasRotaId, '');
});

test('ao encerrar: entregue fica preso à rota, o resto volta a ficar livre', () => {
  assert.equal(situacaoDoPedidoAoEncerrar({ status: 'entregue' }, false), 'entregue');
  assert.equal(situacaoDoPedidoAoEncerrar({ status: 'nao_entregue' }, false), 'liberado');
  assert.equal(situacaoDoPedidoAoEncerrar({ status: 'entregue' }, true), 'liberado');
});

test('resumo: KM rodados, valores e saldo a prestar = recebido + vale − despesas', () => {
  const r = resumoDoRomaneio(romaneio({
    kmSaida: 1000,
    kmChegada: 1350,
    entregas: [
      entrega('1', { status: 'entregue', recebidoCentavos: 20000, recebidoForma: 'Dinheiro' }),
      entrega('2', { status: 'nao_entregue', motivo: 'X' }),
    ],
    acerto: [
      { tipo: 'VALE/ADIANTAMENTO', natureza: 'adiantamento', descricao: '', valorCentavos: 30000 },
      { tipo: 'COMBUSTÍVEL', natureza: 'despesa', descricao: '', valorCentavos: 15000 },
      { tipo: 'DEVOLUÇÃO', natureza: 'informativo', descricao: '', valorCentavos: 10000 },
    ],
  }));
  assert.equal(r.kmRodados, 350);
  assert.equal(r.entregues, 1);
  assert.equal(r.valorNaoEntregueCentavos, 10000);
  assert.equal(r.saldoAPrestarCentavos, 20000 + 30000 - 15000);
  assert.deepEqual(r.recebidoPorForma, [{ forma: 'Dinheiro', centavos: 20000 }]);
});

test('configuração: motivos e tipos de acerto lidos sem lixo; vazio volta ao padrão', () => {
  assert.deepEqual(parseMotivosNaoEntrega([' fechado ', 'FECHADO', '', 3]), ['FECHADO', '3']);
  assert.ok(parseMotivosNaoEntrega(null).length > 3);
  assert.deepEqual(parseTiposAcerto([{ nome: 'lavagem', natureza: 'despesa' }, { nome: 'x', natureza: 'errada' }]), [{ nome: 'LAVAGEM', natureza: 'despesa' }]);
  assert.equal(parseTiposAcerto(undefined).length, TIPOS_ACERTO_PADRAO.length);
});

test('linhas do acerto: uma por tipo, com o valor gravado; tipo antigo com valor não some', () => {
  const linhas = linhasDoAcerto(
    [{ nome: 'COMBUSTÍVEL', natureza: 'despesa' }],
    [{ tipo: 'COMBUSTIVEL', natureza: 'despesa', descricao: '', valorCentavos: 100 }, { tipo: 'LAVAGEM', natureza: 'despesa', descricao: '', valorCentavos: 50 }],
  );
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].valorCentavos, 100);
  assert.equal(linhas[1].tipo, 'LAVAGEM');
});

test('PDF do romaneio: rota a sair leva o quadro do acerto em branco; o relatório soma o período', () => {
  const doc = montarDocumentoRomaneio(romaneio());
  assert.match(doc.titulo, /^Rota 04 DANIELA — 01\/10\/2026/);
  assert.equal(doc.secoes[0].linhas.length, 2);
  assert.ok(doc.secoes[1].linhas.some((l: { item: string }) => l.item === 'COMBUSTÍVEL'));
  const rel = montarDocumentoRelatorioRomaneios(
    [{ ...romaneio({ status: 'fechado', entregas: [entrega('1', { status: 'nao_entregue', motivo: 'CLIENTE RECUSOU' })] }), id: 'r1' }],
    { de: '2026-10-01', ate: '2026-10-01' },
  );
  assert.equal(rel.secoes[0].linhas.length, 1);
  assert.equal(rel.secoes[1].linhas[0].motivo, 'CLIENTE RECUSOU');
});

// ---------------------------------------------------------------------------
// App do motorista (2026-10-08)
// ---------------------------------------------------------------------------

test('valor recebido diferente do pedido exige justificativa; zero e igual nao', () => {
  const base = { status: 'entregue' as const, recebedorNome: 'MARIA', recebidoForma: 'Dinheiro', valorTotalCentavos: 10000 };
  assert.equal(erroDoRegistroDeEntrega({ ...base, recebidoCentavos: 10000 }), null);
  assert.equal(erroDoRegistroDeEntrega({ ...base, recebidoCentavos: 0 }), null);
  assert.match(erroDoRegistroDeEntrega({ ...base, recebidoCentavos: 8000 }) || '', /menor que o valor do pedido .*administrativo/);
  assert.match(erroDoRegistroDeEntrega({ ...base, recebidoCentavos: 12000, justificativaValor: 'ok' }) || '', /maior que o valor do pedido/);
  assert.equal(erroDoRegistroDeEntrega({ ...base, recebidoCentavos: 12000, justificativaValor: 'abate a nota 55' }), null);
  // nao entregue com valor parcial tambem explica
  assert.match(erroDoRegistroDeEntrega({ status: 'nao_entregue', motivo: 'X', recebidoForma: 'Pix', recebidoCentavos: 500, valorTotalCentavos: 10000 }) || '', /menor/);
  assert.equal(diferencaDoRecebido({ recebidoCentavos: 12000, valorTotalCentavos: 10000 }), 2000);
  assert.equal(diferencaDoRecebido({ recebidoCentavos: 0, valorTotalCentavos: 10000 }), 0);
  assert.equal(precisaJustificarValor({ status: 'pendente', recebidoCentavos: 5, valorTotalCentavos: 10 }), false);
  assert.equal(textoDaDiferenca(2000), '+R$\u00a020,00');
  assert.equal(textoDaDiferenca(-150), '−R$\u00a01,50');
  assert.equal(textoDaDiferenca(0), '');
});

test('registro do app: completo, sem undefined, campo a campo em registros.{pedidoId}', () => {
  const e = entrega('7', { canhotoUrl: 'http://x/c.jpg', canhotoCaminho: 'empresas/t/romaneios/r/p7-1.jpg' });
  const gravado = registroParaGravar(e, {
    status: 'entregue', recebedorNome: ' joão ', recebedorDocumento: ' 123 ', motivo: 'ignorado', recebidoCentavos: 10000.4, recebidoForma: 'Pix', observacao: ' obs ', justificativaValor: '',
  }, { nome: 'Pedro', via: 'app', agoraIso: '2026-10-08T12:00:00.000Z' });
  assert.deepEqual(gravado, {
    status: 'entregue', recebedorNome: 'JOÃO', recebedorDocumento: '123', motivo: '', recebidoCentavos: 10000, recebidoForma: 'Pix',
    observacao: 'obs', justificativaValor: '', registradoEm: '2026-10-08T12:00:00.000Z', registradoPor: 'Pedro', registradoVia: 'app',
    canhotoUrl: 'http://x/c.jpg', canhotoCaminho: 'empresas/t/romaneios/r/p7-1.jpg',
  });
  assert.ok(Object.values(gravado).every((v) => v !== undefined));
  const caminhos = caminhosDoRegistro('p7', gravado);
  assert.equal(caminhos['registros.p7.status'], 'entregue');
  assert.equal(caminhos['registros.p7.canhotoUrl'], 'http://x/c.jpg');
  assert.equal(Object.keys(caminhos).length, 13);
  // voltar a pendente limpa tudo e nao carimba quem/quando; o canhoto fica
  const pendente = registroParaGravar(e, { ...gravado, status: 'pendente', recebidoCentavos: 500, justificativaValor: 'x' }, { nome: 'Pedro', via: 'sistema', agoraIso: 'agora' });
  assert.equal(pendente.recebidoCentavos, 0);
  assert.equal(pendente.registradoEm, '');
  assert.equal(pendente.justificativaValor, '');
  assert.equal(pendente.canhotoUrl, 'http://x/c.jpg');
});

test('mapa registros vale sobre a lista; pedido sem registro fica como esta', () => {
  const lista = [entrega('1'), entrega('2', { status: 'nao_entregue', motivo: 'FECHADO' })];
  const mescladas = aplicarRegistros(lista, { p1: { status: 'entregue', recebedorNome: 'ANA', recebidoCentavos: 10000, registradoVia: 'app', canhotoUrl: null } });
  assert.equal(mescladas[0].status, 'entregue');
  assert.equal(mescladas[0].recebedorNome, 'ANA');
  assert.equal(mescladas[0].registradoVia, 'app');
  assert.equal(mescladas[0].canhotoUrl, '');
  assert.equal(mescladas[0].clienteNome, 'CLIENTE 1');
  assert.equal(mescladas[1].status, 'nao_entregue');
  assert.deepEqual(aplicarRegistros(lista, undefined), lista);
  assert.deepEqual(aplicarRegistros(lista, { p9: { status: 'entregue' } }), lista);
  const { faltam, feitas } = separarEntregas(mescladas);
  assert.deepEqual(faltam.map((e) => e.numeroPedido), []);
  assert.deepEqual(feitas.map((e) => e.numeroPedido), ['1', '2']);
});

test('link do mapa e texto de dinheiro', () => {
  assert.equal(linkDoMapa({ endereco: 'Rua A, 5 - Centro', cidade: 'MANHUAÇU/MG' }), 'https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%205%20-%20Centro%2C%20MANHUA%C3%87U%2FMG');
  assert.equal(linkDoMapa({ endereco: '', cidade: '' }), '');
  assert.equal(centavosDoTexto('1.234,56'), 123456);
  assert.equal(centavosDoTexto('80'), 8000);
  assert.equal(centavosDoTexto(''), 0);
  assert.equal(textoDosCentavos(123456), '1234,56');
  assert.equal(textoDosCentavos(0), '');
});

test('registro da entrega: "Como" vem com a forma do pedido (25/10/2026)', () => {
  assert.equal(formaRecebidaPadrao('Boleto'), 'Boleto');
  assert.equal(formaRecebidaPadrao('BOLETO BANCÁRIO'), 'Boleto');
  assert.equal(formaRecebidaPadrao('PIX'), 'Pix');
  assert.equal(formaRecebidaPadrao('Cartão de Crédito'), 'Cartão');
  assert.equal(formaRecebidaPadrao('Débito'), 'Cartão');
  assert.equal(formaRecebidaPadrao('Cheque'), 'Cheque');
  assert.equal(formaRecebidaPadrao('Dinheiro'), 'Dinheiro');
  assert.equal(formaRecebidaPadrao('Crediário'), 'Dinheiro', 'forma que nao bate fica Dinheiro, como antes');
  assert.equal(formaRecebidaPadrao(''), 'Dinheiro');
  assert.equal(formaRecebidaPadrao(undefined), 'Dinheiro');
});

test('busca do acerto: numero do pedido sem zeros, numero da nota ou nome do cliente', () => {
  const entregas = [
    { numeroPedido: '0081', notaNumero: '1520', clienteNome: 'MERCADO SÃO JOSÉ' },
    { numeroPedido: '0810', notaNumero: '', clienteNome: 'PADARIA CENTRAL' },
    { numeroPedido: '0094', notaNumero: '81', clienteNome: 'EMPORIO NATURAL' },
  ];
  assert.deepEqual(entregasDaBusca(entregas, '81').map((e) => e.numeroPedido), ['0081', '0094'], 'pedido 0081 e a nota 81; 0810 nao');
  assert.deepEqual(entregasDaBusca(entregas, '#0081').map((e) => e.numeroPedido), ['0081', '0094']);
  assert.deepEqual(entregasDaBusca(entregas, '1520').map((e) => e.numeroPedido), ['0081']);
  assert.deepEqual(entregasDaBusca(entregas, 'sao jose').map((e) => e.numeroPedido), ['0081']);
  assert.equal(entregasDaBusca(entregas, '  ').length, 3);
  assert.equal(entregasDaBusca(entregas, '999').length, 0);
});
