/**
 * Preenche as datas que as telas usam para o periodo e que faltam em
 * documentos antigos (decisao do dono, 2026-10-14). Regras em
 * server/utils/datasFaltantesDomain.js; o percurso e a gravacao em
 * server/services/datasFaltantes.js (o mesmo que o botao do Painel da
 * Plataforma usa -- e' por ele que se roda na PRODUCAO, desde 15/10/2026):
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
const { admin, db, projectId } = require('../config/firebase');
const { preencherDatasFaltantes } = require('../services/datasFaltantes');

const argumento = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : '';
};
const tenantId = argumento('--tenant');
const aplicar = process.argv.includes('--aplicar');
const desfazer = process.argv.includes('--desfazer');

const listar = (titulo, linhas, total) => {
  if (total === 0) return;
  console.log(`  ${titulo}: ${total}`);
  linhas.forEach((linha) => console.log(`    - ${linha}`));
};

const main = async () => {
  if (!db) {
    console.error('Firestore Admin nao foi inicializado. Confira as credenciais do ambiente (FIREBASE_SERVICE_ACCOUNT_BASE64).');
    process.exit(1);
  }
  const projeto = projectId || admin.app().options.projectId || '(projeto nao identificado)';
  console.log(`Projeto: ${projeto} | ${tenantId ? `empresa ${tenantId}` : 'todas as empresas'} | ${aplicar ? 'GRAVANDO' : 'so mostrando (use --aplicar para gravar)'}${desfazer ? ' | DESFAZER' : ''}`);

  const resultado = await preencherDatasFaltantes({
    db,
    apagar: () => admin.firestore.FieldValue.delete(),
    tenantId,
    aplicar,
    desfazer,
  });
  for (const resumo of resultado.colecoes) {
    console.log(`${resumo.nome} (${resumo.campo}): lidos ${resumo.lidos}${desfazer ? '' : `, ja tinham ${resumo.ok}`}, ${desfazer ? 'voltados' : 'preenchidos'}${aplicar ? '' : ' (simulado)'} ${resumo.alterados}`);
    listar('Sem a data e sem data de criacao (corrigir no cadastro)', resumo.semData, resumo.totalSemData);
    listar('Pendentes sem vencimento (corrigir o vencimento no titulo)', resumo.pendentesSemVencimento, resumo.totalPendentesSemVencimento);
  }
};

main().then(() => process.exit(0)).catch((erro) => {
  console.error('Falhou:', erro.message);
  process.exit(1);
});
