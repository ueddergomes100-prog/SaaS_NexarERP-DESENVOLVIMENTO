import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cfopParaDestino,
  destinatarioEConsumidorFinal,
  meioPagamentoNota,
  montarItemNotaFiscal,
  montarPagamentosNota,
  produtoFiscalDoCadastro,
  resolverGtin,
  somarTributos,
  textoTributosAproximados,
  totaisImpostosDosItens,
  type ContextoNota,
  type ProdutoFiscal,
} from '../src/utils/notaFiscalItemDomain';

// Produto da NF-e real que motivou a revisao (Sol Life, 2026-09-30): FARINHA DE AVEIA 500G,
// como o ERP antigo mandava -- CSOSN 102, PIS/COFINS 99, IPI 99/999, GTIN, 13,45% de tributos.
const farinha: ProdutoFiscal = {
  nome: 'FARINHA DE AVEIA 500G',
  codigo: '0028',
  ncm: '11041200',
  cfop: '5102',
  origem: '0',
  csosn: '102',
  cstPis: '99',
  cstCofins: '99',
  cstIpi: '99',
  codigoBarras: '7898945717236',
  percentualTributos: 13.45,
};
const simplesInterno: ContextoNota = { regime: 'simples_nacional', interestadual: false };

const montar = (produto: ProdutoFiscal, venda = { quantidade: 5, precoUnitario: 6.6, desconto: 1.34, unidadeSigla: 'UN' }, contexto: ContextoNota = simplesInterno) => {
  const r = montarItemNotaFiscal({ produto, venda, contexto, codigoItem: produto.codigo || 'X' });
  if (!r.ok) throw new Error(r.erro);
  return r;
};

test('item do Simples sai igual ao do ERP antigo: GTIN, CSOSN 102, PIS/COFINS 99, IPI 99 com cEnq 999, tributos', () => {
  const r = montar(farinha);
  const it = r.item as Record<string, any>;
  assert.equal(it.code, '0028');
  assert.equal(it.gtinCode, '7898945717236');
  assert.equal(it.cfop, 5102);
  assert.equal(it.unit, 'UN');
  assert.equal(it.quantityTax, 5);
  assert.equal(it.totalAmount, 33);
  assert.equal(it.discountAmount, 1.34);
  assert.deepEqual(it.taxes.icms, { origin: 0, csosn: 102 });
  assert.deepEqual(it.taxes.pis, { cst: 99, baseTax: 31.66, rate: 0, amount: 0 });
  assert.deepEqual(it.taxes.cofins, { cst: 99, baseTax: 31.66, rate: 0, amount: 0 });
  assert.deepEqual(it.taxes.ipi, { cst: 99, classificationCode: '999', baseTax: 31.66, rate: 0, amount: 0 });
  // 31,66 x 13,45% = 4,26 -- exatamente o "Valor Aproximado dos Tributos" da nota do ERP antigo.
  assert.equal(it.taxes.totalTax, 4.26);
  assert.equal(r.tributos.total, 4.26);
  assert.deepEqual(r.avisos, []);
});

test('sem codigo de barras valido vai SEM GTIN; unidade da venda (KG, CX) vai na nota', () => {
  const it = montar({ ...farinha, codigoBarras: '123' }, { quantidade: 2.5, precoUnitario: 10, desconto: 0, unidadeSigla: 'kg' }).item as Record<string, any>;
  assert.equal(it.gtinCode, 'SEM GTIN');
  assert.equal(it.unit, 'KG');
  assert.equal(it.unitTax, 'KG');
  assert.equal(it.discountAmount, undefined);
});

test('sem unidade: vai UN e avisa (regra 4 do CLAUDE.md)', () => {
  const r = montar(farinha, { quantidade: 1, precoUnitario: 10, desconto: 0, unidadeSigla: '' });
  assert.equal((r.item as Record<string, unknown>).unit, 'UN');
  assert.ok(r.avisos.some((a) => a.includes('sem unidade')));
});

test('sem % de tributos: nao manda totalTax e avisa', () => {
  const r = montar({ ...farinha, percentualTributos: undefined });
  assert.equal((r.item as Record<string, any>).taxes.totalTax, undefined);
  assert.ok(r.avisos.some((a) => a.includes('IBPT')));
});

