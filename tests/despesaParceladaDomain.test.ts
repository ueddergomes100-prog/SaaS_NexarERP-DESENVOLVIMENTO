import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarChequesNasParcelas,
  erroDosCheques,
  montarChequeDaParcela,
  numerarCheques,
} from '../src/utils/chequeEmitidoDomain';
import { avisoDeSoma, erroDaDespesa, montarTitulosDaDespesa, type DadosDaDespesa } from '../src/utils/despesaParceladaDomain';
import { dividirEmParcelas } from '../src/utils/pagamentoEntradaDomain';

const bancos = [{ id: 'b1', nome: 'SICOOB' }, { id: 'b2', nome: 'ITAU' }];
const dados = (extra: Partial<DadosDaDespesa> = {}): DadosDaDespesa => ({ descricao: 'seguro caminhao', categoria: 'Seguros', forma: 'Boleto', ...extra });

test('numerar cheques: sequência com zeros, texto com sufixo, vazio vazio', () => {
  assert.deepEqual(numerarCheques('000123', 3), ['000123', '000124', '000125']);
  assert.deepEqual(numerarCheques('99', 3), ['99', '100', '101']);
  assert.deepEqual(numerarCheques('AB1', 3), ['AB1', 'AB1-2', 'AB1-3']);
  assert.deepEqual(numerarCheques('', 2), ['', '']);
  assert.deepEqual(numerarCheques('5', 0), []);
});

test('atalho aplica banco e numeração a todas as parcelas, sem apagar o que já tinha quando vier vazio', () => {
  const parcelas = dividirEmParcelas(300, 3, '2026-10-10', 30);
  const aplicadas = aplicarChequesNasParcelas(parcelas, 'b1', '100');
  assert.deepEqual(aplicadas.map((p) => [p.bancoId, p.numeroCheque]), [['b1', '100'], ['b1', '101'], ['b1', '102']]);
  const semMudar = aplicarChequesNasParcelas(aplicadas, '', '');
  assert.deepEqual(semMudar.map((p) => [p.bancoId, p.numeroCheque]), [['b1', '100'], ['b1', '101'], ['b1', '102']]);
});

test('cheque da parcela: banco, número e data obrigatórios, com mensagem que diz qual cheque', () => {
  const base = { numero: '2', vencimento: '2026-11-10', valor: 100, bancoId: 'b1', numeroCheque: '55' };
  const ok = montarChequeDaParcela(base, bancos);
  assert.equal(ok.bancoNome, 'SICOOB');
  assert.deepEqual(ok.cheque, { bancoEmissor: 'SICOOB', numeroCheque: '55', dataCompensacao: '2026-11-10' });
  assert.throws(() => montarChequeDaParcela({ ...base, bancoId: '' }, bancos), /Escolha o banco do cheque da parcela 2/);
  assert.throws(() => montarChequeDaParcela({ ...base, bancoId: 'zzz' }, bancos), /Escolha o banco/);
  assert.throws(() => montarChequeDaParcela({ ...base, numeroCheque: ' ' }, bancos), /Informe o número do cheque da parcela 2/);
  assert.throws(() => montarChequeDaParcela({ ...base, vencimento: '' }, bancos), /data de compensação/);
});

test('mesmo número de cheque no mesmo banco é recusado; em bancos diferentes passa', () => {
  const p = (numero: string, bancoId: string, numeroCheque: string) => ({ numero, vencimento: '2026-11-10', valor: 50, bancoId, numeroCheque });
  assert.match(String(erroDosCheques([p('1', 'b1', '10'), p('2', 'b1', '10')], bancos)), /aparece mais de uma vez/);
  assert.equal(erroDosCheques([p('1', 'b1', '10'), p('2', 'b2', '10')], bancos), null);
});

test('despesa: descrição, categoria, valor e parcelas são conferidos antes de lançar', () => {
  const parcelas = dividirEmParcelas(300, 3, '2026-10-10', 30);
  assert.equal(erroDaDespesa(dados(), parcelas, 300, bancos), null);
  assert.match(String(erroDaDespesa(dados({ descricao: ' ' }), parcelas, 300, bancos)), /descrição/);
  assert.match(String(erroDaDespesa(dados({ categoria: '' }), parcelas, 300, bancos)), /categoria/);
  assert.match(String(erroDaDespesa(dados(), parcelas, 0, bancos)), /valor da despesa/);
  assert.match(String(erroDaDespesa(dados(), [], 300, bancos)), /ao menos uma parcela/);
  // cheque sem banco/número trava
  assert.match(String(erroDaDespesa(dados({ forma: 'Cheque' }), parcelas, 300, bancos)), /Escolha o banco do cheque da parcela 1/);
  assert.equal(erroDaDespesa(dados({ forma: 'Cheque' }), aplicarChequesNasParcelas(parcelas, 'b1', '1'), 300, bancos), null);
});

