import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Politica de conteudo (CSP) do site, bloco B de seguranca (25/11/2026): o
 * public/.htaccess libera os scripts embutidos nas paginas pelo HASH do texto.
 * Mudou o script de tema de index.html, caixa.html ou vendedor.html sem trocar
 * o hash, a pagina ficaria sem o script quando a politica passar a bloquear.
 * Este teste recalcula os hashes (com fim de linha LF e CRLF) e confere.
 */

// O teste roda compilado numa pasta temporaria (scripts/run-finance-domain-tests.mjs): acha a raiz do projeto.
const raizDoProjeto = (): string => {
  for (const candidata of [process.cwd(), join(process.cwd(), '..'), join(process.cwd(), '..', '..')]) {
    if (existsSync(join(candidata, 'public', '.htaccess')) && existsSync(join(candidata, 'index.html'))) return candidata;
  }
  throw new Error('raiz do projeto nao encontrada');
};

const hash = (texto: string) => `sha256-${createHash('sha256').update(texto, 'utf8').digest('base64')}`;

const politica = (): string => {
  const htaccess = readFileSync(join(raizDoProjeto(), 'public', '.htaccess'), 'utf8');
  const linha = htaccess.split(/\r?\n/).find((l) => /^\s*Header always set Content-Security-Policy/.test(l));
  assert.ok(linha, 'o .htaccess tem a politica de conteudo');
  return linha;
};

test('cada script embutido nas paginas tem o hash na politica (LF e CRLF)', () => {
  const csp = politica();
  for (const pagina of ['index.html', 'caixa.html', 'vendedor.html']) {
    const html = readFileSync(join(raizDoProjeto(), pagina), 'utf8').replace(/\r\n/g, '\n');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, `${pagina} tem script embutido`);
    for (const script of scripts) {
      assert.ok(csp.includes(hash(script)), `${pagina}: falta o hash LF ${hash(script)} no public/.htaccess`);
      assert.ok(csp.includes(hash(script.replace(/\n/g, '\r\n'))), `${pagina}: falta o hash CRLF no public/.htaccess`);
    }
    for (const m of html.matchAll(/\son[a-z]+="([^"]*)"/g)) {
      assert.ok(csp.includes(hash(m[1])), `${pagina}: falta o hash do atributo ${m[1]}`);
    }
  }
});

test('a politica nao libera eval nem script de qualquer lugar', () => {
  const csp = politica();
  const scriptSrc = csp.split(';').find((d) => d.includes('script-src')) || '';
  assert.ok(!scriptSrc.includes("'unsafe-eval'"));
  assert.ok(!scriptSrc.includes("'unsafe-inline'"));
  assert.ok(!/\shttps:\s|\s\*\s/.test(`${scriptSrc} `));
  assert.match(csp, /object-src 'none'/);
});
