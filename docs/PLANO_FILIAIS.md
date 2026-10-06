# Plano — Filiais (2026-10-06, revisado com as decisões do dono)

Proposta aprovada nas decisões abaixo. **Nada implementado ainda.** Única pendência para começar: confirmar com o cliente se Sol Life e Solnatus viram um grupo (só afeta a migração deles, não o desenvolvimento).

## 1. O pedido

Controlar filiais no mesmo sistema, como no Integra (print de 06/10: seletor **"Filial: 10 - A & M / 20 - SOL LIFE / 30 - SOLNATUS / 40 - SOL LIFE"** na barra do topo). Ao trocar a filial, o sistema trabalha naquela filial. As filiais conversam: ver o estoque da outra, **transferir estoque**, emitir **nota de transferência**, com nota ou sem nota.

Exemplo do dono: o Shopping Rural pode ter a loja do Centro e a loja da Baixada (filiais do mesmo grupo). A Sol Natus é outra empresa (outro grupo, não enxerga nada do Shopping Rural).

## 2. Decisões do dono (06/10)

| Assunto | Decisão |
|---|---|
| Clientes | **Compartilhados no grupo**: o mesmo cadastro em todas as filiais. Vendas, notas e financeiro continuam de cada filial. |
| Produtos | **Cadastro único do grupo**, todas as filiais veem. **Preço e estoque são de cada filial.** |
| Filtro de produtos | Já vem marcado na filial em que o usuário está trabalhando. O item guarda **a filial em que foi cadastrado** (quem cadastrou com a filial 3 selecionada → item da filial 3). |
| Preço inicial | Quando uma filial começa a vender um item, o preço **copia o da matriz**; depois cada filial ajusta o seu. |
| Permissões | **As mesmas em todas** as filiais que o usuário acessa. |
| Permissão-chave | **"Utiliza outras filiais"**: libera trocar de filial, ver os itens das outras filiais, alterar o cadastro de item de outra filial e transferir. |
| Ver estoque das outras | **Todos os usuários, só a quantidade** (custo e valores das outras ficam escondidos). |
| Limite de crédito | **Do grupo**: a venda confere o que o cliente deve em todas as filiais somadas. |
| Transferência sem nota | Existe, ligada em Configurações, e **só dono e gerente** usam. |
| CNPJ / IE / estado | **Varia de cliente para cliente**: o sistema aceita filial com CNPJ e IE próprios no mesmo estado, em outro estado, ou do mesmo CNPJ (loja/depósito). |
| Cobrança | **Valor menor por filial adicional**, definido no painel da plataforma. |
| Sol Life e Solnatus | **O dono vai confirmar com o cliente** se viram um grupo. |

## 3. Como o sistema separa empresas hoje

- Cada empresa é um **tenant**: todo documento (cliente, produto, venda, nota, título, lote...) tem `tenantId`.
- As `firestore.rules` e o servidor descobrem a empresa de quem está logado por **um campo só**: `usuarios/{uid}.tenantId` (`currentTenantId()` nas rules, `server/middleware/auth.js`). O token de login não é usado para isso.
- Por empresa também: `configuracoes/{tenantId}` (CNPJ, regras de venda), `configuracoes_privadas/{tenantId}` (Spedy), `contadores/{tenantId}` (numeração), backup, logs.

## 4. O desenho: filial = tenant próprio, com CADASTRO ESPELHADO pelo servidor

```
Grupo "Shopping Rural"  (grupos/{grupoId})
 ├── 10 · Loja Centro   -> tenant A
 └── 20 · Loja Baixada  -> tenant B

 Em A e em B existe uma cópia de CADA cliente e de CADA produto do grupo, ligadas pela mesma
 `grupoChave`. Os dados do cadastro (nome, CPF/CNPJ, endereço; descrição, código, EAN, NCM,
 unidade, categoria...) são iguais nas cópias: alterou numa filial, o servidor repete nas outras.
 Preço, custo, estoque, lotes e promoções ficam só na cópia da filial.
 Vendas, OS, notas, financeiro, caixa e numeração são só da filial.
```

