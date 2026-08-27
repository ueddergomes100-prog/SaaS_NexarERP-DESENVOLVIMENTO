const { admin, db } = require('../config/firebase');

/**
 * Migracao pontual: 4 permissoes que ate agora eram compartilhadas por
 * TELAS DIFERENTES viraram ids proprios (ver src/utils/permissionCatalog.ts
 * e src/utils/routeAccess.ts, 2026-08-27) -- marcar "Pedidos de Venda"
 * liberava Frente de Caixa e Minhas Vendas junto, "Clientes" liberava
 * Veiculos, "Ordens de Producao" liberava o Relatorio, "Entrada de XML"
 * liberava o Historico. Isso impedia controle independente por tela
 * (pedido do usuario).
 *
 * Sem esta migracao, todo funcionario que ja usa uma tela "irma" (ex: PDV,
 * hoje liberado via vendas.pedidos) perderia acesso no instante do deploy,
 * ja que os ids novos nascem ausentes do array `permissoes` de todo mundo.
 * Rodar isso ANTES garante que quem ja tinha acesso continua tendo -- dali
 * em diante, o dono da empresa decide independentemente quem mantem cada
 * um.
 *
 * arrayUnion e' idempotente: pode rodar de novo sem duplicar nem sobrescrever.
 *
 * Uso:
 *   node scripts/migrate-permission-splits.js               (simulacao, so mostra a contagem)
 *   node scripts/migrate-permission-splits.js --apply        (grava de verdade)
 *   node scripts/migrate-permission-splits.js --tenant XYZ   (escopo de 1 empresa so, pra testar)
 */

const REGRAS = [
  { origem: 'vendas.pedidos', novas: ['vendas.minhas_vendas', 'vendas.pdv'] },
  { origem: 'cadastros.clientes', novas: ['cadastros.veiculos'] },
  { origem: 'operacoes.producao', novas: ['operacoes.producao_relatorios'] },
  { origem: 'fiscal.entrada', novas: ['fiscal.entrada_historico'] },
];

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

const commitPatches = async (patches) => {
  for (let index = 0; index < patches.length; index += MAX_BATCH_WRITES) {
    const batch = db.batch();
    patches.slice(index, index + MAX_BATCH_WRITES).forEach(({ ref, novasPermissoes }) => {
      batch.update(ref, { permissoes: admin.firestore.FieldValue.arrayUnion(...novasPermissoes) });
    });
    await batch.commit();
  }
};

const main = async () => {
  const query = tenantId
    ? db.collection('usuarios').where('tenantId', '==', tenantId)
    : db.collection('usuarios');
  const snapshot = await query.get();

  console.log(`Projeto Firebase alvo: ${process.env.FIREBASE_PROJECT_ID || '(padrão do server/config/firebase.js)'}`);
  console.log(tenantId ? `Escopo: tenant ${tenantId}` : 'Escopo: TODOS os tenants');
  console.log(`Usuários encontrados: ${snapshot.size}`);

  const patches = [];
  const contagemPorRegra = REGRAS.map(() => 0);

  snapshot.docs.forEach((doc) => {
    const permissoesAtuais = Array.isArray(doc.data().permissoes) ? doc.data().permissoes : [];
    const novasPermissoes = [];
    REGRAS.forEach((regra, index) => {
      if (!permissoesAtuais.includes(regra.origem)) return;
      const faltando = regra.novas.filter((id) => !permissoesAtuais.includes(id));
      if (faltando.length === 0) return;
      contagemPorRegra[index] += 1;
      novasPermissoes.push(...faltando);
    });
    if (novasPermissoes.length > 0) {
      patches.push({ ref: doc.ref, novasPermissoes });
    }
  });

  REGRAS.forEach((regra, index) => {
    console.log(`"${regra.origem}" → concede [${regra.novas.join(', ')}]: ${contagemPorRegra[index]} usuário(s)`);
  });
  console.log(`Total de usuários que vão ganhar alguma permissão nova: ${patches.length}`);

  if (!shouldApply) {
    console.log('Simulação concluída. Nenhuma gravação foi feita. Use --apply após revisar o resultado.');
    return;
  }

  await commitPatches(patches);
  console.log(`Concluído: ${patches.length} usuário(s) atualizado(s).`);
};

main().catch((error) => {
  console.error('Falha ao migrar permissões separadas:', error);
  process.exitCode = 1;
});
