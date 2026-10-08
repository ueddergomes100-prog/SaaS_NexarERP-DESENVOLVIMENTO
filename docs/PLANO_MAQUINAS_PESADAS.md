# Plano — Oficinas de máquinas pesadas e app do técnico de campo

Pedido do dono em 07/10/2026 (noite), a partir do talão de OS em papel de uma
empresa de peças e manutenção de máquinas (C Máquinas). O sistema já atende bem
oficinas de veículos; a ideia é atender também oficinas de **tratores e máquinas
pesadas**, com serviço **externo** (campo, roça), sem criar um segundo sistema.

## 1. Decisões do dono (07/10)

- **Uma chave em Configurações** — "Empresa de máquinas pesadas" — desligada por
  padrão. Ligada, a OS (e o que gira em volta dela) muda de rótulos, campos e
  impressão. Nada muda para quem não ligar.
- **Peças no campo**: a OS pode sair da oficina **já com as peças pré-lançadas**;
  no campo o técnico acrescenta o que usou a mais e tira o que não usou. Isso
  **registra e reserva o estoque**. A tela de Estoque ganha a coluna
  **"Reservado"** (sem abrir o cadastro do item) e **toda busca de produto**
  mostra quando o item tem estoque reservado.
- **Deslocamento**: preço do km **pré-configurado**; o técnico só informa a
  quantidade de km e o sistema calcula o valor (vira linha de serviço).
- **Técnico abre OS pelo celular** e atende; também vê as OS que a oficina
  abriu e atribuiu a ele.
- **Offline desde a primeira versão**: "já temos o app mobile, é só melhorar".
- Como em tudo que é novo: **configurável e desligado por padrão**; o que já
  funciona para oficina de veículo não muda.

## 2. O que já existe e é reaproveitado

| Já existe | Onde | Como entra |
|---|---|---|
| OS completa (cliente, veículo, serviços, peças, pagamento, estoque por lote, comissão) | `src/pages/OS/OSForm.tsx` | ganha rótulos/campos do modo máquinas; o salvamento em `runTransaction` continua o mesmo |
| Dois modelos de impressão da OS, escolhidos em Configurações | `OsPrintDocument.tsx`, `modeloImpressaoOS` | entra o terceiro modelo, igual ao talão |
| Cadastro de Veículos (placa, marca, modelo, ano, cor, KM) | `src/pages/Veiculos` | vira "Equipamentos" quando a chave liga (frota, série/chassi, horímetro) |
| Reserva de estoque (`quantidadeReservada`) na pré-venda e na condicional | `preVendaDomain.ts`, `condicionalDomain.ts` | a OS passa a reservar do mesmo jeito; a lista e as buscas passam a mostrar |
| App Vendas (PWA, login código+PIN, acesso vendido à parte, consulta de OS e impressão) | `src/pages/Vendedor/*`, `vendedor.html` | ganha o perfil do técnico: Minhas OS, nova OS, atendimento, fotos, assinatura |
| Frota e custo por veículo | `Frota e Custo por Veiculo` | o veículo da empresa usado no deslocamento |
| Mensagens padrão, numeração e documentos por filial (07/10) | Configurações | valem para a OS de máquinas sem nada a mais |

## 3. Fases

### Fase 1 — Chave "Máquinas pesadas" e OS adaptada no desktop (≈ 4 dias)

- `configuracoes.oficinaMaquinasPesadas: boolean` (padrão `false`) e
  `src/utils/oficinaDomain.ts` com os **rótulos** por modo (Veículo/Equipamento,
  Placa/Frota, KM/Horímetro, Mecânico/Técnico, Defeito relatado/Reclamação do
  cliente) e a **regra de identificação**: no modo máquinas a placa deixa de ser
  obrigatória — basta frota **ou** série/chassi.
- Campos novos na OS (`ordens_de_servico`) e no cadastro (`veiculos`, mesma
  coleção, sem migração): `frota`, `serie` (chassi), `horimetro`,
  `tipoEquipamento` (trator, colheitadeira, retroescavadeira… lista
  configurável). `modelo` e `marca` continuam.
- **Bloco "Deslocamento para atendimento"** na OS:
  `deslocamento: { kmInicial, kmFinal, km, horaSaida, horaChegada, local,
  veiculoEmpresaId, veiculoEmpresaNome }`. Em Configurações:
  `precoKmDeslocamento` (R$/km) e `valorVisita` (opcional, fixo). Ao informar
  os km, o sistema cria/atualiza a linha de serviço **"Deslocamento — N km"**
  (km × preço + visita), editável como qualquer serviço.
- **Modelo de impressão "Máquinas pesadas"** (`maquinas-pesadas`), fiel ao
  talão: cabeçalho (cliente, modelo do equipamento, frota/placa, série/chassi,
  data, nº da OS, responsável, hora início/término, horímetro), reclamação do
  cliente, grade de peças/serviços (item, unid., quant., R$, total), bloco de
  deslocamento (KM inicial/final, hora, local), técnico/veículo, observações,
  total, texto de concordância e assinatura do cliente (data e local). Entra
  na lista de modelos e é escolhido sozinho quando a chave liga (dá para trocar).
