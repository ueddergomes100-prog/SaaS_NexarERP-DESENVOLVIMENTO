import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIMITE_MENSAGEM_PADRAO,
  MENSAGENS_PADRAO_VAZIAS,
  informacoesComplementaresComMensagem,
  mensagemDoDocumento,
  parseMensagensPadrao,
} from '../src/utils/mensagensPadraoDomain';

test('parse: vazio ou lixo vira tudo em branco; textos sao aparados e limitados', () => {
  assert.deepEqual(parseMensagensPadrao(undefined), MENSAGENS_PADRAO_VAZIAS);
  assert.deepEqual(parseMensagensPadrao('x'), MENSAGENS_PADRAO_VAZIAS);
  const p = parseMensagensPadrao({ recibo: '  Volte sempre!  ', orcamento: 'a'.repeat(LIMITE_MENSAGEM_PADRAO + 50), notaFiscal: 'Linha 1\r\nLinha 2', extra: 'ignorado' });
  assert.equal(p.recibo, 'Volte sempre!');
  assert.equal(p.orcamento.length, LIMITE_MENSAGEM_PADRAO);
  assert.equal(p.notaFiscal, 'Linha 1\nLinha 2');
  assert.equal(p.minuta, '');
});

test('mensagem do documento le direto da configuracao da filial', () => {
  assert.equal(mensagemDoDocumento({ mensagensPadrao: { minuta: 'Confira a mercadoria na entrega.' } }, 'minuta'), 'Confira a mercadoria na entrega.');
  assert.equal(mensagemDoDocumento(null, 'recibo'), '');
  assert.equal(mensagemDoDocumento({}, 'carne'), '');
});

test('informacoes complementares: mensagem da filial primeiro, quebras viram espaco, partes vazias somem', () => {
  assert.equal(
    informacoesComplementaresComMensagem('Troca em até 7 dias\ncom a nota.', ['Pedido de venda nº 10.', '', false, 'DOCUMENTO EMITIDO POR ME.']),
    'Troca em até 7 dias com a nota. Pedido de venda nº 10. DOCUMENTO EMITIDO POR ME.',
  );
  assert.equal(informacoesComplementaresComMensagem('', ['Pedido de venda nº 10.']), 'Pedido de venda nº 10.');
  assert.equal(informacoesComplementaresComMensagem('', []), '');
});
