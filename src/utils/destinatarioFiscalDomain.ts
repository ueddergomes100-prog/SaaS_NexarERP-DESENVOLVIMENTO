/**
 * INSCRICAO ESTADUAL DO DESTINATARIO NA NF-e (2026-09-21).
 *
 * Caso real (Sol Natus, producao): a NF-e para uma pessoa juridica voltou com
 * "Rejeicao 232: IE do destinatario nao informada" -- embora o cadastro do
 * cliente TIVESSE a Inscricao Estadual. O sistema simplesmente nunca mandava
 * `receiver.stateTaxNumber`: o campo "Inscricao Estadual / RG" do cliente
 * (`identidade`) nao entrava no payload.
 *
 * Regras:
 *  - PESSOA JURIDICA (CNPJ): a IE do cadastro vai em `stateTaxNumber`. "ISENTO"
 *    (convencao do proprio cadastro, "Isento, se nao houver") vai como esta'.
 *    Sem nada preenchido NAO se adivinha: a nota e' bloqueada com mensagem
 *    dizendo onde cadastrar -- seguir sem IE de contribuinte seria emitir
 *    errado ou tomar a rejeicao 232 da SEFAZ.
 *  - PESSOA FISICA (CPF): o campo guarda o RG, que NAO e' Inscricao Estadual --
 *    nunca vai no payload.
 */

export interface InscricaoEstadualDestinatario {
  /** Valor pra `receiver.stateTaxNumber`; ausente = nao manda o campo. */
  valor?: string;
  /** Mensagem em portugues quando a nota nao pode seguir. */
  erro?: string;
}

const somenteDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

export const resolverInscricaoEstadualDestinatario = (params: {
  documento: string;
  /** Conteudo do campo "Inscricao Estadual / RG" do cliente. */
  identidade?: string | null;
  clienteNome?: string;
}): InscricaoEstadualDestinatario => {
  const documento = somenteDigitos(params.documento);
  if (documento.length !== 14) return {}; // CPF: o campo e' RG, nao IE

  const bruto = String(params.identidade ?? '').trim();
  if (/^isento$/i.test(bruto)) return { valor: 'ISENTO' };

  const digitos = somenteDigitos(bruto);
  if (digitos.length >= 5 && digitos.length <= 14) return { valor: digitos };

  const nome = String(params.clienteNome ?? '').trim();
  const quem = nome ? `O cliente "${nome}"` : 'O cliente';
  return {
    erro: bruto
      ? `${quem} é pessoa jurídica e a Inscrição Estadual cadastrada ("${bruto}") não parece válida. Corrija em Cadastros → Clientes (campo "Inscrição Estadual / RG") ou informe "ISENTO", se for isento.`
      : `${quem} é pessoa jurídica e não tem Inscrição Estadual cadastrada. Informe em Cadastros → Clientes (campo "Inscrição Estadual / RG") ou escreva "ISENTO", se for isento.`,
  };
};
