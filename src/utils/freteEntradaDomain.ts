import { ratearValorPorPesos } from './notaAvulsaDomain';

/**
 * FRETE (CT-e) NA ENTRADA DE NOTA (2026-09-21).
 *
 * Pedido do dono: "na tela de nota fiscal tem que ter como lancar o frete
 * manual... lancar o conhecimento de transporte certinho: colocar a chave,
 * colocar o valor, colocar a transportadora."
 *
 * Duas coisas acontecem com esse valor, e elas sao independentes:
 *
 * 1. O frete ENTRA NO CUSTO da mercadoria, rateado entre os itens pelo valor
 *    de cada um. Quem paga R$ 200 de frete por uma carga nao comprou a
 *    mercadoria pelo preco da nota: comprou por ela mais o frete. Sem isso a
 *    margem calculada na venda e' maior do que a real.
 *
 * 2. O frete VIRA UM TITULO A PAGAR. Quando ha transportadora informada, o
 *    titulo e' DELA, separado do titulo do fornecedor da mercadoria -- sao
 *    dois credores diferentes, com vencimentos diferentes. Frete embutido na
 *    propria nota (o `vFrete` que o XML ja traz, cobrado pelo fornecedor)
 *    nao gera titulo separado: quem cobra e' o mesmo fornecedor.
 *
 * Regra pura: sem tela, sem Firestore.
 */

/** Chave de acesso de NF-e/CT-e: 44 digitos. */
export const TAMANHO_CHAVE_ACESSO = 44;

/**
 * Digito verificador da chave (modulo 11, pesos 2..9 ciclicos, da direita
 * pra esquerda) -- o mesmo calculo da SEFAZ para NF-e, NFC-e e CT-e.
 *
 * Existe porque chave digitada errada e' comum: sao 44 numeros, e o erro so'
 * apareceria la na frente, quando o contador fosse escriturar. Conferir o DV
 * pega a maior parte dos erros de digitacao na hora.
 */
export const digitoVerificadorDaChave = (primeiros43: string): number | null => {
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

/** Só os dígitos, para aceitar chave colada com espaços ou pontos. */
export const somenteDigitos = (valor: string): string => String(valor || '').replace(/\D/g, '');

/**
 * Erro em portugues da chave digitada, ou `null` quando esta boa. Chave
 * VAZIA e' valida: o campo e' opcional (nem toda entrada tem CT-e).
 */
export const erroDaChaveAcesso = (valor: string): string | null => {
  const digitos = somenteDigitos(valor);
  if (digitos.length === 0) return null;
  if (digitos.length !== TAMANHO_CHAVE_ACESSO) {
    return `A chave de acesso tem ${TAMANHO_CHAVE_ACESSO} números. Você digitou ${digitos.length}.`;
  }
  const dv = digitoVerificadorDaChave(digitos.slice(0, 43));
  if (dv === null || dv !== Number(digitos[43])) {
    return 'A chave de acesso não confere (o último dígito não bate). Confira os números digitados.';
  }
  return null;
};

export interface ItemComValor {
  /** Valor total do item na nota (quantidade x unitario). */
  valorTotal: number;
  quantidade: number;
}

export interface FreteRateadoDoItem {
  /** Parte do frete que coube a este item, em reais. */
  freteRateado: number;
  /** Custo unitario ja com a parte do frete somada. */
  custoUnitarioComFrete: number;
}

/**
 * Distribui o frete entre os itens, proporcional ao valor de cada um, e
 * devolve o custo unitario ja com a parte que coube a cada linha.
 *
 * Proporcional ao VALOR, nao a quantidade: e' o criterio que a contabilidade
 * usa e o unico que nao distorce carga mista -- 100 parafusos baratos e 2
 * motores caros no mesmo caminhao nao dividem o frete meio a meio.
 *
 * Usa ratearValorPorPesos (a mesma da Nota Avulsa), que trabalha em centavos
 * e devolve a soma exata, sem centavo sumido.
 */
export const ratearFreteNosItens = (itens: ItemComValor[], freteTotal: number): FreteRateadoDoItem[] => {
  const pesos = itens.map((item) => Math.max(0, Number(item.valorTotal) || 0));
  const partes = ratearValorPorPesos(Math.max(0, Number(freteTotal) || 0), pesos);

  return itens.map((item, indice) => {
    const parte = partes[indice] || 0;
    const quantidade = Number(item.quantidade) || 0;
    const valorTotal = Number(item.valorTotal) || 0;
    const custoUnitario = quantidade > 0 ? (valorTotal + parte) / quantidade : 0;
    return {
      freteRateado: parte,
      // Arredonda em centavos: custo unitario com dizimas (frete / 3 itens)
      // nao pode entrar no cadastro com 12 casas decimais.
      custoUnitarioComFrete: Math.round(custoUnitario * 100) / 100,
    };
  });
};

export interface DadosDoFrete {
  /** Valor do frete em reais. 0 = sem frete. */
  valor: number;
  /** Chave do CT-e (44 digitos), quando houver conhecimento. */
  chaveCte: string;
  /** Fornecedor do tipo Transportadora. Vazio = frete do proprio fornecedor. */
  transportadoraId: string;
  transportadoraNome: string;
}

/**
 * O frete gera um titulo PROPRIO (da transportadora)?
 *
 * So' quando ha valor E transportadora escolhida. Sem transportadora, o frete
 * foi cobrado pelo fornecedor da mercadoria dentro da propria nota -- entra no
 * custo, mas nao cria segundo titulo, senao a empresa pagaria duas vezes.
 */
export const freteGeraTituloProprio = (frete: DadosDoFrete): boolean => (
  Number(frete.valor) > 0 && Boolean(String(frete.transportadoraId || '').trim())
);

/**
 * Erro em portugues do bloco de frete, ou `null`. A tela mostra isto antes de
 * deixar confirmar a entrada.
 */
export const erroDoFrete = (frete: DadosDoFrete): string | null => {
  const valor = Number(frete.valor) || 0;
  if (valor < 0) return 'O valor do frete não pode ser negativo.';
  const erroChave = erroDaChaveAcesso(frete.chaveCte);
  if (erroChave) return erroChave;
  // Chave de CT-e sem valor e' quase sempre meio preenchimento: a pessoa
  // colou a chave e esqueceu o valor. Avisar aqui evita a nota entrar com
  // custo errado e o titulo do frete nunca aparecer.
  if (somenteDigitos(frete.chaveCte).length === TAMANHO_CHAVE_ACESSO && valor <= 0) {
    return 'Você informou a chave do conhecimento de transporte, mas não o valor do frete.';
  }
  if (valor > 0 && !String(frete.transportadoraId || '').trim() && somenteDigitos(frete.chaveCte).length > 0) {
    return 'Escolha a transportadora do conhecimento de transporte, ou apague a chave se o frete foi cobrado pelo próprio fornecedor.';
  }
  return null;
};

/** Descricao do titulo a pagar do frete. */
export const descricaoDoTituloDeFrete = (numeroNota: string, frete: DadosDoFrete): string => {
  const chave = somenteDigitos(frete.chaveCte);
  const complemento = chave ? ` - CT-e ${chave.slice(-6)}` : '';
  return `FRETE NF ${numeroNota} - ${frete.transportadoraNome}${complemento}`;
};
