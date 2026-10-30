import { criarOrcamentoExterno, criarPreVendaExterna } from '../../services/vendedorExternoVendaService';
import { trocaService } from '../../services/trocaService';
import { comNotaFiscalDaEscolha } from '../../utils/pedidoVendedorDomain';
import { perguntaRotaNaPreVenda, textoDoResultadoDaRota, type ModoRotaPreVenda } from '../../utils/rotaPreVendaDomain';
import { colocarPedidoNaRotaSemFalhar } from '../../services/rotaPreVendaService';
import { listarRascunhos, marcarErroRascunho, removerRascunho, type RascunhoVenda } from './vendedorRascunhosStore';
import { idDoPedidoDeBonificacao, separarItensDaBonificacao, TIPO_PEDIDO_BONIFICACAO } from '../../utils/bonificacaoDomain';

/*
 * ENVIO DOS RASCUNHOS DO APP VENDAS.
 *
 * Um lugar so' para mandar o rascunho do celular para a loja, usado pelo
 * botao "Enviar dados" (Rascunhos) e, desde 13/10/2026, pelo envio
 * automatico dos rascunhos marcados "Pronto para enviar" quando o celular
 * tem sinal (EnvioAutomaticoDeRascunhos).
 *
 * Regras que valem para os dois: um de cada vez, nunca em paralelo; o
 * rascunho so' sai do aparelho depois de a base confirmar; falha fica na
 * lista com o motivo. Reenviar um rascunho que chegou a gravar antes de a
 * conexao cair nao duplica: o id do rascunho e' o id do documento.
 */

export interface ContextoDeEnvio {
  tenantId: string;
  usuarioId: string;
  vendedorNome: string;
  trabalhaComPreVenda: boolean;
  permiteVendaSemEstoque: boolean;
  conferenciaMercadoriaAtiva: boolean;
  /** Rota na pre-venda (rotaPreVendaDomain.ts): 'nao' = nao mexe em rota. */
  modoRotaPreVenda: ModoRotaPreVenda;
}

export interface ResultadoEnvio {
  localId: string;
  descricao: string;
  ok: boolean;
  mensagem: string;
}

export const rotuloTipoRascunho = (rascunho: RascunhoVenda) => (rascunho.tipo === 'pedido' ? 'Pedido' : rascunho.tipo === 'troca' ? 'Troca' : 'Orçamento');

