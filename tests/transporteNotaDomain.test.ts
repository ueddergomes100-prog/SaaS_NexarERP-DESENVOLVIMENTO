import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRANSPORTE_VAZIO,
  lerTransporte,
  modalidadeEfetiva,
  montarTransporteDaNota,
  normalizarPlaca,
  placaValida,
  ratearPorPeso,
  resumoDoTransporte,
  diferencasDoTransporte,
  notaTravaOTransporte,
  temTransporte,
  transporteParaGravar,
  valorDigitado,
} from '../src/utils/transporteNotaDomain';

const TRANSPORTADORA = {
  nome: 'RAPIDO SUL TRANSPORTES LTDA', documento: '12.345.678/0001-99', inscricaoEstadual: '123.456.789',
  endereco: 'RUA DAS CARGAS', numero: '100', bairro: 'CENTRO', cep: '35500-000', cidade: 'DIVINOPOLIS', estado: 'MG', codigoIbge: '3122306',
};

test('frete digitado com virgula, milhar e ponto decimal (o campo so aceitava inteiro)', () => {
  assert.equal(valorDigitado('180,50'), 180.5);
  assert.equal(valorDigitado('1.234,56'), 1234.56);
  assert.equal(valorDigitado('180.5'), 180.5);
  assert.equal(valorDigitado(''), 0);
  assert.equal(valorDigitado('-3'), 0);
  // Peso com 3 casas (gramas), como a NF-e aceita.
  assert.equal(valorDigitado('0,537', 3), 0.537);
  assert.equal(valorDigitado('0,537'), 0.54, 'dinheiro continua com 2 casas');
  assert.equal(valorDigitado('445,12', 3), 445.12);
  assert.equal(valorDigitado('abc'), 0);
});

test('transporte gravado: limpo, sem undefined; vazio nao grava', () => {
  assert.equal(transporteParaGravar(TRANSPORTE_VAZIO), null);
  assert.equal(temTransporte(TRANSPORTE_VAZIO), false);
  const t = lerTransporte({ modalidade: 'byReceiver', transportadoraId: 'abc', transportadoraNome: ' RAPIDO SUL ', placa: 'abc-1d23', placaUf: 'mg', volumes: { quantidade: '3', especie: 'CAIXA', pesoBrutoKg: '12,5' }, lixo: 1 });
  assert.equal(t.modalidade, 'byReceiver');
  assert.equal(t.placa, 'ABC1D23');
  assert.equal(t.placaUf, 'MG');
  assert.equal(t.volumes.quantidade, 3);
  assert.equal(t.volumes.pesoBrutoKg, 12.5);
  assert.equal(t.transportadoraNome, 'RAPIDO SUL');
  assert.equal(lerTransporte({ modalidade: 'qualquer' }).modalidade, '');
  const gravado = transporteParaGravar(t);
  assert.ok(gravado);
  assert.equal(JSON.stringify(gravado).includes('undefined'), false);
});

test('modalidade: sem escolha, com frete = por conta da loja; sem frete = sem frete', () => {
  assert.equal(modalidadeEfetiva(TRANSPORTE_VAZIO, 180), 'byIssuer');
  assert.equal(modalidadeEfetiva(TRANSPORTE_VAZIO, 0), 'free');
  assert.equal(modalidadeEfetiva({ ...TRANSPORTE_VAZIO, modalidade: 'byReceiver' }, 180), 'byReceiver');
});

test('grupo [transp] completo: modalidade, transportadora com endereco, placa e volumes', () => {
  const t = lerTransporte({ modalidade: 'byIssuer', transportadoraId: 'tr1', transportadoraNome: 'RAPIDO SUL', placa: 'ABC1234', placaUf: 'MG', volumes: { quantidade: 3, especie: 'CAIXA', marca: 'HENNDER', numeracao: '1 a 3', pesoBrutoKg: 25.5, pesoLiquidoKg: 24 } });
  const r = montarTransporteDaNota({ transporte: t, frete: 180.5, transportadora: TRANSPORTADORA });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.transport, {
    freightModality: 'byIssuer',
    carrier: {
      name: 'RAPIDO SUL TRANSPORTES LTDA', federalTaxNumber: '12345678000199', stateTaxNumber: '123456789',
      address: { street: 'RUA DAS CARGAS', number: '100', district: 'CENTRO', postalCode: '35500000', city: { code: '3122306', name: 'DIVINOPOLIS', state: 'MG' } },
    },
    vehicle: { plate: 'ABC1234', state: 'mg' },
    volume: { quantity: 3, species: 'CAIXA', brand: 'HENNDER', volumeNumeration: '1 a 3', netWeight: 24, grossWeight: 25.5 },
  });
  assert.deepEqual(r.avisos, []);
});

