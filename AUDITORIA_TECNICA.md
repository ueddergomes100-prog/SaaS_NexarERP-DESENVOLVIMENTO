# Auditoria Tecnica do Sistema Nexus

Ultima atualizacao: 2026-06-16

Este arquivo existe para registrar pontos tecnicos que nao impedem o sistema de rodar hoje, mas que devem ser reavaliados em auditorias futuras. Quando uma nova analise completa for solicitada, use este arquivo como comparativo.

## Estado registrado em 2026-06-16

Na auditoria/correcao realizada nesta data:

- Typecheck passou sem erros.
- Build de producao passou.
- Backend alterado passou em verificacao de sintaxe com `node --check`.
- `git diff --check` passou, restando apenas avisos normais de fim de linha no Windows.
- ESLint completo passou com 0 erros e 114 warnings.

Os 114 warnings restantes foram classificados como divida tecnica controlada, nao como quebra imediata do sistema.

## O que estes warnings significam

### Baixo risco

Estes warnings normalmente nao quebram o sistema, mas deixam o codigo menos limpo:

- Imports nao utilizados.
- Variaveis declaradas e nao utilizadas.
- Variaveis que poderiam ser `const`.
- Pequenos restos de desenvolvimento.

Impacto esperado:

- Mais ruido ao revisar codigo.
- Manutencao um pouco mais dificil.
- Maior chance de confusao para quem entrar no projeto depois.

Prioridade sugerida: baixa, corrigir em uma rodada de limpeza.

### Medio risco

Os warnings mais importantes sao os de `react-hooks/exhaustive-deps`, principalmente `useEffect` com dependencias faltando.

Possiveis impactos:

- Tela nao atualizar quando `tenantId`, usuario ou permissao muda.
- Dados antigos permanecerem em tela.
- Listener Firestore continuar usando estado antigo.
- Comportamento inconsistente ao trocar de usuario, tenant ou permissao.

Prioridade sugerida: media, corrigir com cuidado e por tela.

Observacao importante: nao corrigir todos os `useEffect` automaticamente. Em alguns casos, adicionar dependencias sem ajustar funcoes com `useCallback` pode causar loop de renderizacao ou chamadas repetidas.

## Quando esta na hora de corrigir

Corrigir estes warnings deve virar prioridade quando acontecer qualquer uma destas situacoes:

- O numero de warnings subir acima de 150.
- Aparecer qualquer erro no ESLint.
- Alguma tela carregar dados errados ao trocar usuario, permissao ou empresa.
- Surgirem bugs intermitentes em listas, dashboards, relatorios, financeiro, OS ou vendas.
- O sistema for preparado para uma fase maior de producao/multitenant.
- Antes de uma refatoracao grande em permissoes, dashboards, relatorios ou financeiro.

## Plano recomendado para correcao futura

1. Rodar `npm run lint` e salvar a quantidade atual de warnings.
2. Corrigir primeiro imports, variaveis nao usadas e `prefer-const`.
3. Depois revisar `useEffect` por modulo, sem fazer mudanca automatica em massa.
4. Priorizar telas que usam `tenantId`, permissoes ou listeners Firestore.
5. Rodar `npm run lint`, typecheck e build apos cada lote.

## Modulos que merecem atencao especial

Priorizar estes modulos se a limpeza for feita:

- Dashboard.
- TopBar/notificacoes.
- Financeiro.
- OS e relatorios mecanicos.
- Vendas e relatorios de vendas.
- CRM agenda/lembretes.
- Configuracoes e permissoes.
- Backup/SuperAdmin.

## Regra operacional importante

Nao abrir ou conectar banco de producao localmente para investigar estes warnings. A analise deve ser feita por codigo, build, lint e ambiente de desenvolvimento/testes.

## Conclusao registrada

Em 2026-06-16, os warnings restantes nao foram considerados bloqueadores. Eles devem ser tratados como limpeza tecnica e prevencao de bugs futuros, principalmente os relacionados a `useEffect`.
