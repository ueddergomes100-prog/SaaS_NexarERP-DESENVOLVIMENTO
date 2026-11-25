/*
 * QR CODE PIX NO PEDIDO IMPRESSO (23/11/2026, pedido da Embala Minas pelo dono).
 *
 * O pedido em meia folha sai com um QR Code Pix ja' com o valor: o cliente
 * escaneia e paga. E' o "Pix copia e cola" ESTATICO do Banco Central (BR Code,
 * padrao EMV): chave, valor, nome e cidade de quem recebe e um identificador
 * do pedido. Nao passa por banco nem por servidor -- e' so' o texto do QR.
 *
 * Decisoes do dono (23/11/2026):
 *  - LIGA POR EMPRESA em Configuracoes (comeca desligado). A chave em branco e'
 *    o CNPJ da empresa. Empresa cujo CNPJ nao e' chave Pix nao pode ganhar um
 *    QR que nao paga.
 *  - SO' NO QUE FALTA PAGAR, para o cliente nao pagar duas vezes:
 *      pre-venda / pedido em analise  -> o valor total;
 *      venda finalizada               -> o que ficou em Pagamento a Prazo (o
 *                                        que o cliente ainda deve);
 *      BOLETO NUNCA (25/11/2026): o cliente paga pelo boleto; na pre-venda
 *      com boleto combinado, essa parte sai do valor do QR;
 *      venda paga na hora (dinheiro, Pix, cartao, cheque) ou cancelada -> sem QR.
 *    Cartao fica "pendente" no sistema enquanto a operadora nao repassa, mas o
 *    cliente ja' pagou: nao conta.
 *
 * Regra pura: sem tela.
 */
import { STATUS_CANCELADA, isPedidoAberto } from './preVendaDomain';
import { toCents } from './financeDomain';

export interface ConfigPixPedido {
  ativo: boolean;
  /** Chave digitada em Configuracoes; vazia = o CNPJ da empresa. */
  chave: string;
}

export const CAMPO_PIX_ATIVO = 'pixNoPedidoAtivo';
export const CAMPO_PIX_CHAVE = 'pixNoPedidoChave';

export const parseConfigPixPedido = (config: Record<string, unknown> | null | undefined): ConfigPixPedido => ({
  ativo: config?.[CAMPO_PIX_ATIVO] === true,
  chave: typeof config?.[CAMPO_PIX_CHAVE] === 'string' ? String(config[CAMPO_PIX_CHAVE]).trim() : '',
});

const apenasDigitos = (v: string): string => v.replace(/\D/g, '');

export type TipoDeChavePix = 'cnpj' | 'cpf' | 'email' | 'telefone' | 'aleatoria';

/**
 * Chave como o Pix espera (CNPJ/CPF so' numeros, e-mail minusculo, telefone
 * +55DDDNUMERO, chave aleatoria minuscula) -- ou o motivo, em portugues.
 */
export const normalizarChavePix = (bruta: string): { chave: string; tipo: TipoDeChavePix } | { erro: string } => {
  const texto = String(bruta || '').trim();
  if (!texto) return { erro: 'Informe a chave Pix.' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(texto)) return { chave: texto.toLowerCase(), tipo: 'aleatoria' };
  if (texto.includes('@')) {
    const email = texto.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 77
      ? { chave: email, tipo: 'email' }
      : { erro: 'A chave Pix parece um e-mail, mas está incompleta. Confira o e-mail cadastrado no banco.' };
  }
  const digitos = apenasDigitos(texto);
  if (texto.startsWith('+') || /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(texto.replace(/\s+/g, ' '))) {
    const nacional = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
    if (nacional.length === 10 || nacional.length === 11) return { chave: `+55${nacional}`, tipo: 'telefone' };
    return { erro: 'A chave Pix parece um telefone, mas o número está incompleto. Use DDD + número.' };
  }
  if (digitos.length === 14) return { chave: digitos, tipo: 'cnpj' };
  if (digitos.length === 11) return { chave: digitos, tipo: 'cpf' };
  return { erro: 'Chave Pix não reconhecida. Use o CNPJ, o CPF, o e-mail, o telefone ou a chave aleatória cadastrada no banco.' };
};

// ---------------------------------------------------------------------------
// BR Code (Pix copia e cola)
// ---------------------------------------------------------------------------

