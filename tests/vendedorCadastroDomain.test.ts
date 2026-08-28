import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TIPO_REGISTRO_PADRAO,
  isRegistroComLogin,
  isRegistroDeVendedor,
  menuVendedoresVisivel,
  parseTipoRegistro,
} from '../src/utils/vendedorCadastroDomain';

test('registro sem o campo tipoRegistro e tratado como login', () => {
  // O default aqui nao e' cosmetico: TODO documento de `usuarios` que existe
  // hoje nasceu antes deste campo, e todos eles tem login. Inverter o
  // default sumiria com a equipe inteira de Equipe & Acessos.
  assert.equal(TIPO_REGISTRO_PADRAO, 'login');
  assert.equal(parseTipoRegistro(undefined), 'login');
  assert.equal(parseTipoRegistro(null), 'login');
  assert.equal(parseTipoRegistro(''), 'login');
  assert.equal(parseTipoRegistro('qualquer coisa'), 'login');
  assert.equal(isRegistroComLogin({}), true);
  assert.equal(isRegistroComLogin(undefined), true);
});

test('so a string exata "vendedor" marca registro sem login', () => {
  assert.equal(parseTipoRegistro('vendedor'), 'vendedor');
  assert.equal(parseTipoRegistro('Vendedor'), 'login');
  assert.equal(parseTipoRegistro('VENDEDOR'), 'login');
  assert.equal(isRegistroDeVendedor({ tipoRegistro: 'vendedor' }), true);
  assert.equal(isRegistroComLogin({ tipoRegistro: 'vendedor' }), false);
});

test('menu de Vendedores aparece com o checkbox ligado', () => {
  assert.equal(
    menuVendedoresVisivel({ exigirIdentificacaoVendedor: true, temVendedorCadastrado: false }),
    true,
  );
});

test('menu de Vendedores sobrevive a desmarcar o checkbox quando ja ha cadastro', () => {
  // Este e' o ponto do desenho: desmarcar a opcao para de EXIGIR a
  // identificacao na venda, mas nao pode fazer o cadastro sumir da vista.
  assert.equal(
    menuVendedoresVisivel({ exigirIdentificacaoVendedor: false, temVendedorCadastrado: true }),
    true,
  );
});

test('empresa que nunca usou balcao compartilhado nao ve o menu', () => {
  assert.equal(
    menuVendedoresVisivel({ exigirIdentificacaoVendedor: false, temVendedorCadastrado: false }),
    false,
  );
});
