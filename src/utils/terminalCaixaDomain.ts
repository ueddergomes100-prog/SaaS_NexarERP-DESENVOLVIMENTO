/**
 * COMPUTADOR DO CAIXA (22/11/2026) -- regras puras do que o computador guarda.
 *
 * Um gerente ativa o computador uma vez (server/services/terminaisCaixa.js);
 * ele guarda a empresa, o nome ("Caixa 1") e o segredo que prova que foi
 * ativado. Com isso a tela de entrada pede so' CODIGO + SENHA de cada
 * funcionario -- nada de CNPJ, usuario ou e-mail a cada troca de turno.
 *
 * Pedido do dono: "as vezes o localStorage buga e sai o CNPJ". Por isso o
 * computador guarda em TRES lugares (terminalCaixaStorage.ts: armazenamento
 * local, banco interno do navegador e cookie) e qualquer um que sobreviver
 * refaz os outros. Aqui so' a leitura defensiva de cada formato.
 */

export interface TerminalDoCaixa {
  terminalId: string;
  /** 64 caracteres hexadecimais; no banco so' fica o hash. */
  segredo: string;
  tenantId: string;
  cnpj: string;
  empresa: string;
  /** Nome do computador ("Caixa 1"). */
  nome: string;
}

export const CHAVE_TERMINAL_CAIXA = 'hennder_caixa_terminal';
/** Cookie so' nas paginas do caixa (/caixa/...). */
export const CAMINHO_DO_COOKIE_DO_CAIXA = '/caixa';
const DEZ_ANOS_EM_SEGUNDOS = 10 * 365 * 24 * 60 * 60;

const texto = (valor: unknown, maximo = 200): string => (typeof valor === 'string' ? valor.trim().slice(0, maximo) : '');

/** Objeto ou JSON gravado -> terminal valido, ou null (lixo, versao antiga, pedaco faltando). */
export const lerTerminalDoCaixa = (valor: unknown): TerminalDoCaixa | null => {
  let bruto: unknown = valor;
  if (typeof valor === 'string') {
    try { bruto = JSON.parse(valor); } catch { return null; }
  }
  if (!bruto || typeof bruto !== 'object') return null;
  const x = bruto as Record<string, unknown>;
  const terminalId = texto(x.terminalId, 60);
  const segredo = texto(x.segredo, 64).toLowerCase();
  const tenantId = texto(x.tenantId, 128);
  if (!terminalId || terminalId.includes('/') || !/^[0-9a-f]{64}$/.test(segredo) || !tenantId) return null;
  return {
    terminalId,
    segredo,
    tenantId,
    cnpj: texto(x.cnpj, 20).replace(/\D/g, ''),
    empresa: texto(x.empresa, 120),
    nome: texto(x.nome, 40) || 'Caixa',
  };
};

/** Le o terminal de `document.cookie` (varios cookies separados por "; "). */
export const terminalDoCookie = (cookies: string): TerminalDoCaixa | null => {
  const par = String(cookies || '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${CHAVE_TERMINAL_CAIXA}=`));
  if (!par) return null;
  try {
    return lerTerminalDoCaixa(decodeURIComponent(par.slice(CHAVE_TERMINAL_CAIXA.length + 1)));
  } catch {
    return null;
  }
};

/** Cookie que guarda o terminal por 10 anos, so' nas paginas do caixa. `null` apaga. */
export const cookieDoTerminal = (terminal: TerminalDoCaixa | null, seguro: boolean): string => {
  const base = `Path=${CAMINHO_DO_COOKIE_DO_CAIXA}; SameSite=Strict${seguro ? '; Secure' : ''}`;
  if (!terminal) return `${CHAVE_TERMINAL_CAIXA}=; Max-Age=0; ${base}`;
  return `${CHAVE_TERMINAL_CAIXA}=${encodeURIComponent(JSON.stringify(terminal))}; Max-Age=${DEZ_ANOS_EM_SEGUNDOS}; ${base}`;
};

/** O primeiro lugar que ainda tem um terminal valido (ordem: local, banco interno, cookie). */
export const primeiroTerminalValido = (...candidatos: unknown[]): TerminalDoCaixa | null => {
  for (const candidato of candidatos) {
    const terminal = lerTerminalDoCaixa(candidato);
    if (terminal) return terminal;
  }
  return null;
};

/** Saldo deixado na gaveta DESTE computador no ultimo fechamento (sugestao ao abrir). */
export const chaveDoUltimoFechamento = (terminalId: string) => `hennder_caixa_ultimo_fechamento_${terminalId}`;

export const lerUltimoFechamento = (valor: unknown): { saldoCentavos: number; operadorNome: string } | null => {
  let bruto: unknown = valor;
  if (typeof valor === 'string') {
    try { bruto = JSON.parse(valor); } catch { return null; }
  }
  if (!bruto || typeof bruto !== 'object') return null;
  const x = bruto as Record<string, unknown>;
  const saldo = Number(x.saldoCentavos);
  if (!Number.isInteger(saldo) || saldo < 0) return null;
  return { saldoCentavos: saldo, operadorNome: texto(x.operadorNome, 80) };
};

/** Codigo do funcionario: so' digitos, 1 ou 2 (o servidor completa com zero). */
export const limparCodigoDoOperador = (valor: string): string => String(valor || '').replace(/\D/g, '').slice(0, 2);
