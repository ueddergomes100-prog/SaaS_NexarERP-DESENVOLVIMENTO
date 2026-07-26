# Migração do domínio financeiro

O script `server/scripts/migrate-financial-domain.js` prepara vendas e transações antigas para os novos campos monetários, de condição de pagamento, natureza financeira e vínculo explícito de vendedor.

Ele nunca grava por padrão. A execução sem `--apply` apenas consulta o tenant informado e mostra quantos documentos seriam atualizados.

```powershell
cd server
node scripts/migrate-financial-domain.js --tenant TENANT_ID
```

Depois de revisar a simulação e garantir que as credenciais apontam para o ambiente correto:

```powershell
node scripts/migrate-financial-domain.js --tenant TENANT_ID --apply
```

Rollback dos campos adicionados exclusivamente pela migração:

```powershell
node scripts/migrate-financial-domain.js --tenant TENANT_ID --rollback
```

Cada documento recebe o marcador `financialDomainMigrationV1`, com a lista exata dos campos adicionados. O script ignora documentos já marcados, usa lotes de até 350 gravações e não cria snapshots de comissão para vendas antigas, pois o percentual histórico não pode ser reconstruído com segurança a partir da configuração atual.