/** CRC16-CCITT (polinomio 0x1021, inicio 0xFFFF), o do BR Code. */
export const crc16Pix = (texto: string): string => {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(texto);
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

const campo = (id: string, valor: string): string => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

/** Nome e cidade no BR Code: sem acento, maiusculo, so' letras, numeros e espaco. */
const textoDoBrCode = (valor: string, maximo: number): string => String(valor || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maximo)
  .trim();

export const montarPixCopiaECola = (args: {
  chave: string;
  nome: string;
  cidade: string;
  valorCentavos: number;
  /** Identificador do pedido (so' letras e numeros, ate' 25). */
  identificador: string;
}): string => {
  const valor = (Math.round(args.valorCentavos) / 100).toFixed(2);
  const identificador = String(args.identificador || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const semCrc = campo('00', '01')
    + campo('01', '11')
    + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', args.chave))
    + campo('52', '0000')
    + campo('53', '986')
    + campo('54', valor)
    + campo('58', 'BR')
    + campo('59', textoDoBrCode(args.nome, 25))
    + campo('60', textoDoBrCode(args.cidade, 15))
    + campo('62', campo('05', identificador))
    + '6304';
  return semCrc + crc16Pix(semCrc);
};

// ---------------------------------------------------------------------------
// O pedido
// ---------------------------------------------------------------------------

type Registro = Record<string, unknown>;

/**
 * Forma em que o cliente ainda deve depois da venda e que o Pix pode pagar.
 * BOLETO NAO ENTRA (25/11/2026, decisao do dono): o cliente paga pelo boleto;
 * um QR Pix no mesmo papel convidava a pagar duas vezes.
 */
const FORMAS_A_RECEBER_DO_CLIENTE = ['Pagamento a Prazo'];
const FORMA_BOLETO = 'Boleto';

const centavosDoPagamento = (p: Registro): number => (
  p.valorCentavos !== undefined && p.valorCentavos !== null ? Math.round(Number(p.valorCentavos)) : toCents(Number(p.valor || 0))
);

/** Quanto o cliente ainda tem a pagar neste pedido por Pix (centavos). 0 = sem QR. */
export const valorDoPixDoPedido = (pedido: Registro): number => {
  if (String(pedido.status || '').trim() === STATUS_CANCELADA) return 0;
  const pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos as Registro[] : [];
  if (isPedidoAberto(pedido.status)) {
    const total = pedido.valorTotalCentavos !== undefined && pedido.valorTotalCentavos !== null
      ? Math.round(Number(pedido.valorTotalCentavos))
      : toCents(Number(pedido.valorTotal || 0));
    // Pre-venda que ja' combinou boleto: a parte em boleto sai do QR.
    const emBoleto = pagamentos
      .filter((p) => String(p?.formaPagamento || '') === FORMA_BOLETO)
      .reduce((soma, p) => soma + centavosDoPagamento(p), 0);
    const restante = total - emBoleto;
    return Number.isFinite(restante) && restante > 0 ? restante : 0;
  }
  return pagamentos
    .filter((p) => FORMAS_A_RECEBER_DO_CLIENTE.includes(String(p?.formaPagamento || '')) && p?.status !== 'confirmado')
    .reduce((soma, p) => soma + centavosDoPagamento(p), 0);
};

export interface QrPixDoPedido {
  copiaECola: string;
  valorCentavos: number;
  /** "CNPJ 11.044.333/0001-39", "e-mail financeiro@...": para o rodape do QR. */
  chaveParaMostrar: string;
}

const chaveParaMostrar = (chave: string, tipo: TipoDeChavePix): string => {
  if (tipo === 'cnpj') return `CNPJ ${chave.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`;
  if (tipo === 'cpf') return `CPF ${chave.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`;
  if (tipo === 'telefone') return `Telefone ${chave}`;
  if (tipo === 'email') return chave;
  return 'Chave aleatória';
};

/**
 * O QR do pedido, ou o motivo de nao sair. `null` = nao era para sair (opcao
 * desligada ou nada a pagar). `{ problema }` = era para sair, mas o cadastro
 * esta' incompleto: a tela avisa (so' na tela, nunca no papel do cliente).
 */
export const qrPixDoPedido = (
  config: Registro | null | undefined,
  pedido: Registro,
): QrPixDoPedido | { problema: string } | null => {
  const opcao = parseConfigPixPedido(config);
  if (!opcao.ativo) return null;
  const valorCentavos = valorDoPixDoPedido(pedido);
  if (!(valorCentavos > 0)) return null;

  const chaveLida = normalizarChavePix(opcao.chave || String(config?.cnpj || ''));
  if ('erro' in chaveLida) {
    return { problema: `QR Code Pix não impresso: ${opcao.chave ? chaveLida.erro : 'a empresa está sem CNPJ e sem chave Pix.'} Acerte em Configurações › Modelo de impressão do Pedido de Venda.` };
  }
  const nome = String(config?.razaoSocial || config?.nomeOficina || '').trim();
  const cidade = String(config?.cidade || config?.nfseCidadeNome || '').trim();
  if (!textoDoBrCode(nome, 25)) return { problema: 'QR Code Pix não impresso: falta o nome da empresa em Configurações.' };
  if (!textoDoBrCode(cidade, 15)) return { problema: 'QR Code Pix não impresso: falta a cidade da empresa em Configurações (campo "Cidade da empresa").' };

  return {
    copiaECola: montarPixCopiaECola({
      chave: chaveLida.chave,
      nome,
      cidade,
      valorCentavos,
      identificador: `PEDIDO${String(pedido.numeroPedido || '').replace(/\D/g, '')}`,
    }),
    valorCentavos,
    chaveParaMostrar: chaveParaMostrar(chaveLida.chave, chaveLida.tipo),
  };
};
