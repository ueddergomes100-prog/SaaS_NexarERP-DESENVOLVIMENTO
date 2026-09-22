import { digitosDoBoleto, montarCodigoBarras, zerosAEsquerda } from './boletoDomain';

/**
 * O QUE MUDA DE BANCO PARA BANCO NO BOLETO (2026-09-21).
 *
 * `boletoDomain.ts` tem o que e' igual em todo banco (fator de vencimento,
 * DVs, codigo de barras, linha digitavel). Aqui fica o que cada banco define
 * do seu jeito: nosso numero, digito do nosso numero e o campo livre de 25
 * posicoes do codigo de barras.
 *
 * ---------------------------------------------------------------------------
 * RESSALVA IMPORTANTE, REGISTRADA DE PROPOSITO
 * ---------------------------------------------------------------------------
 *
 * Os parametros do Sicoob abaixo foram tirados por COMPARACAO com o arquivo
 * de remessa real da Sol Life (CNAB240_2000081800042995.txt, 3 titulos:
 * nosso numero 1200/1201/1202, DV 9/6/3, cooperativa 3049, conta 51215).
 *
 * Tres titulos NAO bastam pra fixar a formula: oito combinacoes diferentes de
 * peso/tamanho reproduzem exatamente esses mesmos tres DVs. A escolhida e' a
 * que bate com a documentacao mais comum do Sicoob (pesos 3,1,9,7) E com o
 * arquivo real -- mas ela TEM de ser confirmada na homologacao com o banco,
 * que e' obrigatoria de qualquer jeito antes de emitir cobranca registrada.
 *
 * Por isso os tamanhos sao parametros, e nao numeros fixos no meio do
 * calculo: se a homologacao apontar diferenca, muda-se um parametro, nao a
 * formula inteira.
 */

export interface ParametrosNossoNumeroSicoob {
  /** Cooperativa (agencia), 4 digitos. */
  cooperativa: string;
  /** Conta/cedente usado no calculo do DV. */
  conta: string;
  /** Quantos digitos a conta ocupa no calculo. Ver a ressalva acima. */
  digitosDaConta?: number;
  /** Quantos digitos o nosso numero ocupa no calculo. */
  digitosDoNossoNumero?: number;
}

/** Pesos do Sicoob, ciclicos da esquerda pra direita. */
const PESOS_SICOOB = [3, 1, 9, 7];

/**
 * Digito verificador do nosso numero no Sicoob.
 *
 * Modulo 11 com pesos 3,1,9,7; resto 0 ou 1 (DV 10/11) vira 0 -- e' a regra
 * do banco, diferente do DV do codigo de barras.
 */
export const dvNossoNumeroSicoob = (nossoNumero: string | number, p: ParametrosNossoNumeroSicoob): number => {
  const sequencia = zerosAEsquerda(p.cooperativa, 4)
    + zerosAEsquerda(p.conta, p.digitosDaConta ?? 8)
    + zerosAEsquerda(nossoNumero, p.digitosDoNossoNumero ?? 9);

  let soma = 0;
  for (let i = 0; i < sequencia.length; i += 1) {
    soma += Number(sequencia[i]) * PESOS_SICOOB[i % PESOS_SICOOB.length];
  }
  const dv = 11 - (soma % 11);
  return (dv === 10 || dv === 11) ? 0 : dv;
};

/** Nosso numero com o DV colado, do jeito que sai impresso e vai na remessa. */
export const nossoNumeroSicoobComDv = (nossoNumero: string | number, p: ParametrosNossoNumeroSicoob): string => {
  const base = zerosAEsquerda(nossoNumero, p.digitosDoNossoNumero ?? 9);
  return `${base}${dvNossoNumeroSicoob(nossoNumero, p)}`;
};

export interface DadosBoletoSicoob {
  cooperativa: string;
  /** DV da cooperativa (1 digito). */
  cooperativaDv?: string;
  conta: string;
  /** DV da conta (1 digito). */
  contaDv?: string;
  /** Modalidade de cobranca do convenio -- 01 = simples com registro. */
  modalidade: string;
  nossoNumero: string | number;
  /** Numero da parcela dentro do carne. 01 quando nao e' carne. */
  parcela?: string | number;
  digitosDaConta?: number;
  digitosDoNossoNumero?: number;
}

