/*
 * ONDE O LOGIN FICA GUARDADO NO NAVEGADOR (regra pura; quem aplica e'
 * src/services/firebase.ts).
 *
 *  - 'sessao': vale so' para a aba. Fechou a aba, saiu. E' o padrao do sistema
 *    no computador: balcao e caixa sao maquinas compartilhadas (ver
 *    src/utils/session.ts).
 *  - 'local': fica guardado no navegador e continua valendo depois de fechar.
 *    App Vendas (/vendedor, celular pessoal) e Frente de Caixa (/caixa, o caixa
 *    fica logado de um dia para o outro).
 *
 * MAQUINA DE DESENVOLVIMENTO (23/11/2026, pedido do dono): rodando com
 * `npm run dev` em localhost, o sistema tambem guarda o login. Quem testa
 * abre e fecha a aba o dia inteiro, e redigitar a senha a cada teste nao
 * protege nada numa maquina de desenvolvimento. Precisa das DUAS coisas -- o
 * modo de desenvolvimento do Vite e o endereco local --, entao nenhum site
 * publicado (producao, nem o dev da Vercel, que e' build de producao) muda.
 *
 * Por que 'guardado_no_dev' e nao simplesmente 'local': o Firebase, ao abrir
 * cada aba, prefere o banco do navegador (IndexedDB) e MUDA o login de lugar
 * quando a tela pede outro (localStorage ou sessao). Cada mudanca apaga o login
 * do lugar antigo, e as outras abas abertas entendem "saiu" -- foi assim que
 * abrir o caixa jogava o sistema para a tela de login (e o contrario). No
 * desenvolvimento, sistema, caixa e app Vendas ficam todos no MESMO lugar (o
 * IndexedDB, que o Firebase ja' prefere): nada muda de lugar, nenhuma aba cai.
 */
import { ehAppDoCaixa } from './frenteDeCaixaDomain';

export type PersistenciaDoLogin = 'local' | 'sessao' | 'guardado_no_dev';

const ENDERECOS_LOCAIS = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** O endereco e' o da propria maquina (ou um nome terminado em .localhost)? */
export const ehEnderecoLocal = (hostname: unknown): boolean => {
  const nome = String(hostname ?? '').trim().toLowerCase();
  return ENDERECOS_LOCAIS.includes(nome) || nome.endsWith('.localhost');
};

export const ehAppVendas = (pathname: unknown): boolean => String(pathname ?? '').startsWith('/vendedor');

export const persistenciaDoLogin = (args: {
  pathname: string;
  hostname: string;
  /** `import.meta.env.DEV`: true so' no `npm run dev`, nunca no site publicado. */
  modoDesenvolvimento: boolean;
}): PersistenciaDoLogin => {
  // Antes dos apps: no desenvolvimento os tres (sistema, caixa, app Vendas) usam o mesmo lugar.
  if (args.modoDesenvolvimento === true && ehEnderecoLocal(args.hostname)) return 'guardado_no_dev';
  if (ehAppVendas(args.pathname) || ehAppDoCaixa(args.pathname)) return 'local';
  return 'sessao';
};
