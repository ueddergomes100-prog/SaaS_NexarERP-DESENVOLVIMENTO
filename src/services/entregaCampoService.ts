import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { estaOnline, type UsuarioDoCampo } from './osCampoService';
import { comprimirImagem } from '../utils/comprimirImagem';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { LADO_MAXIMO_FOTO_PX, TAMANHO_MAXIMO_FOTO_BYTES } from '../utils/osCampoDomain';
import {
  caminhosDoRegistro,
  erroDoRegistroDeEntrega,
  registroParaGravar,
  type DadosDoRegistro,
  type EntregaRomaneio,
} from '../utils/romaneioDomain';
import { adicionarPendencia, novoIdPendencia } from '../utils/filaOffline';
import type { PendenciaCanhoto } from '../utils/offlineDomain';

/*
 * ENTREGAS PELO APP DO MOTORISTA (2026-10-08).
 *
 * O motorista registra entregue/nao entregue, o que recebeu e a foto do
 * canhoto, muitas vezes sem sinal. Tudo aqui e' feito para funcionar offline:
 *
 *  - o registro vai para `registros.{pedidoId}` campo a campo (ver
 *    romaneioDomain.ts, "REGISTROS DO APP"), num updateDoc que o SDK guarda
 *    na fila dele quando nao ha' rede;
 *  - a foto do canhoto, que precisa do Storage, vira pendencia na fila do
 *    aparelho (filaOffline.ts) e sobe pela sincronizacao
 *    (sincronizacaoOfflineService.ts).
 *
 * As firestore.rules so' aceitam esse update numa rota EM ANDAMENTO
 * (canRegisterDeliveryFromApp): rota fechada pela loja antes de o celular
 * voltar a ter sinal recusa o registro atrasado.
 */

/** Offline: nao espera a confirmacao do servidor (ficaria pendurado); o SDK guarda e envia depois. */
const gravar = async (promessa: Promise<unknown>): Promise<void> => {
  if (estaOnline()) { await promessa; return; }
  promessa.catch((erro) => console.error('Registro de entrega offline recusado ao sincronizar:', erro));
};

const erroEmPortugues = (erro: unknown, padrao: string): Error => {
  const codigo = typeof erro === 'object' && erro && 'code' in erro ? String((erro as { code?: unknown }).code) : '';
  if (codigo === 'permission-denied' || codigo === 'storage/unauthorized') {
    return new Error('Você não tem permissão para registrar entregas nesta rota, ou a rota já foi fechada pela loja. Fale com o escritório.');
  }
  if (erro instanceof Error && erro.message && !/firebase|firestore|storage\//i.test(erro.message)) return erro;
  return new Error(padrao);
};

export const caminhoDoCanhoto = (tenantId: string, romaneioId: string, pedidoId: string, carimbo: number): string => (
  `empresas/${tenantId}/romaneios/${romaneioId}/${pedidoId}-${carimbo}.jpg`
);

/** Grava o registro de uma entrega (entregue, nao entregue ou de volta a pendente). */
export const registrarEntregaNoApp = async (p: {
  tenantId: string;
  usuario: UsuarioDoCampo;
  romaneioId: string;
  entrega: EntregaRomaneio;
  registro: DadosDoRegistro;
}): Promise<void> => {
  const erro = erroDoRegistroDeEntrega({ ...p.registro, valorTotalCentavos: p.entrega.valorTotalCentavos });
  if (erro) throw new Error(erro);
  const gravado = registroParaGravar(p.entrega, p.registro, { nome: p.usuario.nome, via: 'app', agoraIso: new Date().toISOString() });
  try {
    await gravar(updateDoc(doc(db, 'romaneios', p.romaneioId), {
      ...caminhosDoRegistro(p.entrega.pedidoId, gravado),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp(), `Entrega do pedido #${p.entrega.numeroPedido} pelo app: ${p.registro.status}`),
    }));
  } catch (e) {
    throw erroEmPortugues(e, 'Não foi possível gravar a entrega. Tente de novo.');
  }
};

/** Sobe a foto (ja' reduzida) e aponta o registro para ela. Usado online e pela sincronizacao. */
export const enviarCanhotoReduzido = async (p: { tenantId: string; usuario: UsuarioDoCampo; romaneioId: string; pedidoId: string; blob: Blob }): Promise<string> => {
  const caminho = caminhoDoCanhoto(p.tenantId, p.romaneioId, p.pedidoId, Date.now());
  const destino = storageRef(storage, caminho);
  await uploadBytes(destino, p.blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000' });
  const url = await getDownloadURL(destino);
  await updateDoc(doc(db, 'romaneios', p.romaneioId), {
    [`registros.${p.pedidoId}.canhotoUrl`]: url,
    [`registros.${p.pedidoId}.canhotoCaminho`]: caminho,
    updatedAt: serverTimestamp(),
    ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
  });
  return url;
};

/**
 * Foto do canhoto: reduz, e sobe na hora (online) ou guarda no aparelho
 * (offline, devolve null). Uma por entrega: a nova substitui a anterior.
 */
export const anexarCanhoto = async (p: { tenantId: string; usuario: UsuarioDoCampo; romaneioId: string; pedidoId: string; arquivo: Blob }): Promise<string | null> => {
  let reduzida: Blob;
  try {
    reduzida = await comprimirImagem(p.arquivo, LADO_MAXIMO_FOTO_PX);
  } catch {
    throw new Error('Não foi possível ler a foto. Tire outra.');
  }
  if (reduzida.size > TAMANHO_MAXIMO_FOTO_BYTES) throw new Error('A foto ficou grande demais mesmo reduzida. Tire outra com menos zoom.');
  if (!estaOnline()) {
    const pendencia: PendenciaCanhoto & { blob: Blob } = {
      id: novoIdPendencia(),
      tenantId: p.tenantId,
      usuarioId: p.usuario.id,
      osId: '',
      tipo: 'canhoto',
      romaneioId: p.romaneioId,
      pedidoId: p.pedidoId,
      nomeArquivo: `canhoto-${Date.now()}.jpg`,
      criadoEm: new Date().toISOString(),
      tentativas: 0,
      ultimoErro: '',
      ultimaTentativaEm: '',
      blob: reduzida,
    };
    await adicionarPendencia(pendencia);
    return null;
  }
  try {
    return await enviarCanhotoReduzido({ tenantId: p.tenantId, usuario: p.usuario, romaneioId: p.romaneioId, pedidoId: p.pedidoId, blob: reduzida });
  } catch (e) {
    throw erroEmPortugues(e, 'Não foi possível enviar a foto do canhoto. Tente de novo.');
  }
};
