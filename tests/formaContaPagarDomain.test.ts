import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formaDoTitulo,
  grupoDaForma,
  montarDocumentoContasPagar,
  passaNoFiltroDeForma,
  resumoAPagarPorForma,
  rotuloDaFormaDoTitulo,
  SEM_FORMA,
  textoDoResumoPorForma,
} from '../src/utils/formaContaPagarDomain';

test('forma do título: pago usa a da baixa; em aberto usa a prevista; sem nenhuma fica vazio', () => {
  assert.equal(formaDoTitulo({ status: 'Paga', formaPagamento: 'Pix', formaPagamentoPrevista: 'Boleto' }), 'Pix');
  assert.equal(formaDoTitulo({ status: 'Pendente', formaPagamento: 'Pix', formaPagamentoPrevista: 'Boleto' }), 'Boleto');
  assert.equal(formaDoTitulo({ status: 'Pendente', formaPagamento: 'Cheque' }), 'Cheque');
  assert.equal(formaDoTitulo({ status: 'Pendente' }), '');
});

test('grupo do filtro junta os nomes diferentes da mesma forma', () => {
  assert.equal(grupoDaForma('Pix'), 'PIX');
  assert.equal(grupoDaForma('PIX'), 'PIX');
  assert.equal(grupoDaForma('Cartão de Crédito'), 'Cartão');
  assert.equal(grupoDaForma('Cartão'), 'Cartão');
  assert.equal(grupoDaForma('Transferência'), 'Transferência');
  assert.equal(grupoDaForma('Acerto com Fornecedor'), 'Outros');
  assert.equal(grupoDaForma(''), '');
});

test('filtro por forma: vazio passa tudo; título sem forma só passa em "Todas"', () => {
  assert.equal(passaNoFiltroDeForma({ status: 'Pendente', formaPagamentoPrevista: 'Boleto' }, 'Boleto'), true);
  assert.equal(passaNoFiltroDeForma({ status: 'Pendente', formaPagamentoPrevista: 'Boleto' }, 'Cheque'), false);
  assert.equal(passaNoFiltroDeForma({ status: 'Paga', formaPagamento: 'Pix' }, 'PIX'), true);
  assert.equal(passaNoFiltroDeForma({ status: 'Pendente' }, ''), true);
  assert.equal(passaNoFiltroDeForma({ status: 'Pendente' }, 'Outros'), false);
});

test('coluna Forma: cheque com número e banco; sem forma mostra traço', () => {
  assert.equal(rotuloDaFormaDoTitulo({ status: 'Pendente', formaPagamento: 'Cheque', bancoNome: 'SICOOB', cheque: { numeroCheque: '123' } }), 'Cheque nº 123 · SICOOB');
  assert.equal(rotuloDaFormaDoTitulo({ status: 'Pendente', formaPagamento: 'Cheque', cheque: { bancoEmissor: 'ITAU' } }), 'Cheque · ITAU');
  assert.equal(rotuloDaFormaDoTitulo({ status: 'Pendente', formaPagamentoPrevista: 'Boleto' }), 'Boleto');
  assert.equal(rotuloDaFormaDoTitulo({ status: 'Pendente' }), '—');
});

test('resumo a pagar por forma: só em aberto, na ordem das formas, sem forma por último', () => {
  const resumo = resumoAPagarPorForma([
    { status: 'Pendente', formaPagamento: 'Cheque', valor: 50 },
    { status: 'Pendente', formaPagamentoPrevista: 'Boleto', valor: 100.1 },
    { status: 'Pendente', formaPagamentoPrevista: 'Boleto', valor: 0.2 },
    { status: 'Pendente', valor: 7 },
    { status: 'Paga', formaPagamento: 'Boleto', valor: 999 },
    { status: 'Cancelada', formaPagamento: 'Cheque', valor: 999 },
  ]);
  assert.deepEqual(resumo, [
    { forma: 'Boleto', quantidade: 2, centavos: 10030 },
    { forma: 'Cheque', quantidade: 1, centavos: 5000 },
    { forma: SEM_FORMA, quantidade: 1, centavos: 700 },
  ]);
  assert.match(textoDoResumoPorForma(resumo), /^Boleto R\$\s100,30 · Cheque R\$\s50,00 · Sem forma informada R\$\s7,00$/);
  assert.deepEqual(resumoAPagarPorForma([]), []);
});

test('relatório: títulos por vencimento com a coluna Forma e o resumo por forma', () => {
  const documento = montarDocumentoContasPagar([
    { id: 'b', status: 'Pendente', data: '2026-12-10', descricao: 'NF 2', formaPagamento: 'Cheque', cheque: { numeroCheque: '9' }, bancoNome: 'ITAU', valor: 50 },
    { id: 'a', status: 'Pendente', data: '2026-11-10', descricao: 'NF 1', formaPagamentoPrevista: 'Boleto', valor: 100 },
    { id: 'c', status: 'Paga', data: '2026-11-01', dataPagamento: '2026-11-02', descricao: 'NF 0', formaPagamento: 'Pix', valor: 10 },
  ], { filtrosAplicados: ['Forma de pagamento: Todas'], periodo: 'Qualquer data', dataHoje: '2026-11-24' });
  assert.equal(documento.titulo, 'Contas a Pagar');
  const [titulos, porForma] = documento.secoes;
  assert.deepEqual(titulos.linhas.map((l: { id: string }) => l.id), ['c', 'a', 'b']);
  const coluna = (id: string) => titulos.colunas.find((c) => c.id === id);
  assert.equal(coluna('forma')?.valor(titulos.linhas[2]), 'Cheque nº 9 · ITAU');
  assert.equal(coluna('situacao')?.valor(titulos.linhas[1]), 'Vencida');
  assert.equal(coluna('pagoEm')?.valor(titulos.linhas[0]), '02/11/2026');
  assert.deepEqual(porForma.linhas, [
    { forma: 'Boleto', quantidade: 1, centavos: 10000 },
    { forma: 'Cheque', quantidade: 1, centavos: 5000 },
  ]);
  assert.match(documento.indicadores[2].valor, /150,00/);
});