**Por que espelhar em vez de um cadastro único num lugar só:**
- Todo o sistema (PDV, Pedido, OS, Orçamento, Condicional, Trocas, app Vendas, NF-e, entrada de nota, lotes, produção, relatórios, as `firestore.rules` e o servidor) lê o produto e o estoque **da empresa ativa**, e mexe em `quantidade`/`precoVenda` daquele documento. Com o espelho, **nada disso muda**: cada filial tem seu documento de produto com o seu preço e o seu estoque.
- Cadastro único num lugar só exigiria trocar `quantidade` e `precoVenda` por "quantidade/preço da filial X" em todos os pontos de venda e de estoque (dezenas de pontos, no navegador e no servidor) e um campo de filial em toda venda, nota e título. Semanas a mais e risco alto de um erro misturar estoque de filiais.
- O custo do espelho é o **sincronizador** (seção 6) — um serviço só, testável, no servidor.

**Trocar de filial** = o servidor troca o `tenantId` ativo do usuário (depois de conferir o acesso). Rules e servidor passam a enxergar a outra filial sozinhos; **as regras de segurança não mudam**.

## 5. Dados novos

| Onde | O quê |
|---|---|
| `grupos/{grupoId}` | nome, `donoUid`, filiais `[{ tenantId, codigo: '10', nome, cnpj, uf, tipo: 'cnpj_proprio' \| 'mesmo_cnpj', matriz: true/false }]`, valor por filial adicional |
| `usuarios/{uid}` | `tenantId` = **filial ativa**; `grupoId`; `filiaisPermitidas: [tenantId...]`; permissão `filiais.utilizar` ("Utiliza outras filiais") |
| cliente/produto (cada cópia) | `grupoChave` (a mesma em todas as cópias), `filialOrigem` (tenant onde foi cadastrado), `vendeNestaFilial` (produto) |
| `contadores/grupo_{grupoId}` | código do cliente e do produto **único no grupo** (o cliente 488 é o 488 em todas as filiais) |
| `transferencias` | origem, destino, itens, situação, nota — escrita só pelo servidor |

## 6. Cadastro compartilhado (o sincronizador)

- **Clientes**: criar ou alterar em qualquer filial → o servidor cria/atualiza a cópia nas outras. Tudo do cliente é compartilhado (inclusive alerta, desconto padrão e limite de crédito); o que ele deve fica no financeiro de cada filial.
- **Produtos**: campos do cadastro são compartilhados; **preço, custo, estoque, estoque mínimo, lotes e promoções são da filial**. Quando uma filial começa a vender o item (entrada de estoque, transferência ou definir preço), o preço inicial vem **da matriz**.
- **Onde o item "é"**: `filialOrigem` = a filial selecionada quando foi cadastrado. O filtro das listas e buscas de produto (Estoque, PDV, Pedido, OS, Orçamento, etiquetas...) já vem em **"Itens desta filial"**; quem tem "Utiliza outras filiais" troca para **"Todos do grupo"**. Proposta a confirmar: item que **recebeu estoque** nesta filial (por transferência ou nota) também aparece em "Itens desta filial", senão a filial não acharia o que acabou de receber.
- **Quem altera**: sem "Utiliza outras filiais", o usuário altera só itens da própria filial; com a permissão, qualquer item. A alteração vale em todas as cópias e vai para o log com quem e de qual filial.
- Como o servidor garante: depois de cada gravação de cadastro a tela chama o servidor (`/api/grupo/cadastro/sincronizar`); uma conferência periódica acerta qualquer cópia que tenha ficado para trás (queda de internet, etc.). Cada cópia guarda a versão para não voltar dado antigo por cima de novo.
- Importações (planilha de produtos/clientes), entrada de NF-e que cria produto, cadastro rápido, app Vendas: todos passam pelo mesmo sincronizador.

## 7. Seletor e cadastro de filial

