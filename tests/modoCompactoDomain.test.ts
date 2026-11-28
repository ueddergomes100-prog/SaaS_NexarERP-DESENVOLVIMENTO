import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerPreferenciaCompacto, LARGURA_PARA_COMPACTO, telaCompacta, zoomDoElemento } from '../src/utils/modoCompactoDomain';

test('modo compacto (28/11/2026): automatico so abaixo da largura; normal e compacto mandam', () => {
  assert.equal(telaCompacta('auto', 1093), true, 'monitor 1366 com o Windows em 125%');
  assert.equal(telaCompacta('auto', 1280), true, 'monitor 1600 com o Windows em 125%');
  assert.equal(telaCompacta('auto', 1440), false, 'Mac 13"');
  assert.equal(telaCompacta('auto', LARGURA_PARA_COMPACTO), false);
  assert.equal(telaCompacta('normal', 900), false);
  assert.equal(telaCompacta('compacto', 1920), true);
  assert.equal(lerPreferenciaCompacto('lixo'), 'auto');
  assert.equal(lerPreferenciaCompacto('normal'), 'normal');
  assert.equal(zoomDoElemento(null), 1);
  assert.equal(zoomDoElemento({ currentCSSZoom: 0.85 } as never), 0.85);
  assert.equal(zoomDoElemento({} as never), 1, 'navegador sem currentCSSZoom');
});
