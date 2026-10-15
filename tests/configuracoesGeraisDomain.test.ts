import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMPOS_GERAIS,
  camposDiferentes,
  juntarCategorias,
  lerConfiguracoesGerais,
  semCamposGerais,
  valoresUnificados,
} from '../src/utils/configuracoesGeraisDomain';

const valido = {
  planoContasReceitas: ['Serviços', ' venda  de produtos ', 'SERVIÇOS', ''],
  planoContasDespesas: ['Aluguel'],
  validarCadastroProduto: true,
  modoValidacaoCliente: 'perguntar',
  trabalhaComLimiteCredito: false,
  transferenciaSemNota: true,
  transferenciaNfeTributacao: 'nao_incide',
};

test('lerConfiguracoesGerais aceita o que a tela manda e limpa as categorias', () => {
  const r = lerConfiguracoesGerais(valido);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.valores.planoContasReceitas, ['Serviços', 'venda de produtos']);
  assert.equal(r.valores.modoValidacaoCliente, 'perguntar');
  assert.equal(r.valores.transferenciaSemNota, true);
});

test('lerConfiguracoesGerais recusa com mensagem em portugues', () => {
  const casos: Array<[Record<string, unknown>, RegExp]> = [
    [{ ...valido, planoContasReceitas: 'x' }, /categorias de receita chegou incompleta/],
    [{ ...valido, planoContasDespesas: ['a'.repeat(61)] }, /passa de 60 letras/],
    [{ ...valido, planoContasDespesas: Array.from({ length: 201 }, (_, i) => `C${i}`) }, /até 200 categorias de despesa/],
    [{ ...valido, validarCadastroProduto: 'sim' }, /Validar cadastro de produto/],
    [{ ...valido, modoValidacaoCliente: 'talvez' }, /cliente não cadastrado/],
    [{ ...valido, transferenciaNfeTributacao: 'icms' }, /tributação da nota de transferência/],
  ];
  for (const [corpo, mensagem] of casos) {
    const r = lerConfiguracoesGerais(corpo);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.erro, mensagem);
  }
});

test('juntarCategorias nao repete (maiusculas e espacos nao contam) e mantem a ordem', () => {
  assert.deepEqual(juntarCategorias(['Aluguel', 'Água'], ['ALUGUEL', 'Marketing'], undefined, ['  água ']), ['Aluguel', 'Água', 'Marketing']);
});

test('a tela da filial nunca grava os campos gerais', () => {
  const salvo = semCamposGerais({ ...valido, nomeOficina: 'LOJA', trabalhaComPreVenda: true });
  for (const campo of CAMPOS_GERAIS) assert.equal(campo in salvo, false, campo);
  assert.deepEqual(salvo, { nomeOficina: 'LOJA', trabalhaComPreVenda: true });
});

test('unificacao: vale a matriz; plano de contas junta todas; campo que a matriz nao tem fica de fora', () => {
  const matriz = { planoContasReceitas: ['Serviços'], trabalhaComLimiteCredito: true, modoValidacaoCliente: 'bloquear' };
  const filial = { planoContasReceitas: ['Serviços', 'Fretes'], trabalhaComLimiteCredito: false, validarCadastroProduto: true };
  const unificados = valoresUnificados(matriz, [matriz, filial]);
  assert.deepEqual(unificados, {
    planoContasReceitas: ['Serviços', 'Fretes'],
    modoValidacaoCliente: 'bloquear',
    trabalhaComLimiteCredito: true,
  });
  assert.deepEqual(camposDiferentes(filial, unificados), ['modoValidacaoCliente', 'trabalhaComLimiteCredito']);
  assert.deepEqual(camposDiferentes(matriz, unificados), ['planoContasReceitas']);
  assert.deepEqual(camposDiferentes({ ...filial, modoValidacaoCliente: 'bloquear', trabalhaComLimiteCredito: true }, unificados), []);
});
