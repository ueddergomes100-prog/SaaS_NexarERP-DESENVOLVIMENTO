/*
 * BASE DE NCM E CEST (pedido do dono, 20/10/2026).
 *
 * Decisao do dono (caixinhas de 20/10): uma base UNICA para todas as empresas,
 * que cresce sozinha -- todo NCM/CEST que aparece num produto cadastrado ou num
 * XML de entrada entra na base, sem repetir (o codigo e' o id do documento em
 * `tabela_ncm` / `tabela_cest`). A empresa tambem cadastra a mao, com descricao.
 *
 * Privacidade: o que entra sozinho e' SO' o codigo (e, no CEST, os NCMs com que
 * ele apareceu). Nome de produto de uma empresa nunca vai para a base que as
 * outras leem. A descricao vem de quem cadastra a mao; depois de descrita, so'
 * o suporte (administrador da plataforma) altera.
 *
 * So' o servidor grava (server/services/tabelasFiscais.js); as telas so' leem.
 */

export const LIMITE_DA_DESCRICAO = 300;
/** Quantos codigos uma chamada de "registrar uso" aceita. */
export const LIMITE_DE_ITENS_POR_REGISTRO = 300;

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** NCM valido: 8 digitos (00000000 nao vale). Vazio quando invalido. */
export const normalizarNcm = (v: unknown): string => {
  const d = soDigitos(v);
  return d.length === 8 && d !== '00000000' ? d : '';
};

/** CEST valido: 7 digitos. Vazio quando invalido. */
export const normalizarCest = (v: unknown): string => {
  const d = soDigitos(v);
  return d.length === 7 && d !== '0000000' ? d : '';
};

/** "21069090" -> "2106.90.90" */
export const formatarNcm = (codigo: string): string => (
  codigo.length === 8 ? `${codigo.slice(0, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6)}` : codigo
);

/** "1700100" -> "17.001.00" */
export const formatarCest = (codigo: string): string => (
  codigo.length === 7 ? `${codigo.slice(0, 2)}.${codigo.slice(2, 5)}.${codigo.slice(5)}` : codigo
);

export interface NovoNcm { codigo: string; descricao: string }
export interface NovoCest { codigo: string; descricao: string; ncm: string }

type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

const lerDescricao = (v: unknown): Leitura<string> => {
  const d = texto(v);
  if (!d) return { ok: false, erro: 'Informe a descrição.' };
  if (d.length > LIMITE_DA_DESCRICAO) return { ok: false, erro: `A descrição passou de ${LIMITE_DA_DESCRICAO} letras. Resuma.` };
  return { ok: true, valor: d };
};

export const lerNovoNcm = (corpo: unknown): Leitura<NovoNcm> => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const codigo = normalizarNcm(c.codigo);
  if (!codigo) return { ok: false, erro: 'O NCM tem 8 números (ex.: 2106.90.90). Confira o código.' };
  const descricao = lerDescricao(c.descricao);
  if (!descricao.ok) return descricao;
  return { ok: true, valor: { codigo, descricao: descricao.valor } };
};

export const lerNovoCest = (corpo: unknown): Leitura<NovoCest> => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const codigo = normalizarCest(c.codigo);
  if (!codigo) return { ok: false, erro: 'O CEST tem 7 números (ex.: 17.001.00). Confira o código.' };
  const ncmInformado = soDigitos(c.ncm);
  const ncm = normalizarNcm(ncmInformado);
  if (ncmInformado && !ncm) return { ok: false, erro: 'O NCM ligado ao CEST tem 8 números. Confira ou deixe em branco.' };
  const descricao = lerDescricao(c.descricao);
  if (!descricao.ok) return descricao;
  return { ok: true, valor: { codigo, descricao: descricao.valor, ncm } };
};

export interface UsoFiscal { ncms: string[]; cests: Array<{ codigo: string; ncms: string[] }> }

/**
 * Do que veio de produtos/XML ([{ ncm, cest }]), os codigos validos sem
 * repetir. O CEST leva os NCMs com que apareceu (ajuda a sugerir o CEST pelo NCM).
 */
export const codigosDoUso = (itens: unknown): UsoFiscal => {
  const lista = Array.isArray(itens) ? itens.slice(0, LIMITE_DE_ITENS_POR_REGISTRO) : [];
  const ncms = new Set<string>();
  const cests = new Map<string, Set<string>>();
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const ncm = normalizarNcm((item as Record<string, unknown>).ncm);
    const cest = normalizarCest((item as Record<string, unknown>).cest);
    if (ncm) ncms.add(ncm);
    if (cest) {
      const doCest = cests.get(cest) ?? new Set<string>();
      if (ncm) doCest.add(ncm);
      cests.set(cest, doCest);
    }
  }
  return {
    ncms: [...ncms].sort(),
    cests: [...cests.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([codigo, n]) => ({ codigo, ncms: [...n].sort() })),
  };
};

/**
 * Pode gravar a descricao? Codigo novo ou sem descricao: sim. Ja' descrito:
 * so' o suporte (administrador da plataforma), para uma empresa nao trocar o
 * que as outras usam.
 */
export const podeDescrever = (descricaoAtual: unknown, ehSuporte: boolean): boolean => ehSuporte || !texto(descricaoAtual);

/** Busca da tela: digitos procuram pelo comeco do codigo; texto procura na descricao. */
export const filtrarTabela = <T extends { codigo: string; descricao?: string }>(linhas: readonly T[], busca: string): T[] => {
  const b = busca.trim().toLowerCase();
  if (!b) return [...linhas];
  const digitos = b.replace(/[.\s-]/g, '');
  if (/^\d+$/.test(digitos)) return linhas.filter((l) => l.codigo.startsWith(digitos));
  return linhas.filter((l) => (l.descricao ?? '').toLowerCase().includes(b));
};
