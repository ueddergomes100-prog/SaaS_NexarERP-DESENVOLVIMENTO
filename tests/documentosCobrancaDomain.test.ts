import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMISSAO_DOCUMENTOS_PADRAO,
  documentosParaMomento,
  emitenteDaConfiguracao,
  formatarDocumentoPessoa,
  inteiroPorExtenso,
  montarDuplicatas,
  montarPromissorias,
  montarRecibo,
  parcelasDoPedido,
  parseEmissaoDocumentos,
  parteDoCliente,
  valorPorExtenso,
  dataPorExtenso,
  localEData,
} from '../src/utils/documentosCobrancaDomain';

test('valor por extenso em portugues', () => {
  assert.equal(inteiroPorExtenso(0), 'zero');
  assert.equal(inteiroPorExtenso(15), 'quinze');
  assert.equal(inteiroPorExtenso(21), 'vinte e um');
  assert.equal(inteiroPorExtenso(100), 'cem');
  assert.equal(inteiroPorExtenso(101), 'cento e um');
  assert.equal(inteiroPorExtenso(1000), 'mil');
  assert.equal(inteiroPorExtenso(1100), 'mil e cem');
  assert.equal(inteiroPorExtenso(1234), 'mil duzentos e trinta e quatro');
  assert.equal(inteiroPorExtenso(2000), 'dois mil');
  assert.equal(inteiroPorExtenso(1_000_000), 'um milhão');
  assert.equal(inteiroPorExtenso(1_200_000), 'um milhão e duzentos mil');
  assert.equal(inteiroPorExtenso(2_501_033), 'dois milhões quinhentos e um mil e trinta e três');
  assert.equal(valorPorExtenso(123456), 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos');
  assert.equal(valorPorExtenso(100), 'um real');
  assert.equal(valorPorExtenso(1), 'um centavo');
  assert.equal(valorPorExtenso(0), 'zero reais');
  assert.equal(valorPorExtenso(40890), 'quatrocentos e oito reais e noventa centavos');
});

test('configuracao de emissao: padrao e\' nunca; lixo vira padrao; momentos separam sempre e perguntar', () => {
  assert.deepEqual(parseEmissaoDocumentos(undefined), EMISSAO_DOCUMENTOS_PADRAO);
  const c = parseEmissaoDocumentos({ promissoria: { modo: 'sempre', vias: 2 }, carne: { modo: 'perguntar', vias: 9 }, recibo: { modo: 'x' }, duplicata: { modo: 'perguntar', vias: 1 } });
  assert.deepEqual(c.promissoria, { modo: 'sempre', vias: 2 });
  assert.deepEqual(c.carne, { modo: 'perguntar', vias: 1 }, 'vias fora do limite voltam para 1');
  assert.deepEqual(c.recibo, { modo: 'nunca', vias: 1 });
  assert.deepEqual(documentosParaMomento(c, 'venda_a_prazo'), { sempre: ['promissoria'], perguntar: ['carne', 'duplicata'] });
  assert.deepEqual(documentosParaMomento(c, 'recebimento'), { sempre: [], perguntar: [] });
  assert.deepEqual(documentosParaMomento(EMISSAO_DOCUMENTOS_PADRAO, 'venda_a_prazo'), { sempre: [], perguntar: [] });
});

test('partes: empresa pela configuracao, cliente pelo cadastro, documentos formatados', () => {
  const empresa = emitenteDaConfiguracao({ razaoSocial: 'Loja Centro Ltda', cnpj: '11222333000181', rua: 'Rua A', numero: '10', bairro: 'Centro', nfseCidadeNome: 'Vitória', nfseCidadeEstado: 'ES', cep: '29010000', telefone: '(27) 3333-0000' });
  assert.deepEqual(empresa, { nome: 'LOJA CENTRO LTDA', documento: '11.222.333/0001-81', endereco: 'Rua A, 10 - Centro', cidadeUf: 'Vitória/ES - CEP 29010-000', telefone: '(27) 3333-0000' });
  const cliente = parteDoCliente({ nome: 'Maria Silva', documento: '16713928684', endereco: 'Rua B', numero: '5', bairro: 'Praia', cidade: 'Serra', estado: 'ES' });
  assert.equal(cliente.documento, '167.139.286-84');
  assert.equal(cliente.cidadeUf, 'Serra/ES');
  assert.equal(formatarDocumentoPessoa('abc'), 'abc');
  assert.equal(parteDoCliente(null, 'Consumidor Final').nome, 'CONSUMIDOR FINAL');
  assert.equal(dataPorExtenso('2026-10-07'), '7 de outubro de 2026');
  assert.equal(localEData('Vitória/ES', '2026-01-01'), 'Vitória/ES, 1 de janeiro de 2026');
  assert.equal(localEData('', '2026-12-25'), '25 de dezembro de 2026');
});

test('promissorias: uma por parcela, numeradas N/total, com extenso; duplicata so\' para CNPJ', () => {
  const venda = { numeroPedido: '0079', dataVenda: '2026-10-07', totalCentavos: 30000 };
  const parcelas = parcelasDoPedido([{ numero: 1, dataVencimento: '2026-11-06', valor: 100 }, { numero: 2, dataVencimento: '2026-12-06', valor: 100 }, { numero: 3, dataVencimento: '2027-01-05', valor: 100 }]);
  const empresa = emitenteDaConfiguracao({ nomeOficina: 'Loja', cnpj: '11222333000181', nfseCidadeNome: 'Vitória', nfseCidadeEstado: 'ES' });
  const pf = parteDoCliente({ nome: 'Maria', documento: '16713928684' });
  const pj = parteDoCliente({ nome: 'Mercado X', documento: '11222333000262' });
  const promissorias = montarPromissorias({ venda, parcelas, empresa, cliente: pf, mensagem: 'Pague em dia.' });
  assert.equal(promissorias.length, 3);
  assert.deepEqual([promissorias[0].numero, promissorias[2].numero], ['01/03', '03/03']);
  assert.equal(promissorias[1].valorExtenso, 'cem reais');
  assert.equal(promissorias[0].praca, 'Vitória/ES');
  assert.equal(promissorias[0].referencia, 'Pedido de venda nº 0079');
  const semCnpj = montarDuplicatas({ venda, parcelas, empresa, cliente: pf });
  assert.equal(semCnpj.ok, false);
  if (!semCnpj.ok) assert.match(semCnpj.erro, /só para cliente com CNPJ.*CPF/);
  const comCnpj = montarDuplicatas({ venda, parcelas, empresa, cliente: pj });
  assert.equal(comCnpj.ok, true);
  if (comCnpj.ok) {
    assert.equal(comCnpj.duplicatas[0].numero, '0079/01');
    assert.equal(comCnpj.duplicatas[0].valorFaturaCentavos, 30000);
  }
});

test('recibo: valor = titulo + juros/multa, extenso, numero curto do titulo', () => {
  const empresa = emitenteDaConfiguracao({ nomeOficina: 'Loja', cnpj: '11222333000181' });
  const cliente = parteDoCliente({ nome: 'Maria', documento: '16713928684' });
  const r = montarRecibo({ titulo: { id: 'hs2br8fI13zZNYaYLFjX', descricao: 'Venda Direta #0044 - Pagamento a Prazo', valorCentavos: 1880, formaPagamento: 'Pix', dataPagamento: '2026-10-07' }, acrescimoCentavos: 64, empresa, cliente, mensagem: 'Obrigado.' });
  assert.equal(r.valorCentavos, 1944);
  assert.equal(r.valorExtenso, 'dezenove reais e quarenta e quatro centavos');
  assert.equal(r.numero, 'AYLFJX');
  assert.equal(r.acrescimoCentavos, 64);
  assert.equal(r.referente, 'Venda Direta #0044 - Pagamento a Prazo');
});