test('soma que não fecha vira aviso (não erro)', () => {
  const parcelas = dividirEmParcelas(300, 3, '2026-10-10', 30);
  assert.equal(avisoDeSoma(parcelas, 300), null);
  assert.match(String(avisoDeSoma(parcelas, 310)), /faltam R\$ 10,00/);
});

test('boleto em 3 vezes: 3 títulos pendentes de saída, com descrição, grupo e sem campos de cheque', () => {
  const parcelas = dividirEmParcelas(100, 3, '2026-10-10', 30);
  const titulos = montarTitulosDaDespesa(dados({ fornecedorId: 'f1', fornecedorNome: 'SEGURADORA' }), parcelas, bancos, 'grp1');
  assert.equal(titulos.length, 3);
  assert.deepEqual(titulos.map((t) => t.valor), [33.34, 33.33, 33.33]);
  assert.equal(titulos[0].descricao, 'SEGURO CAMINHAO (Parcela 1/3)');
  assert.equal(titulos[0].categoria, 'SEGUROS');
  assert.deepEqual(titulos.map((t) => t.data), ['2026-10-10', '2026-11-09', '2026-12-09']);
  assert.equal(titulos[0].grupoParcelasId, 'grp1');
  assert.equal(titulos[0].parcela, 1);
  assert.equal(titulos[0].totalParcelas, 3);
  assert.equal(titulos[0].fornecedorNome, 'SEGURADORA');
  assert.equal(titulos[0].formaPagamentoPrevista, 'Boleto');
  assert.equal('cheque' in titulos[0], false);
  assert.equal('formaPagamento' in titulos[0], false);
  assert.equal(titulos[0].valorCentavos, 3334);
});

test('despesa à vista (1 parcela): sem sufixo de parcela e sem grupo; sem fornecedor não grava a chave', () => {
  const [titulo] = montarTitulosDaDespesa(dados(), dividirEmParcelas(50, 1, '2026-10-10'), bancos, 'g');
  assert.equal(titulo.descricao, 'SEGURO CAMINHAO');
  assert.equal('grupoParcelasId' in titulo, false);
  assert.equal('fornecedorId' in titulo, false);
});

test('despesa em 3 cheques: cada título leva o banco, o cheque, a data de compensação e forma Cheque', () => {
  const parcelas = aplicarChequesNasParcelas(dividirEmParcelas(300, 3, '2026-10-10', 30), 'b2', '700');
  const titulos = montarTitulosDaDespesa(dados({ forma: 'Cheque' }), parcelas, bancos, 'g');
  assert.deepEqual(titulos.map((t) => t.cheque?.numeroCheque), ['700', '701', '702']);
  assert.equal(titulos[1].formaPagamento, 'Cheque');
  assert.equal(titulos[1].bancoId, 'b2');
  assert.equal(titulos[1].bancoNome, 'ITAU');
  assert.equal(titulos[1].status, 'Pendente');
  assert.equal(titulos[1].data, '2026-11-09', 'o vencimento do título é o dia em que o cheque compensa');
  assert.equal(titulos[1].dataPrevistaRecebimento, '2026-11-09');
  assert.equal(titulos.some((t) => Object.values(t).includes(undefined)), false);
});

test('veículo e motorista da frota vão junto quando informados', () => {
  const [titulo] = montarTitulosDaDespesa(
    dados({ veiculoId: 'v1', veiculoNome: 'VW DELIVERY', veiculoPlaca: 'ABC1D23', motoristaId: 'm1', motoristaNome: 'JOSE' }),
    dividirEmParcelas(50, 1, '2026-10-10'), bancos, 'g',
  );
  assert.deepEqual([titulo.veiculoId, titulo.veiculoNome, titulo.veiculoPlaca, titulo.motoristaId, titulo.motoristaNome], ['v1', 'VW DELIVERY', 'ABC1D23', 'm1', 'JOSE']);
});
