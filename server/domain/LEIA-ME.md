# server/domain — arquivos GERADOS, não edite à mão

Estes `.js` são os módulos de regra de `src/utils/*.ts` (dinheiro, datas,
metadados) compilados para CommonJS, para o servidor usar **as mesmas regras**
que as telas, sem uma segunda versão escrita à mão.

- Gerar de novo: `node scripts/build-server-domain.mjs`
- Conferir se está em dia: `node scripts/build-server-domain.mjs --check`
  (roda no gate de push — `.githooks/pre-push`)

Mudou um desses arquivos em `src/utils/`? Rode o script e faça commit desta
pasta junto. Precisa de outro módulo no servidor? Inclua em `MODULOS` no script
(e tudo que ele importa; módulo que importa navegador/Firebase não pode entrar).

Origem: item 8 da auditoria de infraestrutura, fatia 1 (2026-10-05).
