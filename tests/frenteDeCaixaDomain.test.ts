import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMINHO_APP_CAIXA,
  MENSAGEM_SEM_ACESSO_AO_CAIXA,
  destinoAposLogin,
  ehAppDoCaixa,
  entraDiretoNoCaixa,
  podeUsarFrenteDeCaixa,
} from '../src/utils/frenteDeCaixaDomain';

/* Frente de Caixa como app separado (19/10/2026). */

test('quem usa o caixa: PDV, so-caixa, dono, administrador', () => {
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: ['vendas.pdv'] }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: ['vendas.pedidos'] }), false);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: [] }), false);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', isOwner: true }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Admin' }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'SuperAdmin' }), true);
  assert.equal(podeUsarFrenteDeCaixa({ permissoes: null }), false);
});

test('entra direto no caixa so o funcionario com a permissao; dono e administrador nunca ficam presos', () => {
  assert.equal(entraDiretoNoCaixa({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }), true);
  assert.equal(entraDiretoNoCaixa({ role: 'Funcionario', permissoes: ['vendas.pdv'] }), false);
  assert.equal(entraDiretoNoCaixa({ role: 'Admin', permissoes: ['vendas.so_caixa'] }), false);
  assert.equal(entraDiretoNoCaixa({ role: 'Funcionario', isOwner: true, permissoes: ['vendas.so_caixa'] }), false);
});

test('destino depois do login e caminho do app', () => {
  assert.equal(destinoAposLogin({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }, false), CAMINHO_APP_CAIXA);
  assert.equal(destinoAposLogin({ role: 'Funcionario', permissoes: ['vendas.pdv'] }, false), '/dashboard');
  assert.equal(destinoAposLogin({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }, true), '/superadmin');
  assert.equal(ehAppDoCaixa('/caixa'), true);
  assert.equal(ehAppDoCaixa('/caixa/login'), true);
  assert.equal(ehAppDoCaixa('/caixa.html'), true);
  assert.equal(ehAppDoCaixa('/caixas-pdv'), false);
  assert.equal(ehAppDoCaixa('/pdv'), false);
  assert.match(MENSAGEM_SEM_ACESSO_AO_CAIXA, /Frente de Caixa/);
});

test('nomeDoOperador: o nome do cadastro vence o login gravado', async () => {
  const { nomeDoOperador } = await import('../src/utils/frenteDeCaixaDomain');
  assert.equal(nomeDoOperador({ nome: 'Uedder Gomes' }, '50672123000147-uedder'), 'Uedder Gomes');
  assert.equal(nomeDoOperador({ nome: '  ', nomeResponsavel: 'Dono' }, 'login'), 'Dono');
  assert.equal(nomeDoOperador(null, '50672123000147-uedder'), '50672123000147-uedder');
});

test('troco: dinheiro a mais vira troco; venda gravada pelo total (25/11/2026, Jomarly)', async () => {
  const { contaDoTroco, pagamentosSemOTroco } = await import('../src/utils/frenteDeCaixaDomain');
  // 160 de venda, cliente deu 200
  assert.deepEqual(contaDoTroco(16000, [{ forma: 'Dinheiro', valorCentavos: 20000 }]), {
    pagoCentavos: 20000, faltaCentavos: 0, trocoCentavos: 4000, excessoSemTrocoCentavos: 0,
  });
  assert.deepEqual(pagamentosSemOTroco([{ forma: 'Dinheiro', valorCentavos: 20000 }], 4000), [{ forma: 'Dinheiro', valorCentavos: 16000 }]);
  // Pix 100 + dinheiro 100 numa venda de 160: troco 40, Pix fica inteiro
  const misto = [{ forma: 'Pix', valorCentavos: 10000 }, { forma: 'Dinheiro', valorCentavos: 10000 }];
  assert.equal(contaDoTroco(16000, misto).trocoCentavos, 4000);
  assert.deepEqual(pagamentosSemOTroco(misto, 4000), [{ forma: 'Pix', valorCentavos: 10000 }, { forma: 'Dinheiro', valorCentavos: 6000 }]);
  // exato: sem troco
  assert.equal(contaDoTroco(16000, [{ forma: 'Dinheiro', valorCentavos: 16000 }]).trocoCentavos, 0);
  // faltando
  assert.equal(contaDoTroco(16000, [{ forma: 'Dinheiro', valorCentavos: 10000 }]).faltaCentavos, 6000);
});

test('troco: Pix ou cartao acima do total nao vira troco', async () => {
  const { contaDoTroco } = await import('../src/utils/frenteDeCaixaDomain');
  assert.deepEqual(contaDoTroco(16000, [{ forma: 'Pix', valorCentavos: 20000 }]), {
    pagoCentavos: 20000, faltaCentavos: 0, trocoCentavos: 0, excessoSemTrocoCentavos: 4000,
  });
  // cartao 200 + dinheiro 50 em venda de 160: o cartao sozinho ja' passa -- nada de troco do cartao
  const r = contaDoTroco(16000, [{ forma: 'Cartão de Débito', valorCentavos: 20000 }, { forma: 'Dinheiro', valorCentavos: 5000 }]);
  assert.equal(r.trocoCentavos, 5000);
  assert.equal(r.excessoSemTrocoCentavos, 4000);
});
