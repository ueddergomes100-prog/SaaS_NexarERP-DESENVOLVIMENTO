/*
 * Remove os TEXTOS DE EXEMPLO de dentro das caixas (placeholder) em todo o
 * sistema (2026-10-06, pedido do dono): cliente achava que "EX: ARROZ TIPO 1
 * 5KG", "EAN/GTIN", "0,00", "(00) 00000-0000" eram valor ja' preenchido.
 *
 * Regra: sai o que PARECE VALOR (mascara, numero, e-mail, nome proprio,
 * placa, lista de siglas, texto que comeca com "Ex:"); fica o que e'
 * INSTRUCAO ("Buscar por nome ou código...", "Qtd", "Repita a senha",
 * "Sem limite"). Instrucao com exemplo no fim ("Fator (ex: 20)") perde so' o
 * exemplo.
 *
 * Roda uma vez (saida versionada):  node scripts/remover-exemplos-de-placeholder.mjs
 * Para refazer do zero num arquivo, restaure-o do git antes.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXEMPLOS_FIXOS = new Set([
  '-', 'uf', 'mg', 'cidade', 'centro', 'av. central', 'manhuaçu', 'prata', 'joao da silva', 'joão da silva',
  'sagrada família', 'rua joaquim santana', 'solnatus', 'honda', 'ean/gtin', 'nome ou razão social',
  'varejo, destaque, sazonal', 'un, cx, kg, rolo', 'kg, l, un, m...', 'protesto no 7 dia apos o vencimento',
]);

const pareceValor = (texto) => {
  const t = texto.trim();
  if (!t) return false;
  if (EXEMPLOS_FIXOS.has(t.toLowerCase())) return true;
  if (/^ex\.?\s*:/i.test(t) || /^ex\s/i.test(t)) return true;              // "Ex: ...", "Ex.: ...", "ex joao"
  if (/^[\d\s().,\-\/R$•…:]+$/.test(t)) return true;                         // 0,00 | (00) 00000-0000 | R$ 0,00 | ••••
  if (/^[A-Z]{3}-?\d{4}$/.test(t)) return true;                              // ABC-1234, AAA-0000
  if (/@/.test(t)) return true;                                              // e-mails de exemplo
  if (/^URL\b/i.test(t)) return true;                                        // "URL da imagem ou caminho do upload"
  if (/^[A-Z]{1,5}(, [A-Z]{1,5}){2,}\.{0,3}$/.test(t)) return true;         // listas de siglas
  return false;
};

/** Tira o exemplo do fim de uma instrucao: "Fator (ex: 20)" -> "Fator"; "Novo tipo, ex.: LAVAGEM" -> "Novo tipo". */
const semExemploNoFim = (texto) => texto
  .replace(/\s*\((?:ex|exemplo)\.?:?\s[^)]*\)\s*$/i, '')
  .replace(/\s*,\s*(?:ex|exemplo)\.?:\s.*$/i, '')
  .trim();

const arquivos = [];
const varrer = (dir) => {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else if (/\.tsx$/.test(nome)) arquivos.push(caminho);
  }
};
varrer('src');

const RE = /(\s*)placeholder=(?:"([^"\n]*)"|'([^'\n]*)'|\{"([^"\n]*)"\}|\{'([^'\n]*)'\}|\{`([^`$\n]*)`\})/g;

let removidos = 0; let encurtados = 0; const dinamicos = [];
for (const arquivo of arquivos) {
  const original = readFileSync(arquivo, 'utf8');
  let mudou = false;
  const novo = original.replace(RE, (trecho, espaco, a, b, c, d, e) => {
    const texto = a ?? b ?? c ?? d ?? e ?? '';
    if (pareceValor(texto)) { removidos += 1; mudou = true; return ''; }
    const curto = semExemploNoFim(texto);
    if (curto !== texto.trim()) { encurtados += 1; mudou = true; return `${espaco}placeholder="${curto.replace(/"/g, '&quot;')}"`; }
    return trecho;
  });
  const resto = novo.match(/placeholder=\{[^}"'`][^}]*\}/g);
  if (resto) dinamicos.push(`${arquivo}: ${resto.join(' | ')}`);
  if (mudou) writeFileSync(arquivo, novo);
}
console.log(`removidos: ${removidos}  encurtados: ${encurtados}`);
console.log('dinamicos (revisar a mao):'); dinamicos.forEach((d) => console.log('  ' + d));
