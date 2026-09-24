#!/usr/bin/env node
/**
 * Sol Life: coloca TODOS os produtos na categoria SEMIACABADOS e no CST de
 * ICMS "00 - Tributada integralmente", em PRODUCAO, so' nessa empresa.
 * NAO roda a partir do dev/CI deste projeto -- e' um script a parte, que voce
 * roda manualmente com a credencial de PRODUCAO, porque este repositorio
 * nunca conecta em producao sozinho (CLAUDE.md, secao 5). Mesmo padrao de
 * scripts/corrigir-caixa-alta-producao.mjs.
 *
 * -----------------------------------------------------------------------
 * COMO RODAR
 * -----------------------------------------------------------------------
 *
 * 1. Credencial de PRODUCAO (projeto nexus-erp-2026): a mesma do script de
 *    caixa alta (JSON da service account, fora do git).
 *
 * 2. Dependencia (uma vez so, dentro da pasta do projeto):
 *      npm install firebase-admin --no-save
 *
 * 3. Ache o tenantId da Sol Life:
 *      node scripts/sol-life-padronizar-produtos.mjs --buscar-empresa="Sol Life" --credencial="C:\chaves\nexus-erp-2026-producao.json"
 *
 * 4. MODO TESTE (NAO grava nada -- so mostra o que mudaria):
 *      node scripts/sol-life-padronizar-produtos.mjs --tenant-id=<ID> --credencial="C:\chaves\nexus-erp-2026-producao.json"
 *
 * 5. Conferiu? Aplique de verdade (antes de gravar, ele salva um arquivo de
 *    BACKUP com o valor anterior de cada produto):
 *      node scripts/sol-life-padronizar-produtos.mjs --tenant-id=<ID> --credencial="..." --aplicar
 *
 * 6. Se precisar VOLTAR ATRAS, use o arquivo de backup que ele gerou:
 *      node scripts/sol-life-padronizar-produtos.mjs --tenant-id=<ID> --credencial="..." --desfazer="backup-sol-life-....json" --aplicar
 *    (sem --aplicar, mostra so' o que seria desfeito)
 *
 * -----------------------------------------------------------------------
 * O QUE ELE FAZ
 * -----------------------------------------------------------------------
 *
 * Em `estoque` (produtos) do tenant informado, para TODOS os produtos, ativos
 * ou nao:
 *   - `categoria`  -> SEMIACABADOS (a categoria precisa existir e estar ATIVA
 *                     em Cadastros > Categorias da empresa; senao ele para);
 *   - `csosn`      -> "00" (o campo que o formulario chama de "CST de ICMS";
 *                     "00 - Tributada integralmente").
 * So' grava nos produtos em que o valor DIFERE; nao mexe em mais nenhum campo
 * (nem em materias-primas, que ficam em outra colecao), nunca cria nem apaga
 * produto e nunca toca em outro tenant. Idempotente: rodar de novo nao muda
 * nada.
 *
 * Trava de seguranca: se o regime tributario da empresa for Simples
 * Nacional, ele para -- la o campo e' o CSOSN (101, 102...) e "00" e' um
 * codigo de CST que a nota fiscal rejeita.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CATEGORIA_PADRAO = 'SEMIACABADOS';
export const CST_PADRAO = '00';

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const chave = (t) => semAcento(t).trim().toUpperCase();

// ---------------------------------------------------------------------------
// Parte pura (testada em sol-life-padronizar-produtos.test.mjs)
// ---------------------------------------------------------------------------

/** Decide, produto a produto, o que precisa mudar. */
export const planejarPadronizacao = (produtos, { categoria, cst }) => {
  const alterar = [];
  let jaCertos = 0;
  const porCategoria = new Map();
  const porCst = new Map();
  let comCest = 0;
  produtos.forEach((p) => {
    const categoriaAntes = typeof p.categoria === 'string' ? p.categoria : null;
    const cstAntes = typeof p.csosn === 'string' ? p.csosn : null;
    porCategoria.set(categoriaAntes ?? '(vazia)', (porCategoria.get(categoriaAntes ?? '(vazia)') || 0) + 1);
    porCst.set(cstAntes ?? '(vazio)', (porCst.get(cstAntes ?? '(vazio)') || 0) + 1);
    const mudaCategoria = chave(categoriaAntes) !== chave(categoria) || categoriaAntes !== categoria;
    const mudaCst = cstAntes !== cst;
    if (!mudaCategoria && !mudaCst) { jaCertos += 1; return; }
    if (mudaCst && String(p.cest ?? '').replace(/\D/g, '')) comCest += 1;
    alterar.push({
      id: p.id,
      codigo: p.codigo ?? null,
      nome: p.nome ?? null,
      categoriaAntes,
      cstAntes,
      mudaCategoria,
      mudaCst,
    });
  });
  return {
    total: produtos.length,
    alterar,
    jaCertos,
    mudaCategoria: alterar.filter((a) => a.mudaCategoria).length,
    mudaCst: alterar.filter((a) => a.mudaCst).length,
    comCestRecebendoCst: comCest,
    porCategoria: [...porCategoria.entries()].sort((a, b) => b[1] - a[1]),
    porCst: [...porCst.entries()].sort((a, b) => b[1] - a[1]),
  };
};

