import assert from 'node:assert/strict';
import { test } from 'node:test';
import { erroDoVeiculo, formatarPlaca, normalizarPlaca, placaValida, rotuloDoVeiculo } from '../src/utils/frotaDomain';

test('placa: normaliza, valida os dois formatos e formata com hífen', () => {
  assert.equal(normalizarPlaca(' abc-1d23 '), 'ABC1D23');
  assert.equal(placaValida('ABC-1234'), true);
  assert.equal(placaValida('abc1d23'), true);
  assert.equal(placaValida('AB-12345'), false);
  assert.equal(placaValida('ABC123'), false);
  assert.equal(placaValida(''), false);
  assert.equal(formatarPlaca('abc1d23'), 'ABC-1D23');
  assert.equal(formatarPlaca('abc'), 'ABC');
});

test('rótulo do veículo: modelo e placa', () => {
  assert.equal(rotuloDoVeiculo({ modelo: 'VW Delivery', placa: 'abc1d23' }), 'VW Delivery — ABC-1D23');
  assert.equal(rotuloDoVeiculo({ modelo: '', placa: 'abc1d23' }), 'ABC-1D23');
});

test('erros do cadastro dizem o que fazer; placa repetida cita a placa; a própria placa na edição passa', () => {
  const existentes = [{ id: 'v1', placa: 'ABC1D23' }];
  assert.match(String(erroDoVeiculo({ placa: '', modelo: 'X' }, existentes)), /Informe a placa/);
  assert.match(String(erroDoVeiculo({ placa: '12', modelo: 'X' }, existentes)), /7 letras e números/);
  assert.match(String(erroDoVeiculo({ placa: 'DEF1G23', modelo: ' ' }, existentes)), /Informe o modelo/);
  assert.match(String(erroDoVeiculo({ placa: 'abc-1d23', modelo: 'X' }, existentes)), /Já existe um veículo com a placa ABC-1D23/);
  assert.equal(erroDoVeiculo({ placa: 'abc-1d23', modelo: 'X' }, existentes, 'v1'), null);
  assert.match(String(erroDoVeiculo({ placa: 'DEF1G23', modelo: 'X', ano: '21' }, existentes)), /ano/);
  assert.match(String(erroDoVeiculo({ placa: 'DEF1G23', modelo: 'X', kmAtual: '-5' }, existentes)), /KM/);
  assert.equal(erroDoVeiculo({ placa: 'DEF1G23', modelo: 'X', ano: '2021', kmAtual: '120500,5' }, existentes), null);
});
