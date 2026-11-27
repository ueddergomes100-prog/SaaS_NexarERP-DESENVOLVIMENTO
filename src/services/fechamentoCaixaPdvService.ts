import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { ErroDoServidor } from './apiServidor';
import { mandarAoCofreNoFechamento, resumoDaGaveta } from './caixasService';
import { createAuditLog } from './logService';
import { NexusSwal } from '../utils/alerts';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { dateInputToUtcEnd, formatDateInputPtBr, getDateInputInTimeZone } from '../utils/dateTime';
import { fromCents, toCents } from '../utils/financeDomain';
import {
  diasParaFechar,
  erroDoTroco,
  esperadoNoFechamento,
  lerConfigGaveta,
  resultadoDaContagem,
  tituloAteODia,
  type EsperadoNoFechamento,
} from '../utils/gavetaDinheiroDomain';

/**
 * FECHAMENTO DO CAIXA DO PDV num lugar so' (23/11/2026).
 *
 * Antes a conta e a gravacao moravam dentro do PDV. O dono pediu para fechar
 * tambem pela tela Financeiro > Caixa (Sessoes PDV), e para o fechamento
 * conferir contra a gaveta quando a empresa liga "dinheiro das vendas na
 * gaveta" (regra em utils/gavetaDinheiroDomain.ts). As duas telas chamam aqui.
 *
 * 24/11/2026 (decisoes do dono, Embala Minas):
 *  - caixa esquecido aberto fecha com a data de um dia anterior: o esperado so'
 *    conta o que aconteceu ate' o fim daquele dia;
 *  - com a gaveta ligada, o fechamento pergunta quanto fica de troco e o resto
 *    vai para o COFRE na hora (servidor, transferencia CAIXA -> COFRE).
 */

export interface SessaoParaFechar {
  id: string;
  saldoInicialCentavos: number;
  totalSangriasCentavos: number;
  /** Para fechar com a data de um dia anterior: so' as sangrias ate' aquele dia. */
  sangrias?: ReadonlyArray<{ valorCentavos?: number; registradoEm?: string }>;
}

/** Esperado + o que o fechamento precisa saber para perguntar o troco e gravar a data. */
export interface EsperadoDoFechamento extends EsperadoNoFechamento {
  /** Chave "dinheiro das vendas na gaveta" ligada: pergunta o troco e manda o resto ao COFRE. */
  gavetaAtiva: boolean;
  /** yyyy-mm-dd quando o caixa fecha com a data de um dia anterior; vazio = agora. */
  dataDoFechamento: string;
}

const reais = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(centavos));

/** Dinheiro das vendas desta sessao (titulos em dinheiro do PDV; venda cancelada nao conta). `ate`: so' ate' o fim daquele dia. */
export const dinheiroDaSessao = async (tenantId: string, sessaoId: string, ate = ''): Promise<number> => {
  const [snap, recebidas] = await Promise.all([
    getDocs(query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('pdvSessionId', '==', sessaoId),
      where('movimentaCaixaFisico', '==', true),
    )),
    // Notinha recebida neste caixa (28/11/2026): o dinheiro tambem esta' na gaveta.
    getDocs(query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('recebidoNoCaixaId', '==', sessaoId),
    )),
  ]);
  let total = 0;
  recebidas.forEach((docSnap) => {
    const t = docSnap.data();
    if (t.movimentaCaixaFisico !== true || t.status !== 'Paga' || t.estornada === true) return;
    if (!tituloAteODia(t, ate)) return;
    total += Number(t.valorCentavos || 0);
  });
  snap.forEach((docSnap) => {
    const t = docSnap.data();
    // Venda cancelada nesta sessao: o dinheiro voltou ao cliente (19/10/2026).
    if (t.estornada === true || t.status === 'Cancelada') return;
    if (!tituloAteODia(t, ate)) return;
    total += Number(t.valorCentavos || 0);
  });
  return total;
};

const sangriasAteODia = (sessao: SessaoParaFechar, ate: string): number => {
  if (!ate || !Array.isArray(sessao.sangrias)) return sessao.totalSangriasCentavos;
  return sessao.sangrias
    .filter((g) => !g.registradoEm || getDateInputInTimeZone(new Date(g.registradoEm)) <= ate)
    .reduce((soma, g) => soma + Number(g.valorCentavos || 0), 0);
};

/**
 * Saldo esperado em dinheiro. Com a chave da gaveta ligada e um caixa so'
 * aberto, e' o saldo da gaveta (servidor); senao, a conta por sessao.
 * `ate` (yyyy-mm-dd antes de hoje): fechamento com a data daquele dia.
 */
