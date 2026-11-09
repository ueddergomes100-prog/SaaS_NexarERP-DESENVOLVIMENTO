import type { ContextoDoUsuario } from '../utils/historicoAlteracoesDomain';

/**
 * Quem esta' logado agora, para o Histórico de alterações (09/11/2026).
 *
 * O AuthContext preenche (nome do cadastro, papel, empresa, filial) e o
 * createAuditLog le daqui -- assim os ~100 pontos que ja' gravavam historico
 * passam a levar nome, papel e filial sem mexer em cada um. Modulo sem
 * dependencias de proposito: o AuthContext importa sem puxar o Firestore.
 */
let contextoAtual: ContextoDoUsuario | null = null;

export const definirContextoDoHistorico = (contexto: ContextoDoUsuario | null): void => {
  contextoAtual = contexto;
};

export const contextoDoHistorico = (): ContextoDoUsuario | null => contextoAtual;

/** Caminho da tela agora ("/operacoes/romaneios/abc"); vazio fora do navegador. */
export const rotaAtual = (): string => {
  try {
    return typeof window !== 'undefined' && window.location ? window.location.pathname : '';
  } catch {
    return '';
  }
};
