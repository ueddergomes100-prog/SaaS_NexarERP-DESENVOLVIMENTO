/**
 * NUMERACAO DOS DOCUMENTOS (Configuracoes por filial, fase C -- 2026-10-07).
 * Plano em docs/PLANO_CONFIGURACOES_POR_FILIAL.md.
 *
 * Cada filial numera os proprios documentos em
 * `contadores/{filial}/sequencias/{chave}` (firestoreAtomic.ts). Esta tela
 * mostra o ultimo numero usado de cada sequencia e deixa o dono/administrador
 * **adiantar** a numeracao (nunca voltar): serve para quem migra de outro
 * sistema e quer continuar do pedido 75.713, por exemplo. Boletos ficam fora
 * (sao por banco, em Bancos). A NF-e/NFC-e e' numerada pela Spedy.
 *
 * Puro: o servidor (services/numeracao.js) le e grava; aqui ficam a lista, a
 * conta do "ultimo" e a validacao, em portugues.
 */

export interface SequenciaDeDocumento {
  chave: string;
  rotulo: string;
  /** Colecao e campo onde o numero e' gravado, para conferir o maior ja' usado. */
  colecao: string;
  campo: string;
}

export const SEQUENCIAS_DE_DOCUMENTOS: SequenciaDeDocumento[] = [
  { chave: 'pedidos_venda', rotulo: 'Pedido de venda', colecao: 'pedidos_venda', campo: 'numeroPedido' },
  { chave: 'ordens_de_servico', rotulo: 'Ordem de serviço', colecao: 'ordens_de_servico', campo: 'numeroOS' },
  { chave: 'orcamentos', rotulo: 'Orçamento', colecao: 'orcamentos', campo: 'numeroOrcamento' },
  { chave: 'ordens_producao', rotulo: 'Ordem de produção', colecao: 'ordens_producao', campo: 'numero' },
  { chave: 'notas_avulsas', rotulo: 'Nota avulsa', colecao: 'notas_avulsas', campo: 'numero' },
  { chave: 'romaneios', rotulo: 'Romaneio de entrega', colecao: 'romaneios', campo: 'numero' },
  { chave: 'transferencias', rotulo: 'Transferência entre filiais', colecao: 'transferencias', campo: 'numeroTransferencia' },
  { chave: 'trocas', rotulo: 'Troca', colecao: 'trocas', campo: 'numero' },
  { chave: 'condicionais', rotulo: 'Condicional', colecao: 'condicionais', campo: 'numero' },
];

export const sequenciaPelaChave = (chave: unknown): SequenciaDeDocumento | null => (
  SEQUENCIAS_DE_DOCUMENTOS.find((s) => s.chave === String(chave ?? '')) ?? null
);

/** Mesma leitura de firestoreAtomic.parseSequenceValue: so' digitos, 0 se nao houver. */
export const lerValorDeSequencia = (valor: unknown): number => {
  const n = Number.parseInt(String(valor ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Ultimo numero usado = o maior entre a sequencia nova, o campo legado e o maior gravado na colecao. */
export const ultimoNumeroUsado = (valorSequencia: unknown, valorLegado: unknown, maiorGravado: unknown): number => (
  Math.max(lerValorDeSequencia(valorSequencia), lerValorDeSequencia(valorLegado), lerValorDeSequencia(maiorGravado))
);

export interface SituacaoDaSequencia {
  chave: string;
  rotulo: string;
  ultimo: number;
  proximo: number;
  /** Quem adiantou por ultimo, se alguem adiantou pela tela. */
  ajustadoPor?: string | null;
  ajustadoEm?: string | null;
}

export const LIMITE_NUMERO_DOCUMENTO = 999_999_999;

/**
 * Valida o "proximo numero" digitado. Devolve o valor que a sequencia deve
 * guardar (proximo - 1) ou o erro em portugues. Nunca volta para tras.
 */
export const validarNovoProximo = (proximoDigitado: unknown, ultimoAtual: number, rotulo: string): { ok: true; valorDaSequencia: number } | { ok: false; erro: string } => {
  const texto = String(proximoDigitado ?? '').trim().replace(/\./g, '');
  const proximo = Number(texto);
  if (!/^\d+$/.test(texto) || !Number.isInteger(proximo) || proximo < 1) {
    return { ok: false, erro: `Informe o próximo número de ${rotulo.toLowerCase()} como um número inteiro maior que zero.` };
  }
  if (proximo > LIMITE_NUMERO_DOCUMENTO) {
    return { ok: false, erro: `O próximo número de ${rotulo.toLowerCase()} é grande demais (máximo ${LIMITE_NUMERO_DOCUMENTO.toLocaleString('pt-BR')}).` };
  }
  if (proximo <= ultimoAtual) {
    return { ok: false, erro: `O último ${rotulo.toLowerCase()} gravado é o nº ${ultimoAtual.toLocaleString('pt-BR')}. O próximo precisa ser ${(ultimoAtual + 1).toLocaleString('pt-BR')} ou maior: a numeração nunca volta, para não repetir número de documento já emitido.` };
  }
  return { ok: true, valorDaSequencia: proximo - 1 };
};
