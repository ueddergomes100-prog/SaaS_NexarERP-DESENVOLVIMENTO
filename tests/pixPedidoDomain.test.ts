import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  crc16Pix,
  montarPixCopiaECola,
  normalizarChavePix,
  parseConfigPixPedido,
  qrPixDoPedido,
  valorDoPixDoPedido,
} from '../src/utils/pixPedidoDomain';

/* QR Code Pix no pedido impresso (23/11/2026). */

/** Le o BR Code campo a campo (id de 2 digitos, tamanho de 2 digitos, valor). */
const lerCampos = (texto: string): Record<string, string> => {
  const campos: Record<string, string> = {};
  let i = 0;
  while (i < texto.length) {
    const id = texto.slice(i, i + 2);
    const tamanho = Number(texto.slice(i + 2, i + 4));
    assert.ok(Number.isInteger(tamanho), `tamanho invalido em ${i}`);
    campos[id] = texto.slice(i + 4, i + 4 + tamanho);
    i += 4 + tamanho;
  }
  assert.equal(i, texto.length, 'os tamanhos fecham exatamente com o texto');
  return campos;
};

test('CRC16 do BR Code: valor de referencia do CCITT e o exemplo oficial do manual do Pix', () => {
  assert.equal(crc16Pix('123456789'), '29B1');
  const exemploDoManual = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16Pix(exemploDoManual), '1D3D');
});

test('copia e cola: campos do Banco Central, valor com ponto e 2 casas, nome e cidade sem acento, CRC no fim', () => {
  const pix = montarPixCopiaECola({ chave: '11044333000139', nome: 'Embala Minas Comércio de Embalagens Ltda', cidade: 'Manhuaçu', valorCentavos: 82320, identificador: 'PEDIDO0008' });
  const campos = lerCampos(pix);
  assert.equal(campos['00'], '01');
  assert.equal(campos['01'], '11');
  assert.deepEqual(lerCampos(campos['26']), { '00': 'br.gov.bcb.pix', '01': '11044333000139' });
  assert.equal(campos['52'], '0000');
  assert.equal(campos['53'], '986', 'real');
  assert.equal(campos['54'], '823.20');
  assert.equal(campos['58'], 'BR');
  assert.equal(campos['59'], 'EMBALA MINAS COMERCIO DE', 'maximo 25, sem acento');
  assert.equal(campos['60'], 'MANHUACU');
  assert.deepEqual(lerCampos(campos['62']), { '05': 'PEDIDO0008' });
  assert.equal(campos['63'], crc16Pix(pix.slice(0, -4)));
  assert.equal(montarPixCopiaECola({ chave: 'x', nome: 'A', cidade: 'B', valorCentavos: 5, identificador: '' }).includes('5404' + '0.05'), true, 'centavo');
  assert.equal(lerCampos(lerCampos(montarPixCopiaECola({ chave: 'x', nome: 'A', cidade: 'B', valorCentavos: 100, identificador: '#' }))['62'])['05'], '***', 'sem identificador valido vale ***');
});

test('chave Pix: CNPJ, CPF, e-mail, telefone e aleatoria; o resto e recusado em portugues', () => {
  assert.deepEqual(normalizarChavePix('11.044.333/0001-39'), { chave: '11044333000139', tipo: 'cnpj' });
  assert.deepEqual(normalizarChavePix('123.456.789-09'), { chave: '12345678909', tipo: 'cpf' });
  assert.deepEqual(normalizarChavePix(' Financeiro@EmbalaMinas.com.br '), { chave: 'financeiro@embalaminas.com.br', tipo: 'email' });
  assert.deepEqual(normalizarChavePix('+55 (33) 98405-6920'), { chave: '+5533984056920', tipo: 'telefone' });
  assert.deepEqual(normalizarChavePix('(33) 98405-6920'), { chave: '+5533984056920', tipo: 'telefone' });
  assert.deepEqual(normalizarChavePix('123E4567-E12B-12D1-A456-426655440000'), { chave: '123e4567-e12b-12d1-a456-426655440000', tipo: 'aleatoria' });
  assert.match(String((normalizarChavePix('12345') as { erro: string }).erro), /não reconhecida/);
  assert.match(String((normalizarChavePix('fulano@') as { erro: string }).erro), /incompleta/);
  assert.match(String((normalizarChavePix('') as { erro: string }).erro), /Informe/);
});