test('PIS/COFINS em branco no Simples usa 99; no regime normal barra', () => {
  const simples = montar({ ...farinha, cstPis: '', cstCofins: '' }).item as Record<string, any>;
  assert.equal(simples.taxes.pis.cst, 99);
  const normal = montarItemNotaFiscal({
    produto: { ...farinha, csosn: '00', aliquotaIcms: 18, cstPis: '' },
    venda: { quantidade: 1, precoUnitario: 10, desconto: 0, unidadeSigla: 'UN' },
    contexto: { regime: 'lucro_real', interestadual: false },
    codigoItem: '1',
  });
  assert.equal(normal.ok, false);
  assert.match((normal as { erro: string }).erro, /sem CST de PIS/);
});

test('PIS/COFINS 04 a 09 vao so com o CST (sem base)', () => {
  const it = montar({ ...farinha, cstPis: '07', cstCofins: '06' }).item as Record<string, any>;
  assert.deepEqual(it.taxes.pis, { cst: 7 });
  assert.deepEqual(it.taxes.cofins, { cst: 6 });
});

test('cadastro incompleto barra com o nome do produto -- nunca inventa NCM/CSOSN', () => {
  const semNcm = montarItemNotaFiscal({ produto: { ...farinha, ncm: '' }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: simplesInterno, codigoItem: '1' });
  assert.equal(semNcm.ok, false);
  assert.match((semNcm as { erro: string }).erro, /FARINHA DE AVEIA 500G.*sem NCM/);

  const cstNoSimples = montarItemNotaFiscal({ produto: { ...farinha, csosn: '00' }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: simplesInterno, codigoItem: '1' });
  assert.equal(cstNoSimples.ok, false);
  assert.match((cstNoSimples as { erro: string }).erro, /não é um CSOSN do Simples Nacional/);

  const semCfop = montarItemNotaFiscal({ produto: { ...farinha, cfop: '' }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: simplesInterno, codigoItem: '1' });
  assert.equal(semCfop.ok, false);
});

test('CST 00 com aliquota zero barra (nota "tributada integralmente" sem ICMS destacado)', () => {
  const r = montarItemNotaFiscal({
    produto: { ...farinha, csosn: '00', aliquotaIcms: 0, cstPis: '01', cstCofins: '01' },
    venda: { quantidade: 20, precoUnitario: 5.4, desconto: 0, unidadeSigla: 'UN' },
    contexto: { regime: 'lucro_real', interestadual: false },
    codigoItem: '40',
  });
  assert.equal(r.ok, false);
  assert.match((r as { erro: string }).erro, /CST 00.*alíquota de ICMS zerada/);
});

test('regime normal: ICMS destacado sobre (valor - desconto), com reducao no CST 20; CST 60 so o codigo', () => {
  const lr: ContextoNota = { regime: 'lucro_presumido', interestadual: false };
  const cst00 = montar({ ...farinha, csosn: '00', aliquotaIcms: 18, cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3, cstIpi: '' }, { quantidade: 10, precoUnitario: 10, desconto: 10, unidadeSigla: 'UN' }, lr).item as Record<string, any>;
  assert.deepEqual(cst00.taxes.icms, { origin: 0, cst: 0, baseTaxModality: 3, baseTax: 90, rate: 18, amount: 16.2 });
  assert.deepEqual(cst00.taxes.pis, { cst: 1, baseTax: 90, rate: 0.65, amount: 0.59 });
  assert.equal(cst00.taxes.ipi, undefined);

  const cst20 = montar({ ...farinha, csosn: '20', aliquotaIcms: 18, reducaoBaseIcms: 50, cstPis: '01', cstCofins: '01' }, { quantidade: 10, precoUnitario: 100, desconto: 0, unidadeSigla: 'UN' }, lr).item as Record<string, any>;
  assert.equal(cst20.taxes.icms.baseTax, 500);
  assert.equal(cst20.taxes.icms.amount, 90);

  const cst60 = montar({ ...farinha, csosn: '60', cstPis: '01', cstCofins: '01' }, undefined, lr).item as Record<string, any>;
  assert.deepEqual(cst60.taxes.icms, { origin: 0, cst: 60 });
});

test('ST calculada na nota (CSOSN 201/202, CST 10/30/70) barra em vez de sair errado', () => {
  for (const csosn of ['201', '202']) {
    const r = montarItemNotaFiscal({ produto: { ...farinha, csosn }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: simplesInterno, codigoItem: '1' });
    assert.equal(r.ok, false);
  }
  const r = montarItemNotaFiscal({ produto: { ...farinha, csosn: '10', cstPis: '01', cstCofins: '01' }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: { regime: 'lucro_real', interestadual: false }, codigoItem: '1' });
  assert.equal(r.ok, false);
});

