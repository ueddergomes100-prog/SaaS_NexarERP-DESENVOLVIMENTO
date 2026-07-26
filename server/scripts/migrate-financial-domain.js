const { admin, db } = require('../config/firebase');

const MIGRATION_FIELD = 'financialDomainMigrationV1';
const MAX_BATCH_WRITES = 350;

const readArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};

const tenantId = readArgument('--tenant');
const shouldApply = process.argv.includes('--apply');
const shouldRollback = process.argv.includes('--rollback');

if (!tenantId) {
  console.error('Uso: node scripts/migrate-financial-domain.js --tenant <tenantId> [--apply|--rollback]');
  process.exit(1);
}
if (shouldApply && shouldRollback) {
  console.error('Escolha apenas --apply ou --rollback.');
  process.exit(1);
}
if (!db) {
  console.error('Firestore Admin não foi inicializado. Configure as credenciais do ambiente.');
  process.exit(1);
}

const toCents = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const fromCents = (value) => Number((Number(value || 0) / 100).toFixed(2));

const financialNature = (method) => {
  if (method === 'Dinheiro') return 'caixa_fisico';
  if (method === 'Pix' || method === 'Transferência') return 'bancario_digital';
  if (method === 'Crédito de Devolução') return 'credito_cliente';
  return 'contas_receber';
};

const paymentCondition = (data) => (
  data.condicaoPagamento === 'aprazo' || String(data.formaPagamento || '').includes('Prazo')
    ? 'aprazo'
    : 'avista'
);

const addField = (source, patch, addedFields, key, value) => {
  if (source[key] !== undefined) return;
  patch[key] = value;
  addedFields.push(key);
};

const paymentFromLegacy = (transactionId, transactionData, fallbackSale) => {
  const method = transactionData?.formaPagamento || fallbackSale.formaPagamento || 'Outros';
  const valueCents = Number(
    transactionData?.valorCentavos ??
    fallbackSale.valorTotalCentavos ??
    toCents(transactionData?.valor ?? fallbackSale.valorTotal),
  );
  const paid = (transactionData?.status || (fallbackSale.totalPendente > 0 ? 'Pendente' : 'Paga')) === 'Paga';
  const record = {
    id: transactionId,
    indice: Number(transactionData?.paymentIndex || 1),
    transactionId,
    formaPagamento: method,
    condicaoPagamento: paymentCondition(transactionData || fallbackSale),
    valorCentavos: valueCents,
    valor: fromCents(valueCents),
    status: paid ? 'confirmado' : 'pendente',
    naturezaFinanceira: financialNature(method),
    movimentaCaixaFisico: paid && method === 'Dinheiro',
  };
  if (transactionData?.prazoDias) record.prazoDias = Number(transactionData.prazoDias);
  if (transactionData?.dataVencimento) record.dataVencimento = transactionData.dataVencimento;
  if (transactionData?.dataPrevistaRecebimento) {
    record.dataPrevistaRecebimento = transactionData.dataPrevistaRecebimento;
  }
  if (transactionData?.cartao) record.cartao = transactionData.cartao;
  return record;
};

