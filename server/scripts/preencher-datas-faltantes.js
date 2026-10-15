/**
 * Preenche as datas que as telas usam para o periodo e que faltam em
 * documentos antigos (decisao do dono, 2026-10-14). Regras em
 * server/utils/datasFaltantesDomain.js:
 *  - pedidos_venda sem `dataVenda`          -> dia em que o pedido foi criado;
 *  - transacoes PAGAS sem `dataPagamento` e sem `data` -> dataPagamento = dia da criacao.
 * Lancamento pendente sem vencimento so' e' listado (nao se inventa vencimento).
 *
 * Uso (na pasta server, com as credenciais do ambiente que vai corrigir):
 *   node scripts/preencher-datas-faltantes.js                 -> so' mostra o que faria (todas as empresas)
 *   node scripts/preencher-datas-faltantes.js --tenant <id>   -> so' uma empresa
 *   node scripts/preencher-datas-faltantes.js --aplicar       -> grava
 *   node scripts/preencher-datas-faltantes.js --desfazer --aplicar -> apaga o que ESTE script gravou
 *
 * Cada campo preenchido ganha a marca `<campo>PreenchidaPorMigracao: true`,
 * para o --desfazer saber exatamente o que voltar.
 */
const { admin, db } = require('../config/firebase');
const { decidirDataVenda, decidirDataDoLancamento } = require('../utils/datasFaltantesDomain');

const ESCRITAS_POR_LOTE = 400;
const marca = (campo) => `${campo}PreenchidaPorMigracao`;

const COLECOES = [
  { nome: 'pedidos_venda', campo: 'dataVenda', decidir: decidirDataVenda, rotulo: (d) => `pedido #${d.numeroPedido || '?'}` },
  { nome: 'transacoes', campo: 'dataPagamento', decidir: decidirDataDoLancamento, rotulo: (d) => `lançamento "${String(d.descricao || '?').slice(0, 50)}"` },
];

const argumento = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : '';
};
const tenantId = argumento('--tenant');
const aplicar = process.argv.includes('--aplicar');
const desfazer = process.argv.includes('--desfazer');

const processarColecao = async ({ nome, campo, decidir, rotulo }) => {
  let consulta = db.collection(nome);
  if (tenantId) consulta = consulta.where('tenantId', '==', tenantId);
  if (desfazer) consulta = consulta.where(marca(campo), '==', true);
  const snap = await consulta.get();

  const resumo = { lidos: snap.size, ok: 0, alterados: 0, semData: [], pendentesSemVencimento: [] };
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
    const quem = `${dados.tenantId || '?'} / ${rotulo(dados)} (${doc.id})`;
    if (desfazer) {
      lote.update(doc.ref, { [campo]: admin.firestore.FieldValue.delete(), [marca(campo)]: admin.firestore.FieldValue.delete() });
    } else {
      const decisao = decidir(dados);
      if (decisao.acao === 'ok') { resumo.ok += 1; continue; }
      if (decisao.acao === 'sem_data') { resumo.semData.push(quem); continue; }
      if (decisao.acao === 'pendente_sem_vencimento') { resumo.pendentesSemVencimento.push(quem); continue; }
      lote.update(doc.ref, { [decisao.campo]: decisao.valor, [marca(decisao.campo)]: true });
    }
    resumo.alterados += 1;
    noLote += 1;
    if (noLote >= ESCRITAS_POR_LOTE) await gravarLote();
  }
  await gravarLote();
  return resumo;
};

const listar = (titulo, linhas) => {
  if (linhas.length === 0) return;
  console.log(`  ${titulo}: ${linhas.length}`);
  linhas.slice(0, 50).forEach((linha) => console.log(`    - ${linha}`));
};

const main = async () => {
  if (!db) {
    console.error('Firestore Admin nao foi inicializado. Confira as credenciais do ambiente (FIREBASE_SERVICE_ACCOUNT_BASE64).');
    process.exit(1);
  }
  const projeto = admin.app().options.projectId || '(projeto nao identificado)';
  console.log(`Projeto: ${projeto} | ${tenantId ? `empresa ${tenantId}` : 'todas as empresas'} | ${aplicar ? 'GRAVANDO' : 'so mostrando (use --aplicar para gravar)'}${desfazer ? ' | DESFAZER' : ''}`);

  for (const colecao of COLECOES) {
    const resumo = await processarColecao(colecao);
    console.log(`${colecao.nome} (${colecao.campo}): lidos ${resumo.lidos}${desfazer ? '' : `, ja tinham ${resumo.ok}`}, ${desfazer ? 'voltados' : 'preenchidos'}${aplicar ? '' : ' (simulado)'} ${resumo.alterados}`);
    listar('Sem a data e sem data de criacao (corrigir no cadastro)', resumo.semData);
    listar('Pendentes sem vencimento (corrigir o vencimento no titulo)', resumo.pendentesSemVencimento);
  }
};

main().then(() => process.exit(0)).catch((erro) => {
  console.error('Falhou:', erro.message);
  process.exit(1);
});
