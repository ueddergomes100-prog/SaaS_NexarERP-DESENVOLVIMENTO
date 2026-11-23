/**
 * O código de verificação do cadastro chegou?
 *
 * Em 23/11/2026 um cliente ficou travado no cadastro: o e-mail dele devolveu
 * a primeira mensagem, o serviço de envio bloqueou o endereço e passou a
 * descartar os envios seguintes sem avisar. A tela dizia "Enviamos o código"
 * e ele ficou esperando. Agora, alguns segundos depois de cada envio, a tela
 * pergunta ao servidor o que aconteceu (rota /api/onboarding/status-envio) e
 * avisa quando o código não tem como chegar.
 *
 * Aqui mora só a parte pura: os estados, quando perguntar e o texto do aviso.
 * Quem pergunta é o AuthPage.tsx, pelo onboardingService.
 */

export type EstadoEnvioCodigo = 'entregue' | 'a_caminho' | 'devolvido' | 'bloqueado' | 'desconhecido';

const ESTADOS_CONHECIDOS: readonly EstadoEnvioCodigo[] = ['entregue', 'a_caminho', 'devolvido', 'bloqueado', 'desconhecido'];

/** Qualquer coisa que o servidor mande fora da lista vira 'desconhecido'. */
export const normalizarEstadoEnvio = (valor: unknown): EstadoEnvioCodigo => (
  ESTADOS_CONHECIDOS.includes(valor as EstadoEnvioCodigo) ? (valor as EstadoEnvioCodigo) : 'desconhecido'
);

/**
 * Espera antes de cada pergunta, a contar da anterior (5 s, 17 s e 42 s depois
 * do envio). Endereço bloqueado aparece na hora; e-mail que não existe costuma
 * voltar em poucos segundos. Depois da terceira, a tela para de perguntar.
 */
export const ESPERAS_CONSULTA_ENVIO_MS: readonly number[] = [5_000, 12_000, 25_000];

/**
 * Vale perguntar de novo? Só enquanto não há resposta definitiva: 'a_caminho'
 * pode virar devolvido, e 'desconhecido' pode ser só o servidor de e-mail que
 * ainda não registrou o envio.
 */
export const deveConsultarEnvioDeNovo = (estado: EstadoEnvioCodigo, consultasFeitas: number): boolean => (
  (estado === 'a_caminho' || estado === 'desconhecido') && consultasFeitas < ESPERAS_CONSULTA_ENVIO_MS.length
);

export interface AvisoEnvioCodigo {
  titulo: string;
  texto: string;
}

/**
 * Aviso para o usuário quando o código não tem como chegar. `null` nos outros
 * estados: entregue e a caminho seguem o fluxo normal, e sem informação a
 * tela não inventa problema.
 */
export const avisoDoEstadoDeEnvio = (estado: EstadoEnvioCodigo, emailMascarado?: string | null): AvisoEnvioCodigo | null => {
  const email = String(emailMascarado || '').trim();
  const endereco = email || 'o e-mail informado';

  if (estado === 'devolvido') {
    return {
      titulo: 'O e-mail com o código não foi entregue',
      texto: `${email ? `O endereço ${email}` : 'O e-mail informado'} não existe ou não está recebendo mensagens. `
        + 'Clique em Voltar, confira se o e-mail foi digitado certo ou informe outro. '
        + 'Se o endereço estiver certo, fale com o suporte.',
    };
  }

  if (estado === 'bloqueado') {
    return {
      titulo: 'Não conseguimos enviar o código para este e-mail',
      texto: `Uma mensagem nossa para ${endereco} já voltou antes e, por isso, o endereço ficou bloqueado para novos envios. `
        + 'Pedir o código de novo não resolve. '
        + 'Clique em Voltar e informe outro e-mail, ou fale com o suporte para liberar este endereço.',
    };
  }

  return null;
};
