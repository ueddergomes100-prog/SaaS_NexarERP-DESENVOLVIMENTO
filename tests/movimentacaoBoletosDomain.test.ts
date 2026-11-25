import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gravidadeDoRetorno,
  movimentacaoPorDia,
  tituloDoRetorno,
  type BoletoPagoDaMovimentacao,
  type ResumoDoRetorno,
} from '../src/utils/movimentacaoBoletosDomain';

const boleto = (dados: Partial<BoletoPagoDaMovimentacao> & { id: string }): BoletoPagoDaMovimentacao => ({
  clienteNome: 'CLIENTE', descricao: '', nossoNumero: '', dataPagamento: '2026-11-23', valorCentavos: 100, valorPagoCentavos: 100, bancoNome: 'SICOOB', ...dados,
});

test('movimentacao: um dia por data de pagamento, mais recente primeiro, total pelo valor pago', () => {
  const dias = movimentacaoPorDia([
    boleto({ id: 'a', clienteNome: 'JULIANA', dataPagamento: '2026-11-23', valorCentavos: 28145, valorPagoCentavos: 29078 }),
    boleto({ id: 'b', clienteNome: 'BRUNO', dataPagamento: '2026-11-23', valorCentavos: 127421, valorPagoCentavos: 0 }),
    boleto({ id: 'c', dataPagamento: '2026-11-25', valorPagoCentavos: 500 }),
    boleto({ id: 'd', dataPagamento: '' }),
  ]);
  assert.deepEqual(dias.map((d) => d.data), ['2026-11-25', '2026-11-23', '']);
  assert.deepEqual(dias[1].boletos.map((b) => b.id), ['b', 'a'], 'clientes em ordem alfabetica');
  assert.equal(dias[1].totalPagoCentavos, 29078 + 127421, 'sem valor pago gravado vale o do titulo');
});

const resumo = (dados: Partial<ResumoDoRetorno>): ResumoDoRetorno => ({ baixados: [], naoEncontrados: [], jaPagos: 0, recusados: [], avulsosLancados: 0, ...dados });
const baixa = { clienteNome: 'X', nossoNumero: '1', dataPagamento: '2026-11-23', valorPagoCentavos: 100, acrescimoCentavos: 0, descontoCentavos: 0 };

test('fim do retorno: nada baixado e nada encontrado e aviso, nunca sucesso (o caso da Embala Minas)', () => {
  const nada = resumo({ naoEncontrados: ['3773-9', '3861-2'] });
  assert.equal(gravidadeDoRetorno(nada), 'aviso');
  assert.equal(tituloDoRetorno(nada), 'Nenhum boleto foi baixado');
  assert.equal(gravidadeDoRetorno(resumo({ baixados: [baixa] })), 'sucesso');
  assert.equal(gravidadeDoRetorno(resumo({ jaPagos: 10 })), 'sucesso', 'mesmo arquivo de novo: nada a fazer, sem erro');
  const parte = resumo({ baixados: [baixa], naoEncontrados: ['9'] });
  assert.equal(gravidadeDoRetorno(parte), 'aviso');
  assert.equal(tituloDoRetorno(parte), '1 boleto(s) baixado(s); 1 não encontrado(s)');
  assert.equal(gravidadeDoRetorno(resumo({ baixados: [baixa], recusados: ['cancelado'] })), 'aviso');
});
