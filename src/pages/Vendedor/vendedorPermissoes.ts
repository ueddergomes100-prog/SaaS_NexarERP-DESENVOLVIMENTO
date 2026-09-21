/**
 * Permissao que libera o Balanco (contagem de estoque) no app do vendedor.
 * O balanco corrige o SALDO do estoque, e a permissao que o cadastro do
 * funcionario ja tem pra isso e' o Ajuste Manual de Estoque. Sem ela o atalho
 * some e a rota /vendedor/balanco volta pro inicio.
 */
export const PERMISSAO_BALANCO = 'estoque.ajusteManual';

/**
 * Quem pode cadastrar cliente pelo app: as mesmas permissoes que as regras do
 * banco aceitam pra gravar em `clientes` no dia a dia de venda (firestore.rules,
 * canWriteTenantCollection). Sem nenhuma delas o botao nem aparece.
 */
const PERMISSOES_CADASTRO_CLIENTE = ['cadastros.clientes', 'vendas.pedidos', 'vendas.orcamentos'];

export const podeCadastrarClienteNoApp = (permissoes: string[]): boolean => (
  PERMISSOES_CADASTRO_CLIENTE.some((permissao) => permissoes.includes(permissao))
);
