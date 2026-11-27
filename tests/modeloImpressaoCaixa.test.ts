import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELOS_IMPRESSAO_CAIXA, modeloDeImpressaoDoCaixa, PEDIDO_PRINT_MODELS } from '../src/utils/pedidoPrintModels';

test('modelo de impressao do caixa: cupom por padrao, ou um modelo do Pedido de Venda', () => {
  assert.equal(modeloDeImpressaoDoCaixa(undefined), 'cupom');
  assert.equal(modeloDeImpressaoDoCaixa({}), 'cupom');
  assert.equal(modeloDeImpressaoDoCaixa({ modeloImpressaoCaixa: 'meia-folha' }), 'meia-folha');
  assert.equal(modeloDeImpressaoDoCaixa({ modeloImpressaoCaixa: 'pre-venda-simples' }), 'pre-venda-simples');
  assert.equal(modeloDeImpressaoDoCaixa({ modeloImpressaoCaixa: 'qualquer' }), 'cupom', 'valor estranho volta ao cupom');
  assert.equal(MODELOS_IMPRESSAO_CAIXA.length, PEDIDO_PRINT_MODELS.length + 1, 'todos os modelos do pedido + o cupom');
});