export const calcularEsperadoDoFechamento = async (tenantId: string, sessao: SessaoParaFechar, ate = ''): Promise<EsperadoDoFechamento> => {
  const dia = ate && ate < getDateInputInTimeZone() ? ate : '';
  let dinheiroDaSessaoCentavos = 0;
  try {
    dinheiroDaSessaoCentavos = await dinheiroDaSessao(tenantId, sessao.id, dia);
  } catch (erro) {
    // Como sempre foi no PDV: sem a soma, o esperado sai so' com saldo inicial e sangrias, e a pessoa confere a mao.
    console.error('Erro ao calcular o dinheiro das vendas do caixa:', erro);
  }
  const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
  const config = lerConfigGaveta(configSnap.exists() ? configSnap.data() : null);
  const gaveta = config.ativo ? await resumoDaGaveta(dia) : null;
  const esperado = esperadoNoFechamento({
    gavetaAtiva: Boolean(gaveta?.ativo),
    saldoDaGavetaCentavos: gaveta?.ativo ? gaveta.saldoCentavos : null,
    caixasAbertos: gaveta?.ativo ? gaveta.caixasAbertos : 1,
    saldoInicialCentavos: sessao.saldoInicialCentavos,
    dinheiroDaSessaoCentavos,
    totalSangriasCentavos: sangriasAteODia(sessao, dia),
  });
  return {
    ...esperado,
    explicacao: dia ? `${esperado.explicacao} Só entra o que aconteceu até o fim de ${formatDateInputPtBr(dia)}.` : esperado.explicacao,
    gavetaAtiva: Boolean(gaveta?.ativo && gaveta.saldoCentavos !== null),
    dataDoFechamento: dia,
  };
};

/**
 * Caixa aberto num dia anterior (esquecido aberto): pergunta com que data ele
 * fecha. Devolve '' (agora), a data escolhida, ou null se a pessoa voltar.
 */
export const escolherDataDoFechamento = async (abertoEm: Date | null): Promise<string | null> => {
  if (!abertoEm || Number.isNaN(abertoEm.getTime())) return '';
  const hoje = getDateInputInTimeZone();
  const diaDaAbertura = getDateInputInTimeZone(abertoEm);
  const dias = diasParaFechar(diaDaAbertura, hoje);
  if (dias.length <= 1) return '';
  const opcoes = Object.fromEntries(dias.map((d) => [d, `${formatDateInputPtBr(d)}${d === diaDaAbertura ? ' (dia da abertura)' : ''}${d === hoje ? ' (hoje, agora)' : ''}`]));
  const resultado = await NexusSwal.fire({
    title: 'Com que data o caixa fecha?',
    html: `<div style="text-align:left;font-size:14px;color:var(--text-secondary);line-height:1.5;">
        Este caixa foi aberto em <strong style="color:var(--text-primary);">${formatDateInputPtBr(diaDaAbertura)}</strong> e não foi fechado.
        <div style="font-size:12px;color:var(--text-muted);margin-top:6px;">Fechando com uma data anterior, o esperado só conta o dinheiro que entrou e saiu até o fim daquele dia, e o fechamento fica registrado naquela data.</div>
      </div>`,
    input: 'select',
    inputOptions: opcoes,
    inputValue: dias.includes(diaDaAbertura) ? diaDaAbertura : dias[0],
    inputAttributes: { 'aria-label': 'Data do fechamento do caixa' },
    showCancelButton: true,
    confirmButtonText: 'Continuar',
    cancelButtonText: 'Voltar',
  });
  if (!resultado.isConfirmed) return null;
  const escolhido = String(resultado.value || '');
  return escolhido && escolhido < hoje ? escolhido : '';
};

export interface ValorContado {
  contadoCentavos: number;
  /** Gaveta ligada: quanto fica de troco (o resto vai ao COFRE); null quando nao se aplica. */
  trocoCentavos: number | null;
}

const centavosDoCampo = (valor: string): number | null => {
  const texto = String(valor || '').trim().replace(',', '.');
  if (texto === '') return null;
  const numero = Number(texto);
  return Number.isFinite(numero) && numero >= 0 ? toCents(numero) : null;
};

/**
 * Janela "valor contado" (+ "fica de troco na gaveta" quando `comTroco`).
 * Usada no fechamento e no acerto de um dia anterior.
 */
