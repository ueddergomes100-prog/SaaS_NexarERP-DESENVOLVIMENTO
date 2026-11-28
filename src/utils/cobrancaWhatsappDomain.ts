/*
 * COBRANCA PELO WHATSAPP NO APP VENDAS (28/11/2026, pedido do dono).
 *
 * "Enviar para o WhatsApp vencidos, todos, individual, e enviar so' um lembrete
 * de vendas que eles devem, mostrando valores, pedidos e data da compra."
 *
 * A mensagem e' curta e fala como gente (regra do dono para texto que vai ao
 * cliente: sem cara de IA, sem frase de efeito, no maximo uma exclamacao).
 * Vencida mostra juros e multa pelas % que valem na tela (as da filial ou as
 * trocadas so' na consulta, atrasoReceberDomain.ts).
 */

export type TipoDeCobranca = 'vencidas' | 'todas' | 'uma';

export interface ContaDaCobranca {
  /** "Venda Direta #120 - Boleto (Parcela 1/2)". */
  descricao: string;
  /** Dia da compra (AAAA-MM-DD); vazio quando nao se sabe. */
  dataCompra: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  valorCentavos: number;
  /** Juros + multa do atraso (0 quando em dia). */
  acrescimoCentavos: number;
}

/** No maximo tantas contas listadas; o resto vira "e mais N". O total sempre soma todas. */
export const MAX_CONTAS_NA_MENSAGEM = 12;

const inteiro = (n: unknown): number => Math.max(0, Math.round(Number(n) || 0));

const reais = (centavos: number): string => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataBr = (data: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Primeiro nome com so' a inicial maiuscula ("MARIA DA SILVA" -> "Maria"). */
export const primeiroNome = (nome: string): string => {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  return primeiro ? primeiro.charAt(0).toLocaleUpperCase('pt-BR') + primeiro.slice(1).toLocaleLowerCase('pt-BR') : '';
};

/** "Venda Direta #120 - Boleto (Parcela 1/2)" -> "Pedido #120 (parcela 1/2)"; sem numero, a propria descricao. */
export const rotuloDaConta = (descricao: string): string => {
  const texto = String(descricao || '').trim();
  const numero = /#\s*(\d+)/.exec(texto);
  if (!numero) return texto || 'Conta';
  const parcela = /parcela\s*(\d+\s*\/\s*\d+)/i.exec(texto);
  return `Pedido #${numero[1]}${parcela ? ` (parcela ${parcela[1].replace(/\s+/g, '')})` : ''}`;
};

export const contaVencida = (conta: Pick<ContaDaCobranca, 'vencimento'>, hoje: string): boolean => (
  Boolean(conta.vencimento) && conta.vencimento.slice(0, 10) < hoje
);

/** Quais contas entram: as vencidas ou todas, do vencimento mais antigo ao mais novo. */
export const contasDaCobranca = <T extends Pick<ContaDaCobranca, 'vencimento'>>(contas: T[], tipo: TipoDeCobranca, hoje: string): T[] => (
  (tipo === 'vencidas' ? contas.filter((c) => contaVencida(c, hoje)) : [...contas])
    .sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'))
);

export const totalDaCobranca = (contas: ContaDaCobranca[]): number => (
  contas.reduce((soma, c) => soma + inteiro(c.valorCentavos) + inteiro(c.acrescimoCentavos), 0)
);

const linhasDaConta = (conta: ContaDaCobranca, hoje: string): string[] => {
  const partes = [rotuloDaConta(conta.descricao)];
  if (conta.dataCompra) partes.push(`compra ${dataBr(conta.dataCompra)}`);
  if (conta.vencimento) partes.push(`${contaVencida(conta, hoje) ? 'venceu' : 'vence'} ${dataBr(conta.vencimento)}`);
  const valor = inteiro(conta.valorCentavos);
  const acrescimo = inteiro(conta.acrescimoCentavos);
  return [
    partes.join(' · '),
    acrescimo > 0 ? `${reais(valor)} + ${reais(acrescimo)} de juros e multa = ${reais(valor + acrescimo)}` : reais(valor),
  ];
};

/**
 * Texto do lembrete. `contas` ja' vem escolhida (contasDaCobranca); vazia = ''.
 */
export const mensagemDeCobranca = (dados: {
  clienteNome: string;
  empresaNome: string;
  contas: ContaDaCobranca[];
  hoje: string;
}): string => {
  const { contas, hoje } = dados;
  if (contas.length === 0) return '';
  const nome = primeiroNome(dados.clienteNome);
  const empresa = String(dados.empresaNome || '').trim();
  const abertura = `Oi${nome ? `, ${nome}` : ''}, tudo bem?${empresa ? ` Aqui é da ${empresa}.` : ''}`;
  const temVencida = contas.some((c) => contaVencida(c, hoje));
  const chamada = contas.length === 1
    ? `Passando pra lembrar da conta ${temVencida ? 'que venceu' : 'em aberto'}:`
    : `Passando pra lembrar das contas ${temVencida && contas.every((c) => contaVencida(c, hoje)) ? 'vencidas' : 'em aberto'}:`;
  const listadas = contas.slice(0, MAX_CONTAS_NA_MENSAGEM);
  const blocos = listadas.map((c) => linhasDaConta(c, hoje).join('\n'));
  const resto = contas.length - listadas.length;
  if (resto > 0) blocos.push(`e mais ${resto} ${resto === 1 ? 'conta' : 'contas'}`);
  const linhas = [abertura, chamada, '', blocos.join('\n\n')];
  if (contas.length > 1) linhas.push('', `Total: ${reais(totalDaCobranca(contas))}`);
  linhas.push('', 'Se já pagou, pode desconsiderar. Qualquer dúvida é só me chamar.');
  return linhas.join('\n');
};

/**
 * Numero no formato do WhatsApp (55 + DDD + numero), ou null quando o cadastro
 * nao tem um celular/telefone com DDD. Aceita com ou sem +55, espacos e tracos.
 */
export const telefoneParaWhatsapp = (telefone: unknown): string | null => {
  let digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.startsWith('0')) digitos = digitos.replace(/^0+/, '');
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return null;
};

/** Primeiro numero que serve, na ordem: celular, telefone. */
export const whatsappDoCliente = (cliente: { celular?: unknown; telefone?: unknown } | null | undefined): string | null => (
  cliente ? telefoneParaWhatsapp(cliente.celular) || telefoneParaWhatsapp(cliente.telefone) : null
);

/** Link do WhatsApp com o texto; sem numero, o WhatsApp pede para escolher o contato. */
export const linkDoWhatsapp = (numero: string | null, texto: string): string => (
  `https://wa.me/${numero || ''}?text=${encodeURIComponent(texto)}`
);
