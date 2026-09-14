/**
 * Modulos OPCIONAIS do app do vendedor externo (Emitir Nota Fiscal, Contas a
 * Pagar, Contas a Receber) -- os 4 basicos (pedido, orcamento, consultar
 * preco/cliente) nao entram aqui, sao o proprio motivo do app existir e
 * ficam sempre liberados pra quem tem `acessoAppMobile`.
 *
 * Reaproveita DE PROPOSITO os mesmos ids de `permissionCatalog.ts`
 * (`fiscal.emitir`, `financeiro.pagar`, `financeiro.receber`) em vez de
 * inventar um campo novo no Firestore: quem tem a permissao no sistema
 * inteiro, tem no app tambem, dos dois lados (Usuario com login usa o popup
 * de Permissoes que ja lista essas mesmas; Vendedor de balcao sem login usa
 * o checklist em VendedoresList.tsx que grava no mesmo `usuarios/{id}.permissoes`).
 */

export interface ModuloMobileExtra {
  /** Mesmo id de PERMISSION_CATALOG -- nao e' um vocabulario novo. */
  id: string;
  label: string;
}

export const MODULOS_MOBILE_EXTRAS: ModuloMobileExtra[] = [
  { id: 'fiscal.emitir', label: 'Emitir Nota Fiscal' },
  { id: 'financeiro.pagar', label: 'Contas a Pagar' },
  { id: 'financeiro.receber', label: 'Contas a Receber' },
];

export const MODULOS_MOBILE_EXTRAS_IDS: string[] = MODULOS_MOBILE_EXTRAS.map((m) => m.id);
