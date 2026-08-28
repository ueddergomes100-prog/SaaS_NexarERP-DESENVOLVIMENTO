// Cadastro de vendedor SEM login (modo balcao compartilhado).
//
// Decisao de produto (2026-08-28). Cenario real: loja com 10 computadores,
// cada um logado o dia inteiro numa conta de ESTACAO (`balcao01`,
// `balcao02`, `frenteloja01`...). Quem vende sao pessoas -- Juliano,
// Rodrigo, Fabielle -- que se identificam a cada venda com codigo + senha
// de 4 digitos (ver vendedorPinDomain.ts).
//
// ---------------------------------------------------------------------------
// O PROBLEMA QUE ISTO RESOLVE
// ---------------------------------------------------------------------------
//
// Antes daqui, ser vendedor exigia ser USUARIO do sistema, porque codigo,
// senha de vendedor e percentual de comissao moram em `usuarios/{id}`. E
// todo usuario nascia com conta no Firebase Auth + entrada no indice de
// logins + uma vaga do limite de usuarios contratados. Consequencias, todas
// reais:
//
//  1. existiam logins de verdade ("juliano", "rodrigo") que ninguem deveria
//     usar. Uma estacao deslogada por engano voltava com o nome de outra
//     pessoa na tela -- e o balcao inteiro parava pra entender o porque;
//  2. esses logins apareciam em Equipe & Acessos e em Permissao de
//     Usuarios, com botao de permissao que nao servia pra nada;
//  3. cada vendedor comia uma licenca do plano da empresa.
//
// ---------------------------------------------------------------------------
// POR QUE O VENDEDOR MORA EM `usuarios`, E NAO NUMA COLECAO PROPRIA
// ---------------------------------------------------------------------------
//
// Porque "de quem e' esta venda" e "quanto ele ganha de comissao" ja sao
// resolvidos por `usuarios/{id}` em todo lugar que importa: Dashboard,
// Relatorio de Comissoes, Relatorio de Vendas impresso, Pre-vendas, Minhas
// Vendas, minuta de expedicao -- e no backend que valida o PIN
// (server/services/vendedorPin.js). Uma colecao separada obrigaria busca em
// DOIS lugares em cada um desses pontos, mais migracao das vendas ja
// gravadas, sem entregar nada a mais pro cliente.
//
// A colecao `usuarios` ja e', na pratica, "pessoas da empresa": a OS aponta
// `mecanicoId` pra la desde sempre. O que o vendedor nao tem e' LOGIN --
// e' so isso que `tipoRegistro` diz.
//
// Consequencia pratica: a hierarquia de comissao (produto > vendedor >
// sistema, em financeDomain.ts) continua identica. Muda o cadastro, nao a
// regra.

/** O que este registro de `usuarios` e':
 *  - 'login'    -> conta que entra no sistema (padrao, e' todo mundo que ja
 *                  existe hoje: dono, balcao01, financeiro, fiscal);
 *  - 'vendedor' -> pessoa que so vende. Sem conta no Firebase Auth, sem
 *                  entrada em `usernames`, sem permissao de modulo. */
export type TipoRegistroUsuario = 'login' | 'vendedor';

export const TIPO_REGISTRO_PADRAO: TipoRegistroUsuario = 'login';

/** Documento antigo nao tem o campo -- e todo documento antigo tem login.
 *  Por isso o default e' 'login', e nunca o contrario. */
export const parseTipoRegistro = (raw: unknown): TipoRegistroUsuario =>
  raw === 'vendedor' ? 'vendedor' : TIPO_REGISTRO_PADRAO;

export interface RegistroComTipo {
  tipoRegistro?: unknown;
}

export const isRegistroDeVendedor = (registro: RegistroComTipo | null | undefined): boolean =>
  parseTipoRegistro(registro?.tipoRegistro) === 'vendedor';

/** Quem aparece em Equipe & Acessos, em Permissao de Usuarios, nos combos de
 *  mecanico/responsavel, e quem conta no limite de usuarios contratados. */
export const isRegistroComLogin = (registro: RegistroComTipo | null | undefined): boolean =>
  !isRegistroDeVendedor(registro);

/**
 * O menu "Cadastros Auxiliares > Vendedores" aparece?
 *
 * Liga com o checkbox "Exigir identificação do vendedor a cada venda" --
 * esse checkbox E' a marca de "esta empresa trabalha em balcao
 * compartilhado", e um toggle novo dizendo quase a mesma coisa viraria duas
 * chaves capazes de se contradizer.
 *
 * MAS continua aparecendo enquanto existir vendedor cadastrado, mesmo com o
 * checkbox desligado. Se sumisse, desmarcar a opcao por engano faria o
 * cadastro inteiro desaparecer da vista -- cadastro que some e' chamado de
 * suporte na certa. Desmarcar para de EXIGIR a identificacao na venda; nao
 * apaga nem esconde quem ja foi cadastrado.
 */
export const menuVendedoresVisivel = (args: {
  exigirIdentificacaoVendedor: boolean;
  temVendedorCadastrado: boolean;
}): boolean => args.exigirIdentificacaoVendedor || args.temVendedorCadastrado;

/**
 * Vendedor cadastrado entra nos COMBOS de selecao de vendedor/mecanico?
 *
 * Nao. Ele so existe pro fluxo de identificacao por codigo + senha, que e'
 * onde a empresa que ligou o checkbox trabalha -- e nesse fluxo o combo de
 * "Vendedor responsavel" fica escondido de proposito (PedidoVendaForm).
 *
 * Deixar o vendedor sem login no combo criaria um caso torto: a venda
 * ficaria carimbada num id que nao e' de ninguem logado, e a trava "nao
 * visualizar vendas de outro usuario" -- que compara com o uid de quem
 * esta logado -- esconderia da propria pessoa a venda que ela acabou de
 * fazer. Ver visibilidadeVendasDomain.ts.
 */
export const VENDEDOR_SEM_LOGIN_FORA_DOS_COMBOS = true;

/** Mensagem unica pra explicar o cadastro em todas as telas que citam ele.
 *  Uma frase so, no lugar de cada tela inventar a sua. */
export const EXPLICACAO_VENDEDOR_SEM_LOGIN =
  'Vendedores de balcão são cadastrados em Cadastros Auxiliares → Vendedores. Eles não entram no sistema: identificam-se com código e senha de 4 dígitos a cada venda, enquanto a estação (balcão 01, balcão 02...) segue logada.';
