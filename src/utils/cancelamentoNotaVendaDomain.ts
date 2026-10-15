import { numeroDaNota } from './nomeArquivoDomain';

/**
 * CANCELAR A VENDA JUNTO COM A NOTA (pedido do cliente, 15/10/2026).
 *
 * Ate' aqui, venda com NF-e/NFC-e autorizada era bloqueada: a pessoa tinha de
 * ir em Notas Fiscais, cancelar a nota e voltar para cancelar a venda. Agora o
 * proprio "Cancelar venda" pede o motivo, cancela a nota na SEFAZ (pela Spedy)
 * e SO' DEPOIS da nota confirmada como cancelada cancela a venda. Se a SEFAZ
 * recusar (prazo vencido) ou ainda nao tiver respondido, a venda NAO e' tocada.
 *
 * So' quem pode cancelar nota (a permissao de Notas Fiscais) faz isso pelo
 * pedido -- decisao do dono de 15/10. Nota de devolucao nao conta: ela nao
 * impede cancelar a venda.
 */

export interface NotaDaVenda {
  id: string;
  tipo?: unknown;
  status?: unknown;
  number?: number | string | null;
  spedyId?: unknown;
  finalidade?: unknown;
}

export const STATUS_NOTA_EM_TRANSMISSAO = ['enqueued', 'processing', 'created'];

const ehNotaDaVenda = (nota: NotaDaVenda) => (
  (nota.tipo === 'NF-e' || nota.tipo === 'NFC-e') && nota.finalidade !== 'devolucao'
);

/** As notas da venda que impedem cancelar so' a venda: as autorizadas e as que ainda aguardam a SEFAZ. */
export const classificarNotasDaVenda = (notas: NotaDaVenda[]) => {
  const daVenda = notas.filter(ehNotaDaVenda);
  return {
    autorizadas: daVenda.filter((nota) => nota.status === 'authorized'),
    emTransmissao: daVenda.filter((nota) => STATUS_NOTA_EM_TRANSMISSAO.includes(String(nota.status))),
  };
};

/** "NF-e nº 93" / "NFC-e" -- como o cliente le. */
export const descricaoDaNota = (nota: Pick<NotaDaVenda, 'tipo' | 'number'>): string => {
  const numero = numeroDaNota(nota.number);
  return `${String(nota.tipo || 'Nota')}${numero ? ` nº ${numero}` : ''}`;
};

/** Lista para frase: "NF-e nº 93", "NF-e nº 93 e NFC-e nº 12". */
export const listaDeNotas = (notas: Pick<NotaDaVenda, 'tipo' | 'number'>[]): string => {
  const nomes = notas.map(descricaoDaNota);
  if (nomes.length <= 1) return nomes[0] || '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
};

/** Tipo do documento na Spedy (a rota de cancelamento e' por tipo). */
export const tipoSpedyDaNota = (tipo: unknown): 'consumer' | 'product' => (tipo === 'NFC-e' ? 'consumer' : 'product');

export const JUSTIFICATIVA_MINIMA = 15;
export const JUSTIFICATIVA_MAXIMA = 255;

/** Regra da SEFAZ para o motivo do cancelamento. Devolve a mensagem de erro ou null. */
export const validarJustificativaCancelamento = (texto: unknown): string | null => {
  const limpo = String(texto ?? '').trim();
  if (limpo.length < JUSTIFICATIVA_MINIMA) return `Escreva o motivo com pelo menos ${JUSTIFICATIVA_MINIMA} letras (regra da SEFAZ).`;
  if (limpo.length > JUSTIFICATIVA_MAXIMA) return `O motivo pode ter no máximo ${JUSTIFICATIVA_MAXIMA} letras (limite da SEFAZ).`;
  return null;
};

/** A Spedy/SEFAZ recusou porque passou do prazo de cancelamento. */
export const ehErroDePrazo = (mensagem: unknown): boolean => /prazo|501/i.test(String(mensagem ?? ''));

/** O que fazer quando a SEFAZ recusa por prazo (mesma orientacao da tela de Notas Fiscais). */
export const ORIENTACAO_FORA_DO_PRAZO = [
  'A venda NÃO foi cancelada.',
  '• Venda que NÃO aconteceu, com a nota autorizada há até 168 horas (7 dias): peça o cancelamento extemporâneo no SIARE (site da SEFAZ-MG) e depois tente de novo. Em outros estados o caminho é parecido: confirme com o contador.',
  '• Mercadoria que saiu e voltou: não cancele — use "Devolução de itens" (em Mais ações), que devolve o estoque e emite a NF-e de devolução.',
].join('\n');
