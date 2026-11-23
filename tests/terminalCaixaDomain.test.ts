import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAVE_TERMINAL_CAIXA,
  cookieDoTerminal,
  lerTerminalDoCaixa,
  lerUltimoFechamento,
  limparCodigoDoOperador,
  primeiroTerminalValido,
  terminalDoCookie,
} from '../src/utils/terminalCaixaDomain.js';

const SEGREDO = 'a1'.repeat(32);
const TERMINAL = { terminalId: 'abc123', segredo: SEGREDO, tenantId: 'loja', cnpj: '12.345.678/0001-90', empresa: 'Loja Teste', nome: 'Caixa 1' };

test('terminal: le objeto ou JSON; recusa o que falta ou esta torto', () => {
  const esperado = { ...TERMINAL, cnpj: '12345678000190' };
  assert.deepEqual(lerTerminalDoCaixa(TERMINAL), esperado);
  assert.deepEqual(lerTerminalDoCaixa(JSON.stringify(TERMINAL)), esperado);
  assert.equal(lerTerminalDoCaixa({ ...TERMINAL, segredo: 'curto' }), null);
  assert.equal(lerTerminalDoCaixa({ ...TERMINAL, terminalId: 'a/b' }), null);
  assert.equal(lerTerminalDoCaixa({ ...TERMINAL, tenantId: '' }), null);
  assert.equal(lerTerminalDoCaixa('{quebrado'), null);
  assert.equal(lerTerminalDoCaixa(null), null);
  assert.equal(lerTerminalDoCaixa({ ...TERMINAL, nome: '' })?.nome, 'Caixa', 'sem nome vale "Caixa"');
});

test('cookie: vai e volta, so nas paginas do caixa, e apaga', () => {
  const cookie = cookieDoTerminal(lerTerminalDoCaixa(TERMINAL), true);
  assert.match(cookie, /Path=\/caixa; SameSite=Strict; Secure$/);
  assert.match(cookie, /Max-Age=315360000/);
  const valor = cookie.split(';')[0];
  assert.equal(terminalDoCookie(`outro=1; ${valor}; mais=2`)?.terminalId, 'abc123');
  assert.equal(terminalDoCookie('outro=1'), null);
  assert.equal(terminalDoCookie(`${CHAVE_TERMINAL_CAIXA}=%E0%A4%A`), null, 'cookie corrompido nao derruba a tela');
  assert.match(cookieDoTerminal(null, false), new RegExp(`^${CHAVE_TERMINAL_CAIXA}=; Max-Age=0; Path=/caixa; SameSite=Strict$`));
});

test('o primeiro lugar que sobreviveu vale (local apagado, banco interno ainda tem)', () => {
  assert.equal(primeiroTerminalValido(null, '', TERMINAL, { ...TERMINAL, terminalId: 'outro' })?.terminalId, 'abc123');
  assert.equal(primeiroTerminalValido(null, undefined, 'lixo'), null);
});

test('ultimo fechamento do computador e codigo do operador', () => {
  assert.deepEqual(lerUltimoFechamento('{"saldoCentavos":15000,"operadorNome":"ANA"}'), { saldoCentavos: 15000, operadorNome: 'ANA' });
  assert.equal(lerUltimoFechamento('{"saldoCentavos":-1}'), null);
  assert.equal(lerUltimoFechamento('{"saldoCentavos":1.5}'), null);
  assert.equal(lerUltimoFechamento('x'), null);
  assert.equal(limparCodigoDoOperador(' 0 7a'), '07');
  assert.equal(limparCodigoDoOperador('123'), '12');
});