test('CSOSN 101 leva o credito do Simples (aliquota do cadastro)', () => {
  const it = montar({ ...farinha, csosn: '101', aliquotaIcms: 2.5 }, { quantidade: 1, precoUnitario: 100, desconto: 0, unidadeSigla: 'UN' }).item as Record<string, any>;
  assert.deepEqual(it.taxes.icms, { origin: 0, csosn: 101, snCreditRate: 2.5, snCreditAmount: 2.5 });
  const semAliquota = montarItemNotaFiscal({ produto: { ...farinha, csosn: '101' }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: simplesInterno, codigoItem: '1' });
  assert.equal(semAliquota.ok, false);
});

test('IPI: CST fora da tabela de saida barra; aliquota > 0 barra (nao somamos IPI no valor da venda)', () => {
  const cstErrado = montarItemNotaFiscal({ produto: { ...farinha, cstIpi: '01' }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: simplesInterno, codigoItem: '1' });
  assert.equal(cstErrado.ok, false);
  const comAliquota = montarItemNotaFiscal({ produto: { ...farinha, cstIpi: '50', aliquotaIpi: 10 }, venda: { quantidade: 1, precoUnitario: 1, desconto: 0 }, contexto: simplesInterno, codigoItem: '1' });
  assert.equal(comAliquota.ok, false);
  const naoTributado = montar({ ...farinha, cstIpi: '53', enquadramentoIpi: '301' }).item as Record<string, any>;
  assert.deepEqual(naoTributado.taxes.ipi, { cst: 53, classificationCode: '301' });
});

test('CEST e cBenef vao quando o cadastro tem; IBS/CBS com CST antigo de 2 digitos nao vai', () => {
  const it = montar({ ...farinha, cest: '1703100', beneficioFiscal: 'MG000001', cstIbs: '01' }).item as Record<string, any>;
  assert.equal(it.cest, '1703100');
  assert.equal(it.taxBenefitCode, 'MG000001');
  assert.equal(it.taxes.ibsCbs, undefined);
});

test('venda para outro estado troca o CFOP (5102 -> 6102, 5405 -> 6404) e volta no interno', () => {
  assert.equal(cfopParaDestino('5102', true), '6102');
  assert.equal(cfopParaDestino('5405', true), '6404');
  assert.equal(cfopParaDestino('5929', true), '6929');
  assert.equal(cfopParaDestino('6102', false), '5102');
  assert.equal(cfopParaDestino('6404', false), '5405');
  assert.equal(cfopParaDestino('5102', false), '5102');
  const it = montar(farinha, undefined, { regime: 'simples_nacional', interestadual: true }).item as Record<string, any>;
  assert.equal(it.cfop, 6102);
});

test('produto com ST vendido para outro estado: sem CFOP interestadual no cadastro barra; com ele, usa CFOP e CSOSN interestaduais', () => {
  const granolaSt: ProdutoFiscal = { ...farinha, cfop: '5405', csosn: '500', cest: '1703100' };
  const inter: ContextoNota = { regime: 'simples_nacional', interestadual: true };
  const sem = montarItemNotaFiscal({ produto: granolaSt, venda: { quantidade: 1, precoUnitario: 10, desconto: 0, unidadeSigla: 'UN' }, contexto: inter, codigoItem: '1' });
  assert.equal(sem.ok, false);
  assert.match((sem as { erro: string }).erro, /substituição tributária.*CFOP interestadual/);

  // Como o ERP antigo da Sol Life fazia para ES/RJ: 6102 com CSOSN 102.
  const com = montar({ ...granolaSt, cfopInterestadual: '6102', csosnInterestadual: '102' }, undefined, inter).item as Record<string, any>;
  assert.equal(com.cfop, 6102);
  assert.deepEqual(com.taxes.icms, { origin: 0, csosn: 102 });

  // Dentro do estado, o CFOP/CSOSN interestadual nao interfere.
  const interno = montar({ ...granolaSt, cfopInterestadual: '6102', csosnInterestadual: '102' }).item as Record<string, any>;
  assert.equal(interno.cfop, 5405);
  assert.deepEqual(interno.taxes.icms, { origin: 0, csosn: 500 });

  const cfopErrado = montarItemNotaFiscal({ produto: { ...granolaSt, cfopInterestadual: '5102' }, venda: { quantidade: 1, precoUnitario: 10, desconto: 0 }, contexto: inter, codigoItem: '1' });
  assert.equal(cfopErrado.ok, false);
});

