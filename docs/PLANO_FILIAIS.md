# Plano — Filiais (2026-10-06)

Proposta para o dono aprovar. **Nada implementado ainda.**

## 1. O pedido

Controlar filiais no mesmo sistema, como no Integra (print de 06/10: seletor **"Filial: 10 - A & M / 20 - SOL LIFE / 30 - SOLNATUS / 40 - SOL LIFE"** na barra do topo). Ao trocar a filial, tudo passa a ser daquela filial: produtos, clientes, notas, vendas. "Basicamente uma base nova, porém dentro da empresa." As filiais precisam conversar: ver o estoque da outra, **transferir estoque**, emitir **nota de transferência**, com nota ou sem nota.

Exemplo do dono: o Shopping Rural pode ter a loja do Centro e a loja da Baixada (filiais, conversam entre si). A Sol Natus é outra empresa (outro grupo, não enxerga nada do Shopping Rural).

## 2. Como o sistema separa empresas hoje

- Cada empresa é um **tenant**: todo documento (cliente, produto, venda, nota, título, lote...) tem `tenantId`.
- As `firestore.rules` e o servidor descobrem a empresa de quem está logado por **um campo só**: `usuarios/{uid}.tenantId` (`currentTenantId()` nas rules, `server/middleware/auth.js` no servidor). O token de login não é usado para isso.
- Por empresa também: `configuracoes/{tenantId}` (dados da empresa, CNPJ, regras de venda), `configuracoes_privadas/{tenantId}` (chave da Spedy), `contadores/{tenantId}` (numeração de pedido, OS, NF...), backup, logs.
- O "registro da empresa" hoje é o cadastro do dono: `usuarios/{tenantId}` (plano, módulos bloqueados, limite de usuários) — o `tenantId` da empresa é o `uid` do dono.

## 3. A proposta: cada filial é uma empresa (tenant) dentro de um GRUPO

```
Grupo "Shopping Rural"  (grupos/{grupoId})
 ├── 10 · Loja Centro    -> tenant A  (clientes, produtos, vendas, notas, financeiro, numeração próprios)
 └── 20 · Loja Baixada   -> tenant B  (idem)

Grupo "Sol Natus"        -> outro grupo, não vê nada do Shopping Rural
```

**Por que assim:**
- A separação "tudo individual" **já existe e já está testada** em todas as telas, regras, índices, numeração, Spedy (um CNPJ por tenant) e backup. Filial nova nasce separada de graça.
- **As regras do Firestore não mudam.** Trocar de filial = o servidor troca o `tenantId` ativo no cadastro do usuário (depois de conferir que ele tem acesso àquela filial). Rules e servidor passam a enxergar a outra filial sozinhos.
- Empresas que já existem podem ser **juntadas num grupo sem migrar dado nenhum** (cada uma vira uma filial do grupo).
- O que é "comunicação entre filiais" (estoque da outra, transferência, relatório do grupo) passa pelo **servidor**, que confere o grupo e o acesso antes de ler/gravar em duas filiais.

**Alternativa descartada:** um campo `filialId` em todo documento dentro do mesmo tenant. Exigiria mexer em todas as consultas, regras e índices do sistema (centenas de pontos), com risco real de dado de uma filial aparecer na outra. Meses de trabalho e teste.

## 4. Dados novos

| Onde | O quê |
|---|---|
| `grupos/{grupoId}` | nome do grupo, `donoUid`, lista de filiais `[{ tenantId, codigo: '10', nome, cnpj, uf, ativa }]` na ordem do seletor |
| `usuarios/{uid}` | `tenantId` = **filial ativa** (o que rules/servidor já usam); `grupoId`; `filiaisPermitidas: [tenantId...]`; fase 2: `permissoesPorFilial` |
| filial nova | `configuracoes/{tenantId}` (CNPJ, IE, endereço da filial), `contadores/{tenantId}`, `configuracoes_privadas/{tenantId}` (Spedy), e o registro da empresa (hoje `usuarios/{tenantId}`, sem login, com plano/módulos herdados do grupo) |
| `transferencias` | uma por transferência, com `tenantOrigem`, `tenantDestino`, itens, situação, nota (escrita só pelo servidor) |

## 5. Seletor de filial (igual ao print)

- Na barra do topo, ao lado do usuário: **"Filial: 10 · Loja Centro ▾"**. Só aparece para quem tem acesso a 2 filiais ou mais (empresa de uma filial só não vê nada novo).
- Trocar: `POST /api/filiais/ativar` → servidor confere `filiaisPermitidas`, grava a filial ativa → o sistema fecha as abas abertas (são dados da filial anterior) e recarrega na filial nova. Se houver aba com alteração não salva, pergunta antes.
- **Limite consciente:** a filial ativa é do usuário, não da janela. Duas janelas do mesmo usuário trocam juntas (no Integra também é uma filial por vez). Para trabalhar em duas filiais ao mesmo tempo, dois usuários.
- Cabeçalho de impressão, DANFE, recibo, PDV etc. já saem com os dados da filial ativa (vêm de `configuracoes/{tenantId}`).

## 6. Cadastro de filial

