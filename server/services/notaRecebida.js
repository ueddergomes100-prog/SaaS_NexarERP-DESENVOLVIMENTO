/**
 * NOTA RECEBIDA PELA CHAVE DE ACESSO (2026-09-21).
 *
 * Pedido do dono: "quando digitar a chave, o sistema sozinho ja importa a
 * nota fiscal". Ate aqui a Entrada de Notas so' aceitava o ARQUIVO XML: a
 * pessoa tinha de conseguir o arquivo com o fornecedor, salvar e subir.
 *
 * A Spedy expoe as notas que a SEFAZ distribui contra o CNPJ da empresa
 * (`/inbound-product-invoices`). Duas coisas importam, e as duas moldam o
 * fluxo da tela:
 *
 * 1. O XML COMPLETO (`nfeProc`, o unico que serve pra dar entrada e pro
 *    contador escriturar) so' e' liberado DEPOIS DA MANIFESTACAO do
 *    destinatario na SEFAZ. Antes disso o download traz so' o resumo. Por
 *    isso a manifestacao e' um passo proprio, com confirmacao do usuario:
 *    e' ato fiscal em nome da empresa, nao pode acontecer sozinho.
 *
 * 2. A SEFAZ guarda 90 dias e so' distribui nota emitida CONTRA o CNPJ da
 *    empresa. Nota mais velha, ou de outro CNPJ, nunca vai aparecer -- e a
 *    mensagem tem de dizer isso, senao a pessoa fica tentando a mesma chave.
 *
 * Funcoes puras aqui; as chamadas HTTP ficam na rota.
 */

const TAMANHO_CHAVE = 44;

/** Só os dígitos: a chave costuma ser colada com espaços. */
const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');

/** DV da chave (módulo 11, pesos 2..9 da direita para a esquerda). */
const digitoVerificador = (primeiros43) => {
  if (!/^\d{43}$/.test(primeiros43)) return null;
  let peso = 2;
  let soma = 0;
  for (let i = primeiros43.length - 1; i >= 0; i -= 1) {
    soma += Number(primeiros43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
};

/**
 * Valida a chave digitada. Devolve `{ ok, chave, erro }` -- erro em portugues,
 * dizendo o que fazer (regra 2 do CLAUDE.md).
 */
const validarChaveAcesso = (valor) => {
  const chave = somenteDigitos(valor);
  if (!chave) return { ok: false, chave: '', erro: 'Informe a chave de acesso da nota (44 números).' };
  if (chave.length !== TAMANHO_CHAVE) {
    return { ok: false, chave, erro: `A chave de acesso tem ${TAMANHO_CHAVE} números. Você informou ${chave.length}.` };
  }
  const dv = digitoVerificador(chave.slice(0, 43));
  if (dv === null || dv !== Number(chave[43])) {
    return { ok: false, chave, erro: 'A chave de acesso não confere (o último dígito não bate). Confira os números.' };
  }
  return { ok: true, chave, erro: null };
};

/**
 * Traduz a nota que a Spedy devolveu para o que a TELA precisa saber.
 *
 * `situacao` diz o proximo passo, e e' o que a tela usa pra decidir o que
 * mostrar:
 *   - `pronta`      -> da pra baixar o XML e importar agora;
 *   - `manifestar`  -> achou, mas o XML completo depende da manifestacao;
 *   - `cancelada`   -> nota cancelada/denegada na SEFAZ: nao se da entrada;
 *   - `nao_encontrada` -> nao chegou (ainda) pra este CNPJ.
 */
const situacaoDaNota = (nota) => {
  if (!nota) return { situacao: 'nao_encontrada', motivo: null };

  const status = String(nota.status || '').toLowerCase();
  if (status === 'canceled' || status === 'denied') {
    return {
      situacao: 'cancelada',
      motivo: status === 'canceled'
        ? 'Esta nota foi CANCELADA na SEFAZ. Não é possível dar entrada nela.'
        : 'Esta nota foi DENEGADA na SEFAZ. Não é possível dar entrada nela.',
    };
  }
  if (nota.isComplete === true) return { situacao: 'pronta', motivo: null };
  return {
    situacao: 'manifestar',
    motivo: 'A SEFAZ só libera o XML completo depois que a empresa registra a Ciência da Operação.',
  };
};

/** Resumo da nota para a tela confirmar antes de manifestar/importar. */
const resumoDaNota = (nota) => ({
  id: nota?.id || '',
  numero: String(nota?.number || nota?.numero || ''),
  serie: String(nota?.series || ''),
  emitenteNome: nota?.issuer?.name || nota?.issuer?.corporateName || '',
  emitenteCnpj: somenteDigitos(nota?.issuer?.federalTaxNumber || ''),
  emitidaEm: nota?.issuedAt || nota?.issueDate || '',
  valorTotal: Number(nota?.totalAmount ?? nota?.amount ?? 0),
  chave: somenteDigitos(nota?.accessKey || ''),
});

/**
 * Mensagem de "não achei" -- explica os dois motivos reais (90 dias e CNPJ),
 * para a pessoa não ficar repetindo a mesma busca.
 */
const mensagemNaoEncontrada = () => (
  'Esta nota ainda não chegou da SEFAZ. Só aparecem aqui notas emitidas contra o CNPJ da sua empresa '
  + 'nos últimos 90 dias. Se a nota foi emitida agora, tente de novo em alguns minutos; '
  + 'se for mais antiga ou de outro CNPJ, use o arquivo XML.'
);

/** Traduz a falha da Spedy para algo que o usuário resolve sozinho. */
const mensagemDeFalha = (status, corpo) => {
  const detalhe = typeof corpo === 'string' ? corpo : (corpo?.message || corpo?.error || '');
  if (status === 402 || /plano|plan|subscription|feature/i.test(detalhe)) {
    return 'O recurso "Notas recebidas" não está ativo no plano da Spedy desta empresa. '
      + 'Ative no painel da Spedy (Configurações → NF-e → Notas recebidas) ou use o arquivo XML.';
  }
  if (status === 401 || status === 403) {
    return 'A Spedy recusou a chave de API desta empresa. Confira a integração em Configurações → Configuração de Nota Fiscal.';
  }
  if (status === 429) {
    return 'A Spedy pediu para aguardar antes de uma nova busca. Tente novamente em alguns minutos.';
  }
  return detalhe || 'Não foi possível consultar a nota na SEFAZ agora. Tente novamente em instantes.';
};

module.exports = {
  TAMANHO_CHAVE,
  digitoVerificador,
  mensagemDeFalha,
  mensagemNaoEncontrada,
  resumoDaNota,
  situacaoDaNota,
  somenteDigitos,
  validarChaveAcesso,
};
