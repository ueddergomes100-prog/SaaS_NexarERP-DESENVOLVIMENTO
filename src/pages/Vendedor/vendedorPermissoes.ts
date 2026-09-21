/**
 * Permissao que libera o Balanco (contagem de estoque) no app do vendedor.
 * O balanco corrige o SALDO do estoque, e a permissao que o cadastro do
 * funcionario ja tem pra isso e' o Ajuste Manual de Estoque. Sem ela o atalho
 * some e a rota /vendedor/balanco volta pro inicio.
 */
export const PERMISSAO_BALANCO = 'estoque.ajusteManual';
