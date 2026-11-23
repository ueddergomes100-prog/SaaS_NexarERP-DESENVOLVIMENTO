import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { ErroDoServidor } from './apiServidor';
import { resumoDaGaveta } from './caixasService';
import { createAuditLog } from './logService';
import { NexusSwal } from '../utils/alerts';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { fromCents, toCents } from '../utils/financeDomain';
import {
  esperadoNoFechamento,
  lerConfigGaveta,
  resultadoDaContagem,
  type EsperadoNoFechamento,
} from '../utils/gavetaDinheiroDomain';

/**
 * FECHAMENTO DO CAIXA DO PDV num lugar so' (23/11/2026).
 *
 * Antes a conta e a gravacao moravam dentro do PDV. O dono pediu para fechar
 * tambem pela tela Financeiro > Caixa (Sessoes PDV), e para o fechamento
 * conferir contra a gaveta quando a empresa liga "dinheiro das vendas na
 * gaveta" (regra em utils/gavetaDinheiroDomain.ts). As duas telas chamam aqui.
 */

export interface SessaoParaFechar {
  id: string;
  saldoInicialCentavos: number;
  totalSangriasCentavos: number;
}

const reais = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(centavos));

/** Dinheiro das vendas desta sessao (titulos em dinheiro do PDV; venda cancelada nao conta). */
export const dinheiroDaSessao = async (tenantId: string, sessaoId: string): Promise<number> => {
  const snap = await getDocs(query(
    collection(db, 'transacoes'),
    where('tenantId', '==', tenantId),
    where('pdvSessionId', '==', sessaoId),
    where('movimentaCaixaFisico', '==', true),
  ));
  let total = 0;
  snap.forEach((docSnap) => {
    const t = docSnap.data();
    // Venda cancelada nesta sessao: o dinheiro voltou ao cliente (19/10/2026).
    if (t.estornada === true || t.status === 'Cancelada') return;
    total += Number(t.valorCentavos || 0);
  });
  return total;
};

/**
 * Saldo esperado em dinheiro. Com a chave da gaveta ligada e um caixa so'
 * aberto, e' o saldo da gaveta (servidor); senao, a conta por sessao.
 */
export const calcularEsperadoDoFechamento = async (tenantId: string, sessao: SessaoParaFechar): Promise<EsperadoNoFechamento> => {
  let dinheiroDaSessaoCentavos = 0;
  try {
    dinheiroDaSessaoCentavos = await dinheiroDaSessao(tenantId, sessao.id);
  } catch (erro) {
    // Como sempre foi no PDV: sem a soma, o esperado sai so' com saldo inicial e sangrias, e a pessoa confere a mao.
    console.error('Erro ao calcular o dinheiro das vendas do caixa:', erro);
  }
  const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
  const config = lerConfigGaveta(configSnap.exists() ? configSnap.data() : null);
  const gaveta = config.ativo ? await resumoDaGaveta() : null;
  return esperadoNoFechamento({
    gavetaAtiva: Boolean(gaveta?.ativo),
    saldoDaGavetaCentavos: gaveta?.ativo ? gaveta.saldoCentavos : null,
    caixasAbertos: gaveta?.ativo ? gaveta.caixasAbertos : 1,
    saldoInicialCentavos: sessao.saldoInicialCentavos,
    dinheiroDaSessaoCentavos,
    totalSangriasCentavos: sessao.totalSangriasCentavos,
  });
};

/** Pergunta o valor contado. Devolve os centavos, ou null se a pessoa cancelar. */
export const pedirValorContado = async (esperado: EsperadoNoFechamento, titulo = 'Fechar caixa', aviso = ''): Promise<number | null> => {
  const resultado = await NexusSwal.fire({
    title: titulo,
    html: `<div style="text-align:left;font-size:14px;color:var(--text-secondary);line-height:1.5;">
        Saldo esperado em dinheiro: <strong style="color:var(--text-primary);">${reais(esperado.saldoEsperadoCentavos)}</strong>.
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${esperado.explicacao}</div>
        <div style="margin-top:10px;">Informe o valor contado fisicamente no caixa.</div>
        ${aviso ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">${aviso}</div>` : ''}
      </div>`,
    input: 'number',
    inputValue: fromCents(Math.max(0, esperado.saldoEsperadoCentavos)).toFixed(2),
    inputAttributes: { min: '0', step: '0.01', 'aria-label': 'Valor contado no caixa, em reais' },
    showCancelButton: true,
    confirmButtonText: 'Fechar caixa',
    cancelButtonText: 'Cancelar',
    inputValidator: (valor) => {
      const numero = Number(valor);
      return valor === '' || !Number.isFinite(numero) || numero < 0 ? 'Informe o valor contado no caixa (zero se a gaveta estiver vazia).' : undefined;
    },
  });
  if (!resultado.isConfirmed) return null;
  return toCents(resultado.value || 0);
};

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
  esperado: EsperadoNoFechamento;
  saldoInformadoCentavos: number;
}): Promise<number> => {
  const { esperado, saldoInformadoCentavos } = args;
  const diferencaCentavos = saldoInformadoCentavos - esperado.saldoEsperadoCentavos;
  const ref = doc(db, 'caixas_pdv', args.sessaoId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status !== 'aberto') {
      throw new ErroDoFechamento('Este caixa já foi fechado. Atualize a tela para ver o fechamento.');
    }
    tx.update(ref, {
      status: 'fechado',
      fechadoEm: serverTimestamp(),
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
    descricao: `Caixa fechado por ${args.fechadoPorNome}${args.pelaTelaDeSessoes ? ' pela tela Caixa (Sessões PDV)' : ''}. Esperado: ${reais(esperado.saldoEsperadoCentavos)}, informado: ${reais(saldoInformadoCentavos)}, diferença: ${reais(diferencaCentavos)}.`
      + `${esperado.modo === 'gaveta' ? ' Conferido contra o saldo da gaveta.' : ''}`,
    registroRelacionadoId: args.sessaoId,
    status: 'sucesso',
  });
  return diferencaCentavos;
};

/** Frase do resultado para o aviso depois de fechar. */
export const mensagemDoFechamento = (diferencaCentavos: number, modo: EsperadoNoFechamento['modo']): string => (
  `Caixa fechado. ${resultadoDaContagem(diferencaCentavos)}${modo === 'gaveta' && diferencaCentavos !== 0 ? ' A diferença entrou no extrato do CAIXA.' : ''}`
);
