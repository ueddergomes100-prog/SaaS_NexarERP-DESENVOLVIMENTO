import { apenasDigitos, mensagemDocumentoInvalido, tipoDocumento } from './documentoValidacao';

/**
 * CADASTRO DE CLIENTE PELO APP DO VENDEDOR (2026-09-21).
 *
 * O vendedor cadastra o cliente na rua, no celular, ja' com tudo que a nota
 * fiscal exige la' na base: CPF/CNPJ, nome, endereco completo com numero,
 * codigo da cidade (IBGE, vem do CEP) e -- pra pessoa juridica -- Inscricao
 * Estadual. E-mail e' opcional (so' pra envio da nota).
 *
 * O cliente digita so' os numeros e a tela formata sozinha (pontos, traco e
 * barra). O que vai pro banco continua sendo SO' DIGITOS em documento, CEP e
 * telefone, como o cadastro do computador ja' faz -- e' assim que a busca por
 * duplicado e a nota fiscal leem.
 */

// ---------------------------------------------------------------------------
// Mascaras (formatam enquanto digita)
// ---------------------------------------------------------------------------

/** CPF ate 11 digitos (000.000.000-00); a partir do 12o vira CNPJ
 * (00.000.000/0000-00). Refaz a mascara a cada tecla, entao a virada acontece
 * sozinha. */
export const mascaraDocumento = (valor: string): string => {
  const d = apenasDigitos(valor).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
};

export const mascaraCep = (valor: string): string => {
  const d = apenasDigitos(valor).slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, '$1-$2');
};

/** (00) 0000-0000 ou (00) 00000-0000 (celular, 11 digitos). */
export const mascaraTelefone = (valor: string): string => {
  const d = apenasDigitos(valor).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export const emailValido = (email: string): boolean => (
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
);

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

export interface FormularioClienteMobile {
  /** Como o cliente digitou (com mascara). */
  documento: string;
  nome: string;
  fantasia: string;
  /** Inscricao Estadual (PJ, ou "ISENTO") / RG (PF, opcional). */
  identidade: string;
  cep: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  codigoIbge: string;
  telefone: string;
  email: string;
}

export const formularioClienteVazio = (): FormularioClienteMobile => ({
  documento: '', nome: '', fantasia: '', identidade: '', cep: '', endereco: '', numero: '',
  bairro: '', cidade: '', estado: '', codigoIbge: '', telefone: '', email: '',
});

export type TipoPessoaCliente = 'PF' | 'PJ' | null;

export const tipoPessoaDoDocumento = (documento: string): TipoPessoaCliente => {
  const tipo = tipoDocumento(apenasDigitos(documento));
  return tipo === 'CPF' ? 'PF' : tipo === 'CNPJ' ? 'PJ' : null;
};

/**
 * Confere o que a nota fiscal exige. Devolve as mensagens (em portugues, no
 * plural quando falta mais de uma coisa) na ordem em que aparecem na tela;
 * lista vazia = pode salvar. Nao se preenche nada por conta propria: dado que
 * falta e' pedido a quem esta cadastrando.
 */
export const validarClienteMobile = (f: FormularioClienteMobile): string[] => {
  const erros: string[] = [];

  const digitosDoc = apenasDigitos(f.documento);
  if (!digitosDoc) {
    erros.push('Informe o CPF ou o CNPJ do cliente — a nota fiscal precisa dele.');
  } else {
    const erroDoc = mensagemDocumentoInvalido(f.documento);
    if (erroDoc) erros.push(erroDoc);
  }

  if (!f.nome.trim()) {
    erros.push(tipoPessoaDoDocumento(f.documento) === 'PJ'
      ? 'Informe a razão social do cliente.'
      : 'Informe o nome do cliente.');
  }

  if (tipoPessoaDoDocumento(f.documento) === 'PJ' && !f.identidade.trim()) {
    erros.push('Informe a Inscrição Estadual da empresa, ou escreva ISENTO se ela for isenta — sem isso a nota fiscal é rejeitada.');
  }

  if (apenasDigitos(f.cep).length !== 8) {
    erros.push('Informe o CEP com 8 números.');
  }
  if (!f.endereco.trim()) erros.push('Informe o endereço (rua).');
  if (!f.numero.trim()) erros.push('Informe o número do endereço (ou S/N, se não houver).');
  if (!f.bairro.trim()) erros.push('Informe o bairro.');
  if (!f.cidade.trim() || !f.estado.trim()) erros.push('Informe a cidade e o estado (o CEP preenche sozinho).');

  if (f.email.trim() && !emailValido(f.email)) {
    erros.push('O e-mail parece incompleto. Corrija ou deixe em branco — ele só serve para enviar a nota.');
  }

  const digitosTel = apenasDigitos(f.telefone);
  if (digitosTel && digitosTel.length < 10) {
    erros.push('O telefone precisa do DDD e do número (10 ou 11 números).');
  }

  return erros;
};

/** Avisos que NAO impedem salvar. */
export const avisosClienteMobile = (f: FormularioClienteMobile): string[] => {
  const avisos: string[] = [];
  if (apenasDigitos(f.cep).length === 8 && !f.codigoIbge.trim()) {
    avisos.push('Não consegui o código da cidade (IBGE) pelo CEP. O cliente será salvo, mas antes de emitir nota fiscal para ele complete o cadastro no computador.');
  }
  return avisos;
};

/**
 * Documento no formato do cadastro do computador (ClienteForm.tsx): os mesmos
 * campos, textos em CAIXA ALTA, numeros so' com digitos. Campos que o app nao
 * pede ficam vazios, igual ao computador -- nunca `undefined` no Firestore.
 */
export const montarClienteParaGravar = (
  f: FormularioClienteMobile,
  extras: { codigo: string; tenantId: string; vendedorId: string },
) => ({
  codigo: extras.codigo,
  nome: f.nome.toUpperCase().trim(),
  fantasia: f.fantasia.toUpperCase().trim(),
  telefone: apenasDigitos(f.telefone),
  celular: '',
  email: f.email.trim().toLowerCase(),
  emailNfe: '',
  documento: apenasDigitos(f.documento),
  identidade: /^isento$/i.test(f.identidade.trim()) ? 'ISENTO' : f.identidade.toUpperCase().trim(),
  endereco: f.endereco.toUpperCase().trim(),
  bairro: f.bairro.toUpperCase().trim(),
  numero: f.numero.toUpperCase().trim(),
  cep: apenasDigitos(f.cep),
  cidade: f.cidade.toUpperCase().trim(),
  estado: f.estado.toUpperCase().trim(),
  codigoIbge: f.codigoIbge.trim(),
  referencia: '',
  enderecoCobranca: '', numeroCobranca: '', bairroCobranca: '', cidadeCobranca: '', estadoCobranca: '', cepCobranca: '',
  enderecoEntrega: '', numeroEntrega: '', bairroEntrega: '', cidadeEntrega: '', estadoEntrega: '', cepEntrega: '',
  referenciaEntrega: '',
  limiteDeCredito: null,
  tenantId: extras.tenantId,
  // De onde veio o cadastro -- ajuda a conferir depois o que o vendedor criou.
  origemCadastro: 'app_vendedor',
  cadastradoPorVendedorId: extras.vendedorId,
});
