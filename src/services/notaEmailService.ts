import { auth } from './firebase';

/**
 * E-mail da nota fiscal ao cliente (PDF + XML), enviado pelo servidor com o SMTP da propria empresa
 * (server/routes/notaEmail.routes.js). A tela so' diz QUAL nota: o destinatario e' o e-mail do cadastro do
 * cliente e o remetente e' o e-mail do perfil da empresa -- os dois lidos no servidor.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class NotaEmailError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'NotaEmailError';
    this.status = status;
  }
}

export interface ResultadoEnvioEmail {
  ok: boolean;
  /** Para quem o e-mail foi. */
  para: string;
  /** Verdadeiro quando a nota ja tinha sido enviada e nada foi reenviado. */
  jaEnviado?: boolean;
}

const chamar = async <T>(caminho: string, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) {
    throw new NotaEmailError('O envio de e-mail precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new NotaEmailError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}/api/nota-email${caminho}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new NotaEmailError('Não foi possível falar com o servidor. Verifique a internet e tente de novo.', 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new NotaEmailError(dados.error || 'Não foi possível enviar o e-mail. Tente novamente.', resposta.status);
  }
  return dados as T;
};

export const notaEmailService = {
  /** Envia (ou reenvia, com `forcar`) o e-mail de uma nota autorizada. */
  enviar: (notaId: string, forcar = false) => chamar<ResultadoEnvioEmail>(`/nota/${notaId}/enviar`, { forcar }),
  /** Manda um e-mail de teste do e-mail da empresa para ele mesmo, com o SMTP já salvo. */
  testar: () => chamar<{ ok: boolean; para: string }>('/teste', {}),
};