- Lista de OS, busca e Orçamento com os mesmos rótulos (Frota/Série no lugar
  da placa). Relatório de Serviços idem.
- Testes de domínio (rótulos, obrigatoriedade, cálculo do deslocamento).

### Fase 2 — Reserva de estoque na OS e visível em todo lugar (≈ 2 dias)

- OS em aberto (Orçamento Pendente, Aguardando Peça, Em atendimento) com peças
  lançadas **reserva** `quantidadeReservada` no produto, dentro da mesma
  transação de salvamento (mesma trava da condicional: disponível = quantidade
  − reservada). Finalizar baixa e libera a reserva; cancelar libera; editar
  ajusta a diferença. Vale para os dois modos (veículos também se beneficia) —
  **ligado por configuração** ("Reservar estoque das peças da OS em aberto"),
  padrão desligado para não mudar quem já usa.
- Conferir e **unificar** o número: pré-venda e condicional já reservam;
  garantir que todas gravam/leem o mesmo `quantidadeReservada`.
- **Estoque**: colunas **Reservado** e **Disponível** na lista (sem abrir o
  item) e filtro "só com reserva"; clicar no número mostra de onde vem a
  reserva (pré-venda nº, condicional nº, OS nº).
- **Buscas de produto** (ProductAutocomplete, ProductSearchModal, PDV, Pedido,
  OS, Orçamento, app Vendas): quando `quantidadeReservada > 0`, a linha mostra
  "Reservado: N · Disponível: M" em destaque.

### Fase 3 — App do técnico, online (≈ 5 dias)

Dentro do app Vendas (mesma PWA, mesmo login código+PIN, mesmo
`acessoAppMobile` vendido à parte). Quem tem `mecanica.os` + `mecanica.os_alterar`
vê o perfil do técnico; o vendedor comum continua vendo só o dele.

- **Minhas OS**: atribuídas a mim + abertas por mim, por status, com busca.
- **Nova OS**: cliente (busca + cadastro rápido), equipamento do cliente
  (escolher ou cadastrar: modelo, frota, série, horímetro), reclamação, hora
  de início. Nasce **"Em atendimento"** (status novo) com `tecnicoId`.
- **Atendimento**: peças pré-lançadas com +/− e remover; adicionar peça
  (busca já existe no app); serviços; **km de deslocamento → valor
  calculado**; horímetro; **observação do serviço feito**; **fotos** (câmera,
  comprimidas no aparelho, Storage `empresas/{tenant}/os/{osId}/…`, regra
  nova em dev **e** produção, limite de tamanho e tipo imagem);
  **assinatura do cliente** na tela (canvas → PNG no Storage), que sai na
  impressão.
- **"Concluir atendimento"** → status **"Aguardando conferência"**: a OS fica
  destacada na lista do desktop; a oficina confere, ajusta e **finaliza com
  pagamento** como hoje (estoque baixa, comissão, financeiro). O app **nunca**
  fecha financeiro — mesmo princípio da pré-venda.
- Impressão da OS no app com o modelo de máquinas (já existe impressão de OS
  no app); galeria de fotos e assinatura visíveis na OS do desktop.
- Enquanto a OS está "Em atendimento" no campo, o desktop **avisa** antes de
  editar (evita sobrescrever o que o técnico ainda não enviou).

### Fase 4 — Offline (≈ 5 dias)

- **Fila local** (IndexedDB) de tudo que o técnico faz na OS: abrir, lançar
  peça/serviço, deslocamento, observação, fotos, assinatura, concluir. Envia
  sozinho quando volta o sinal e tem o botão "Enviar pendentes"; indicador
  "N pendentes" no topo. Fotos ficam na fila até subir.
- **Catálogo no aparelho**: peças, serviços, clientes e equipamentos baixados
  ao abrir com sinal (atualização incremental por `updatedAt`), para buscar e
  lançar sem rede.
- **Service worker** com cache dos arquivos do `vendedor.html` (hoje `sw.js`
  é passthrough): o app abre sem sinal.
- **Reserva de estoque só acontece ao sincronizar** (offline não dá para
  reservar) — o app diz isso claramente; se ao sincronizar faltar estoque,
  a OS vai com aviso "estoque insuficiente" para a oficina resolver (não
  trava o técnico).
- Conflito: o que o técnico lançou vence nos itens dele; a oficina não edita
  OS "Em atendimento" sem confirmar (fase 3).
- O mesmo motor de fila + catálogo serve o **modo offline do vendedor**
  (pendência aprovada em setembro) — sai junto, sem retrabalho.

### Fase 5 — Acabamento (≈ 1 dia)

