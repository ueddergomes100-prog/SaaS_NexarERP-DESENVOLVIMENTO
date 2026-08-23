import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'nexus-finance-tests-'));
const testFiles = [
  join(temporaryDirectory, 'tests', 'financeDomain.test.js'),
  join(temporaryDirectory, 'tests', 'productSearch.test.js'),
  join(temporaryDirectory, 'tests', 'keyboardFlow.test.js'),
  join(temporaryDirectory, 'tests', 'catalogDefaults.test.js'),
  join(temporaryDirectory, 'tests', 'roles.test.js'),
  join(temporaryDirectory, 'tests', 'documentMetadata.test.js'),
  join(temporaryDirectory, 'tests', 'textSearch.test.js'),
  join(temporaryDirectory, 'tests', 'clientSearch.test.js'),
  join(temporaryDirectory, 'tests', 'saleQuantity.test.js'),
  join(temporaryDirectory, 'tests', 'producaoDomain.test.js'),
  join(temporaryDirectory, 'tests', 'fiscalDomain.test.js'),
  join(temporaryDirectory, 'tests', 'estoqueReservaDomain.test.js'),
  join(temporaryDirectory, 'tests', 'entradaNfeDomain.test.js'),
  join(temporaryDirectory, 'tests', 'sintegraDomain.test.js'),
  join(temporaryDirectory, 'tests', 'conferenciaDomain.test.js'),
  join(temporaryDirectory, 'tests', 'embalagemDomain.test.js'),
];

try {
  const compileResult = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    'tests/financeDomain.test.ts',
    'tests/productSearch.test.ts',
    'tests/keyboardFlow.test.ts',
    'tests/catalogDefaults.test.ts',
    'tests/roles.test.ts',
    'tests/documentMetadata.test.ts',
    'tests/textSearch.test.ts',
    'tests/clientSearch.test.ts',
    'tests/saleQuantity.test.ts',
    'tests/producaoDomain.test.ts',
    'tests/fiscalDomain.test.ts',
    'tests/estoqueReservaDomain.test.ts',
    'tests/entradaNfeDomain.test.ts',
    'tests/sintegraDomain.test.ts',
    'tests/conferenciaDomain.test.ts',
    'tests/embalagemDomain.test.ts',
    'src/utils/financeDomain.ts',
    'src/utils/dateTime.ts',
    'src/utils/productSearch.ts',
    'src/utils/keyboardFlow.ts',
    'src/utils/catalogDefaults.ts',
    'src/utils/roles.ts',
    'src/utils/documentMetadata.ts',
    'src/utils/textSearch.ts',
    'src/utils/clientSearch.ts',
    'src/utils/saleQuantity.ts',
    'src/utils/producaoDomain.ts',
    'src/utils/fiscalDomain.ts',
    'src/utils/osServicePricing.ts',
    'src/utils/estoqueReservaDomain.ts',
    'src/utils/entradaNfeDomain.ts',
    'src/utils/sintegraDomain.ts',
    'src/utils/conferenciaDomain.ts',
    'src/utils/embalagemDomain.ts',
    '--ignoreConfig',
    '--outDir', temporaryDirectory,
    '--rootDir', '.',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--ignoreDeprecations', '6.0',
    '--target', 'es2022',
    '--types', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--pretty', 'false',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (compileResult.status !== 0) {
    process.stderr.write(compileResult.stdout || '');
    process.stderr.write(compileResult.stderr || '');
    process.exitCode = compileResult.status ?? 1;
  } else {
    const result = spawnSync(process.execPath, ['--test', ...testFiles], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    process.exitCode = result.status ?? 1;
  }

} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
