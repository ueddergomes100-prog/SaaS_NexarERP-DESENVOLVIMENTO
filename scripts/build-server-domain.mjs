/*
 * REGRA DE DINHEIRO NUM LUGAR SO' (item 8 da auditoria de infra, 2026-10-05).
 *
 * O servidor passa a gravar baixa/estorno (e, nas proximas fatias, venda e
 * saldo de banco). As regras ja existem, testadas, em src/utils/*Domain.ts.
 * Reescrever em JS seria ter duas versoes da mesma conta de dinheiro -- e a
 * primeira diferenca entre elas vira saldo errado sem ninguem ver.
 *
 * Este script compila os modulos listados abaixo para CommonJS em
 * server/domain/ (o servidor nao tem TypeScript nem passo de build: a
 * Hostinger roda `node server.js` direto). A saida e' VERSIONADA.
 *
 *   node scripts/build-server-domain.mjs           -> gera server/domain/
 *   node scripts/build-server-domain.mjs --check   -> falha se server/domain/
 *                                                     estiver diferente do src
 *
 * O --check roda no gate de push (.githooks/pre-push): mexeu num desses
 * arquivos do src e esqueceu de gerar, o push nao sobe.
 *
 * Modulo novo que o servidor precisar: entra em MODULOS (com tudo que ele
 * importa -- modulo que importa browser/Firebase nao pode entrar).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MODULOS = [
  'src/utils/dateTime.ts',
  'src/utils/documentMetadata.ts',
  'src/utils/financeDomain.ts',
  'src/utils/baixaFinanceiraDomain.ts',
  'src/utils/embalagemDomain.ts',
  'src/utils/unidadeMedidaDomain.ts',
  'src/utils/preVendaDomain.ts',
  'src/utils/condicionalDomain.ts',
  'src/utils/filialDomain.ts',
  'src/utils/cadastroGrupoDomain.ts',
  'src/utils/transferenciaDomain.ts',
  'src/utils/resumoGrupoDomain.ts',
  // Filiais F4: nota de transferencia montada no servidor com o mesmo item fiscal das telas.
  'src/utils/osServicePricing.ts',
  'src/utils/fiscalDomain.ts',
  'src/utils/importacaoFiscalDomain.ts',
  'src/utils/notaFiscalItemDomain.ts',
  'src/utils/notaTransferenciaDomain.ts',
  // Configuracoes por filial, fase A: maior atraso do cliente (saldo no grupo).
  'src/utils/parametrosVendaDomain.ts',
];

const DESTINO = resolve('server/domain');
const verificar = process.argv.includes('--check');

const temporario = mkdtempSync(join(tmpdir(), 'hennder-server-domain-'));
try {
  const resultado = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    ...MODULOS,
    '--ignoreConfig',
    '--outDir', temporario,
    '--rootDir', 'src/utils',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--ignoreDeprecations', '6.0',
    '--target', 'es2022',
    '--types', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--newLine', 'lf',
    '--pretty', 'false',
  ], { encoding: 'utf8' });

  if (resultado.status !== 0) {
    process.stderr.write(resultado.stdout || '');
    process.stderr.write(resultado.stderr || '');
    process.exitCode = resultado.status ?? 1;
  } else {
    const gerados = readdirSync(temporario).filter((nome) => nome.endsWith('.js')).sort();

    if (verificar) {
      const existentes = existsSync(DESTINO)
        ? readdirSync(DESTINO).filter((nome) => nome.endsWith('.js')).sort()
        : [];
      const normalizar = (texto) => texto.replace(/\r\n/g, '\n');
      const diferentes = gerados.filter((nome) => (
        !existentes.includes(nome)
        || normalizar(readFileSync(join(temporario, nome), 'utf8')) !== normalizar(readFileSync(join(DESTINO, nome), 'utf8'))
      ));
      const sobrando = existentes.filter((nome) => !gerados.includes(nome));
      if (diferentes.length > 0 || sobrando.length > 0) {
        process.stderr.write([
          'server/domain/ está desatualizado em relação a src/utils/.',
          ...diferentes.map((nome) => `  diferente: ${nome}`),
          ...sobrando.map((nome) => `  sobrando:  ${nome}`),
          'Rode: node scripts/build-server-domain.mjs  (e faça commit de server/domain/)',
          '',
        ].join('\n'));
        process.exitCode = 1;
      } else {
        process.stdout.write(`server/domain/ em dia (${gerados.length} módulos).\n`);
      }
    } else {
      mkdirSync(DESTINO, { recursive: true });
      for (const nome of readdirSync(DESTINO)) {
        if (nome.endsWith('.js') && !gerados.includes(nome)) rmSync(join(DESTINO, nome));
      }
      for (const nome of gerados) copyFileSync(join(temporario, nome), join(DESTINO, nome));
      process.stdout.write(`server/domain/ gerado: ${gerados.join(', ')}\n`);
    }
  }
} finally {
  rmSync(temporario, { recursive: true, force: true });
}