export const pedirContadoETroco = async (args: {
  titulo: string;
  /** HTML do topo (ja' escapado: so' numeros e textos nossos). */
  cabecalhoHtml: string;
  rotuloContado: string;
  contadoSugeridoCentavos: number;
  comTroco: boolean;
  trocoSugeridoCentavos?: number;
  avisoHtml?: string;
  textoConfirmar: string;
}): Promise<ValorContado | null> => {
  const estiloCampo = 'width:100%;box-sizing:border-box;margin:4px 0 0;padding:8px 10px;font-size:16px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-tertiary);color:var(--text-primary);';
  const resultado = await NexusSwal.fire({
    title: args.titulo,
    html: `<div style="text-align:left;font-size:14px;color:var(--text-secondary);line-height:1.5;">
        ${args.cabecalhoHtml}
        <label for="contagem-contado" style="display:block;margin-top:12px;font-weight:600;color:var(--text-primary);">${args.rotuloContado}</label>
        <input id="contagem-contado" type="number" min="0" step="0.01" value="${fromCents(Math.max(0, args.contadoSugeridoCentavos)).toFixed(2)}" style="${estiloCampo}" />
        ${args.comTroco ? `
        <label for="contagem-troco" style="display:block;margin-top:12px;font-weight:600;color:var(--text-primary);">Fica de troco na gaveta (R$)</label>
        <input id="contagem-troco" type="number" min="0" step="0.01" value="${fromCents(Math.max(0, args.trocoSugeridoCentavos || 0)).toFixed(2)}" style="${estiloCampo}" />
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">O resto vai para o COFRE na hora (transferência em Caixas e Transferências). Zero de troco manda tudo.</div>` : ''}
        ${args.avisoHtml ? `<div style="font-size:12px;color:var(--text-muted);margin-top:10px;">${args.avisoHtml}</div>` : ''}
      </div>`,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: args.textoConfirmar,
    cancelButtonText: 'Cancelar',
    didOpen: () => {
      const campo = document.getElementById('contagem-contado') as HTMLInputElement | null;
      campo?.focus();
      campo?.select();
    },
    preConfirm: () => {
      const contado = centavosDoCampo((document.getElementById('contagem-contado') as HTMLInputElement | null)?.value || '');
      if (contado === null) {
        NexusSwal.showValidationMessage('Informe o valor contado (zero se a gaveta estiver vazia).');
        return false;
      }
      if (!args.comTroco) return { contadoCentavos: contado, trocoCentavos: null };
      const troco = centavosDoCampo((document.getElementById('contagem-troco') as HTMLInputElement | null)?.value || '');
      const erro = troco === null ? 'Informe quanto fica de troco na gaveta (zero se for tudo para o COFRE).' : erroDoTroco(contado, troco);
      if (erro) {
        NexusSwal.showValidationMessage(erro);
        return false;
      }
      return { contadoCentavos: contado, trocoCentavos: troco };
    },
  });
  if (!resultado.isConfirmed || !resultado.value) return null;
  return resultado.value as ValorContado;
};

/**
 * Pergunta o valor contado (e, com a gaveta ligada, quanto fica de troco).
 * Devolve os centavos, ou null se a pessoa cancelar.
 */
export const pedirValorContado = (
  esperado: EsperadoDoFechamento,
  titulo = 'Fechar caixa',
  aviso = '',
  trocoSugeridoCentavos = 0,
): Promise<ValorContado | null> => pedirContadoETroco({
  titulo,
  cabecalhoHtml: `Saldo esperado em dinheiro: <strong style="color:var(--text-primary);">${reais(esperado.saldoEsperadoCentavos)}</strong>.
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${esperado.explicacao}</div>`,
  rotuloContado: 'Valor contado fisicamente no caixa (R$)',
  contadoSugeridoCentavos: esperado.saldoEsperadoCentavos,
  comTroco: esperado.gavetaAtiva,
  trocoSugeridoCentavos,
  avisoHtml: aviso,
  textoConfirmar: 'Fechar caixa',
});

export class ErroDoFechamento extends Error {}

/** So' as mensagens escritas por nos chegam na tela; erro cru de biblioteca vira o texto padrao. */
export const mensagemDoErroDeFechamento = (erro: unknown): string => (
  (erro instanceof ErroDoFechamento || erro instanceof ErroDoServidor) && erro.message
    ? erro.message
    : 'Confira a internet e tente fechar o caixa de novo.'
);

/**
 * Grava o fechamento. Recusa se o caixa ja' foi fechado por outra tela (PDV e
 * Sessoes podem tentar ao mesmo tempo). Devolve a diferenca em centavos.
 */
export const gravarFechamentoDoCaixa = async (args: {
  tenantId: string;
  sessaoId: string;
  usuarioId: string;
  usuarioEmail: string;
  /** Quem esta' fechando (operador no PDV; dono/administrador pela tela de sessoes). */
  fechadoPorNome: string;
  /** Fechado de fora do PDV: fica registrado na sessao. */
  pelaTelaDeSessoes?: boolean;
  esperado: EsperadoDoFechamento;
  saldoInformadoCentavos: number;
}): Promise<number> => {
  const { esperado, saldoInformadoCentavos } = args;
  const diferencaCentavos = saldoInformadoCentavos - esperado.saldoEsperadoCentavos;
  // Caixa esquecido aberto: o fechamento fica no fim do dia escolhido (a diferenca entra no extrato daquele dia).
  const fimDoDia = esperado.dataDoFechamento ? dateInputToUtcEnd(esperado.dataDoFechamento) : null;
  const ref = doc(db, 'caixas_pdv', args.sessaoId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status !== 'aberto') {
      throw new ErroDoFechamento('Este caixa já foi fechado. Atualize a tela para ver o fechamento.');
    }
    tx.update(ref, {
      status: 'fechado',
      fechadoEm: fimDoDia ? Timestamp.fromDate(fimDoDia) : serverTimestamp(),
      ...(fimDoDia ? { fechadoComDataDe: esperado.dataDoFechamento, fechamentoRegistradoEm: serverTimestamp() } : {}),
      saldoFinalInformadoCentavos: saldoInformadoCentavos,
      saldoEsperadoCentavos: esperado.saldoEsperadoCentavos,
      diferencaCentavos,
      // Conferido contra a gaveta: a diferenca entra no extrato do CAIXA (gavetaDinheiroDomain).
      fechamentoPelaGaveta: esperado.modo === 'gaveta',
      ...(args.pelaTelaDeSessoes ? { fechadoPorId: args.usuarioId, fechadoPorNome: args.fechadoPorNome, fechadoForaDoPdv: true } : {}),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(args.usuarioId, serverTimestamp(), 'Caixa fechado'),
    });
  });

  createAuditLog({
    tenantId: args.tenantId,
    usuarioId: args.usuarioId,
    usuarioEmail: args.usuarioEmail,
    modulo: 'financeiro',
    acao: 'fechar_caixa',
    descricao: `Caixa fechado por ${args.fechadoPorNome}${args.pelaTelaDeSessoes ? ' pela tela Caixa (Sessões PDV)' : ''}`
      + `${esperado.dataDoFechamento ? ` com a data de ${formatDateInputPtBr(esperado.dataDoFechamento)}` : ''}. Esperado: ${reais(esperado.saldoEsperadoCentavos)}, informado: ${reais(saldoInformadoCentavos)}, diferença: ${reais(diferencaCentavos)}.`
      + `${esperado.modo === 'gaveta' ? ' Conferido contra o saldo da gaveta.' : ''}`,
    registroRelacionadoId: args.sessaoId,
    status: 'sucesso',
  });
  return diferencaCentavos;
};

/**
 * Depois de fechar com a gaveta ligada: o contado menos o troco vai para o
 * COFRE (servidor). Devolve a frase para o aviso; `ok: false` quando nao deu
 * (o caixa ja' esta' fechado -- o dinheiro fica no CAIXA ate' alguem transferir).
 */
export const mandarAoCofreDepoisDeFechar = async (sessaoId: string, trocoCentavos: number): Promise<{ ok: boolean; texto: string; paraCofreCentavos: number | null; trocoCentavos: number | null }> => {
  try {
    const r = await mandarAoCofreNoFechamento({ sessaoId, trocoCentavos });
    if (r.valorCentavos <= 0) return { ok: true, texto: `Todo o dinheiro ficou de troco na gaveta (${reais(r.trocoCentavos)}).`, paraCofreCentavos: 0, trocoCentavos: r.trocoCentavos };
    return { ok: true, texto: `${reais(r.valorCentavos)} foram para o ${r.cofreNome || 'COFRE'}; ficaram ${reais(r.trocoCentavos)} de troco na gaveta.`, paraCofreCentavos: r.valorCentavos, trocoCentavos: r.trocoCentavos };
  } catch (erro) {
    const motivo = erro instanceof ErroDoServidor && erro.message ? erro.message : 'Confira a internet.';
    return { ok: false, texto: `O caixa foi fechado, mas o dinheiro não foi para o COFRE: ${motivo} Faça a transferência do CAIXA para o COFRE em Financeiro › Caixas e Transferências.`, paraCofreCentavos: null, trocoCentavos: null };
  }
};

/** Frase do resultado para o aviso depois de fechar. */
export const mensagemDoFechamento = (diferencaCentavos: number, modo: EsperadoNoFechamento['modo'], cofre = ''): string => (
  `Caixa fechado. ${resultadoDaContagem(diferencaCentavos)}${modo === 'gaveta' && diferencaCentavos !== 0 ? ' A diferença entrou no extrato do CAIXA.' : ''}${cofre ? ` ${cofre}` : ''}`
);
