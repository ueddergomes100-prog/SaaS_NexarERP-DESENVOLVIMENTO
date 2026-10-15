import { doc, getDoc, runTransaction, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { trocaService } from './trocaService';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import {
  canTransition,
  computeStatusFinal,
  DEFAULT_BLOQUEAR_EXCEDENTE,
  DEFAULT_EXIGIR_BIPAGEM,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  ordenarPorLocalizacao,
  reconciliarItensDaConferencia,
  type BipagemResultado,
  type ConferenciaItem,
  type StatusConferencia,
} from '../utils/conferenciaDomain';
import { normalizeEmbalagens } from '../utils/embalagemDomain';
import { isVendaDoUsuario } from '../utils/visibilidadeVendasDomain';

/**
 * CONFERENCIA DE MERCADORIA -- abrir, gravar e fechar (15/10/2026: saiu de
 * ConferenciaForm.tsx para o app Vendas conferir pelo celular com a MESMA
 * regra do computador). Pedido/pre-venda grava direto em `expedicoes` e
 * `pedidos_venda`; TROCA vai pelo servidor (trocaService), como sempre foi.
 * Regras puras em conferenciaDomain.ts.
 */

export type AlvoDaConferencia = { tipo: 'pedido' | 'troca'; id: string };

export interface UsuarioDaConferencia {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}

export interface ConfigDaConferencia {
  exigirBipagem: boolean;
  bloquearExcedente: boolean;
  ordenarMinutaPorLocal: boolean;
}

export interface ConferenciaAberta {
  numero: string;
  clienteNome?: string;
  config: ConfigDaConferencia;
  itens: ConferenciaItem[];
  status: StatusConferencia;
  abertoPorNome: string;
  /** O pedido mudou desde a ultima abertura: o que mudou (null = nada). */
  avisos: string[] | null;
  /** Para perceber, com a tela aberta, que o pedido mudou de novo. */
  assinaturaDoPedido: string;
}

interface HistoricoEntry {
  de: string;
  para: string;
  em: Timestamp;
  usuarioId: string;
  usuarioNome: string;
}

export const STATUS_LABELS: Record<StatusConferencia, string> = {
  aguardando: 'Aguardando Conferência',
  em_conferencia: 'Em Conferência',
  conferido: 'Conferido',
  divergente: 'Divergente',
};
export const STATUS_COLORS: Record<StatusConferencia, string> = {
  aguardando: '#f59e0b',
  em_conferencia: '#3b82f6',
  conferido: '#10b981',
  divergente: '#ef4444',
};

export const FEEDBACK_LABELS: Record<BipagemResultado, string> = {
  ok: 'Item conferido.',
  nao_encontrado: 'Código não encontrado neste pedido.',
  excedente: 'Quantidade já bateu o pedido — bipagem recusada.',
  bloqueado_manual: 'Este produto tem código de barras cadastrado — bipe em vez de lançar manual.',
};
export const FEEDBACK_COLORS: Record<BipagemResultado | 'pendente', string> = {
  ok: '#10b981',
  nao_encontrado: '#ef4444',
  excedente: '#f59e0b',
  bloqueado_manual: '#f59e0b',
  pendente: '#3b82f6',
};

/** "neste pedido" vira "nesta troca" quando e' troca. */
export const textoDoFeedback = (resultado: BipagemResultado, ehTroca: boolean) => (
  ehTroca ? FEEDBACK_LABELS[resultado].replace('neste pedido', 'nesta troca') : FEEDBACK_LABELS[resultado]
);

// Web Audio API pra feedback sonoro -- o separador normalmente nao esta
// olhando pra tela enquanto bipa (decisao do plano). Sem dependencia nova,
// so osciladores simples -- nenhum arquivo de audio embutido.
const playTone = (frequency: number, durationMs: number) => {
  try {
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.18;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
    oscillator.onended = () => ctx.close();
  } catch {
    // Ambiente sem suporte a Web Audio -- o feedback visual continua sozinho.
  }
};

// Padroes DISTINTOS entre nao_encontrado e excedente (exigencia do plano):
// nao_encontrado e um zumbido longo grave; excedente e dois bipes curtos.
export const playFeedbackSound = (resultado: BipagemResultado) => {
  if (resultado === 'ok') playTone(880, 110);
  else if (resultado === 'excedente') { playTone(300, 90); setTimeout(() => playTone(300, 90), 150); }
  else playTone(220, 220);
};

/**
 * Itens da conferencia a partir dos itens do pedido, enriquecidos com estoque/{id} (codigo, EAN e local).
 * O EAN do item vendido em embalagem e' o da EMBALAGEM -- o separador tem o saco na mao, nao a unidade.
 * Usado ao abrir a conferencia e quando o pedido e' alterado com a conferencia em andamento.
 */
export const montarItensDaConferencia = async (itensPedido: any[]): Promise<ConferenciaItem[]> => Promise.all(
  itensPedido.map(async (item: any): Promise<ConferenciaItem> => {
    const base: ConferenciaItem = {
      produtoId: item.id,
      nome: item.nome,
      // Quantidade na unidade VENDIDA: bipar 1 saco fecha 1, nao 20.
      quantidadePedida: item.quantidade,
      quantidadeConferida: 0,
      unidadeMedidaSigla: item.unidadeMedidaSigla,
    };
    if (!item.id || item.id === 'avulso') return base;
    try {
      const estoqueSnap = await getDoc(doc(db, 'estoque', item.id));
      if (estoqueSnap.exists()) {
        const produto = estoqueSnap.data();
        const embalagemDoItem = item.embalagemId
          ? normalizeEmbalagens(produto.embalagens).find((e) => e.id === item.embalagemId)
          : null;
        return {
          ...base,
          codigo: produto.codigo || '',
          codigoBarras: (embalagemDoItem?.codigoBarras || produto.codigoBarras || ''),
          localizacaoEstoque: produto.localizacaoEstoque || '',
        };
      }
    } catch (err) {
      console.error('Erro ao buscar dados de estoque do item da conferência:', err);
    }
    return base;
  })
);

/** Assinatura dos itens do pedido: muda quando alguem acrescenta, retira ou muda a quantidade de um item. */
export const assinaturaDosItens = (itensPedido: any[]): string => JSON.stringify(
  itensPedido.map((i: any) => [i.id || '', i.nome || '', Number(i.quantidade || 0), i.embalagemId || '']),
);

// Busca o nome de exibicao do usuario atual pra auditoria (nome legivel,
// nao so uid) -- mesmo fallback de tres niveis usado pro vendedor em
// PedidoVendaForm.tsx.
export const nomeDoUsuarioDaConferencia = async (usuario: UsuarioDaConferencia | null): Promise<string> => {
  if (!usuario) return 'Desconhecido';
  let nome = usuario.displayName || usuario.email || usuario.uid;
  try {
    const perfilSnap = await getDoc(doc(db, 'usuarios', usuario.uid));
    if (perfilSnap.exists()) {
      const perfil = perfilSnap.data();
      nome = perfil.nome || perfil.nomeResponsavel || nome;
    }
  } catch {
    // Segue com o fallback -- nao bloqueia a operacao.
  }
  return nome;
};

export const lerConfigDaConferencia = async (tenantId: string): Promise<ConfigDaConferencia> => {
  let config: Record<string, unknown> = {};
  const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
  if (configSnap.exists()) config = configSnap.data();
  return {
    exigirBipagem: (config.exigirBipagem as boolean | undefined) ?? DEFAULT_EXIGIR_BIPAGEM,
    bloquearExcedente: (config.bloquearExcedente as boolean | undefined) ?? DEFAULT_BLOQUEAR_EXCEDENTE,
    ordenarMinutaPorLocal: (config.ordenarMinutaPorLocal as boolean | undefined) ?? DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  };
};

const registrarLog = async (dados: Record<string, unknown>) => {
  try {
    const { createAuditLog } = await import('./logService');
    createAuditLog(dados as any);
  } catch (err) {
    console.error('Erro ao registrar log da conferência:', err);
  }
};

/**
 * Abre (ou retoma) a conferencia. Erro com mensagem para a tela quando o
 * pedido nao pode ser conferido (outro vendedor, sem conferencia, cancelado).
 */
export const abrirConferencia = async (args: {
  alvo: AlvoDaConferencia;
  tenantId: string;
  usuario: UsuarioDaConferencia;
  vendasVisiveisDeUsuarioId?: string | null;
}): Promise<ConferenciaAberta> => {
  const { alvo, tenantId, usuario, vendasVisiveisDeUsuarioId } = args;

  if (alvo.tipo === 'troca') {
    const aberta = await trocaService.abrirConferencia(alvo.id);
    const config = await lerConfigDaConferencia(tenantId);
    return {
      numero: aberta.troca.numeroTroca,
      clienteNome: aberta.troca.clienteNome,
      config,
      itens: config.ordenarMinutaPorLocal ? ordenarPorLocalizacao(aberta.itens) : aberta.itens,
      status: aberta.status,
      abertoPorNome: aberta.abertoPorNome,
      avisos: null,
      assinaturaDoPedido: '',
    };
  }

  const pedidoId = alvo.id;
  const usuarioNome = await nomeDoUsuarioDaConferencia(usuario);

  const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', pedidoId));
  if (!pedidoSnap.exists() || pedidoSnap.data().tenantId !== tenantId) throw new Error('Pedido não encontrado.');
  const pedidoData = pedidoSnap.data();
  // Visibilidade de vendas: sem isto, o link direto da conferencia
  // abriria a venda do colega com itens, quantidades e cliente.
  if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(pedidoData, vendasVisiveisDeUsuarioId)) {
    throw new Error('Esta venda foi registrada por outro vendedor e sua empresa limitou cada vendedor às próprias vendas. Peça a um usuário com nível Administração para conferir este pedido.');
  }
  if (!pedidoData.statusConferencia) throw new Error('Este pedido não está habilitado para conferência de mercadoria.');
  // Pedido/pre-venda cancelado sai da expedicao: nao ha o que separar.
  if (pedidoData.status === 'Cancelada') throw new Error('Este pedido foi cancelado e saiu da expedição. Não há mercadoria a conferir.');

  const config = await lerConfigDaConferencia(tenantId);

  // Enriquece cada item com estoque/{id} (codigo/codigoBarras/
  // localizacaoEstoque) FORA da transacao -- mesmo padrao ja usado em
  // MinutaPrint.tsx (Fatia 2). So usado se a expedicao ainda nao
  // existir; se ja existe, os itens gravados la sao a fonte da verdade.
  const itensDoPedido = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];
  const itensEnriquecidos = await montarItensDaConferencia(itensDoPedido);
  const itensIniciais = config.ordenarMinutaPorLocal ? ordenarPorLocalizacao(itensEnriquecidos) : itensEnriquecidos;

  // Abertura sempre em transacao -- toca 2 documentos (expedicoes +
  // pedidos_venda), regra permanente da Secao 1.4. So escreve algo
  // quando o estado realmente precisa mudar (evita historico/log
  // espurio toda vez que a tela e' revisitada ja em_conferencia).
  const resultado = await runTransaction(db, async (transaction) => {
    const pedidoRefTx = doc(db, 'pedidos_venda', pedidoId);
    const expedicaoRefTx = doc(db, 'expedicoes', pedidoId);
    const pedidoSnapTx = await transaction.get(pedidoRefTx);
    const expedicaoSnapTx = await transaction.get(expedicaoRefTx);

    if (!pedidoSnapTx.exists()) throw new Error('Pedido não encontrado.');
    const pedidoDataTx = pedidoSnapTx.data();

    if (expedicaoSnapTx.exists()) {
      const expedicaoDataTx = expedicaoSnapTx.data();

      if (expedicaoDataTx.status === 'em_conferencia') {
        return {
          itens: (expedicaoDataTx.itens as ConferenciaItem[]) || itensIniciais,
          status: 'em_conferencia' as StatusConferencia,
          abertoPorNome: expedicaoDataTx.abertoPorNome || usuarioNome,
        };
      }

      const de = expedicaoDataTx.status as StatusConferencia;
      if (!canTransition(de, 'em_conferencia')) throw new Error('Transição de status inválida para reabrir esta conferência.');

      const novoHistorico = [
        ...(expedicaoDataTx.historico || []),
        { de, para: 'em_conferencia', em: Timestamp.now(), usuarioId: usuario.uid, usuarioNome },
      ];
      transaction.update(expedicaoRefTx, {
        status: 'em_conferencia',
        historico: novoHistorico,
        ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp()),
      });
      transaction.update(pedidoRefTx, {
        statusConferencia: 'em_conferencia',
        ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp()),
      });
      return {
        itens: (expedicaoDataTx.itens as ConferenciaItem[]) || itensIniciais,
        status: 'em_conferencia' as StatusConferencia,
        abertoPorNome: expedicaoDataTx.abertoPorNome || usuarioNome,
      };
    }

    // Primeira vez que este pedido e' aberto pra conferencia.
    const de = (pedidoDataTx.statusConferencia as StatusConferencia) || 'aguardando';
    const historicoInicial: HistoricoEntry[] = [
      { de, para: 'em_conferencia', em: Timestamp.now(), usuarioId: usuario.uid, usuarioNome },
    ];
    transaction.set(expedicaoRefTx, {
      tenantId,
      pedidoId,
      numeroPedido: pedidoDataTx.numeroPedido,
      clienteNome: pedidoDataTx.clienteNome || '',
      status: 'em_conferencia',
      itens: itensIniciais,
      abertoPor: usuario.uid,
      abertoPorNome: usuarioNome,
      abertoEm: serverTimestamp(),
      observacao: '',
      historico: historicoInicial,
      ...buildDocumentMetadata(usuario.uid, serverTimestamp()),
    });
    transaction.update(pedidoRefTx, {
      statusConferencia: 'em_conferencia',
      ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp()),
    });
    return { itens: itensIniciais, status: 'em_conferencia' as StatusConferencia, abertoPorNome: usuarioNome };
  });

  // Pedido alterado depois da primeira abertura (item cancelado/acrescentado): alinha a copia com o pedido atual.
  const reconciliado = reconciliarItensDaConferencia(resultado.itens, itensIniciais);
  if (reconciliado.mudou) {
    try {
      await updateDoc(doc(db, 'expedicoes', pedidoId), { itens: reconciliado.itens, ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp()) });
    } catch (erroReconciliar) {
      console.error('Erro ao gravar a lista atualizada da conferência:', erroReconciliar);
    }
  }

  void registrarLog({
    tenantId,
    usuarioId: usuario.uid,
    usuarioEmail: usuario.email || usuario.uid,
    modulo: 'expedicao',
    acao: 'conferencia_aberta',
    descricao: `Conferência do pedido #${pedidoData.numeroPedido} aberta.`,
    registroRelacionadoId: pedidoId,
    status: 'sucesso',
  });

  return {
    numero: pedidoData.numeroPedido,
    clienteNome: pedidoData.clienteNome,
    config,
    itens: reconciliado.itens,
    status: resultado.status,
    abertoPorNome: resultado.abertoPorNome,
    avisos: reconciliado.mudou ? reconciliado.avisos : null,
    assinaturaDoPedido: assinaturaDosItens(itensDoPedido),
  };
};

