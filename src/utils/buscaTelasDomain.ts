import { resolveRouteAccess } from './routeAccess';

/**
 * BUSCA PELA LUPA (menu no topo, pedido do dono em 26/11/2026).
 *
 * Com o menu no topo, a barra de pesquisa espremia o menu ("BUSCAR OS, CLIENT"
 * cortado) e os resultados apareciam num popup estreito. Agora fica so' uma
 * LUPA, que abre uma janela larga: telas do sistema (ir direto para a tela),
 * clientes, fornecedores, OS e produtos. Regra pura aqui; a janela e'
 * BuscaGlobalModal.tsx.
 *
 * Decisoes do dono: nas telas NAO aparecem "Filiais" nem "Permissao de
 * Usuarios"; tela ou cadastro que a pessoa nao pode abrir nao aparece (mesma
 * regra das rotas -- routeAccess.ts).
 */

export interface ItemDoMenuParaBusca {
  label: string;
  to: string;
}

export interface GrupoDoMenuParaBusca {
  label: string;
  items: ItemDoMenuParaBusca[];
}

export interface TelaEncontrada {
  label: string;
  to: string;
  grupo: string;
}

/** Telas que nunca aparecem na busca (pedido do dono). */
export const CAMINHOS_FORA_DA_BUSCA = ['/configuracoes/filiais'];
export const ROTULOS_FORA_DA_BUSCA = ['permissao de usuarios', 'filiais'];

/** Sem acento, minusculo, espacos simples. */
export const normalizarBusca = (texto: unknown): string => String(texto ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const foraDaBusca = (item: ItemDoMenuParaBusca): boolean => (
  CAMINHOS_FORA_DA_BUSCA.includes(item.to) || ROTULOS_FORA_DA_BUSCA.includes(normalizarBusca(item.label))
);

/**
 * Telas do menu (ja' filtradas pelo que a pessoa ve) que batem com o termo:
 * cada palavra do termo precisa estar no nome da tela ou no nome do grupo.
 * Nome que comeca com o termo vem primeiro. Termo vazio = nenhuma.
 */
export const telasDaBusca = (grupos: GrupoDoMenuParaBusca[], termo: string, limite = 8): TelaEncontrada[] => {
  const busca = normalizarBusca(termo);
  if (!busca) return [];
  const palavras = busca.split(' ');
  const vistos = new Set<string>();
  const achadas: Array<TelaEncontrada & { peso: number }> = [];
  for (const grupo of grupos) {
    for (const item of grupo.items) {
      if (!item.to || vistos.has(item.to) || foraDaBusca(item)) continue;
      const nome = normalizarBusca(item.label);
      const onde = `${nome} ${normalizarBusca(grupo.label)}`;
      if (!palavras.every((p) => onde.includes(p))) continue;
      vistos.add(item.to);
      const peso = nome.startsWith(busca) ? 0 : nome.includes(busca) ? 1 : 2;
      achadas.push({ label: item.label, to: item.to, grupo: grupo.label, peso });
    }
  }
  return achadas
    .sort((a, b) => a.peso - b.peso || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, Math.max(0, limite))
    .map(({ label, to, grupo }) => ({ label, to, grupo }));
};

/**
 * Pode abrir este caminho? Mesma regra das abas (TabPane.tsx): modulo do plano
 * bloqueado barra (menos a plataforma); a permissao da rota vale para quem nao
 * e' dono/plataforma.
 */
export const podeAbrirCaminho = (args: {
  caminho: string;
  acessoTotal: boolean;
  plataforma: boolean;
  permissoes: string[] | null | undefined;
  modulosBloqueados: string[] | null | undefined;
}): boolean => {
  const { routeModule, routePermission } = resolveRouteAccess(args.caminho);
  if (routeModule && !args.plataforma && (args.modulosBloqueados || []).includes(routeModule)) return false;
  return !routePermission || args.acessoTotal || Boolean(args.permissoes?.includes(routePermission));
};
