import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nomeDoPacote, planoDoPacote, tempoEstimado } from '../src/utils/pacoteContadorDomain';
import { linhaDaNotaEmitida, linhaDaNotaRecebida } from '../src/utils/relatorioContadorDomain';

const CHAVE = '32261050672123000147550010000001231000001230';
const autorizada = linhaDaNotaEmitida({ id: 'n1', tipo: 'NF-e', status: 'authorized', number: 123, accessKey: CHAVE, data: '2026-10-05', clienteNome: 'MARIA' });
const cancelada = linhaDaNotaEmitida({ id: 'n2', tipo: 'NFC-e', status: 'canceled', number: 7, data: '2026-10-06', clienteNome: 'JOAO' });
const rejeitada = linhaDaNotaEmitida({ id: 'n3', tipo: 'NF-e', status: 'rejected', number: null, data: '2026-10-07', clienteNome: 'ANA' });
const servico = linhaDaNotaEmitida({ id: 'n4', tipo: 'NFS-e', status: 'authorized', number: 55, data: '2026-10-08', clienteNome: 'BETO' });
const recebida = linhaDaNotaRecebida({ id: 'e1', numeroNF: '999', dataEmissao: '2026-10-03', fornecedorNome: 'DISTRIBUIDORA X/Y', valorTotal: 10 });
const recebidaAntiga = linhaDaNotaRecebida({ id: 'e2', numeroNF: '10092', dataEmissao: '2026-08-06', fornecedorNome: 'SILVA', valorTotal: 10 });

test('pacote: emitidas autorizadas e canceladas, CC-e e recebidas com XML; o resto fica de fora com o motivo', () => {
  const emitidas = new Map([
    ['n1', { spedyId: 'sp1', cartas: [{ eventId: 'ev1', sequencia: 1 }, { eventId: '', sequencia: 2 }] }],
    ['n2', { spedyId: 'sp2', cartas: [] }],
    ['n3', { spedyId: 'sp3', cartas: [] }],
    ['n4', { spedyId: 'sp4', cartas: [] }],
  ]);
  const plano = planoDoPacote([autorizada, cancelada, rejeitada, servico, recebida, recebidaAntiga], emitidas, new Set(['e1']));
  assert.deepEqual(plano.tarefas.map((t) => [t.tipo, t.nome]), [
    ['emitida', `emitidas/NF-e 123 - ${CHAVE}.xml`],
    ['cce', 'cartas-de-correcao/CC-e NF-e 123 - seq 1.xml'],
    ['emitida', 'emitidas/NFC-e 7 - CANCELADA.xml'],
    ['emitida', 'emitidas/NFS-e 55.xml'],
    ['recebida', 'recebidas/NF-e 999 - DISTRIBUIDORA XY.xml'],
  ]);
  const tipos = plano.tarefas.filter((t) => t.tipo === 'emitida').map((t) => (t.tipo === 'emitida' ? t.spedyTipo : ''));
  assert.deepEqual(tipos, ['product', 'consumer', 'service']);
  assert.equal(plano.chamadasSpedy, 4);
  assert.equal(plano.foraDoPacote.length, 2);
  assert.match(plano.foraDoPacote[0], /rejeitada, sem XML autorizado/);
  assert.match(plano.foraDoPacote[1], /entrada antiga, sem o XML guardado/);
});

test('pacote: emitida sem id da Spedy fica de fora; tempo e nome do arquivo', () => {
  const plano = planoDoPacote([autorizada], new Map(), new Set());
  assert.equal(plano.tarefas.length, 0);
  assert.match(plano.foraDoPacote[0], /sem a identificação da Spedy/);
  assert.equal(tempoEstimado(10), 'menos de 1 minuto');
  assert.equal(tempoEstimado(120), 'cerca de 3 minutos');
  assert.equal(nomeDoPacote('2026-09-01', '2026-09-30'), 'xmls-contador-2026-09-01-a-2026-09-30.zip');
});
