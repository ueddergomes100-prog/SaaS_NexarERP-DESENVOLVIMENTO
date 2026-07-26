import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'nexus-finance-tests-'));
const outputFile = join(temporaryDirectory, 'tests', 'financeDomain.test.js');

try {
  const compileResult = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    'tests/financeDomain.test.ts',
    'src/utils/financeDomain.ts',
    'src/utils/dateTime.ts',
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
    const result = spawnSync(process.execPath, ['--test', outputFile], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    process.exitCode = result.status ?? 1;
  }

} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
