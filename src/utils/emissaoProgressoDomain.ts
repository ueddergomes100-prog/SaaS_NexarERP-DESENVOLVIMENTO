/**
 * POP-UP DE ACOMPANHAMENTO DA EMISSAO DE NOTA (2026-09-21).
 *
 * Antes, emitir uma nota fechava o formulario, mostrava "enviada para
 * processamento" e o usuario ficava sem saber se a nota saiu -- so' via a
 * lista mudar de status minutos depois. Agora a tela mostra o caminho real:
 *
 *   Validando os dados -> Enviando para a Spedy -> Transmitindo para a SEFAZ
 *   -> Autorizada | Rejeitada
 *
 * Este modulo e' so' a parte sem tela: em que etapa a emissao esta, quando
 * parar de perguntar pra Spedy e o que dizer a quem emitiu em cada desfecho.
 * A consulta em si (HTTP) e o desenho ficam em NFE.tsx e no componente
 * EmissaoProgressoModal.
 */

/** Status da nota na Spedy que significam "ainda nao teve resposta final". */
export const STATUS_EM_PROCESSAMENTO = ['enqueued', 'processing', 'created'] as const;

export const estaEmProcessamento = (status: string | null | undefined): boolean => (
  (STATUS_EM_PROCESSAMENTO as readonly string[]).includes(String(status ?? ''))
);

/** De quanto em quanto tempo perguntamos a Spedy enquanto a tela espera. */
export const INTERVALO_CONSULTA_MS = 3000;

/** Depois disso a tela para de esperar e avisa que a nota segue sendo
 * processada (a lista continua atualizando sozinha). A SEFAZ costuma
 * responder em segundos; passar de 90s quase sempre e' instabilidade dela. */
export const LIMITE_ESPERA_MS = 90_000;

export type EtapaEmissao = 'validando' | 'enviando' | 'transmitindo' | 'concluida';

export type DesfechoEmissao = 'autorizada' | 'rejeitada' | 'demorando' | 'falha_envio';

export interface EtapaDescricao {
  id: Exclude<EtapaEmissao, 'concluida'>;
  rotulo: string;
}

export const ETAPAS_EMISSAO: EtapaDescricao[] = [
  { id: 'validando', rotulo: 'Validando os dados' },
  { id: 'enviando', rotulo: 'Enviando para a Spedy' },
  { id: 'transmitindo', rotulo: 'Transmitindo para a SEFAZ' },
];

/** Quem autoriza a nota: SEFAZ (NF-e, NFC-e) ou a prefeitura (NFS-e). */
export const orgaoAutorizador = (tipo: string): 'SEFAZ' | 'prefeitura' => (tipo === 'NFS-e' ? 'prefeitura' : 'SEFAZ');

/** Rotulo da etapa pro tipo de nota (a ultima muda de SEFAZ pra prefeitura). */
export const rotuloDaEtapa = (etapa: EtapaDescricao['id'], tipo: string): string => (
  etapa === 'transmitindo' ? `Transmitindo para a ${orgaoAutorizador(tipo)}` : (ETAPAS_EMISSAO.find((e) => e.id === etapa)?.rotulo ?? '')
);

export type SituacaoEtapa = 'feita' | 'andamento' | 'pendente' | 'erro';

const ORDEM: Record<EtapaEmissao, number> = { validando: 0, enviando: 1, transmitindo: 2, concluida: 3 };

/**
 * Como desenhar cada linha da lista de etapas.
 * `etapaAtual` e' onde a emissao esta agora; `desfecho` (quando ja' terminou)
 * decide se a etapa em que parou foi um erro ou um sucesso.
 */
export const situacaoDaEtapa = (
  etapa: EtapaDescricao['id'],
  etapaAtual: EtapaEmissao,
  desfecho: DesfechoEmissao | null,
): SituacaoEtapa => {
  if (desfecho === null) {
    if (ORDEM[etapa] < ORDEM[etapaAtual]) return 'feita';
    if (ORDEM[etapa] === ORDEM[etapaAtual]) return 'andamento';
    return 'pendente';
  }
  // Terminou: as etapas antes de onde parou estao feitas; onde parou depende do desfecho.
  if (ORDEM[etapa] < ORDEM[etapaAtual]) return 'feita';
  if (ORDEM[etapa] > ORDEM[etapaAtual]) return desfecho === 'autorizada' ? 'feita' : 'pendente';
  return desfecho === 'autorizada' ? 'feita' : desfecho === 'demorando' ? 'andamento' : 'erro';
};

