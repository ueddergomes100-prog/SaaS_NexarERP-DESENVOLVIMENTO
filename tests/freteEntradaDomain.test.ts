import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TAMANHO_CHAVE_ACESSO,
  credorDoFrete,
  vencimentoDoFrete,
  descricaoDoTituloDeFrete,
  digitoVerificadorDaChave,
  erroDaChaveAcesso,
  erroDoFrete,
  freteGeraTituloProprio,
  ratearFreteNosItens,
  somenteDigitos,
  type DadosDoFrete,
} from '../src/utils/freteEntradaDomain';

/** Monta uma chave valida: 43 digitos + o DV calculado. */
const chaveValida = (primeiros43: string) => primeiros43 + String(digitoVerificadorDaChave(primeiros43));
const BASE43 = '3526090512345678000199570010000012341000012345';

// --- chave de acesso -------------------------------------------------------

test('chave vazia e valida: o campo e opcional', () => {
  assert.equal(erroDaChaveAcesso(''), null);
  assert.equal(erroDaChaveAcesso('   '), null);
});

test('chave com quantidade errada de digitos diz quantos faltam', () => {
  const erro = erroDaChaveAcesso('123456');
  assert.match(String(erro), new RegExp(String(TAMANHO_CHAVE_ACESSO)));
  assert.match(String(erro), /6/);
});

test('chave com DV correto passa; um digito trocado e recusado', () => {
  const chave = chaveValida(BASE43.slice(0, 43));
  assert.equal(chave.length, 44);
  assert.equal(erroDaChaveAcesso(chave), null);

  // Troca um digito do meio: o DV deixa de bater.
  const adulterada = chave.slice(0, 20) + (chave[20] === '9' ? '8' : '9') + chave.slice(21);
  assert.match(String(erroDaChaveAcesso(adulterada)), /não confere/i);
});

test('chave aceita colada com espacos e pontos', () => {
  const chave = chaveValida(BASE43.slice(0, 43));
  const bagunçada = chave.replace(/(\d{4})/g, '$1 ');
  assert.equal(erroDaChaveAcesso(bagunçada), null);
  assert.equal(somenteDigitos(bagunçada), chave);
});

test('DV recusa entrada que nao tem 43 digitos', () => {
  assert.equal(digitoVerificadorDaChave('123'), null);
  assert.equal(digitoVerificadorDaChave('x'.repeat(43)), null);
});

// --- rateio do frete -------------------------------------------------------

test('frete e dividido proporcional ao VALOR de cada item', () => {
  const itens = [
    { valorTotal: 300, quantidade: 3 },  // 75% do valor
    { valorTotal: 100, quantidade: 10 }, // 25%
  ];
  const r = ratearFreteNosItens(itens, 40);
  assert.deepEqual(r.map((x) => x.freteRateado), [30, 10]);
  // Custo unitario: (300+30)/3 = 110 e (100+10)/10 = 11
  assert.deepEqual(r.map((x) => x.custoUnitarioComFrete), [110, 11]);
});

test('a soma do frete rateado e SEMPRE o frete informado, sem centavo perdido', () => {
  for (const frete of [10, 33.33, 0.01, 199.99, 1000]) {
    for (const valores of [[100, 100, 100], [10, 20, 70], [1, 1, 1, 1, 1, 1, 1]]) {
      const itens = valores.map((v) => ({ valorTotal: v, quantidade: 1 }));
      const soma = ratearFreteNosItens(itens, frete).reduce((s, x) => s + x.freteRateado, 0);
      assert.equal(Math.round(soma * 100), Math.round(frete * 100), `frete ${frete} em ${valores.length} itens`);
    }
  }
});

test('carga mista: item caro leva mais frete que item barato em maior quantidade', () => {
  const itens = [
    { valorTotal: 20, quantidade: 100 },   // 100 parafusos baratos
    { valorTotal: 1980, quantidade: 2 },   // 2 motores caros
  ];
  const r = ratearFreteNosItens(itens, 200);
  assert.ok(r[1].freteRateado > r[0].freteRateado);
  assert.equal(Math.round((r[0].freteRateado + r[1].freteRateado) * 100), 20000);
});

test('frete zero nao mexe no custo', () => {
  const r = ratearFreteNosItens([{ valorTotal: 100, quantidade: 4 }], 0);
  assert.equal(r[0].freteRateado, 0);
  assert.equal(r[0].custoUnitarioComFrete, 25);
});

test('item sem quantidade nao divide por zero', () => {
  const r = ratearFreteNosItens([{ valorTotal: 100, quantidade: 0 }], 10);
  assert.equal(r[0].custoUnitarioComFrete, 0);
});

test('custo unitario com dizima fica em centavos, nao com 12 casas', () => {
  // 100 + 10 de frete em 3 unidades = 36,666...
  const r = ratearFreteNosItens([{ valorTotal: 100, quantidade: 3 }], 10);
  assert.equal(r[0].custoUnitarioComFrete, 36.67);
});

// --- titulo do frete -------------------------------------------------------

