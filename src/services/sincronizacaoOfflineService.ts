import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { enviarAssinatura, enviarFotoReduzida, estaOnline, type UsuarioDoCampo } from './osCampoService';
import { enviarCanhotoReduzido } from './entregaCampoService';
import { applyStockFieldDeltas, formatSequenceValue, getCurrentMaxSequence, getNextTenantSequenceValue, writeTenantSequenceValue } from '../utils/firestoreAtomic';
import { computeReservationDelta } from '../utils/estoqueReservaDomain';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { osEncerrada } from '../utils/osCampoDomain';
import { ordenarPendencias, podeTentarAgora, type Pendencia } from '../utils/offlineDomain';
import { atualizarPendencia, listarPendencias, removerPendencia, type PendenciaGuardada } from '../utils/filaOffline';

/*
 * SINCRONIZACAO DAS PENDENCIAS OFFLINE (app do tecnico, fase 4 -- 2026-10-08).
 *
 * Roda quando a rede volta, ao abrir o app e pelo botao "Enviar agora" da
 * faixa (VendedorFaixaOffline). Reproduz, na ordem de offlineDomain.ts, o
 * que ficou guardado no aparelho: numera a OS aberta sem sinal, reserva o
 * estoque das pecas, sobe fotos e assinatura. Cada pendencia e' independente:
 * uma que falha so' marca a falha (tentativas/ultimoErro) e as outras seguem.
 */

let emAndamento: Promise<ResultadoSincronizacao> | null = null;

export interface ResultadoSincronizacao {
  enviadas: number;
  comErro: number;
  restantes: number;
}

const itens = (lista: unknown) => (Array.isArray(lista) ? lista : []).map((x) => ({ id: String(x.id), nome: String(x.nome || ''), quantidade: Number(x.quantidade || 0) }));

const numerarOs = async (tenantId: string, usuario: UsuarioDoCampo, osId: string) => {
  const maior = await getCurrentMaxSequence(db, 'ordens_de_servico', tenantId, 'numeroOS').catch(() => 0);
  await runTransaction(db, async (tx) => {
    const osRef = doc(db, 'ordens_de_servico', osId);
    const snap = await tx.get(osRef);
    if (!snap.exists()) return;
    const atual = snap.data();
    if (atual.numeroProvisorio !== true) return;
    const proximo = await getNextTenantSequenceValue(tx, db, tenantId, 'ordens_de_servico', maior);
    writeTenantSequenceValue(tx, db, tenantId, 'ordens_de_servico', proximo);
    tx.update(osRef, { numeroOS: formatSequenceValue(proximo, 2), numeroProvisorio: false, ...buildDocumentUpdateMetadata(usuario.id, serverTimestamp()) });
  });
};

const reservarEstoqueDaOs = async (tenantId: string, usuario: UsuarioDoCampo, osId: string) => {
  await runTransaction(db, async (tx) => {
    const osRef = doc(db, 'ordens_de_servico', osId);
    const [snap, cfg] = await Promise.all([tx.get(osRef), tx.get(doc(db, 'configuracoes', tenantId))]);
    if (!snap.exists()) return;
    const atual = snap.data();
    const config = cfg.exists() ? cfg.data() : {};
    const reservaNaoCabe = (config.momentoBaixaEstoque ?? 'imediato') !== 'pedido' || atual.estoqueBaixado === true || osEncerrada(atual.status) || atual.estoqueReservado === true;
    if (reservaNaoCabe) {
      tx.update(osRef, { reservaPendente: false, ...buildDocumentUpdateMetadata(usuario.id, serverTimestamp()) });
      return;
    }
    const deltas = computeReservationDelta([], itens(atual.pecas));
    if (deltas.length > 0) await applyStockFieldDeltas(tx, db, deltas, config.venderSemEstoque === true);
    tx.update(osRef, { estoqueReservado: deltas.length > 0, reservaPendente: false, ...buildDocumentUpdateMetadata(usuario.id, serverTimestamp()) });
  });
};

const executar = async (p: PendenciaGuardada, usuario: UsuarioDoCampo): Promise<void> => {
  switch (p.tipo) {
    case 'numero_os':
      await numerarOs(p.tenantId, usuario, p.osId);
      return;
    case 'reserva_os':
      await reservarEstoqueDaOs(p.tenantId, usuario, p.osId);
      return;
    case 'foto':
      if (!p.blob) throw new Error('A foto não está mais no aparelho (o navegador limpou os dados).');
      await enviarFotoReduzida({ tenantId: p.tenantId, usuario, osId: p.osId, blob: p.blob, legenda: p.legenda, indice: Number(p.criadoEm.replace(/\D/g, '').slice(-4)) || 0 });
      return;
    case 'assinatura':
      if (!p.blob) throw new Error('A assinatura não está mais no aparelho (o navegador limpou os dados).');
      await enviarAssinatura({ tenantId: p.tenantId, usuario, osId: p.osId, png: p.blob, nomeAssinante: p.nomeAssinante });
      return;
    case 'canhoto':
      if (!p.blob) throw new Error('A foto do canhoto não está mais no aparelho (o navegador limpou os dados).');
      await enviarCanhotoReduzido({ tenantId: p.tenantId, usuario, romaneioId: p.romaneioId, pedidoId: p.pedidoId, blob: p.blob });
      return;
    default:
      throw new Error(`Pendência desconhecida: ${(p as Pendencia).tipo}`);
  }
};

export const sincronizarPendencias = (args: { tenantId: string; usuario: UsuarioDoCampo }): Promise<ResultadoSincronizacao> => {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    const resultado: ResultadoSincronizacao = { enviadas: 0, comErro: 0, restantes: 0 };
    try {
      if (!estaOnline()) {
        resultado.restantes = (await listarPendencias(args.tenantId, args.usuario.id)).length;
        return resultado;
      }
      const lista = ordenarPendencias(await listarPendencias(args.tenantId, args.usuario.id));
      const agora = new Date().toISOString();
      for (const p of lista) {
        if (!podeTentarAgora(p, agora)) { resultado.restantes++; continue; }
        try {
          await executar(p, args.usuario);
          await removerPendencia(p.id);
          resultado.enviadas++;
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : 'Falha ao enviar.';
          await atualizarPendencia(p.id, { tentativas: p.tentativas + 1, ultimoErro: mensagem, ultimaTentativaEm: new Date().toISOString() });
          resultado.comErro++;
          resultado.restantes++;
        }
      }
      return resultado;
    } finally {
      emAndamento = null;
    }
  })();
  return emAndamento;
};