test('so o que falta pagar: pre-venda = total; venda = so o a prazo; pago na hora, boleto ou cancelada = sem QR', () => {
  assert.equal(valorDoPixDoPedido({ status: 'Pré-venda', valorTotalCentavos: 82320 }), 82320);
  assert.equal(valorDoPixDoPedido({ status: 'Em Análise', valorTotal: 50 }), 5000);
  assert.equal(valorDoPixDoPedido({ status: 'Finalizada', valorTotalCentavos: 82320, pagamentos: [{ formaPagamento: 'Dinheiro', status: 'confirmado', valorCentavos: 82320 }] }), 0, 'pago em dinheiro');
  assert.equal(valorDoPixDoPedido({ status: 'Finalizada', pagamentos: [{ formaPagamento: 'Cartão de Crédito', status: 'pendente', valorCentavos: 1000 }] }), 0, 'cartao ja foi pago pelo cliente');
  assert.equal(valorDoPixDoPedido({ status: 'Finalizada', pagamentos: [
    { formaPagamento: 'Dinheiro', status: 'confirmado', valorCentavos: 2000 },
    { formaPagamento: 'Boleto', status: 'pendente', valorCentavos: 30000 },
    { formaPagamento: 'Boleto', status: 'pendente', valorCentavos: 30000 },
    { formaPagamento: 'Pagamento a Prazo', status: 'pendente', valor: 10.5 },
  ] }), 1050, 'o boleto o cliente paga pelo boleto: so o a prazo vai no QR (25/11/2026)');
  assert.equal(valorDoPixDoPedido({ status: 'Finalizada', pagamentos: [
    { formaPagamento: 'Boleto', status: 'pendente', valorCentavos: 38221 },
    { formaPagamento: 'Boleto', status: 'pendente', valorCentavos: 38221 },
  ] }), 0, 'venda so em boleto: sem QR');
  assert.equal(valorDoPixDoPedido({ status: 'Cancelada', valorTotalCentavos: 82320 }), 0);
  assert.equal(valorDoPixDoPedido({ status: 'Pré-venda', valorTotalCentavos: 0 }), 0);
});

test('pre-venda com boleto combinado: a parte em boleto sai do QR; so boleto = sem QR', () => {
  assert.equal(valorDoPixDoPedido({ status: 'Pré-venda', valorTotalCentavos: 100000, pagamentos: [{ formaPagamento: 'Boleto', valor: 1000 }] }), 0);
  assert.equal(valorDoPixDoPedido({ status: 'Pré-venda', valorTotalCentavos: 100000, pagamentos: [
    { formaPagamento: 'Boleto', valorCentavos: 60000 },
    { formaPagamento: 'Pix', valorCentavos: 40000 },
  ] }), 40000);
  assert.equal(valorDoPixDoPedido({ status: 'Pré-venda', valorTotalCentavos: 100000, pagamentos: [{ formaPagamento: 'Dinheiro', valorCentavos: 100000 }] }), 100000, 'sem boleto: o total, como antes');
});

const embalaMinas = {
  nomeOficina: 'EMBALA MINAS',
  razaoSocial: 'EMBALA MINAS LTDA',
  cnpj: '11.044.333/0001-39',
  nfseCidadeNome: 'Manhuaçu',
  pixNoPedidoAtivo: true,
  pixNoPedidoChave: '',
};
const preVenda = { status: 'Pré-venda', numeroPedido: '0008', valorTotalCentavos: 82320 };

test('QR do pedido: desligado ou nada a pagar = nao sai; ligado = chave CNPJ (em branco), valor e numero do pedido', () => {
  assert.deepEqual(parseConfigPixPedido({}), { ativo: false, chave: '' });
  assert.equal(qrPixDoPedido({ ...embalaMinas, pixNoPedidoAtivo: false }, preVenda), null, 'comeca desligado');
  assert.equal(qrPixDoPedido(embalaMinas, { ...preVenda, status: 'Cancelada' }), null);

  const qr = qrPixDoPedido(embalaMinas, preVenda);
  assert.ok(qr && 'copiaECola' in qr);
  if (qr && 'copiaECola' in qr) {
    const campos = lerCampos(qr.copiaECola);
    assert.equal(lerCampos(campos['26'])['01'], '11044333000139', 'chave em branco = CNPJ da empresa');
    assert.equal(campos['54'], '823.20');
    assert.equal(campos['59'], 'EMBALA MINAS LTDA', 'razao social');
    assert.equal(campos['60'], 'MANHUACU');
    assert.equal(lerCampos(campos['62'])['05'], 'PEDIDO0008');
    assert.equal(qr.valorCentavos, 82320);
    assert.equal(qr.chaveParaMostrar, 'CNPJ 11.044.333/0001-39');
  }

  const comEmail = qrPixDoPedido({ ...embalaMinas, pixNoPedidoChave: 'pix@embalaminas.com.br' }, preVenda);
  assert.ok(comEmail && 'copiaECola' in comEmail && comEmail.chaveParaMostrar === 'pix@embalaminas.com.br');
});

test('QR do pedido: cadastro incompleto nao inventa nada, diz o que acertar (so na tela)', () => {
  const semCidade = qrPixDoPedido({ ...embalaMinas, nfseCidadeNome: '' }, preVenda);
  assert.match(String(semCidade && 'problema' in semCidade ? semCidade.problema : ''), /falta a cidade da empresa/);
  const semCnpj = qrPixDoPedido({ ...embalaMinas, cnpj: '' }, preVenda);
  assert.match(String(semCnpj && 'problema' in semCnpj ? semCnpj.problema : ''), /sem CNPJ e sem chave Pix/);
  const chaveRuim = qrPixDoPedido({ ...embalaMinas, pixNoPedidoChave: '123' }, preVenda);
  assert.match(String(chaveRuim && 'problema' in chaveRuim ? chaveRuim.problema : ''), /Chave Pix não reconhecida/);
  assert.equal(qrPixDoPedido({ ...embalaMinas, cidade: 'Manhuaçu', nfseCidadeNome: '' }, preVenda) !== null, true, 'cidade da filial tambem serve');
});
