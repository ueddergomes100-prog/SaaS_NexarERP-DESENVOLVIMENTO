/**
 * Preenche a `dataVenda` dos pedidos que nao tem (decisao do dono, 2026-10-14).
 * Regra em server/domain/dataVendaDomain.js: dia em que o pedido foi criado.
 *
 * Uso (na pasta server, com as credenciais do ambiente que vai corrigir):
 *   node scripts/preencher-data-venda.js                 -> so' mostra o que faria (todas as empresas)
 *   node scripts/preencher-data-venda.js --tenant <id>   -> so' uma empresa
 *   node scripts/preencher-data-venda.js --aplicar       -> grava
 *   node scripts/preencher-data-venda.js --desfazer --aplicar -> apaga o que ESTE script gravou
 *
 * Cada pedido corrigido ganha `dataVendaPreenchidaPorMigracao: true`, para o
 * --desfazer saber exatamente o que voltar.
 */
const { admin, db } = require('../config/firebase');
const { decidirDataVenda } = require('../domain/dataVendaDomain');

const MARCA = 'dataVendaPreenchidaPorMigracao';
const ESCRITAS_POR_LOTE = 400;

const argumento = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : '';
};
const tenantId = argumento('--tenant');
const aplicar = process.argv.includes('--aplicar');
const desfazer = process.argv.includes('--desfazer');

const main = async () => {
  if (!db) {
    console.error('Firestore Admin nao foi inicializado. Confira as credenciais do ambiente (FIREBASE_SERVICE_ACCOUNT_BASE64).');
    process.exit(1);
  }
  const projeto = admin.app().options.projectId || '(projeto nao identificado)';
  console.log(`Projeto: ${projeto} | ${tenantId ? `empresa ${tenantId}` : 'todas as empresas'} | ${aplicar ? 'GRAVANDO' : 'so mostrando (use --aplicar para gravar)'}${desfazer ? ' | DESFAZER' : ''}`);

  let consulta = db.collection('pedidos_venda');
  if (tenantId) consulta = consulta.where('tenantId', '==', tenantId);
  if (desfazer) consulta = consulta.where(MARCA, '==', true);
  const snap = await consulta.get();

  const contagem = { lidos: snap.size, ok: 0, preencher: 0, semData: 0 };
  const semData = [];
  let lote = db.batch();
  let noLote = 0;
  const gravarLote = async () => {
    if (noLote === 0) return;
    if (aplicar) await lote.commit();
    lote = db.batch();
    noLote = 0;
  };

  for (const doc of snap.docs) {
    const dados = doc.data();
    if (desfazer) {
      contagem.preencher += 1;
      lote.update(doc.ref, { dataVenda: admin.firestore.FieldValue.delete(), [MARCA]: admin.firestore.FieldValue.delete() });
    } else {
      const decisao = decidirDataVenda(dados);
      if (decisao.acao === 'ok') { contagem.ok += 1; continue; }
      if (decisao.acao === 'sem_data') {
        contagem.semData += 1;
        semData.push(`${dados.tenantId || '?'} / pedido #${dados.numeroPedido || '?'} (${doc.id})`);
        continue;
      }
      contagem.preencher += 1;
      lote.update(doc.ref, { dataVenda: decisao.dataVenda, [MARCA]: true });
    }
    noLote += 1;
    if (noLote >= ESCRITAS_POR_LOTE) await gravarLote();
  }
  await gravarLote();

  console.log(`Pedidos lidos: ${contagem.lidos}`);
  if (!desfazer) console.log(`Ja tinham data da venda: ${contagem.ok}`);
  console.log(`${desfazer ? 'Voltados' : 'Preenchidos'}${aplicar ? '' : ' (simulado)'}: ${contagem.preencher}`);
  if (semData.length > 0) {
    console.log(`Sem data da venda e sem data de criacao (corrigir no pedido): ${semData.length}`);
    semData.slice(0, 50).forEach((linha) => console.log(`  - ${linha}`));
  }
};

main().then(() => process.exit(0)).catch((erro) => {
  console.error('Falhou:', erro.message);
  process.exit(1);
});
