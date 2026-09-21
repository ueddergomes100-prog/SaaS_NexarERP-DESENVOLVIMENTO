/**
 * REENVIO DE NOTA REJEITADA -- QUAL `integrationId` USAR (2026-09-21).
 *
 * A Spedy usa o `integrationId` como chave de idempotencia: reenviar o POST
 * com o MESMO id "atualiza a nota existente" e reaproveita o numero -- e' o
 * caminho documentado pra corrigir uma rejeicao de DADO (NCM, CFOP,
 * endereco do cliente...), e continua sendo o padrao aqui.
 *
 * Ha' uma rejeicao que esse caminho NAO cura: a que nasce da CONFIGURACAO da
 * empresa no momento em que a nota foi criada. Caso real (producao da Sol
 * Natus): a NF-e foi criada com o ambiente da empresa indefinido, voltou com
 * "Ambiente:0" e, mesmo depois de definir Producao e corrigir o NCM, o
 * reenvio com o mesmo id voltou identico -- a Spedy manteve "Ambiente da
 * nota: 0" na nota antiga. Nesse caso so' uma nota NOVA (integrationId novo)
 * pega a configuracao atual.
 *
 * Cada tentativa nova ganha um sufixo `-tN`. A tentativa em uso fica gravada
 * na nota local (`tentativaEmissao`) so' DEPOIS que a Spedy responde: se o
 * envio cair no meio, o proximo clique recalcula o MESMO id e a idempotencia
 * segura contra nota duplicada.
 *
 * Nota nova = numero novo; o numero da rejeitada antiga fica como buraco na
 * sequencia e deve ser inutilizado na SEFAZ (a Spedy tem essa operacao).
 */

/** Rejeicao que a Spedy grava na nota e que so' uma nota nova resolve. */
export const rejeicaoPrendeConfiguracaoNaNota = (mensagem?: string | null): boolean => {
  const texto = String(mensagem ?? '');
  return /Ambiente:\s*0\b/i.test(texto) || /definições do serviço/i.test(texto);
};

export interface EscolhaIntegrationId {
  integrationId: string;
  /** Numero da tentativa que vai pra Spedy (1 = a original). */
  tentativa: number;
  /** true quando o reenvio vai criar uma nota nova na Spedy. */
  notaNova: boolean;
}

export const escolherIntegrationIdDoReenvio = (params: {
  /** id do documento local em `notas_fiscais` */
  docId: string;
  /** tentativa gravada na nota local; ausente = 1 (a original) */
  tentativaAtual?: number | null;
  /** ultima mensagem de rejeicao da nota */
  mensagemRejeicao?: string | null;
}): EscolhaIntegrationId => {
  const atual = Math.max(1, Math.floor(Number(params.tentativaAtual) || 1));
  const notaNova = rejeicaoPrendeConfiguracaoNaNota(params.mensagemRejeicao);
  const tentativa = notaNova ? atual + 1 : atual;
  return {
    integrationId: tentativa === 1 ? params.docId : `${params.docId}-t${tentativa}`,
    tentativa,
    notaNova,
  };
};
