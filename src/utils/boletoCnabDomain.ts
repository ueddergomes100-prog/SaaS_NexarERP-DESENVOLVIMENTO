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
 * DV DO NOSSO NUMERO -- CONFIRMADO CONTRA DADO REAL (2026-09-23)
 * ---------------------------------------------------------------------------
 *
 * Em 2026-09-21 so' havia 3 titulos reais (nosso numero 1200/1201/1202) e oito
 * combinacoes de tamanho reproduziam os mesmos 3 DVs. Em 2026-09-23 chegaram
 * mais dados reais do Sicoob: um segundo arquivo de remessa (nosso numero
 * 1330, DV 1) e um arquivo de RETORNO com 196 titulos, cada um com nosso
 * numero + DV calculado pelo proprio banco.
 *
 * A unica formula que reproduz os 196 DVs do retorno (e os 4 da remessa) e':
 * modulo 11, pesos 3,1,9,7 ciclicos da esquerda pra direita, sobre
 *
 *   cooperativa (4) + conta COM O DV da conta, em 9 posicoes + nosso numero em 8
 *
 * (ex.: 3049 + 000512150 + 00001330). Por isso `contaDv` entra no calculo.
 */

export interface ParametrosNossoNumeroSicoob {
  /** Cooperativa (agencia), 4 digitos. */
  cooperativa: string;
  /** Conta do cedente, sem o DV. */
  conta: string;
  /** DV da conta -- entra no calculo do DV do nosso numero (ver acima). */
  contaDv?: string;
  /** Quantos digitos conta+DV ocupam no calculo (9 confirmado pelo banco). */
  digitosDaConta?: number;
  /** Quantos digitos o nosso numero ocupa no calculo (8 confirmado pelo banco). */
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
    + zerosAEsquerda(`${digitosDoBoleto(p.conta)}${digitosDoBoleto(p.contaDv ?? '')}`, p.digitosDaConta ?? 9)
    + zerosAEsquerda(nossoNumero, p.digitosDoNossoNumero ?? 8);

  let soma = 0;
  for (let i = 0; i < sequencia.length; i += 1) {
    soma += Number(sequencia[i]) * PESOS_SICOOB[i % PESOS_SICOOB.length];
  }
  const dv = 11 - (soma % 11);
  return (dv === 10 || dv === 11) ? 0 : dv;
};

/** Nosso numero com o DV colado, do jeito que sai impresso e vai na remessa
 *  (9 digitos + DV = 10 posicoes, como no arquivo real do banco). */
export const nossoNumeroSicoobComDv = (nossoNumero: string | number, p: ParametrosNossoNumeroSicoob): string => {
  const base = zerosAEsquerda(nossoNumero, 9);
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
    contaDv: dados.contaDv,
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
