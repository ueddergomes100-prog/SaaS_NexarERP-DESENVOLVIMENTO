# Regras de trabalho neste sistema

Instruções para quem (pessoa ou IA) for mexer no código do Hennder ERP.

## 1. Erro de cadastro do cliente não muda a lógica do sistema

**Não altere regra de negócio, validação ou fluxo do sistema para contornar
dado que o cliente deixou de preencher.** Se falta informação no cadastro, o
caminho é um destes dois — nunca torcer a lógica:

1. **Preencher com o padrão documentado** e avisar o usuário, quando existe um
   padrão óbvio e a operação não pode travar;
2. **Bloquear com mensagem clara**, quando seguir sem o dado produziria
   resultado errado.

O que **não** é aceitável: criar exceção, desviar de validação, ou fazer a
tela se comportar diferente só porque aquele registro está incompleto. O
sistema tem um comportamento só. Cadastro incompleto se resolve no cadastro.

## 2. Mensagem de erro é para o usuário final, em português

Todo erro que chega na tela é escrito **em português, direto, dizendo o que
houve e o que fazer para resolver**. O objetivo é o cliente se resolver
sozinho, sem abrir chamado no suporte.

- **Nunca** deixe erro cru de biblioteca vazar para a tela (`Function
  Transaction.set() called with invalid data...` não diz nada a ninguém).
- Cite o registro pelo nome que o usuário conhece (o nome do produto, não o id).
- Diga o próximo passo: *"edite o produto em Estoque e informe a unidade"*.

Helpers em [`src/utils/alerts.ts`](src/utils/alerts.ts):
`showError` (modal, bloqueia), `showWarning` (toast, informa e segue),
`showSuccess`, `confirmDelete`.

## 3. Nunca grave `undefined` no Firestore

O Firestore **recusa** `undefined` e derruba o save inteiro com erro cru:

```
Unsupported field value: undefined (found in document ordens_de_servico/...)
```

Isso acontece quando se copia campo opcional direto do documento:

```ts
// ERRADO: produto sem o campo vira a chave com valor undefined
unidadeMedidaSigla: doc.data().unidadeMedidaSigla,
```

Campo que pode não existir: ou **preencha com o padrão**, ou **omita a chave**.
Nunca deixe a chave com `undefined`.

## 4. Unidade de medida ausente → `UN`

Decisão de produto (2026-08-24). Produto sem unidade de medida cadastrada
entra na venda/OS/orçamento com a unidade padrão **`UN`** (unitário, sem venda
fracionada, 0 casas decimais) e o usuário é avisado na hora, em português,
para corrigir o cadastro no Estoque. A operação **não** trava.

Regra completa, com o porquê e as ressalvas, em
[`src/utils/unidadeMedidaDomain.ts`](src/utils/unidadeMedidaDomain.ts):
`resolveUnidadeMedidaProduto`, `temUnidadeMedidaCadastrada`,
`avisoUnidadeMedidaAusente`, `UNIDADE_MEDIDA_FALLBACK`.

Use esses helpers em **todo** ponto onde produto do estoque vira item de
documento. Não reimplemente o fallback na tela.

Duas ressalvas que valem repetir:

- **`UN` não é neutro.** Ele afirma produto unitário e não fracionável, e a
  sigla vai para a nota fiscal. Produto que na vida real é vendido em KG segue
  tratado como unitário até alguém arrumar o cadastro — por isso o aviso.
- **Serviço não tem unidade.** Não existe "UN de serviço": os três campos
  ficam fora do item de serviço, de propósito.

## 5. Ambientes

Detalhes de banco, remotes e deploy estão nos documentos de arquitetura em
[`docs/`](docs/). O essencial: **produção e desenvolvimento são projetos
Firebase separados, e nada roda contra produção a partir da máquina local.**