- **Seletor** na barra do topo: "Filial: 10 · Loja Centro ▾", só para quem tem "Utiliza outras filiais" e acesso a 2 filiais ou mais. Trocar fecha as abas abertas (perguntando se houver algo sem salvar) e recarrega na filial nova. A filial ativa é do usuário, não da janela.
- **Configurações → Filiais** (dono): código, nome, CNPJ (consulta automática), IE, endereço, tipo (CNPJ próprio ou mesmo CNPJ), qual é a matriz. Criar a filial já espelha clientes e produtos do grupo (preço da matriz, estoque zero) e copia as configurações.
- Spedy: filial com CNPJ próprio é cadastrada como empresa própria na Spedy (fluxo que já existe). Em geral o certificado e-CNPJ da matriz assina as notas das filiais de mesma raiz — confirmar com a Spedy. Filial "mesmo CNPJ" não emite nota própria (ou usa série separada — decidir na fase da NF-e).

## 8. Comunicação entre filiais

**a) Estoque nas outras filiais** — no produto, no PDV, no Pedido e na OS: "Centro: 12 · Baixada: 0", para **todos os usuários, só quantidade**.

**b) Limite de crédito do grupo** — ao vender a prazo, a conferência de limite soma o que o cliente deve em todas as filiais (servidor).

**c) Transferência de estoque** (tela nova em Estoque, quem tem "Utiliza outras filiais"):
- Origem = filial ativa; destino; itens (mesma `grupoChave`, então o produto sempre existe no destino); quantidade; lote/validade quando o produto controla lote; valor = custo médio da origem.
- **Rascunho → Enviada** (baixa na origem, "em trânsito") **→ Recebida** (entrada no destino com conferência) ou **Recusada** (volta).
- Tudo pelo servidor, numa transação nas duas filiais, com log nas duas.

**d) Com nota** — NF-e na origem pela Spedy. CFOP escolhido **sozinho pela UF das duas filiais**: **5152** (mesmo estado) / **6152** (outro estado) para revenda; **5151/6151** para produção própria. Destinatário = a filial destino; valores a custo. No destino, a entrada é lançada sozinha quando a nota é autorizada (**1152/2152**). Tributação (ICMS na transferência entre estabelecimentos do mesmo dono — STF ADC 49 e LC 204/2023; CSOSN no Simples) **configurável** em Configurações fiscais; o contador confirma por estado.

**e) Sem nota** — só controle de estoque, **só dono e gerente**, com aviso de que mercadoria entre CNPJs diferentes circula com nota. Entre filiais "mesmo CNPJ" é o caminho normal.

**f) Relatórios do grupo** — vendas, estoque e financeiro por filial e somados.

## 9. Fases e prazo (dias úteis; cada fase em branch própria, testada no dev)

| Fase | O quê | Prazo |
|---|---|---|
| F0 | Grupo, cadastro de filial, seletor, troca de filial pelo servidor, permissão "Utiliza outras filiais"; revisar os ~14 pontos que supõem "dono = empresa" | 5–7 |
| F1 | Cadastro compartilhado: sincronizador de clientes e produtos, código único do grupo, filial de origem, preço da matriz, filtro "Itens desta filial / Todos do grupo", conferência periódica | 6–8 |
| F2 | Estoque das outras filiais + limite de crédito do grupo | 2–3 |
| F3 | Transferência sem nota (envio, em trânsito, recebimento, recusa, lote, custo) | 4–5 |
| F4 | Transferência com NF-e + entrada automática no destino | 4–6 (depende do contador e da Spedy) |
| F5 | Relatórios do grupo + valor por filial no painel da plataforma | 2–3 |
| | **Total** | **23–32 (≈ 5 a 6,5 semanas)** |

## 10. Juntar empresas que já existem (ex.: Sol Life + Solnatus)

Com cadastro compartilhado, juntar duas empresas num grupo **não é mais só ligar**: é preciso **unificar os cadastros** — produto casado por código de barras e código, cliente casado por CPF/CNPJ, sobras viram itens da filial de origem — e dar ao cliente um relatório do que foi juntado antes de gravar. Ferramenta própria (≈ 3–4 dias), feita só se o cliente confirmar.

## 11. Cuidados

- Cobrança: valor da filial adicional no painel da plataforma; Super Admin passa a listar grupos e filiais.
- Backup: por filial (já é por tenant) + do grupo.
- Vendedor externo (app Vendas), PDV e agente de WhatsApp pertencem a uma filial.
- Limite de usuários do plano: por grupo.
- Filial "mesmo CNPJ": numeração/série da NF-e para não colidir com a matriz.
