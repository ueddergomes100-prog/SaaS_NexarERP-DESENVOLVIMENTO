import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALERTA_TAMANHO_MAXIMO, alertaDoCliente, camposDoAlertaParaGravar, erroDoAlertaDoCliente } from '../src/utils/clienteAlertaDomain';

test('alerta so aparece com a caixa marcada e texto preenchido', () => {
  assert.equal(alertaDoCliente({ alertaAtivo: true, alertaTexto: '  Só vende à vista  ' }), 'Só vende à vista');
  assert.equal(alertaDoCliente({ alertaAtivo: false, alertaTexto: 'Só vende à vista' }), null);
  assert.equal(alertaDoCliente({ alertaAtivo: true, alertaTexto: '   ' }), null);
  assert.equal(alertaDoCliente({ nome: 'CLIENTE ANTIGO' }), null);
  assert.equal(alertaDoCliente(null), null);
});

test('marcar sem texto bloqueia com mensagem; desmarcado nao valida', () => {
  assert.match(erroDoAlertaDoCliente(true, '  ') ?? '', /Escreva o texto do alerta/);
  assert.equal(erroDoAlertaDoCliente(false, ''), null);
  assert.equal(erroDoAlertaDoCliente(true, 'Cobrar boleto atrasado'), null);
  assert.match(erroDoAlertaDoCliente(true, 'x'.repeat(ALERTA_TAMANHO_MAXIMO + 1)) ?? '', /limite é 500/);
});

test('o que vai para o Firestore: nunca undefined, desmarcado guarda o texto', () => {
  assert.deepEqual(camposDoAlertaParaGravar(true, '  Entregar após 14h '), { alertaAtivo: true, alertaTexto: 'Entregar após 14h' });
  assert.deepEqual(camposDoAlertaParaGravar(false, 'Entregar após 14h'), { alertaAtivo: false, alertaTexto: 'Entregar após 14h' });
  assert.deepEqual(camposDoAlertaParaGravar(true, ''), { alertaAtivo: false, alertaTexto: '' });
});