/** Campos a gravar para um item do plano (so' os que mudam). */
export const camposParaGravar = (item, { categoria, cst }) => ({
  ...(item.mudaCategoria ? { categoria } : {}),
  ...(item.mudaCst ? { csosn: cst } : {}),
});

/** Regime que usa CST de ICMS (nao CSOSN)? Simples Nacional nao pode receber "00". */
export const regimeAceitaCst = (regime) => typeof regime === 'string' && regime !== 'simples_nacional';

/**
 * Backup: o valor de ANTES de cada produto e o que o script vai gravar (para
 * o desfazer conferir que ninguem mexeu depois).
 */
export const montarBackup = (plano, { tenantId, categoria, cst }) => ({
  criadoEm: new Date().toISOString(),
  tenantId,
  aplicado: { categoria, csosn: cst },
  itens: plano.alterar.map((a) => ({
    id: a.id,
    codigo: a.codigo,
    nome: a.nome,
    categoriaAntes: a.categoriaAntes,
    cstAntes: a.cstAntes,
    mudouCategoria: a.mudaCategoria,
    mudouCst: a.mudaCst,
  })),
});

/** O que o desfazer precisa fazer com cada item do backup, olhando o produto de AGORA. */
export const planejarDesfazer = (backup, produtosAgora) => {
  const porId = new Map(produtosAgora.map((p) => [p.id, p]));
  const restaurar = [];
  const ignorados = [];
  backup.itens.forEach((item) => {
    const atual = porId.get(item.id);
    if (!atual) { ignorados.push({ ...item, motivo: 'produto não existe mais' }); return; }
    const campos = {};
    if (item.mudouCategoria) {
      if (atual.categoria === backup.aplicado.categoria) campos.categoria = item.categoriaAntes; // null = apagar
      else ignorados.push({ ...item, motivo: `categoria mudou depois do script (agora "${atual.categoria}")` });
    }
    if (item.mudouCst) {
      if (atual.csosn === backup.aplicado.csosn) campos.csosn = item.cstAntes;
      else ignorados.push({ ...item, motivo: `CST mudou depois do script (agora "${atual.csosn}")` });
    }
    if (Object.keys(campos).length > 0) restaurar.push({ id: item.id, nome: item.nome, campos });
  });
  return { restaurar, ignorados };
};

// ---------------------------------------------------------------------------
// Acesso ao Firestore (recebe `db` e `FieldValue` para poder ser testado)
// ---------------------------------------------------------------------------