/**
 * Campo livre do Sicoob (25 posicoes do codigo de barras):
 *
 *   carteira(1) agencia(4) modalidade(2) conta(7) nossoNumero(10) parcela(1)
 *
 * Carteira 1 = cobranca simples com registro (a unica que o cliente usa
 * hoje, conforme o cadastro do sistema antigo: "Carteira Emissao Propria 01").
 */
export const campoLivreSicoob = (dados: DadosBoletoSicoob): string => {
  const carteira = '1';
  const agencia = zerosAEsquerda(dados.cooperativa, 4);
  const modalidade = zerosAEsquerda(dados.modalidade || '01', 2);
  const conta = zerosAEsquerda(dados.conta, 7);
  const nossoNumero = nossoNumeroSicoobComDv(dados.nossoNumero, {
    cooperativa: dados.cooperativa,
    conta: dados.conta,
    digitosDaConta: dados.digitosDaConta,
    digitosDoNossoNumero: dados.digitosDoNossoNumero,
  });
  const parcela = zerosAEsquerda(dados.parcela ?? 1, 1);

  return `${carteira}${agencia}${modalidade}${conta}${zerosAEsquerda(nossoNumero, 10)}${parcela}`;
};

/** Codigo de barras completo de um boleto Sicoob. */
export const codigoBarrasSicoob = (args: {
  dados: DadosBoletoSicoob;
  vencimento: string;
  valorCentavos: number;
}): string => montarCodigoBarras({
  banco: '756',
  vencimento: args.vencimento,
  valorCentavos: args.valorCentavos,
  campoLivre: campoLivreSicoob(args.dados),
});

// ---------------------------------------------------------------------------
// REGISTROS DO CNAB 240
// ---------------------------------------------------------------------------

/**
 * Monta uma linha de 240 posicoes a partir de campos posicionados.
 *
 * Em arquivo de posicao fixa, um campo com tamanho errado empurra TODOS os
 * seguintes e o banco rejeita o arquivo inteiro. Por isso a linha nasce
 * cheia de espacos e cada campo e' escrito na posicao dele: campo que passar
 * do tamanho e' erro na hora, nao um arquivo torto descoberto no banco.
 */
export interface CampoCnab {
  /** Posicao inicial, 1-based (como a especificacao da FEBRABAN escreve). */
  de: number;
  /** Posicao final, 1-based e inclusiva. */
  ate: number;
  valor: string | number;
  /** `num` preenche com zeros a esquerda; `alfa` com espacos a direita. */
  tipo?: 'num' | 'alfa';
}

export const montarLinhaCnab = (campos: CampoCnab[], tamanho = 240): string => {
  const linha = new Array(tamanho).fill(' ');

  for (const campo of campos) {
    const largura = campo.ate - campo.de + 1;
    if (largura <= 0 || campo.ate > tamanho) {
      throw new Error(`Campo CNAB fora do registro: posições ${campo.de}-${campo.ate}.`);
    }
    const bruto = campo.tipo === 'num'
      ? zerosAEsquerda(digitosDoBoleto(String(campo.valor ?? '')), largura)
      : String(campo.valor ?? '').toUpperCase().slice(0, largura).padEnd(largura, ' ');

    if (bruto.length !== largura) {
      throw new Error(`Campo CNAB com tamanho errado nas posições ${campo.de}-${campo.ate}.`);
    }
    for (let i = 0; i < largura; i += 1) linha[campo.de - 1 + i] = bruto[i];
  }

  return linha.join('');
};

/** Data `AAAA-MM-DD` no formato DDMMAAAA da remessa. */
export const dataCnab = (iso: string): string => {
  const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return p ? `${p[3]}${p[2]}${p[1]}` : '00000000';
};

/** Valor em centavos para o campo de 15 posicoes da remessa. */
export const valorCnab = (centavos: number): string => zerosAEsquerda(Math.max(0, Math.round(Number(centavos) || 0)), 15);
