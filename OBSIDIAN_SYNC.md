# Integração Obrigatória com Obsidian

O projeto Nexar ERP possui um vault oficial de documentação em:

`C:\Users\uedde\OneDrive\Área de Trabalho\Obsidian Uedder\uedder\Nexar ERP`

## Regra obrigatória

Toda alteração relevante no sistema deve ser documentada no Obsidian antes de ser considerada concluída.

Antes de alterar código, banco, regras, permissões, layout, fluxo ou deploy, consultar:

- `00 - Inicio/00 - INICIO - Nexar ERP.md`
- `01 - Sistema/Estado Atual do Projeto.md`
- `03 - Banco de Dados e Segurança/Regras Obrigatórias de Banco e Produção.md`
- `05 - Operacao e Deploy/Fluxo Obrigatório Codex + Obsidian.md`
- `06 - Roadmap/Próximas Atualizações.md`

## Ao finalizar qualquer tarefa

Atualizar no vault:

- Diário técnico do dia.
- Changelog manual.
- Página da funcionalidade alterada.
- Roadmap, se houver pendência nova.
- Decisões técnicas, se houve mudança de arquitetura ou regra.

## Regras permanentes

- Não abrir banco de produção localmente.
- Não fazer commit/push sem autorização explícita do usuário.
- Não alterar Firestore rules sem documentar motivo.
- Não considerar tarefa concluída sem registrar documentação quando a mudança for relevante.