test('GTIN so passa com digito verificador valido', () => {
  assert.equal(resolverGtin('7898945717236'), '7898945717236');
  assert.equal(resolverGtin('7898945717237'), 'SEM GTIN');
  assert.equal(resolverGtin(''), 'SEM GTIN');
});

test('consumidor final: CPF sim; CNPJ com IE nao; CNPJ sem IE ou ISENTO sim', () => {
  assert.equal(destinatarioEConsumidorFinal({ documento: '123.456.789-09' }), true);
  assert.equal(destinatarioEConsumidorFinal({ documento: '17.926.066/0001-00', inscricaoEstadual: '0012345678' }), false);
  assert.equal(destinatarioEConsumidorFinal({ documento: '17926066000100', inscricaoEstadual: '' }), true);
  assert.equal(destinatarioEConsumidorFinal({ documento: '17926066000100', inscricaoEstadual: 'ISENTO' }), true);
});

test('pagamentos: meio real, agrupado; soma diferente do valor da nota cai em "outros" com o valor da nota', () => {
  assert.equal(meioPagamentoNota('Boleto'), 'billetBanking');
  assert.equal(meioPagamentoNota('Pagamento a Prazo'), 'storeCredit');
  assert.equal(meioPagamentoNota('Cartão de Crédito'), 'creditCard');
  assert.deepEqual(
    montarPagamentosNota([{ formaPagamento: 'Pix', valor: 30 }, { formaPagamento: 'Dinheiro', valor: 10 }, { formaPagamento: 'Pix', valor: 5.5 }], 45.5),
    [{ method: 'pix', amount: 35.5 }, { method: 'money', amount: 10 }],
  );
  assert.deepEqual(montarPagamentosNota([{ formaPagamento: 'Pix', valor: 30 }], 45.5), [{ method: 'other', amount: 45.5 }]);
  assert.deepEqual(montarPagamentosNota([], 10), [{ method: 'other', amount: 10 }]);
});

test('texto da Lei 12.741: por esfera quando separado, total quando nao', () => {
  const separado = somarTributos([{ federal: 1, estadual: 2, municipal: 0, total: 3 }, { federal: 0.5, estadual: 0.5, municipal: 0, total: 1 }]);
  assert.match(textoTributosAproximados(separado, 40), /R\$\s1,50 federais, R\$\s2,50 estaduais e R\$\s0,00 municipais \(10,00%\)\. Fonte: IBPT\./);
  assert.match(textoTributosAproximados({ federal: 0, estadual: 0, municipal: 0, total: 4.26 }, 31.66), /R\$\s4,26 \(13,46%\)/);
  assert.equal(textoTributosAproximados({ federal: 0, estadual: 0, municipal: 0, total: 0 }, 10), '');
});

test('totais de impostos somam os itens', () => {
  const a = montar({ ...farinha, csosn: '00', aliquotaIcms: 18, cstPis: '01', aliquotaPis: 1, cstCofins: '01', aliquotaCofins: 3, cstIpi: '' }, { quantidade: 1, precoUnitario: 100, desconto: 0, unidadeSigla: 'UN' }, { regime: 'lucro_real', interestadual: false }).item;
  const t = totaisImpostosDosItens([a, a]);
  assert.deepEqual(t, { icmsBaseTax: 200, icmsAmount: 36, pisAmount: 2, cofinsAmount: 6, totalTax: 26.9 });
});

test('produtoFiscalDoCadastro le campos da raiz ou do bloco fiscal antigo, e o GTIN da embalagem vendida', () => {
  const p = produtoFiscalDoCadastro({
    nome: 'GRANOLA', codigo: '7', fiscal: { ncm: '19042000', cfopPadraoSaida: '5405', csosnCst: '500', cest: '1703100' },
    codigoBarras: '7898945717236',
    embalagens: [{ id: 'cx', codigoBarras: '17898945717233' }],
    percentualTributos: 23.06,
  }, { embalagemId: 'cx' });
  assert.equal(p.ncm, '19042000');
  assert.equal(p.cfop, '5405');
  assert.equal(p.csosn, '500');
  assert.equal(p.cest, '1703100');
  assert.equal(p.codigoBarras, '17898945717233');
  assert.equal(p.percentualTributos, 23.06);
  assert.equal(p.percentualTributosFederal, undefined);
});