test('bloqueios com a mensagem de onde corrigir', () => {
  const comTransp = lerTransporte({ transportadoraId: 'tr1', transportadoraNome: 'RAPIDO SUL' });
  const semDoc = montarTransporteDaNota({ transporte: comTransp, frete: 10, transportadora: { ...TRANSPORTADORA, documento: '' } });
  assert.equal(semDoc.ok, false);
  if (!semDoc.ok) assert.match(semDoc.erro, /sem CNPJ\/CPF/);
  const naoAchou = montarTransporteDaNota({ transporte: comTransp, frete: 10, transportadora: null });
  if (!naoAchou.ok) assert.match(naoAchou.erro, /não foi encontrada/); else assert.fail();
  const freteSemModalidade = montarTransporteDaNota({ transporte: { ...TRANSPORTE_VAZIO, modalidade: 'free' }, frete: 10, transportadora: null });
  if (!freteSemModalidade.ok) assert.match(freteSemModalidade.erro, /quem paga o frete/); else assert.fail();
  const placaRuim = montarTransporteDaNota({ transporte: lerTransporte({ placa: 'AB12', placaUf: 'MG' }), frete: 0, transportadora: null });
  if (!placaRuim.ok) assert.match(placaRuim.erro, /não é válida/); else assert.fail();
  const semUf = montarTransporteDaNota({ transporte: lerTransporte({ placa: 'ABC1234' }), frete: 0, transportadora: null });
  if (!semUf.ok) assert.match(semUf.erro, /UF da placa/); else assert.fail();
  // Numero do endereco acima de 10 caracteres: a Spedy recusa a nota inteira (TSA, 07/11/2026).
  const numeroLongo = montarTransporteDaNota({ transporte: comTransp, frete: 10, transportadora: { ...TRANSPORTADORA, numero: '2809, SALA ADM 2' } });
  if (!numeroLongo.ok) assert.match(numeroLongo.erro, /"2809, SALA ADM 2"\) tem 16 caracteres.*no máximo 10.*Cadastros › Fornecedores/); else assert.fail();
  const numeroNoLimite = montarTransporteDaNota({ transporte: comTransp, frete: 10, transportadora: { ...TRANSPORTADORA, numero: ' 1234567890 ' } });
  assert.equal(numeroNoLimite.ok, true);
  if (numeroNoLimite.ok) assert.equal(((numeroNoLimite.transport.carrier as Record<string, unknown>).address as Record<string, unknown>).number, '1234567890');
  // Sem endereco: sai, com aviso.
  const semEndereco = montarTransporteDaNota({ transporte: comTransp, frete: 10, transportadora: { nome: 'X', documento: '12345678000199', inscricaoEstadual: 'isento' } });
  assert.equal(semEndereco.ok, true);
  if (semEndereco.ok) {
    assert.equal((semEndereco.transport.carrier as Record<string, unknown>).stateTaxNumber, 'ISENTO');
    assert.match(semEndereco.avisos.join(' '), /sem endereço/);
  }
});

test('sem nada de transporte e sem frete: so a modalidade "sem frete"', () => {
  const r = montarTransporteDaNota({ transporte: TRANSPORTE_VAZIO, frete: 0, transportadora: null });
  assert.deepEqual(r, { ok: true, transport: { freightModality: 'free' }, avisos: [] });
});

test('rateio do frete pelos itens: centavos exatos, a soma bate', () => {
  const partes = ratearPorPeso(180.5, [100, 200, 0.01]);
  assert.equal(Math.round(partes.reduce((s, p) => s + p, 0) * 100), 18050);
  assert.deepEqual(ratearPorPeso(10, [1, 1, 1]).map((p) => Math.round(p * 100)).sort(), [333, 333, 334]);
  assert.deepEqual(ratearPorPeso(0, [5, 5]), [0, 0]);
  assert.deepEqual(ratearPorPeso(9, [0, 0]), [4.5, 4.5]);
});

test('placa e resumo', () => {
  assert.equal(normalizarPlaca('abc-1d23'), 'ABC1D23');
  assert.equal(placaValida('ABC1D23'), true);
  assert.equal(placaValida('ABC1234'), true);
  assert.equal(placaValida('AB1234'), false);
  assert.match(resumoDoTransporte(lerTransporte({ transportadoraNome: 'RAPIDO SUL', volumes: { quantidade: 2, especie: 'CX' } }), 180.5), /Frete R\$\s?180,50 · Por conta da loja — CIF \(0\) · RAPIDO SUL · 2 vol\. CX/);
});

test('venda finalizada: nota transmitida trava o transporte; rejeitada ou cancelada nao', () => {
  for (const st of ['authorized', 'enqueued', 'processing', 'created']) assert.equal(notaTravaOTransporte(st), true, st);
  for (const st of ['rejected', 'denied', 'canceled', 'cancelled', '', undefined]) assert.equal(notaTravaOTransporte(st), false, String(st));
});

test('historico do transporte: so o que mudou, em portugues', () => {
  const antes = lerTransporte({ modalidade: 'byIssuer', transportadoraNome: 'TSA LOGISTICA LTDA', volumes: { quantidade: 2, especie: 'PALETTS', pesoBrutoKg: 445.12, pesoLiquidoKg: 0.537 } });
  const depois = lerTransporte({ ...antes, volumes: { ...antes.volumes, pesoLiquidoKg: 410.521 } });
  assert.deepEqual(diferencasDoTransporte(antes, depois), [
    { campo: 'Peso líquido', valorAnterior: '0,537 kg', valorNovo: '410,521 kg' },
  ]);
  assert.deepEqual(diferencasDoTransporte(antes, antes), []);
  assert.deepEqual(diferencasDoTransporte(TRANSPORTE_VAZIO, lerTransporte({ placa: 'abc1d23', placaUf: 'MG' })), [
    { campo: 'Placa do veículo', valorAnterior: '—', valorNovo: 'ABC1D23/MG' },
  ]);
});