export const lerProdutos = async (db, tenantId) => {
  const snap = await db.collection('estoque').where('tenantId', '==', tenantId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const verificarPreCondicoes = async (db, tenantId, categoria) => {
  const erros = [];
  const cfg = await db.collection('configuracoes').doc(tenantId).get();
  if (!cfg.exists) erros.push(`Não achei a configuração da empresa (${tenantId}). Confira o tenantId.`);
  else if (!regimeAceitaCst(cfg.data().regimeTributario)) {
    erros.push(`O regime tributário da empresa é "${cfg.data().regimeTributario ?? 'não informado'}". Com Simples Nacional o campo é o CSOSN (101, 102...) e "00" seria rejeitado na nota fiscal. Confirme o regime em Configurações antes de rodar.`);
  }
  const cats = await db.collection('categorias').where('tenantId', '==', tenantId).get();
  const achada = cats.docs.map((d) => d.data()).find((c) => chave(c.nome) === chave(categoria));
  if (!achada) erros.push(`A categoria "${categoria}" não existe nesta empresa. Crie em Cadastros > Categorias e rode de novo.`);
  else if (achada.ativo === false) erros.push(`A categoria "${categoria}" está INATIVA. Ative em Cadastros > Categorias e rode de novo.`);
  const nomeDaCategoria = achada ? String(achada.nome) : categoria;
  return { erros, nomeDaCategoria, empresa: cfg.exists ? cfg.data() : null };
};

const LOTE = 400; // o Firestore aceita ate' 500 escritas por lote

export const gravarEmLotes = async (db, escritas) => {
  for (let inicio = 0; inicio < escritas.length; inicio += LOTE) {
    const batch = db.batch();
    escritas.slice(inicio, inicio + LOTE).forEach(({ id, campos }) => batch.update(db.collection('estoque').doc(id), campos));
    await batch.commit();
    console.log(`  ${Math.min(inicio + LOTE, escritas.length)}/${escritas.length} gravados.`);
  }
};

export const aplicarPadronizacao = async (db, FieldValue, plano, opcoes) => {
  const escritas = plano.alterar.map((item) => ({
    id: item.id,
    campos: {
      ...camposParaGravar(item, opcoes),
      updatedAt: FieldValue.serverTimestamp(),
      ultimaAlteracao: 'Categoria e CST de ICMS padronizados (script de implantação)',
    },
  }));
  await gravarEmLotes(db, escritas);
};

export const aplicarDesfazer = async (db, FieldValue, planoDesfazer) => {
  const escritas = planoDesfazer.restaurar.map((r) => ({
    id: r.id,
    campos: {
      ...Object.fromEntries(Object.entries(r.campos).map(([campo, valor]) => [campo, valor === null ? FieldValue.delete() : valor])),
      updatedAt: FieldValue.serverTimestamp(),
      ultimaAlteracao: 'Padronização de categoria e CST desfeita (script de implantação)',
    },
  }));
  await gravarEmLotes(db, escritas);
};

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

const lerArgumentos = () => Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, ...resto] = arg.replace(/^--/, '').split('=');
    return [k, resto.join('=') || 'true'];
  }),
);

const imprimirTabela = (titulo, pares, max = 12) => {
  console.log(titulo);
  pares.slice(0, max).forEach(([valor, qtd]) => console.log(`    ${String(qtd).padStart(5)}  ${valor}`));
  if (pares.length > max) console.log(`    ... e mais ${pares.length - max} valor(es)`);
};

