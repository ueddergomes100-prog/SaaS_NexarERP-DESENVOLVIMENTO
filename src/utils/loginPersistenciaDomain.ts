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
 */
import { ehAppDoCaixa } from './frenteDeCaixaDomain';

export type PersistenciaDoLogin = 'local' | 'sessao';

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
  if (ehAppVendas(args.pathname) || ehAppDoCaixa(args.pathname)) return 'local';
  if (args.modoDesenvolvimento === true && ehEnderecoLocal(args.hostname)) return 'local';
  return 'sessao';
};
