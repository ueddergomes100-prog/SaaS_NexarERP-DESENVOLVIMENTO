import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  faixaQueJaCobre,
  lerPedidoDeInutilizacao,
  lerStatusInutilizacao,
  mensagemDeNumeroUsado,
  notasQueUsamAFaixa,
  textoDaFaixa,
} from '../src/utils/inutilizacaoDomain';

const MOTIVO = 'Quebra de sequência por falha antes do envio';
const erro = (corpo: unknown) => (lerPedidoDeInutilizacao(corpo) as { erro?: string }).erro || '';

test('pedido valido: numeros como texto, motivo sem espacos sobrando', () => {
  assert.deepEqual(
    lerPedidoDeInutilizacao({ modelo: 'nfce', serie: '1', inicial: '10', final: '12', motivo: `  ${MOTIVO}\n` }),
    { pedido: { modelo: 'nfce', serie: 1, inicial: 10, final: 12, motivo: MOTIVO } },
  );
  assert.ok('pedido' in lerPedidoDeInutilizacao({ modelo: 'nfe', serie: 0, inicial: 5, final: 5, motivo: MOTIVO }), 'serie 0 e um numero so');
});

test('pedido invalido: modelo, serie, faixa e motivo, em portugues', () => {
  assert.match(erro({ modelo: 'nfse', serie: 1, inicial: 1, final: 1, motivo: MOTIVO }), /NF-e ou de NFC-e/);
  assert.match(erro({ modelo: 'nfe', serie: '', inicial: 1, final: 1, motivo: MOTIVO }), /série/);
  assert.match(erro({ modelo: 'nfe', serie: 1000, inicial: 1, final: 1, motivo: MOTIVO }), /série/);
  assert.match(erro({ modelo: 'nfe', serie: 1, inicial: 0, final: 1, motivo: MOTIVO }), /inicial/);
  assert.match(erro({ modelo: 'nfe', serie: 1, inicial: 1.5, final: 2, motivo: MOTIVO }), /inicial/);
  assert.match(erro({ modelo: 'nfe', serie: 1, inicial: 9, final: 3, motivo: MOTIVO }), /antes do inicial/);
  assert.match(erro({ modelo: 'nfe', serie: 1, inicial: 1, final: 1001, motivo: MOTIVO }), /máximo é 1000/);
  assert.match(erro({ modelo: 'nfe', serie: 1, inicial: 1, final: 1, motivo: 'curto' }), /pelo menos 15/);
  assert.match(erro({ modelo: 'nfe', serie: 1, inicial: 1, final: 1, motivo: 'x'.repeat(256) }), /no máximo 255/);
});

test('numero usado: so nota do mesmo modelo, dentro da faixa, autorizada/cancelada/denegada', () => {
  const notas = [
    { tipo: 'NFC-e', number: 10, status: 'authorized', clienteNome: 'MARIA' },
    { tipo: 'NFC-e', number: 11, status: 'rejected' },
    { tipo: 'NF-e', number: 12, status: 'authorized' },
    { tipo: 'NFC-e', number: 13, status: 'canceled' },
    { tipo: 'NFC-e', number: 20, status: 'authorized' },
    { tipo: 'NFC-e', number: null, status: 'authorized' },
  ];
  const usadas = notasQueUsamAFaixa(notas, { modelo: 'nfce', inicial: 10, final: 15 });
  assert.deepEqual(usadas.map((n) => n.number), [10, 13]);
  assert.match(mensagemDeNumeroUsado(usadas, 'nfce'), /nº 10 \(autorizada, MARIA\); nº 13 \(cancelada\)/);
  assert.match(mensagemDeNumeroUsado(usadas, 'nfce'), /nota autorizada se cancela/);
});

test('faixa ja inutilizada ou em processamento cruza; rejeitada nao', () => {
  const registradas = [
    { modelo: 'nfe', serie: 1, inicial: 10, final: 15, status: 'registered' },
    { modelo: 'nfe', serie: 1, inicial: 30, final: 30, status: 'rejected' },
    { modelo: 'nfce', serie: 1, inicial: 40, final: 45, status: 'inProcessing' },
  ];
  assert.ok(faixaQueJaCobre(registradas, { modelo: 'nfe', serie: 1, inicial: 15, final: 20 }));
  assert.equal(faixaQueJaCobre(registradas, { modelo: 'nfe', serie: 2, inicial: 10, final: 10 }), null, 'outra serie');
  assert.equal(faixaQueJaCobre(registradas, { modelo: 'nfe', serie: 1, inicial: 30, final: 30 }), null, 'rejeitada pode tentar de novo');
  assert.ok(faixaQueJaCobre(registradas, { modelo: 'nfce', serie: 1, inicial: 1, final: 40 }));
});

test('status e texto da faixa', () => {
  assert.equal(lerStatusInutilizacao('registered'), 'registered');
  assert.equal(lerStatusInutilizacao('qualquer'), 'inProcessing');
  assert.equal(textoDaFaixa(5, 5), 'nº 5');
  assert.equal(textoDaFaixa(5, 9), 'nº 5 a 9');
});