const principal = async () => {
  const args = lerArgumentos();
  if (!args['credencial']) {
    console.error('Falta --credencial="caminho\\para\\service-account.json" (a chave de PRODUCAO, projeto nexus-erp-2026).');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(readFileSync(args['credencial'], 'utf8'));
  if (serviceAccount.project_id !== 'nexus-erp-2026') {
    console.error(`ATENÇÃO: a credencial informada é do projeto "${serviceAccount.project_id}", não "nexus-erp-2026" (produção). Script encerrado por segurança.`);
    process.exit(1);
  }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  if (args['buscar-empresa']) {
    const termo = String(args['buscar-empresa']).toLowerCase();
    console.log(`Procurando empresas com nome parecido com "${termo}"...\n`);
    const snap = await db.collection('usuarios').where('role', 'in', ['Master', 'Admin']).get();
    const achados = snap.docs
      .map((d) => ({ tenantId: d.data().tenantId || d.id, nome: String(d.data().nome || d.data().nomeResponsavel || ''), role: d.data().role }))
      .filter((a) => a.nome.toLowerCase().includes(termo));
    if (achados.length === 0) console.log('Nada encontrado. Confira a grafia ou peça o tenantId direto ao dono do sistema.');
    achados.forEach((a) => console.log(`  tenantId: ${a.tenantId}   |   ${a.role}: ${a.nome}`));
    return;
  }

  const tenantId = args['tenant-id'];
  if (!tenantId) {
    console.error('Use --buscar-empresa="nome" para achar o tenantId, ou --tenant-id=<ID>. Veja os comentários no topo do arquivo.');
    process.exit(1);
  }
  const aplicar = args['aplicar'] === 'true';
  const opcoes = { categoria: args['categoria'] && args['categoria'] !== 'true' ? args['categoria'] : CATEGORIA_PADRAO, cst: args['cst'] && args['cst'] !== 'true' ? args['cst'] : CST_PADRAO };

  // ---- desfazer ----
  if (args['desfazer']) {
    if (!existsSync(args['desfazer'])) { console.error(`Arquivo de backup não encontrado: ${args['desfazer']}`); process.exit(1); }
    const backup = JSON.parse(readFileSync(args['desfazer'], 'utf8'));
    if (backup.tenantId !== tenantId) { console.error(`Este backup é da empresa ${backup.tenantId}, não de ${tenantId}. Encerrado.`); process.exit(1); }
    const planoDesfazer = planejarDesfazer(backup, await lerProdutos(db, tenantId));
    console.log(`${planoDesfazer.restaurar.length} produto(s) voltariam ao valor anterior; ${planoDesfazer.ignorados.length} item(ns) ignorado(s) por terem mudado depois.`);
    planoDesfazer.ignorados.slice(0, 15).forEach((i) => console.log(`  ignorado: ${i.nome} — ${i.motivo}`));
    if (!aplicar) { console.log('\nMODO TESTE -- nada foi gravado. Rode de novo com --aplicar para desfazer de verdade.'); return; }
    await aplicarDesfazer(db, FieldValue, planoDesfazer);
    console.log('\nPronto: padronização desfeita.');
    return;
  }

  // ---- padronizar ----
  const pre = await verificarPreCondicoes(db, tenantId, opcoes.categoria);
  if (pre.erros.length > 0) {
    console.error('NÃO POSSO CONTINUAR:');
    pre.erros.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  opcoes.categoria = pre.nomeDaCategoria;
  console.log(`Empresa ${tenantId} — regime: ${pre.empresa.regimeTributario}. Categoria de destino: "${opcoes.categoria}". CST de destino: "${opcoes.cst}".\n`);

  const plano = planejarPadronizacao(await lerProdutos(db, tenantId), opcoes);
  console.log(`${plano.total} produto(s) na empresa.`);
  console.log(`  já corretos (nada a fazer): ${plano.jaCertos}`);
  console.log(`  a mudar de categoria:       ${plano.mudaCategoria}`);
  console.log(`  a mudar de CST:             ${plano.mudaCst}\n`);
  imprimirTabela('  Categorias que os produtos têm hoje:', plano.porCategoria);
  imprimirTabela('\n  CST/CSOSN que os produtos têm hoje:', plano.porCst);
  if (plano.comCestRecebendoCst > 0) {
    console.log(`\n  ATENÇÃO: ${plano.comCestRecebendoCst} produto(s) têm CEST (substituição tributária) e vão receber CST 00. Confirme com o contador da empresa se é isso mesmo.`);
  }
  console.log('\n  Exemplos:');
  plano.alterar.slice(0, 12).forEach((a) => console.log(`    #${a.codigo ?? '?'} ${a.nome}  |  categoria: ${a.categoriaAntes ?? '(vazia)'} -> ${opcoes.categoria}  |  CST: ${a.cstAntes ?? '(vazio)'} -> ${opcoes.cst}`));

  if (plano.alterar.length === 0) { console.log('\nNada a fazer.'); return; }
  if (!aplicar) { console.log('\nMODO TESTE -- nada foi gravado. Rode de novo com --aplicar para gravar de verdade.'); return; }

  const carimbo = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const arquivoBackup = `backup-sol-life-${carimbo}.json`;
  writeFileSync(arquivoBackup, JSON.stringify(montarBackup(plano, { tenantId, ...opcoes }), null, 2), 'utf8');
  console.log(`\nBackup salvo em ${arquivoBackup} (guarde este arquivo: é ele que permite desfazer).`);
  console.log('Gravando...');
  await aplicarPadronizacao(db, FieldValue, plano, opcoes);
  console.log(`\nPronto: ${plano.alterar.length} produto(s) atualizado(s). Para desfazer: --desfazer="${arquivoBackup}" --aplicar`);
};

// So' roda quando chamado direto (o teste importa as funcoes sem executar nada).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().then(() => process.exit(0)).catch((erro) => {
    console.error('Erro:', erro.message);
    process.exit(1);
  });
}
