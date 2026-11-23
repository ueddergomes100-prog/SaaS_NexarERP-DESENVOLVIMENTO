/*
 * VERSAO DO SISTEMA NO CABECALHO (23/11/2026, pedido do dono).
 *
 * "Ja' atualizou ou nao?" -- depois de publicar, ninguem sabia se a tela que
 * estava aberta ja' era a nova. Agora cada tela mostra, pequeno, de quando e'
 * o sistema que esta' rodando NAQUELA aba.
 *
 * A versao e' o CARIMBO DO BUILD: a data e a hora em que o sistema foi montado
 * para publicar (vite.config.ts) e, quando da' para saber, o codigo curto da
 * alteracao (o mesmo que aparece nas anotacoes de publicacao, ex.: 6bb0571).
 * Nao existe numero para alguem lembrar de aumentar: publicou, o carimbo muda
 * sozinho. A hora e' sempre a de Brasilia, onde quer que o build rode.
 *
 * Regra pura: sem tela e sem os valores do build (quem le os valores e'
 * src/utils/versaoDoSistema.ts).
 */

export interface VersaoDoSistema {
  /** Quando o build foi feito (ISO, UTC). Vazio = nao deu para saber. */
  construidaEm: string;
  /** Codigo curto da alteracao publicada (7 letras/numeros). Vazio = build sem git. */
  commit: string;
  /** Rodando em `npm run dev` na maquina de quem desenvolve. */
  desenvolvimento: boolean;
}

const FUSO = 'America/Sao_Paulo';

/** Le o que o build carimbou, sem confiar no formato. */
export const lerVersaoDoSistema = (bruto: { construidaEm?: unknown; commit?: unknown; desenvolvimento?: unknown }): VersaoDoSistema => {
  const texto = typeof bruto.construidaEm === 'string' ? bruto.construidaEm.trim() : '';
  const data = texto ? new Date(texto) : null;
  const commit = typeof bruto.commit === 'string' ? bruto.commit.trim().toLowerCase() : '';
  return {
    construidaEm: data && !Number.isNaN(data.getTime()) ? data.toISOString() : '',
    commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit.slice(0, 7) : '',
    desenvolvimento: bruto.desenvolvimento === true,
  };
};

const partes = (iso: string): { dia: string; mes: string; ano: string; hora: string; minuto: string } | null => {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const mapa: Record<string, string> = {};
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(data).forEach((p) => { mapa[p.type] = p.value; });
  return { dia: mapa.day, mes: mapa.month, ano: mapa.year, hora: mapa.hour, minuto: mapa.minute };
};

/**
 * O que aparece no cabecalho, bem curto: "v 23/11 14:32". Sem a data do build,
 * o codigo da alteracao ("v 6bb0571"); sem nenhum dos dois, nada (a tela nao
 * mostra um "versao desconhecida" que nao ajuda ninguem).
 */
export const rotuloDaVersao = (versao: VersaoDoSistema): string => {
  if (versao.desenvolvimento) return versao.commit ? `dev ${versao.commit}` : 'dev';
  const p = partes(versao.construidaEm);
  if (p) return `v ${p.dia}/${p.mes} ${p.hora}:${p.minuto}`;
  return versao.commit ? `v ${versao.commit}` : '';
};

/** Texto completo, para quem passa o mouse (ou toca) na versao. */
export const descricaoDaVersao = (versao: VersaoDoSistema): string => {
  const p = partes(versao.construidaEm);
  const codigo = versao.commit ? ` Código da alteração: ${versao.commit}.` : '';
  if (versao.desenvolvimento) {
    return `Sistema rodando na máquina de desenvolvimento${p ? `, iniciado em ${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto}` : ''}.${codigo}`;
  }
  if (!p) return versao.commit ? `Versão do sistema.${codigo}` : '';
  return `Versão do sistema: publicada em ${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto} (horário de Brasília).${codigo} `
    + 'Depois de uma atualização, recarregue a página (F5): a data aqui muda quando a tela já é a nova.';
};