const buildTransactionPatch = (document) => {
  const data = document.data();
  if (data[MIGRATION_FIELD]) return null;
  const patch = {};
  const addedFields = [];
  const valueCents = Number(data.valorCentavos ?? toCents(data.valor));
  const method = data.formaPagamento || 'Outros';

  addField(data, patch, addedFields, 'valorCentavos', valueCents);
  addField(data, patch, addedFields, 'condicaoPagamento', paymentCondition(data));
  addField(data, patch, addedFields, 'naturezaFinanceira', financialNature(method));
  addField(
    data,
    patch,
    addedFields,
    'movimentaCaixaFisico',
    data.status === 'Paga' && method === 'Dinheiro',
  );
  addField(data, patch, addedFields, 'idempotencyKey', `transacao:legado:${document.id}`);

  patch[MIGRATION_FIELD] = {
    version: 1,
    addedFields,
    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  return patch;
};

const buildSalePatch = (document, transactionDocuments) => {
  const data = document.data();
  if (data[MIGRATION_FIELD]) return null;
  const patch = {};
  const addedFields = [];
  const totalCents = Number(data.valorTotalCentavos ?? toCents(data.valorTotal));
  const itemsTotalCents = Number(data.valorTotalItensCentavos ?? toCents(data.valorTotalItens ?? data.valorTotal));
  const discountCents = Number(data.valorTotalDescontosCentavos ?? toCents(data.valorTotalDescontos));

  addField(data, patch, addedFields, 'valorTotalCentavos', totalCents);
  addField(data, patch, addedFields, 'valorTotalItensCentavos', itemsTotalCents);
  addField(data, patch, addedFields, 'valorTotalDescontosCentavos', discountCents);
  addField(data, patch, addedFields, 'condicaoPagamento', paymentCondition(data));
  addField(data, patch, addedFields, 'vendedorId', data.usuarioResponsavelId || '');

  const existingPayments = Array.isArray(data.pagamentos) ? data.pagamentos : [];
  let payments = existingPayments;
  if (payments.length === 0) {
    const linkedTransactions = transactionDocuments.filter((transactionDocument) => {
      const transaction = transactionDocument.data();
      return transaction.pedidoId === document.id || transactionDocument.id === document.id;
    });
    payments = linkedTransactions.length > 0
      ? linkedTransactions.map((transactionDocument) => (
        paymentFromLegacy(transactionDocument.id, transactionDocument.data(), data)
      ))
      : [paymentFromLegacy(document.id, null, data)];
    addField(data, patch, addedFields, 'pagamentos', payments);
  }

  const receivedCents = payments
    .filter((payment) => payment.status === 'confirmado')
    .reduce((sum, payment) => sum + Number(payment.valorCentavos ?? toCents(payment.valor)), 0);
  const pendingCents = payments
    .filter((payment) => payment.status !== 'confirmado')
    .reduce((sum, payment) => sum + Number(payment.valorCentavos ?? toCents(payment.valor)), 0);
  addField(data, patch, addedFields, 'totalRecebidoCentavos', receivedCents);
  addField(data, patch, addedFields, 'totalRecebido', fromCents(receivedCents));
  addField(data, patch, addedFields, 'totalPendenteCentavos', pendingCents);
  addField(data, patch, addedFields, 'totalPendente', fromCents(pendingCents));

  patch[MIGRATION_FIELD] = {
    version: 1,
    addedFields,
    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
    commissionSnapshotCreated: false,
  };
  return patch;
};

const commitPatches = async (patches) => {
  for (let index = 0; index < patches.length; index += MAX_BATCH_WRITES) {
    const batch = db.batch();
    patches.slice(index, index + MAX_BATCH_WRITES).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
};

const rollbackPatches = (documents) => documents.flatMap((document) => {
  const marker = document.data()[MIGRATION_FIELD];
  if (!marker || !Array.isArray(marker.addedFields)) return [];
  const data = { [MIGRATION_FIELD]: admin.firestore.FieldValue.delete() };
  marker.addedFields.forEach((field) => {
    data[field] = admin.firestore.FieldValue.delete();
  });
  return [{ ref: document.ref, data }];
});

const main = async () => {
  const [salesSnapshot, transactionsSnapshot] = await Promise.all([
    db.collection('pedidos_venda').where('tenantId', '==', tenantId).get(),
    db.collection('transacoes').where('tenantId', '==', tenantId).get(),
  ]);
  const salesDocuments = salesSnapshot.docs;
  const transactionDocuments = transactionsSnapshot.docs;

  if (shouldRollback) {
    const patches = [
      ...rollbackPatches(salesDocuments),
      ...rollbackPatches(transactionDocuments),
    ];
    console.log(`Rollback preparado para ${patches.length} documento(s) do tenant ${tenantId}.`);
    await commitPatches(patches);
    console.log('Rollback concluído.');
    return;
  }

  const transactionPatches = transactionDocuments
    .map((document) => ({ ref: document.ref, data: buildTransactionPatch(document) }))
    .filter((item) => item.data);
  const salePatches = salesDocuments
    .map((document) => ({
      ref: document.ref,
      data: buildSalePatch(document, transactionDocuments),
    }))
    .filter((item) => item.data);
  const patches = [...transactionPatches, ...salePatches];

  console.log(`Tenant: ${tenantId}`);
  console.log(`Vendas encontradas: ${salesDocuments.length}; a migrar: ${salePatches.length}.`);
  console.log(`Transações encontradas: ${transactionDocuments.length}; a migrar: ${transactionPatches.length}.`);
  console.log('Snapshots de comissão não são criados para registros legados, evitando aplicar percentuais atuais ao passado.');

  if (!shouldApply) {
    console.log('Simulação concluída. Nenhuma gravação foi feita. Use --apply após revisar o resultado.');
    return;
  }

  await commitPatches(patches);
  console.log(`Migração concluída: ${patches.length} documento(s) atualizado(s).`);
};

main().catch((error) => {
  console.error('Falha na migração financeira:', error);
  process.exitCode = 1;
});
