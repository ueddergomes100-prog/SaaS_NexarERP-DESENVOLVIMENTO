const { admin, db } = require('../config/firebase');

/**
 * Migracao pontual: concede a permissao nova `dashboard.acesso` (ver
 * src/utils/permissionCatalog.ts) pra TODO usuario ja cadastrado, em TODOS
 * os tenants, antes da permissao entrar no ar.
 *
 * Por que: ate agora a rota /dashboard nao tinha `routePermission` nenhum
 * (ver src/utils/routeAccess.ts) -- qualquer funcionario com o modulo
 * liberado abria a tela, independente do que estivesse marcado em
 * "Modulos Permitidos". Ligar o gate sem essa migracao faria TODO
 * funcionario de TODA empresa perder acesso ao Dashboard no mesmo instante
 * do deploy, ja que uma permissao nova nasce ausente do array `permissoes`
 * de todo mundo. Rodar isso ANTES garante que ninguem perde nada nesse
 * exato dia -- dali em diante, o dono da empresa decide quem mantem
 * acesso, e usuario novo criado depois PRECISA ganhar a permissao na mao
 * (ou por copia -- ver o botao "Copiar permissoes" em Configuracoes).
 *
 * arrayUnion e' idempotente: pode rodar de novo sem duplicar nem sem medo
 * de sobrescrever nada que ja estava no array.
 *
 * Uso:
 *   node scripts/grant-dashboard-acesso.js               (simulacao, so mostra a contagem)
 *   node scripts/grant-dashboard-acesso.js --apply        (grava de verdade)
 *   node scripts/grant-dashboard-acesso.js --tenant XYZ   (escopo de 1 empresa so, pra testar)
 */

const PERMISSAO = 'dashboard.acesso';
const MAX_BATCH_WRITES = 350;

const readArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};

const tenantId = readArgument('--tenant');
const shouldApply = process.argv.includes('--apply');

if (!db) {
  console.error('Firestore Admin não foi inicializado. Configure as credenciais do ambiente (server/.env).');
  process.exit(1);
}

const commitPatches = async (refs) => {
  for (let index = 0; index < refs.length; index += MAX_BATCH_WRITES) {
    const batch = db.batch();
    refs.slice(index, index + MAX_BATCH_WRITES).forEach((ref) => {
      batch.update(ref, { permissoes: admin.firestore.FieldValue.arrayUnion(PERMISSAO) });
    });
    await batch.commit();
  }
};

const main = async () => {
  const query = tenantId
    ? db.collection('usuarios').where('tenantId', '==', tenantId)
    : db.collection('usuarios');
  const snapshot = await query.get();

  const jaTem = [];
  const vaiGanhar = [];
  snapshot.docs.forEach((doc) => {
    const permissoes = Array.isArray(doc.data().permissoes) ? doc.data().permissoes : [];
    if (permissoes.includes(PERMISSAO)) jaTem.push(doc.ref);
    else vaiGanhar.push(doc.ref);
  });

  console.log(`Projeto Firebase alvo: ${process.env.FIREBASE_PROJECT_ID || '(padrão do server/config/firebase.js)'}`);
  console.log(tenantId ? `Escopo: tenant ${tenantId}` : 'Escopo: TODOS os tenants');
  console.log(`Usuários encontrados: ${snapshot.size}`);
  console.log(`Já tinham "${PERMISSAO}": ${jaTem.length}`);
  console.log(`Vão ganhar "${PERMISSAO}" agora: ${vaiGanhar.length}`);

  if (!shouldApply) {
    console.log('Simulação concluída. Nenhuma gravação foi feita. Use --apply após revisar o resultado.');
    return;
  }

  await commitPatches(vaiGanhar);
  console.log(`Concluído: ${vaiGanhar.length} usuário(s) atualizado(s).`);
};

main().catch((error) => {
  console.error('Falha ao conceder dashboard.acesso:', error);
  process.exitCode = 1;
});
