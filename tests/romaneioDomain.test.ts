import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  erroDoPedidoParaRomaneio,
  erroDoRegistroDeEntrega,
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
