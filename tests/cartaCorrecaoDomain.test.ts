import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CARTA_MAX_POR_NOTA,
  cartasMaisNovasPrimeiro,
  erroDoTextoCarta,
  motivoQueImpedeCartaNaTela,
  normalizarTextoCarta,
  notaAceitaCartaCorrecao,
  type CartaEnviada,
} from '../src/utils/cartaCorrecaoDomain';

const carta = (n: number, enviadaEm = `2026-09-${String(n).padStart(2, '0')}T10:00:00.000Z`): CartaEnviada => ({
  eventId: `e${n}`, status: 'sent', texto: `carta ${n} com texto suficiente`, enviadaEm,
});

test('normaliza espacos e quebras de linha', () => {
  assert.equal(normalizarTextoCarta('  a   b\nc\t d '), 'a b c d');
});

test('texto: 14 caracteres nao passa, 15 passa, 1000 passa, 1001 nao passa', () => {
  assert.match(erroDoTextoCarta('x'.repeat(14)) ?? '', /pelo menos 15/);
  assert.equal(erroDoTextoCarta('x'.repeat(15)), null);
  assert.equal(erroDoTextoCarta('x'.repeat(1000)), null);
  assert.match(erroDoTextoCarta('x'.repeat(1001)) ?? '', /no máximo 1000/);
});

test('espaco extra nao conta pro tamanho (igual ao servidor)', () => {
  assert.notEqual(erroDoTextoCarta('a                    b'), null);
  assert.equal(erroDoTextoCarta('  ' + 'x'.repeat(15) + '  '), null);
});

test('so NF-e autorizada aceita carta', () => {
  assert.equal(notaAceitaCartaCorrecao({ tipo: 'NF-e', status: 'authorized' }), true);
  assert.equal(notaAceitaCartaCorrecao({ tipo: 'NF-e', status: 'rejected' }), false);
  assert.equal(notaAceitaCartaCorrecao({ tipo: 'NF-e', status: 'canceled' }), false);
  assert.equal(notaAceitaCartaCorrecao({ tipo: 'NFC-e', status: 'authorized' }), false);
  assert.equal(notaAceitaCartaCorrecao({ tipo: 'NFS-e', status: 'authorized' }), false);
});

test('motivo que impede: tipo, status e limite de 20', () => {
  assert.match(motivoQueImpedeCartaNaTela({ tipo: 'NFC-e', status: 'authorized' }) ?? '', /só para NF-e/);
  assert.match(motivoQueImpedeCartaNaTela({ tipo: 'NF-e', status: 'processing' }) ?? '', /autorizada/);
  assert.equal(motivoQueImpedeCartaNaTela({ tipo: 'NF-e', status: 'authorized' }), null);
  const dezenove = Array.from({ length: CARTA_MAX_POR_NOTA - 1 }, (_, i) => carta(i + 1));
  const vinte = Array.from({ length: CARTA_MAX_POR_NOTA }, (_, i) => carta(i + 1));
  assert.equal(motivoQueImpedeCartaNaTela({ tipo: 'NF-e', status: 'authorized', cartasCorrecao: dezenove }), null);
  assert.match(motivoQueImpedeCartaNaTela({ tipo: 'NF-e', status: 'authorized', cartasCorrecao: vinte }) ?? '', /limite da SEFAZ/);
});

test('historico mostra a mais nova primeiro e nao altera a lista original', () => {
  const original = [carta(3), carta(1), carta(2)];
  assert.deepEqual(cartasMaisNovasPrimeiro(original).map((c) => c.eventId), ['e3', 'e2', 'e1']);
  assert.deepEqual(original.map((c) => c.eventId), ['e3', 'e1', 'e2']);
  assert.deepEqual(cartasMaisNovasPrimeiro(undefined), []);
});
