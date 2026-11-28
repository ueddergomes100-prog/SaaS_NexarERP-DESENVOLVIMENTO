import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contasDaCobranca,
  linkDoWhatsapp,
  MAX_CONTAS_NA_MENSAGEM,
  mensagemDeCobranca,
  primeiroNome,
  rotuloDaConta,
  telefoneParaWhatsapp,
  totalDaCobranca,
  whatsappDoCliente,
  type ContaDaCobranca,
} from '../src/utils/cobrancaWhatsappDomain';

const HOJE = '2026-11-28';
const conta = (parcial: Partial<ContaDaCobranca>): ContaDaCobranca => ({
  descricao: 'Venda Direta #120 - Boleto', dataCompra: '2026-11-03', vencimento: '2026-11-10', valorCentavos: 15000, acrescimoCentavos: 0, ...parcial,
});

test('cobranca: rotulo do pedido sai da descricao, com a parcela', () => {
  assert.equal(rotuloDaConta('Venda Direta #120 - Boleto (Parcela 1/2)'), 'Pedido #120 (parcela 1/2)');
  assert.equal(rotuloDaConta('PDV #77 - Pagamento a Prazo'), 'Pedido #77');
  assert.equal(rotuloDaConta('Mensalidade de novembro'), 'Mensalidade de novembro');
  assert.equal(rotuloDaConta(''), 'Conta');
});

test('cobranca: vencidas ou todas, da mais antiga para a mais nova', () => {
  const contas = [conta({ vencimento: '2026-12-12', descricao: 'Venda Direta #131 - Boleto' }), conta({ vencimento: '2026-11-10' })];
  assert.deepEqual(contasDaCobranca(contas, 'vencidas', HOJE).map((c) => c.vencimento), ['2026-11-10']);
  assert.deepEqual(contasDaCobranca(contas, 'todas', HOJE).map((c) => c.vencimento), ['2026-11-10', '2026-12-12']);
});

test('cobranca: mensagem com pedido, data da compra, vencimento, juros e total', () => {
  const contas = contasDaCobranca([
    conta({ acrescimoCentavos: 540 }),
    conta({ descricao: 'Venda Direta #131 - Boleto', dataCompra: '2026-11-12', vencimento: '2026-12-12', valorCentavos: 8000 }),
  ], 'todas', HOJE);
  const texto = mensagemDeCobranca({ clienteNome: 'MARIA DA SILVA', empresaNome: 'Embala Minas', contas, hoje: HOJE });
  assert.match(texto, /^Oi, Maria, tudo bem\? Aqui é da Embala Minas\./);
  assert.match(texto, /Pedido #120 · compra 03\/11\/2026 · venceu 10\/11\/2026/);
  assert.match(texto, /R\$\s150,00 \+ R\$\s5,40 de juros e multa = R\$\s155,40/);
  assert.match(texto, /Pedido #131 · compra 12\/11\/2026 · vence 12\/12\/2026/);
  assert.match(texto, /Total: R\$\s235,40/);
  assert.equal(totalDaCobranca(contas), 23540);
  assert.doesNotMatch(texto, /—|tempestivo|excelência/, 'sem cara de IA');
  assert.ok((texto.match(/!/g) || []).length <= 1);
});

test('cobranca: uma conta so\' nao repete o total; sem contas, texto vazio', () => {
  const texto = mensagemDeCobranca({ clienteNome: 'joao', empresaNome: '', contas: [conta({})], hoje: HOJE });
  assert.match(texto, /^Oi, Joao, tudo bem\?\nPassando pra lembrar da conta que venceu:/);
  assert.doesNotMatch(texto, /Total:/);
  assert.equal(mensagemDeCobranca({ clienteNome: 'x', empresaNome: 'y', contas: [], hoje: HOJE }), '');
});

test('cobranca: muitas contas listam as primeiras e somam todas no total', () => {
  const contas = Array.from({ length: MAX_CONTAS_NA_MENSAGEM + 3 }, (_, i) => conta({ descricao: `Venda Direta #${i + 1} - Boleto`, valorCentavos: 100 }));
  const texto = mensagemDeCobranca({ clienteNome: 'Ana', empresaNome: 'Loja', contas, hoje: HOJE });
  assert.match(texto, /e mais 3 contas/);
  assert.match(texto, /Total: R\$\s15,00/);
});

test('cobranca: telefone vira numero do WhatsApp so\' com DDD', () => {
  assert.equal(telefoneParaWhatsapp('(33) 98888-7777'), '5533988887777');
  assert.equal(telefoneParaWhatsapp('+55 33 3331-2222'), '553333312222');
  assert.equal(telefoneParaWhatsapp('033 98888-7777'), '5533988887777');
  assert.equal(telefoneParaWhatsapp('98888-7777'), null, 'sem DDD nao da para mandar');
  assert.equal(telefoneParaWhatsapp(undefined), null);
  assert.equal(whatsappDoCliente({ celular: '', telefone: '33 3331-2222' }), '553333312222');
  assert.equal(whatsappDoCliente({ celular: '33988887777', telefone: '3333312222' }), '5533988887777', 'celular primeiro');
  assert.equal(linkDoWhatsapp(null, 'a b'), 'https://wa.me/?text=a%20b');
  assert.equal(linkDoWhatsapp('5533988887777', 'oi'), 'https://wa.me/5533988887777?text=oi');
  assert.equal(primeiroNome(''), '');
});
