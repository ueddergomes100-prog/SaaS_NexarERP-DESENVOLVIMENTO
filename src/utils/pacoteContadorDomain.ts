import type { LinhaContador, ModeloFiscal } from './relatorioContadorDomain';
import { nomeDeArquivoSeguro } from './zipDomain';

/*
 * PACOTE DO CONTADOR (fase 2 do Relatorio do Contador, 20/10/2026): o .zip com
 * os XMLs das notas da lista.
 *  - Emitidas (autorizadas e canceladas): o XML vem da Spedy, um por vez
 *    (limite de 60 por minuto da Spedy por empresa).
 *  - Cartas de correcao das emitidas: o XML de cada carta, tambem da Spedy.
 *  - Recebidas: o XML guardado na entrada (`xmlGzipBase64`). Entrada antiga,
 *    lancada antes de 24/09, nao guardou o XML: fica de fora, com aviso.
 *  - Rejeitada/em processamento nao tem XML autorizado: fica de fora, com aviso.
 */

export type TipoSpedy = 'product' | 'consumer' | 'service';
export const TIPO_SPEDY_DO_MODELO: Record<ModeloFiscal, TipoSpedy> = { 'NF-e': 'product', 'NFC-e': 'consumer', 'NFS-e': 'service' };

export interface DadosDaEmitidaParaPacote {
  spedyId: string;
  /** Cartas de correcao enviadas (eventId da Spedy). */
  cartas: Array<{ eventId: string; sequencia: number }>;
}

export type TarefaDoPacote =
  | { tipo: 'emitida'; nome: string; spedyTipo: TipoSpedy; spedyId: string }
  | { tipo: 'cce'; nome: string; spedyId: string; eventId: string }
  | { tipo: 'recebida'; nome: string; linhaId: string };

export interface PlanoDoPacote {
  tarefas: TarefaDoPacote[];
  /** O que ficou de fora e por que (em portugues, para mostrar). */
  foraDoPacote: string[];
  /** Quantas chamadas a' Spedy (para estimar o tempo). */
  chamadasSpedy: number;
}

const rotuloDaNota = (l: LinhaContador): string => `${l.modelo} ${l.numero || 'sem número'}`;

export const planoDoPacote = (
  linhas: readonly LinhaContador[],
  emitidas: ReadonlyMap<string, DadosDaEmitidaParaPacote>,
  recebidasComXml: ReadonlySet<string>,
): PlanoDoPacote => {
  const tarefas: TarefaDoPacote[] = [];
  const foraDoPacote: string[] = [];
  for (const l of linhas) {
    if (l.origem === 'recebida') {
      if (!recebidasComXml.has(l.id)) {
        foraDoPacote.push(`${rotuloDaNota(l)} de ${l.participante || 'fornecedor'}: entrada antiga, sem o XML guardado.`);
        continue;
      }
      tarefas.push({ tipo: 'recebida', linhaId: l.id, nome: `recebidas/${nomeDeArquivoSeguro(`${rotuloDaNota(l)} - ${l.participante || 'fornecedor'}`)}.xml` });
      continue;
    }
    const dados = emitidas.get(l.id);
    if (l.situacao !== 'autorizada' && l.situacao !== 'cancelada') {
      foraDoPacote.push(`${rotuloDaNota(l)}: ${l.situacao === 'rejeitada' ? 'rejeitada' : 'em processamento'}, sem XML autorizado.`);
      continue;
    }
    if (!dados?.spedyId) {
      foraDoPacote.push(`${rotuloDaNota(l)}: sem a identificação da Spedy para baixar o XML.`);
      continue;
    }
    const sufixo = l.situacao === 'cancelada' ? ' - CANCELADA' : '';
    tarefas.push({
      tipo: 'emitida',
      spedyTipo: TIPO_SPEDY_DO_MODELO[l.modelo],
      spedyId: dados.spedyId,
      nome: `emitidas/${nomeDeArquivoSeguro(`${rotuloDaNota(l)}${l.chave ? ` - ${l.chave}` : ''}${sufixo}`)}.xml`,
    });
    for (const carta of dados.cartas) {
      if (!carta.eventId) continue;
      tarefas.push({
        tipo: 'cce',
        spedyId: dados.spedyId,
        eventId: carta.eventId,
        nome: `cartas-de-correcao/${nomeDeArquivoSeguro(`CC-e ${rotuloDaNota(l)} - seq ${carta.sequencia}`)}.xml`,
      });
    }
  }
  return { tarefas, foraDoPacote, chamadasSpedy: tarefas.filter((t) => t.tipo !== 'recebida').length };
};

/** Intervalo entre chamadas a' Spedy: 50 por minuto, folga sobre o limite de 60 (outros usuarios emitindo). */
export const INTERVALO_ENTRE_CHAMADAS_MS = 1200;

/** "cerca de 3 minutos" para mostrar antes de comecar. */
export const tempoEstimado = (chamadas: number): string => {
  const segundos = Math.ceil((chamadas * INTERVALO_ENTRE_CHAMADAS_MS) / 1000);
  if (segundos < 60) return 'menos de 1 minuto';
  const minutos = Math.ceil(segundos / 60);
  return `cerca de ${minutos} minuto${minutos > 1 ? 's' : ''}`;
};

/** Nome do .zip: "xmls-contador-2026-09-01-a-2026-09-30.zip". */
export const nomeDoPacote = (de: string, ate: string): string => `xmls-contador-${de}-a-${ate}.zip`;