Tela **Configurações → Filiais** (só o dono/administrador do grupo):
- Código (10, 20...), nome, CNPJ (consulta automática como no cadastro de empresa), IE, endereço.
- Ao criar, opção de **copiar da matriz**: configurações, produtos (sem estoque), categorias, marcas, unidades, formas de pagamento, usuários que terão acesso.
- Spedy: a filial é cadastrada como empresa própria (CNPJ dela), pelo fluxo que já existe no painel da plataforma. Em geral o certificado e-CNPJ da matriz assina as notas das filiais de mesma raiz — confirmar com a Spedy.

## 7. Comunicação entre filiais

**a) Estoque nas outras filiais** — no cadastro do produto, no Pedido e no PDV: "Centro: 12 · Baixada: 0". O produto é casado entre filiais pelo **código**, depois pelo **código de barras (EAN)**.

**b) Transferência de estoque** (tela nova em Estoque):
- Origem = filial ativa; escolhe o destino e os itens (quantidade; lote/validade quando o produto controla lote).
- Valor = custo médio da origem; o destino recalcula o custo médio na entrada.
- Situações: **Rascunho → Enviada** (baixa na origem, fica "em trânsito") **→ Recebida** (entrada no destino, com conferência das quantidades) ou **Recusada** (volta para a origem).
- Produto que não existe no destino: o sistema oferece criar a cópia do cadastro lá.
- Tudo gravado pelo servidor numa transação só (as duas filiais), com log nas duas.

**c) Com nota** — NF-e de transferência emitida na origem pela Spedy:
- CFOP **5152** (mesmo estado) / **6152** (outro estado) para mercadoria de revenda; **5151/6151** para produção própria. Destinatário = a filial destino. Valores a custo.
- No destino, a entrada é lançada sozinha quando a nota é autorizada (CFOP **1152/2152**), sem importar XML.
- Tributação (ICMS na transferência entre estabelecimentos do mesmo dono — STF ADC 49 e LC 204/2023; CSOSN no Simples) fica **configurável** em Configurações fiscais, não fixa no código. O contador confirma por estado.

**d) Sem nota** — movimentação interna, só controle de estoque. Ligada por uma configuração ("Permitir transferência sem nota"), com aviso: mercadoria entre CNPJs diferentes circula com nota. Serve para acerto entre depósitos/lojas do mesmo CNPJ ou correção.

**e) Relatórios do grupo** — vendas, estoque e financeiro por filial e somados (no servidor, só para quem tem acesso às filiais).

## 8. O que é de cada filial e o que é do grupo

| Cada filial | Do grupo |
|---|---|
| Clientes, produtos e estoque, preços | Lista de filiais e quem acessa cada uma |
| Vendas, OS, orçamentos, pré-vendas, condicional | Transferências entre filiais |
| NF-e/NFC-e, série e numeração, Spedy | Relatórios consolidados |
| Financeiro (contas, bancos, caixa) | Dono do grupo (troca para qualquer filial) |
| Configurações, vendedores, app Vendas | |

## 9. Fases e prazo (dias úteis, cada fase em branch própria, testada no dev)

| Fase | O quê | Prazo |
|---|---|---|
| F0 | Grupo, cadastro de filial (com cópia da matriz), seletor e troca de filial pelo servidor; revisar os ~14 pontos que hoje supõem "dono = empresa" (`uid === tenantId`, `usuarios/{tenantId}` como registro da empresa, `storage.rules`) | 5–7 |
| F1 | Estoque nas outras filiais (produto, Pedido, PDV) | 2 |
| F2 | Transferência sem nota: envio, em trânsito, recebimento, recusa, lote, custo | 4–5 |
| F3 | Transferência com NF-e + entrada automática no destino | 4–6 (depende do contador e da Spedy) |
| F4 | Relatórios e painel do grupo | 2–3 |
| | **Total** | **17–23 (≈ 3,5 a 4,5 semanas)** |

## 10. Cuidados

- Cobrança: cada filial é uma empresa a mais no plano?
- Backup: um por filial (já é por tenant) + backup do grupo.
- Vendedor externo, PDV e agente de WhatsApp pertencem a uma filial.
- Super Admin passa a listar grupos e filiais.
- Limite de usuários do plano: por filial ou do grupo.

## 11. Decisões que preciso do dono

1. **Clientes** totalmente separados por filial (como foi dito), com um botão "copiar cliente de outra filial"? Ou cliente do grupo visível em todas?
2. **Produtos**: ao criar a filial, copiar o catálogo da matriz? Cada filial com o seu preço de venda?
3. **Usuários**: a mesma permissão em todas as filiais que acessam, ou permissão diferente por filial?
4. **Transferência sem nota**: liberar? Para quem?
5. Cada filial tem **CNPJ e IE próprios** (mesma raiz)? Alguma em outro estado (CFOP 6152)?
6. **Cobrança**: filial conta como uma empresa a mais na mensalidade?
7. **Sol Life e Solnatus**: no Integra aparecem como filiais (20 e 30) da mesma instalação. No Hennder viram um grupo (filiais) ou continuam empresas separadas? Juntar não exige migrar dados.
8. Quem pode **ver o estoque das outras filiais**: todos os usuários ou só gerente e dono?