const enviarUm = async (ctx: ContextoDeEnvio, rascunho: RascunhoVenda): Promise<string> => {
  if (rascunho.tipo === 'troca') {
    // Troca vai pelo servidor (a loja aprova depois); reenviar o mesmo rascunho nao duplica.
    const resposta = await trocaService.solicitar({
      idDocumento: rascunho.localId,
      clienteId: rascunho.cliente.id,
      observacao: rascunho.observacao,
      itens: (rascunho.itensTroca || []).map((item) => ({
        id: item.id,
        quantidade: item.quantidade,
        motivo: item.motivo,
        ...(item.motivoDescricao ? { motivoDescricao: item.motivoDescricao } : {}),
      })),
    });
    return `Troca #${resposta.numeroTroca} enviada — aguarde a loja aprovar`;
  }
  if (rascunho.tipo === 'pedido') {
    if (!ctx.trabalhaComPreVenda) {
      throw new Error('A opção "Pré-venda" está desligada nas Configurações da empresa. Peça pro administrador habilitar.');
    }
    // Bonificacao (contador, 30/10/2026): os brindes saem num PEDIDO DE BONIFICACAO
    // proprio, ligado a venda (ids fixos: reenviar nao duplica nenhum dos dois).
    const { cobrados, brindes } = separarItensDaBonificacao(rascunho.itens);
    const idBonificacao = brindes.length > 0 ? idDoPedidoDeBonificacao(rascunho.localId) : '';
    const comum = {
      tenantId: ctx.tenantId,
      usuarioId: ctx.usuarioId,
      vendedorId: ctx.usuarioId,
      vendedorNome: ctx.vendedorNome,
      clienteId: rascunho.cliente.id,
      clienteNome: rascunho.cliente.nome,
      observacao: rascunho.observacao,
      ...(rascunho.notaFiscal ? { comNotaFiscal: comNotaFiscalDaEscolha(rascunho.notaFiscal) } : {}),
      // Segue a config da empresa "Permitir venda sem estoque", como as
      // demais telas de venda.
      permitirVendaSemEstoque: ctx.permiteVendaSemEstoque,
      conferenciaMercadoriaAtiva: ctx.conferenciaMercadoriaAtiva,
    };
    const { id, numeroPedido } = await criarPreVendaExterna({
      ...comum,
      itens: cobrados,
      idDocumento: rascunho.localId,
      ...(idBonificacao ? { pedidoBonificacaoId: idBonificacao } : {}),
    });
    const bonificacao = idBonificacao
      ? await criarPreVendaExterna({
        ...comum,
        itens: brindes,
        idDocumento: idBonificacao,
        tipoPedido: TIPO_PEDIDO_BONIFICACAO,
        pedidoVendaOrigemId: id,
        pedidoVendaOrigemNumero: numeroPedido,
      })
      : null;
    // Rota na pre-venda (21/10/2026): a pre-venda ja' esta' na base; a rota
    // e' complemento -- o servidor confere se a escolhida ainda esta' em
    // montagem e, se nao, usa a que sobrou. Falhou, a loja coloca pelo Romaneio.
    // Sem o ponto final: quem mostra a mensagem e' que fecha a frase.
    const rota = perguntaRotaNaPreVenda(ctx.modoRotaPreVenda)
      ? textoDoResultadoDaRota(await colocarPedidoNaRotaSemFalhar(id, rascunho.rota?.id)).replace(/\.$/, '')
      : '';
    // A bonificacao vai junto, na mesma entrega.
    if (bonificacao && perguntaRotaNaPreVenda(ctx.modoRotaPreVenda)) await colocarPedidoNaRotaSemFalhar(bonificacao.id, rascunho.rota?.id);
    return `Pré-venda #${numeroPedido}${bonificacao ? ` e Bonificação #${bonificacao.numeroPedido} enviadas` : ' enviada'}${rota ? ` — ${rota}` : ''}`;
  }
  const { numeroOrcamento } = await criarOrcamentoExterno({
    tenantId: ctx.tenantId,
    usuarioId: ctx.usuarioId,
    clienteId: rascunho.cliente.id,
    clienteNome: rascunho.cliente.nome,
    clienteTelefone: rascunho.cliente.telefone || '',
    itens: rascunho.itens,
    idDocumento: rascunho.localId,
  });
  return `Orçamento #${numeroOrcamento} enviado`;
};

/** Trava do aparelho: o botao e o automatico nunca mandam ao mesmo tempo. */
let envioEmAndamento: Promise<ResultadoEnvio[]> | null = null;

export const envioDeRascunhosEmAndamento = (): boolean => envioEmAndamento !== null;

/**
 * Manda os rascunhos escolhidos por `filtro` (todos, no botao; so' os prontos,
 * no automatico). Se ja' houver um envio rodando, espera ele e nao manda de
 * novo -- devolve lista vazia.
 */
export const enviarRascunhos = async (
  ctx: ContextoDeEnvio,
  filtro: (rascunho: RascunhoVenda) => boolean,
  aoProgredir?: (parcial: ResultadoEnvio[]) => void,
): Promise<ResultadoEnvio[]> => {
  if (envioEmAndamento) {
    await envioEmAndamento.catch(() => undefined);
    return [];
  }
  const tarefa = (async () => {
    const log: ResultadoEnvio[] = [];
    // Le na hora: a lista pode ter mudado desde que a tela abriu.
    const pendentes = listarRascunhos(ctx.tenantId, ctx.usuarioId).filter(filtro);
    for (const rascunho of pendentes) {
      const descricao = `${rotuloTipoRascunho(rascunho)} — ${rascunho.cliente.nome}`;
      try {
        const mensagem = await enviarUm(ctx, rascunho);
        // So' agora, com a base confirmando, o rascunho sai do aparelho.
        removerRascunho(ctx.tenantId, ctx.usuarioId, rascunho.localId);
        log.push({ localId: rascunho.localId, descricao, ok: true, mensagem });
      } catch (error) {
        const mensagem = error instanceof Error && error.message
          ? error.message
          : 'Não foi possível enviar. Verifique a internet e tente de novo.';
        try {
          marcarErroRascunho(ctx.tenantId, ctx.usuarioId, rascunho.localId, mensagem);
        } catch {
          // O rascunho continua salvo do jeito que estava; so' o motivo nao gravou.
        }
        log.push({ localId: rascunho.localId, descricao, ok: false, mensagem });
      }
      aoProgredir?.([...log]);
    }
    return log;
  })();
  envioEmAndamento = tarefa;
  try {
    return await tarefa;
  } finally {
    envioEmAndamento = null;
  }
};
