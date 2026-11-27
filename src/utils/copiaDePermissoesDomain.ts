/*
 * COPIAR AS PERMISSOES DE OUTRO USUARIO (27/11/2026, pedido do dono).
 *
 * "A opcao de copiar permissao na tela de configuracao do sistema nao ta
 * funcionando, poderia arrumar a funcao e mover ela para a tela de usuarios,
 * pra conseguir criar um funcionario ja com permissao de um usuario ja criado,
 * ou clonar funcionario ai ja puxa as permissoes e so muda nome e senhas e
 * codigos".
 *
 * A copia vale na tela de Usuarios em tres lugares: a janela de permissoes
 * ("Copiar de"), o cadastro do funcionario novo ("Copiar permissoes de") e o
 * botao "Duplicar" da lista. Grava sempre pelo servidor (a mesma rota da janela
 * de permissoes), que confere quem pode dar o que.
 *
 * Copia: as permissoes por modulo e o nivel de acesso. NAO copia as regras de
 * comissao (remuneracao pessoal, decisao de 27/08/2026), nem nome, usuario,
 * senha e codigo.
 *
 * So' mexe no que QUEM ESTA' COPIANDO pode dar (o gerente so' da' e tira o que
 * ele mesmo tem); o resto fica como estava no destino -- assim o servidor nunca
 * recusa a copia por causa de uma permissao fora do alcance.
 *
 * Regra pura: sem tela e sem Firestore.
 */
import { PERMISSION_CATALOG } from './permissionCatalog';
import { ehPapelDeAdministrador } from './papelAdministradorDomain';

const CATALOGO: readonly string[] = PERMISSION_CATALOG.map((item) => item.id);

/**
 * As permissoes do destino depois de copiar as da origem. `daOrigem` sao as
 * efetivas da origem (permissoesEfetivasDoUsuario); `atuais`, as do destino
 * (vazias no funcionario novo). Marcadores internos de `atuais` ficam.
 */
export const permissoesCopiadas = (args: {
  atuais: ReadonlyArray<string>;
  daOrigem: ReadonlyArray<string>;
  podeMexer: (permissao: string) => boolean;
}): string[] => {
  const origem = new Set(args.daOrigem);
  const resultado = new Set(args.atuais);
  CATALOGO.forEach((id) => {
    if (!args.podeMexer(id)) return;
    if (origem.has(id)) resultado.add(id);
    else resultado.delete(id);
  });
  return [...resultado];
};

/** Quantas permissoes da origem ficaram de fora por falta de alcance de quem copia. */
export const permissoesForaDoAlcance = (daOrigem: ReadonlyArray<string>, podeMexer: (permissao: string) => boolean): number => (
  daOrigem.filter((id) => CATALOGO.includes(id) && !podeMexer(id)).length
);

export interface UsuarioParaCopiar {
  id: string;
  nome?: unknown;
  username?: unknown;
  role?: unknown;
  status?: unknown;
}

/**
 * Quem aparece na lista "copiar de": os cadastros com permissoes por modulo
 * (funcionario e administrador) desta empresa, menos o proprio destino e o
 * dono (o dono pode tudo -- nao ha' o que copiar). Vendedor de balcao (sem
 * login) fica de fora: as permissoes dele sao as do app, em Vendedores.
 */
export const usuariosParaCopiar = <T extends UsuarioParaCopiar & { tipoRegistro?: unknown }>(
  usuarios: ReadonlyArray<T>,
  args: { donoId: string; destinoId?: string | null },
): T[] => usuarios
  .filter((u) => u.id !== args.donoId && u.id !== args.destinoId)
  .filter((u) => u.tipoRegistro !== 'vendedor')
  .filter((u) => u.role === 'Funcionario' || ehPapelDeAdministrador(u.role))
  .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

export const rotuloDoUsuarioParaCopiar = (u: UsuarioParaCopiar): string => {
  const nome = String(u.nome || u.username || 'Sem nome').trim();
  // Login gravado como 'CNPJ-usuario' (o usuario pode ter hifen).
  const bruto = String(u.username || '');
  const usuario = bruto.includes('-') ? bruto.split('-').slice(1).join('-') : bruto;
  const inativo = u.status === 'Inativo' ? ' — inativo' : '';
  return `${nome}${usuario && usuario !== nome ? ` (${usuario})` : ''}${inativo}`;
};