const frete = (extra: Partial<DadosDoFrete> = {}): DadosDoFrete => ({
  valor: 0, chaveCte: '', transportadoraId: '', transportadoraNome: '', ...extra,
});

test('titulo proprio so com valor E transportadora', () => {
  assert.equal(freteGeraTituloProprio(frete({ valor: 100, transportadoraId: 't1' })), true);
  // Frete cobrado pelo proprio fornecedor (vFrete do XML): entra no custo,
  // mas nao cria segundo titulo -- senao a empresa pagaria duas vezes.
  assert.equal(freteGeraTituloProprio(frete({ valor: 100 })), false);
  assert.equal(freteGeraTituloProprio(frete({ transportadoraId: 't1' })), false);
  assert.equal(freteGeraTituloProprio(frete()), false);
});

test('frete sem nada informado nao reclama', () => {
  assert.equal(erroDoFrete(frete()), null);
});

test('frete negativo e recusado', () => {
  assert.match(String(erroDoFrete(frete({ valor: -1 }))), /negativo/i);
});

test('chave de CT-e sem valor avisa o meio preenchimento', () => {
  const chave = chaveValida(BASE43.slice(0, 43));
  assert.match(String(erroDoFrete(frete({ chaveCte: chave }))), /não o valor do frete/i);
});

test('chave de CT-e com valor mas sem transportadora pede a transportadora', () => {
  const chave = chaveValida(BASE43.slice(0, 43));
  assert.match(String(erroDoFrete(frete({ chaveCte: chave, valor: 50 }))), /transportadora/i);
});

test('frete do proprio fornecedor (valor sem chave e sem transportadora) passa', () => {
  assert.equal(erroDoFrete(frete({ valor: 50 })), null);
});

test('frete completo passa', () => {
  const chave = chaveValida(BASE43.slice(0, 43));
  assert.equal(erroDoFrete(frete({ valor: 50, chaveCte: chave, transportadoraId: 't1', transportadoraNome: 'TRANSP X' })), null);
});

test('descricao do titulo identifica a nota, a transportadora e o CT-e', () => {
  const chave = chaveValida(BASE43.slice(0, 43));
  const d = descricaoDoTituloDeFrete('13199', frete({ valor: 50, chaveCte: chave, transportadoraId: 't1', transportadoraNome: 'TRANSP X' }));
  assert.match(d, /FRETE NF 13199/);
  assert.match(d, /TRANSP X/);
  assert.match(d, new RegExp(chave.slice(-6)));
});

test('sem CT-e a descricao nao inventa referencia', () => {
  const d = descricaoDoTituloDeFrete('13199', frete({ valor: 50, transportadoraId: 't1', transportadoraNome: 'TRANSP X' }));
  assert.equal(d, 'FRETE NF 13199 - TRANSP X');
});

// --- frete a prazo (2026-09-24) ---------------------------------------------

test('frete cobrado a parte pelo fornecedor gera titulo proprio, no nome dele', () => {
  const f = frete({ valor: 80, lancarNoFornecedor: true });
  assert.equal(freteGeraTituloProprio(f), true);
  const credor = credorDoFrete(f, { id: 'f1', nome: 'FORNECEDOR A' });
  assert.deepEqual(credor, { id: 'f1', nome: 'FORNECEDOR A', ehFornecedorDaNota: true });
  // sem valor, marcar a opcao nao gera titulo
  assert.equal(freteGeraTituloProprio(frete({ lancarNoFornecedor: true })), false);
});

test('com transportadora escolhida, ela e o credor mesmo com a opcao do fornecedor marcada', () => {
  const f = frete({ valor: 80, lancarNoFornecedor: true, transportadoraId: 't1', transportadoraNome: 'TRANSP' });
  assert.deepEqual(credorDoFrete(f, { id: 'f1', nome: 'FORNECEDOR A' }), { id: 't1', nome: 'TRANSP', ehFornecedorDaNota: false });
});

test('vencimento do frete: o informado, ou emissao + 30 dias', () => {
  assert.equal(vencimentoDoFrete(frete({ vencimento: '2026-11-05' }), '2026-09-10'), '2026-11-05');
  assert.equal(vencimentoDoFrete(frete(), '2026-09-10'), '2026-10-10');
  assert.equal(vencimentoDoFrete(frete({ vencimento: 'lixo' }), '2026-09-10'), '2026-10-10');
});

test('vencimento fora do formato de data e recusado com mensagem', () => {
  assert.match(String(erroDoFrete(frete({ valor: 10, vencimento: '05/11/2026' }))), /vencimento do frete/i);
  assert.equal(erroDoFrete(frete({ valor: 10, vencimento: '2026-11-05' })), null);
});

test('chave de CT-e com valor e credor = fornecedor da nota passa', () => {
  const chave = chaveValida(BASE43.slice(0, 43));
  assert.equal(erroDoFrete(frete({ chaveCte: chave, valor: 50, lancarNoFornecedor: true })), null);
});

test('descricao sem transportadora nao deixa hifen sobrando', () => {
  assert.equal(descricaoDoTituloDeFrete('13199', frete({ valor: 50, lancarNoFornecedor: true })), 'FRETE NF 13199');
});
