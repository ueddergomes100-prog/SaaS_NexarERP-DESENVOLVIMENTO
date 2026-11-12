/**
 * ABRIR UM ARQUIVO DE BACKUP FORA DO SISTEMA (12/11/2026).
 *
 * Para o pior dia: o sistema esta' fora do ar e voce tem so' o arquivo de
 * backup (baixado do painel ou da copia externa) e a chave. Este script
 * decifra e descompacta o arquivo num computador qualquer que tenha Node,
 * sem banco, sem internet e sem o servidor.
 *
 * Uso (na pasta `server`):
 *   PowerShell:  $env:BACKUP_ENCRYPTION_KEY = 'a chave'; node scripts/abrir-backup.js caminho\backup_2026-11-12_02-00.json.gz
 *   Linux/Mac:   BACKUP_ENCRYPTION_KEY='a chave' node scripts/abrir-backup.js caminho/backup_2026-11-12_02-00.json.gz
 *
 * Sem mais nada, mostra de quem e' o backup, quando foi gerado e quantos
 * registros tem em cada colecao. Com um segundo caminho, grava o conteudo
 * aberto (JSON) nesse arquivo:
 *   node scripts/abrir-backup.js backup.json.gz dados-abertos.json
 *
 * A chave NAO vai na linha de comando (ficaria no historico do terminal) e
 * nunca e' impressa. O arquivo aberto tem os dados da empresa em claro:
 * guarde com o mesmo cuidado e apague quando terminar.
 */
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { decifrar } = require('../services/backupCripto');

const [, , entrada, saida] = process.argv;

const sair = (mensagem) => { console.error(mensagem); process.exit(1); };

if (!entrada) sair('Informe o arquivo de backup. Ex.: node scripts/abrir-backup.js backup_2026-11-12_02-00.json.gz');
if (!fs.existsSync(entrada)) sair(`Arquivo não encontrado: ${entrada}`);
const chave = String(process.env.BACKUP_ENCRYPTION_KEY || '').trim();
if (!chave) sair('Defina a variável BACKUP_ENCRYPTION_KEY com a chave dos backups antes de rodar (ela não vai na linha de comando).');

let aberto;
try {
  aberto = JSON.parse(zlib.gunzipSync(decifrar(fs.readFileSync(entrada), chave)).toString('utf8'));
} catch (erro) {
  sair(`Não foi possível abrir o arquivo: ${erro.message}\nConfira se a chave é a mesma de quando o backup foi gerado e se o arquivo não foi alterado.`);
}

const { metadata = {}, data = {} } = aberto;
const conferido = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex') === metadata.checksum;

console.log(`Empresa:    ${metadata.companyName || '(sem nome)'} (${metadata.companyId || 'sem id'})`);
console.log(`CNPJ:       ${metadata.cnpj || '-'}`);
console.log(`Gerado em:  ${metadata.createdAt || '-'}`);
console.log(`Integridade: ${conferido ? 'conferida (o conteúdo é o mesmo de quando foi gerado)' : 'NÃO CONFERE -- o arquivo pode ter sido alterado'}`);
console.log('Registros por coleção:');
Object.entries(data)
  .map(([nome, valor]) => [nome, Array.isArray(valor) ? valor.length : (valor ? 1 : 0)])
  .filter(([, total]) => total > 0)
  .sort((a, b) => b[1] - a[1])
  .forEach(([nome, total]) => console.log(`  ${String(total).padStart(7)}  ${nome}`));

if (saida) {
  fs.writeFileSync(saida, JSON.stringify(aberto, null, 2));
  console.log(`\nConteúdo aberto gravado em: ${saida}`);
  console.log('Atenção: esse arquivo tem os dados da empresa em claro. Apague quando terminar.');
}
