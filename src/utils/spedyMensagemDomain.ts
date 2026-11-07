/**
 * Mensagens de validacao da Spedy em portugues (07/11/2026).
 *
 * A Spedy devolve a validacao do ASP.NET em ingles ("The field Number must be
 * a string with a maximum length of 10."), que chegava crua na tela da nota
 * (regra 2 do CLAUDE.md). As travas da propria nota pegam os casos conhecidos
 * antes do envio; isto e' a rede de seguranca para o resto: troca o trecho em
 * ingles pelo equivalente em portugues, com o nome do campo que o usuario
 * conhece, e deixa o resto da mensagem como veio.
 */

const CAMPOS: Record<string, string> = {
  number: 'Número do endereço (do cliente ou da transportadora)',
  street: 'Rua do endereço',
  district: 'Bairro',
  postalcode: 'CEP',
  additionalinformation: 'Complemento / informações adicionais',
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  statetaxnumber: 'Inscrição estadual',
  federaltaxnumber: 'CPF / CNPJ / documento',
  description: 'Descrição do produto',
  code: 'Código do produto',
  departurelocation: 'Local de embarque',
  species: 'Espécie dos volumes',
  brand: 'Marca dos volumes',
  volumenumeration: 'Numeração dos volumes',
  plate: 'Placa do veículo',
};

const nomeDoCampo = (campo: string): string => CAMPOS[campo.toLowerCase()] ?? campo;

export const traduzirMensagemDaSpedy = (mensagem: string): string => String(mensagem ?? '')
  .replace(
    /The field (\w+) must be a string(?: or array type)? with a maximum length of '?(\d+)'?\.?/gi,
    (_, campo: string, max: string) => `o campo "${nomeDoCampo(campo)}" aceita no máximo ${max} caracteres.`,
  )
  .replace(
    /The field (\w+) must be a string(?: or array type)? with a minimum length of '?(\d+)'?\.?/gi,
    (_, campo: string, min: string) => `o campo "${nomeDoCampo(campo)}" precisa ter pelo menos ${min} caracteres.`,
  )
  .replace(
    /The (\w+) field is required\.?/gi,
    (_, campo: string) => `o campo "${nomeDoCampo(campo)}" é obrigatório.`,
  );