/** Traduz o status final da Spedy. `null` = ainda nao terminou (ou status
 * desconhecido, que tratamos como "nao terminou" -- nunca como sucesso). */
export const desfechoDoStatus = (status: string | null | undefined): DesfechoEmissao | null => {
  const s = String(status ?? '');
  if (s === 'authorized') return 'autorizada';
  if (s === 'rejected' || s === 'denied') return 'rejeitada';
  return null;
};

/** Continua perguntando? Sim enquanto a nota esta em processamento e o
 * tempo de espera nao acabou. */
export const deveContinuarConsultando = (params: { iniciouEmMs: number; agoraMs: number; status: string | null | undefined }): boolean => (
  estaEmProcessamento(params.status) && params.agoraMs - params.iniciouEmMs < LIMITE_ESPERA_MS
);

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** Orientacao pras rejeicoes que ja' aconteceram de verdade neste sistema. As
 * demais mostram so' a mensagem da SEFAZ e mandam consultar a nota na lista. */
const ORIENTACAO_POR_CODIGO: Record<string, string> = {
  '232': 'A inscrição estadual (IE) do cliente não foi informada. Cadastre a IE no cliente (ou ISENTO, se ele for isento) e retransmita.',
  '778': 'O NCM de um dos produtos é inválido. Corrija o NCM no cadastro do produto em Estoque e retransmita.',
};

/** Acha o numero da rejeicao ("Rejeição 232: ...") no codigo ou no texto. */
export const codigoDaRejeicao = (codigo: string | null | undefined, mensagem: string | null | undefined): string | null => {
  const direto = String(codigo ?? '').match(/\b(\d{3})\b/);
  if (direto) return direto[1];
  const noTexto = String(mensagem ?? '').match(/rejei[cç][aã]o\D{0,4}(\d{3})\b/i);
  return noTexto ? noTexto[1] : null;
};

export interface TextoDesfecho {
  titulo: string;
  detalhe: string;
  orientacao: string;
}

export const textoDoDesfecho = (params: {
  desfecho: DesfechoEmissao;
  tipo: string;
  numero?: number | string | null;
  codigo?: string | null;
  mensagem?: string | null;
  erroEnvio?: string | null;
}): TextoDesfecho => {
  const { desfecho, tipo } = params;
  const numero = params.numero ? ` Nº ${params.numero}` : '';
  const orgao = orgaoAutorizador(tipo);

  if (desfecho === 'autorizada') {
    return {
      titulo: `${tipo}${numero} autorizada`,
      detalhe: `A ${orgao} autorizou a nota. Ela já pode ser impressa e enviada ao cliente.`,
      orientacao: '',
    };
  }

  if (desfecho === 'rejeitada') {
    const codigoRej = codigoDaRejeicao(params.codigo, params.mensagem);
    const detalhe = (params.mensagem || '').trim() || `A ${orgao} recusou a nota, mas não informou o motivo.`;
    return {
      titulo: `${tipo} rejeitada`,
      detalhe: codigoRej && !detalhe.includes(codigoRej) ? `Rejeição ${codigoRej}: ${detalhe}` : detalhe,
      orientacao: (codigoRej && ORIENTACAO_POR_CODIGO[codigoRej])
        || 'Corrija o que a mensagem pede e use "Retransmitir" na lista de notas. Para ver a situação exata na Spedy, use "Consultar na Spedy".',
    };
  }

  if (desfecho === 'demorando') {
    return {
      titulo: `A ${orgao} ainda não respondeu`,
      detalhe: `A ${tipo} foi enviada e continua sendo processada. Isso acontece quando a ${orgao} está lenta.`,
      orientacao: 'Pode fechar esta janela: a lista de notas atualiza sozinha e mostra o resultado assim que sair. Não emita de novo.',
    };
  }

  return {
    titulo: `Não foi possível enviar a ${tipo}`,
    detalhe: (params.erroEnvio || '').trim() || 'O envio para a Spedy falhou.',
    orientacao: 'A nota não foi emitida. Corrija o que a mensagem indica (ou tente de novo em instantes) e emita novamente.',
  };
};