/**
 * GRAVACAO AUTOMATICA (2026-09-25): cada bipagem e' gravada na hora.
 * `observacao` undefined = nao mexe na observacao gravada.
 */
export const gravarProgressoDaConferencia = async (args: { alvo: AlvoDaConferencia; uid: string; itens: ConferenciaItem[]; observacao?: string }) => {
  const { alvo, uid, itens, observacao } = args;
  if (alvo.tipo === 'troca') {
    // Na troca quem escreve e' o servidor: ele so' aceita a quantidade conferida (nada altera via DevTools).
    await trocaService.salvarConferencia(alvo.id, itens.map((item) => ({ produtoId: item.produtoId, quantidadeConferida: item.quantidadeConferida })));
    return;
  }
  await updateDoc(doc(db, 'expedicoes', alvo.id), {
    itens,
    ...(observacao !== undefined ? { observacao } : {}),
    ...buildDocumentUpdateMetadata(uid, serverTimestamp()),
  });
};

/** Fecha a conferencia como Conferido ou Divergente (decidido pelos itens). Devolve o status final. */
export const fecharConferencia = async (args: {
  alvo: AlvoDaConferencia;
  tenantId: string;
  usuario: UsuarioDaConferencia;
  itens: ConferenciaItem[];
  observacao: string;
  numero: string;
}): Promise<StatusConferencia> => {
  const { alvo, tenantId, usuario, itens, observacao, numero } = args;
  const final = computeStatusFinal(itens);

  if (alvo.tipo === 'troca') {
    // O servidor confere as quantidades, decide o status final e grava
    // na troca e na expedicao numa transacao so'.
    await trocaService.fecharConferencia(
      alvo.id,
      itens.map((item) => ({ produtoId: item.produtoId, quantidadeConferida: item.quantidadeConferida })),
      observacao,
    );
    return final;
  }

  const pedidoId = alvo.id;
  const usuarioNome = await nomeDoUsuarioDaConferencia(usuario);

  await runTransaction(db, async (transaction) => {
    const pedidoRefTx = doc(db, 'pedidos_venda', pedidoId);
    const expedicaoRefTx = doc(db, 'expedicoes', pedidoId);
    const pedidoSnapTx = await transaction.get(pedidoRefTx);
    const expedicaoSnapTx = await transaction.get(expedicaoRefTx);
    if (!pedidoSnapTx.exists()) throw new Error('Pedido não encontrado.');
    if (!expedicaoSnapTx.exists()) throw new Error('Registro de conferência não encontrado.');

    const historicoAtual = expedicaoSnapTx.data().historico || [];
    const novoHistorico = [
      ...historicoAtual,
      { de: 'em_conferencia', para: final, em: Timestamp.now(), usuarioId: usuario.uid, usuarioNome },
    ];

    transaction.update(expedicaoRefTx, {
      status: final,
      itens,
      observacao,
      conferidoPor: usuario.uid,
      conferidoPorNome: usuarioNome,
      conferidoEm: serverTimestamp(),
      historico: novoHistorico,
      ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp()),
    });
    // Restrito aos campos liberados por canCloseConferenciaOnPedido()
    // nas firestore.rules -- nunca adicionar outro campo aqui sem
    // atualizar a regra junto (ver Modulo 12 no plano).
    transaction.update(pedidoRefTx, {
      statusConferencia: final,
      conferidoPor: usuario.uid,
      conferidoPorNome: usuarioNome,
      conferidoEm: serverTimestamp(),
      ...buildDocumentUpdateMetadata(usuario.uid, serverTimestamp()),
    });
  });

  void registrarLog({
    tenantId,
    usuarioId: usuario.uid,
    usuarioEmail: usuario.email || usuario.uid,
    modulo: 'expedicao',
    acao: 'conferencia_fechada',
    descricao: `Conferência do pedido #${numero} fechada como ${STATUS_LABELS[final]}.`,
    registroRelacionadoId: pedidoId,
    valorAnterior: 'em_conferencia',
    valorNovo: final,
    status: 'sucesso',
  });

  return final;
};