Rótulos em Relatório de Serviços e Frota; deslocamento alimenta o KM do
veículo da empresa (Frota); textos padrões da OS; documentação (vault,
docs); limpeza de dados de teste do dev.

### Total: ≈ 17 dias úteis, em branch própria (worktree), testado no dev antes de juntar.

## 4. Modelo de dados (resumo)

- `configuracoes/{tenant}`: `oficinaMaquinasPesadas`, `tiposEquipamento[]`,
  `precoKmDeslocamento`, `valorVisita`, `reservarEstoqueOS`,
  `modeloImpressaoOS: 'maquinas-pesadas'`.
- `veiculos/{id}`: + `frota`, `serie`, `horimetro`, `tipoEquipamento`.
- `ordens_de_servico/{id}`: + `frota`, `serie`, `horimetro`, `tipoEquipamento`,
  `deslocamento{}`, `tecnicoId/tecnicoNome` (= mecânico), `fotos[]`
  (`{caminho, url, legenda, em}`), `assinaturaCliente{caminho, em, local}`,
  `origem: 'app_tecnico'`, `atendimentoCampo{inicio, fim, concluidoEm}`,
  status novos **"Em atendimento"** e **"Aguardando conferência"**.
- `estoque/{id}`: `quantidadeReservada` (já existe) passa a ser a fonte única.
- Storage: `empresas/{tenantId}/os/{osId}/{arquivo}`.

## 5. Segurança e regras

- `firestore.rules`: técnico com `mecanica.os_alterar` grava em
  `ordens_de_servico` e ajusta `estoque.quantidadeReservada` (só esse campo,
  pela transação) — conferir o que a pré-venda já libera e reaproveitar.
- `storage.rules`: `empresas/{tenantId}/os/**` — leitura para usuário do
  tenant; escrita só imagem, até 5 MB, usuário do tenant. **Publicar em dev
  e produção antes do app** (produção o dono publica).
- Nada roda contra produção a partir da máquina local.

## 6. Fora deste plano (anotado, sem data)

- Agenda de visitas / rota do dia com GPS.
- Checklist de inspeção por tipo de máquina.
- Contrato de manutenção por horas (horímetro) com aviso de revisão.
- App separado na Play Store para o técnico (o TWA do app Vendas já serve o
  mesmo endereço; se o dono quiser um ícone próprio, é só outro pacote).

## 7. Decisões tomadas em 08/10 (00h40) para a fase 3

- Técnico vê valores em R$ no app: **configurável por empresa** (chave em Configurações, padrão ligado).
- Assinatura do cliente para "Concluir atendimento": **opcional, configurável** (chave "Exigir assinatura do cliente para concluir", padrão desligado; sem assinatura o app só avisa).
- Fotos: **até 10 por OS, reduzidas a 1280px** no aparelho (~200–400 KB cada), legenda opcional.
- Preço do km: único por filial (fase 1). Por veículo da empresa só se alguém pedir.

## 8. Situação

- **07/10/2026 (noite) — Fase 1 feita** (`b30e21c`, `f4bb802`; no `main` e no repositório dev), testada no dev: chave ligada, equipamento sem placa, OS com deslocamento de 40 km virando serviço de R$ 200,00 e impressão no modelo do talão. Fases 2 a 5 a fazer, nesta ordem.
- **07/10/2026 (madrugada de 08/10) — Fase 2 feita** (`ef0c854`): a OS já reservava com "Reservar no Pedido e na OS"; entrou a parte visível (colunas Reservado/Disponível, filtro, janela "de onde vem", etiqueta em toda busca).
- **08/10/2026 (manhã) — Fase 3 feita** (`630046f`, `facf718`): app do técnico dentro do app Vendas (Minhas/Todas, Nova OS no campo, atendimento com peças, serviços, km, horímetro, observação, fotos ≤10 a 1280px, assinatura na tela, Salvar/Concluir → "Aguardando conferência"), desktop com status novos, aviso e cartão de fotos/assinatura, talão com a assinatura, chaves "Técnico vê valores" e "Exigir assinatura". `storage.rules` publicada no dev; **produção: push + o dono publicar `storage.rules`**. Testada no dev com a OS #14. Faltam 4 (offline) e 5.
- **08/10/2026 (manhã) — Fase 4 feita** (`19fab7d`): Firestore com cache persistente só no app, fila de pendências no aparelho (número da OS, reserva, fotos, assinatura), sincronização automática ao voltar a rede com faixa e "Enviar agora", OS aberta sem sinal nasce "nº pendente", service worker com cache dos arquivos do app. Testado no dev simulando a queda da rede (foto pendente subiu sozinha; OS #15 aberta sem sinal foi numerada ao voltar). Falta a 5 (acabamento). A base do modo offline do vendedor (pendência de setembro) saiu junto.
- **08/10/2026 — Fase 5 feita (acabamento):** modelos padrão e Personalizado 01 da OS mostram frota, série e horímetro. **Bloco completo no dev.** Produção: push do `main` + o dono publicar `storage.rules`.
