import { addDoc, arrayRemove, arrayUnion, collection, doc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { createAuditLog } from './logService';
import {
  applyStockFieldDeltas,
  formatSequenceValue,
  getCurrentMaxSequence,
  getNextTenantSequenceValue,
  writeTenantSequenceValue,
} from '../utils/firestoreAtomic';
import { computeReservationDelta, type MomentoBaixaEstoque } from '../utils/estoqueReservaDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { getDateInputInTimeZone } from '../utils/dateTime';
import { comprimirImagem } from '../utils/comprimirImagem';
import { kmDoDeslocamento, temDeslocamento, type Deslocamento } from '../utils/oficinaDomain';
import {
  CORES_STATUS_OS_CAMPO,
  LADO_MAXIMO_FOTO_PX,
  STATUS_OS_AGUARDANDO_CONFERENCIA,
  TAMANHO_MAXIMO_FOTO_BYTES,
  caminhoDaAssinaturaOS,
  caminhoDaFotoOS,
  montarNovaOsDeCampo,
  osEncerrada,
  podeAdicionarFotos,
  totalDoAtendimentoCentavos,
  type AssinaturaOS,
  type EquipamentoCampo,
  type FotoOS,
  type PecaCampo,
  type ServicoCampo,
} from '../utils/osCampoDomain';

/*
 * OS NO CAMPO -- gravacao (maquinas pesadas, fase 3 -- 2026-10-08).
 *
 * Tudo que o app do tecnico escreve passa por aqui, em funcoes pequenas e
 * independentes de tela, de proposito: a fase 4 (offline) vai enfileirar
 * exatamente estas chamadas no aparelho e reproduzi-las quando voltar o
 * sinal. Regras (firestore.rules): `ordens_de_servico` e `veiculos` aceitam
 * quem tem `mecanica.os`; a reserva mexe so' em quantidade/quantidadeReservada
 * do estoque (canAdjustStockQuantity). Storage: empresas/{tenant}/os/{osId}.
 *
 * O app NUNCA finaliza a OS: "Concluir atendimento" deixa em "Aguardando
 * conferencia" e a oficina fecha no desktop (pagamento, baixa, comissao).
 */

export interface UsuarioDoCampo {
  id: string;
  nome: string;
  email: string;
}

const horaAgora = () => new Date().toTimeString().slice(0, 5);

const erroEmPortugues = (erro: unknown, padrao: string): Error => {
  const msg = erro instanceof Error ? erro.message : '';
  if (/permission|insufficient/i.test(msg)) return new Error('Sem permissão para gravar esta OS. Peça ao administrador a permissão "Ordens de Serviço" no seu cadastro.');
  if (/offline|network|unavailable|Failed to fetch/i.test(msg)) return new Error('Sem conexão. Verifique a internet e tente de novo — nada foi perdido na tela.');
  return new Error(msg && !/^Function |^FirebaseError/.test(msg) ? msg : padrao);
};

// ---------------------------------------------------------------------------
// Abrir
// ---------------------------------------------------------------------------

export interface AbrirOsNoCampoParams {
  tenantId: string;
  usuario: UsuarioDoCampo;
  cliente: { id: string | null; nome: string; telefone: string };
  equipamento: EquipamentoCampo;
  /** Equipamento digitado na hora: tambem entra no cadastro de veiculos/equipamentos do cliente. */
  salvarEquipamentoNoCadastro: boolean;
  reclamacao: string;
}

export const abrirOsNoCampo = async (p: AbrirOsNoCampoParams): Promise<{ id: string; numeroOS: string }> => {
  try {
    const maiorNumero = await getCurrentMaxSequence(db, 'ordens_de_servico', p.tenantId, 'numeroOS').catch(() => 0);
    const osRef = doc(collection(db, 'ordens_de_servico'));
    let numeroOS = '';
    await runTransaction(db, async (transaction) => {
      const proximo = await getNextTenantSequenceValue(transaction, db, p.tenantId, 'ordens_de_servico', maiorNumero);
      numeroOS = formatSequenceValue(proximo, 2);
      writeTenantSequenceValue(transaction, db, p.tenantId, 'ordens_de_servico', proximo);
      transaction.set(osRef, {
        ...montarNovaOsDeCampo({
          tenantId: p.tenantId,
          numeroOS,
          tecnico: { id: p.usuario.id, nome: p.usuario.nome },
          cliente: p.cliente,
          equipamento: p.equipamento,
          reclamacao: p.reclamacao,
          data: getDateInputInTimeZone(),
          hora: horaAgora(),
        }),
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(p.usuario.id, serverTimestamp()),
      });
    });
    if (p.salvarEquipamentoNoCadastro && p.cliente.id) {
      // Fora da transacao de proposito: falhar aqui nao pode derrubar a OS ja aberta.
      try {
        await addDoc(collection(db, 'veiculos'), {
          tenantId: p.tenantId,
          clienteId: p.cliente.id,
          clienteNome: p.cliente.nome,
          placa: p.equipamento.placa,
          modelo: p.equipamento.modelo,
          marca: p.equipamento.marca,
          ano: p.equipamento.ano,
          cor: p.equipamento.cor,
          frota: p.equipamento.frota,
          serie: p.equipamento.serie,
          tipoEquipamento: p.equipamento.tipoEquipamento,
          horimetro: Number(p.equipamento.horimetro) || 0,
          kmAtual: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...buildDocumentMetadata(p.usuario.id, serverTimestamp()),
        });
      } catch (erro) {
        console.error('Equipamento nao entrou no cadastro (a OS foi aberta):', erro);
      }
    }
    createAuditLog({
      tenantId: p.tenantId,
      usuarioId: p.usuario.id,
      usuarioEmail: p.usuario.email,
      modulo: 'Ordens de Serviço',
      acao: 'Abrir no campo',
      descricao: `OS #${numeroOS} aberta pelo app do técnico para ${p.cliente.nome}`,
      registroRelacionadoId: osRef.id,
      status: 'sucesso',
    });
    return { id: osRef.id, numeroOS };
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível abrir a OS. Tente de novo.');
  }
};

// ---------------------------------------------------------------------------
// Salvar o atendimento (pecas, servicos, deslocamento, horimetro, observacao)
// ---------------------------------------------------------------------------

export interface SalvarAtendimentoParams {
  tenantId: string;
  usuario: UsuarioDoCampo;
  osId: string;
  pecas: PecaCampo[];
  servicos: ServicoCampo[];
  deslocamento: Deslocamento;
  horimetro: string;
  relatorioTecnico: string;
  /** Configuracoes -> Momento da baixa: 'pedido' = a OS aberta reserva as pecas. */
  momentoBaixaEstoque: MomentoBaixaEstoque;
  permitirVendaSemEstoque: boolean;
}

export const salvarAtendimento = async (p: SalvarAtendimentoParams): Promise<void> => {
  try {
    await runTransaction(db, async (transaction) => {
      const osRef = doc(db, 'ordens_de_servico', p.osId);
      const snap = await transaction.get(osRef);
      if (!snap.exists()) throw new Error('Esta OS não existe mais. Volte para a lista e abra de novo.');
      const atual = snap.data();
      if (atual.tenantId !== p.tenantId) throw new Error('Esta OS é de outra empresa.');
      if (osEncerrada(atual.status)) throw new Error(`Esta OS já está ${String(atual.status).toLowerCase()} e não pode ser alterada pelo app.`);

      const itens = (lista: Array<{ id: string; nome: string; quantidade: number }>) => lista.map((x) => ({ id: x.id, nome: x.nome, quantidade: x.quantidade }));
      let estoqueReservado = atual.estoqueReservado === true;
      if (p.momentoBaixaEstoque === 'pedido' && atual.estoqueBaixado !== true) {
        const anteriores = atual.estoqueReservado === true ? itens(atual.pecas || []) : [];
        const deltas = computeReservationDelta(anteriores, itens(p.pecas));
        if (deltas.length > 0) await applyStockFieldDeltas(transaction, db, deltas, p.permitirVendaSemEstoque);
        estoqueReservado = p.pecas.length > 0;
      }

      const totalCentavos = totalDoAtendimentoCentavos(p.pecas, p.servicos);
      transaction.update(osRef, {
        pecas: p.pecas,
        servicos: p.servicos,
        deslocamento: temDeslocamento(p.deslocamento) ? { ...p.deslocamento, km: kmDoDeslocamento(p.deslocamento) } : null,
        horimetro: p.horimetro,
        relatorioTecnico: p.relatorioTecnico,
        valorTotal: totalCentavos / 100,
        valorTotalCentavos: totalCentavos,
        estoqueReservado,
        'atendimentoCampo.ultimoEnvio': new Date().toISOString(),
        ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
      });
    });
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível salvar o atendimento. Tente de novo.');
  }
};

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

export interface AdicionarFotoParams {
  tenantId: string;
  usuario: UsuarioDoCampo;
  osId: string;
  arquivo: Blob;
  legenda: string;
  fotosAtuais: FotoOS[];
  indice?: number;
}

export const adicionarFotoOs = async (p: AdicionarFotoParams): Promise<FotoOS> => {
  const cabe = podeAdicionarFotos(p.fotosAtuais, 1);
  if (!cabe.ok) throw new Error(cabe.erro);
  try {
    const reduzida = await comprimirImagem(p.arquivo, LADO_MAXIMO_FOTO_PX);
    if (reduzida.size > TAMANHO_MAXIMO_FOTO_BYTES) throw new Error('A foto ficou grande demais mesmo reduzida. Tire outra com menos zoom.');
    const caminho = caminhoDaFotoOS(p.tenantId, p.osId, Date.now(), p.indice ?? p.fotosAtuais.length);
    const destino = storageRef(storage, caminho);
    await uploadBytes(destino, reduzida, { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000' });
    const url = await getDownloadURL(destino);
    const foto: FotoOS = { caminho, url, legenda: p.legenda.trim(), em: new Date().toISOString(), por: p.usuario.nome };
    await updateDoc(doc(db, 'ordens_de_servico', p.osId), {
      fotos: arrayUnion(foto),
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
    });
    return foto;
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível enviar a foto. Tente de novo.');
  }
};

export const removerFotoOs = async (p: { usuario: UsuarioDoCampo; osId: string; foto: FotoOS }): Promise<void> => {
  try {
    await updateDoc(doc(db, 'ordens_de_servico', p.osId), {
      fotos: arrayRemove(p.foto),
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
    });
    // O arquivo sai depois do documento: se falhar, sobra um arquivo orfao, nunca uma foto fantasma na OS.
    await deleteObject(storageRef(storage, p.foto.caminho)).catch(() => undefined);
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível apagar a foto. Tente de novo.');
  }
};

export const salvarLegendasDasFotos = async (p: { usuario: UsuarioDoCampo; osId: string; fotos: FotoOS[] }): Promise<void> => {
  try {
    await updateDoc(doc(db, 'ordens_de_servico', p.osId), {
      fotos: p.fotos,
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
    });
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível salvar as legendas. Tente de novo.');
  }
};

// ---------------------------------------------------------------------------
// Assinatura do cliente
// ---------------------------------------------------------------------------

export const salvarAssinaturaOs = async (p: { tenantId: string; usuario: UsuarioDoCampo; osId: string; png: Blob; nomeAssinante: string }): Promise<AssinaturaOS> => {
  try {
    const caminho = caminhoDaAssinaturaOS(p.tenantId, p.osId, Date.now());
    const destino = storageRef(storage, caminho);
    await uploadBytes(destino, p.png, { contentType: 'image/png', cacheControl: 'private, max-age=31536000' });
    const url = await getDownloadURL(destino);
    const assinatura: AssinaturaOS = { caminho, url, em: new Date().toISOString(), por: p.usuario.nome, nomeAssinante: p.nomeAssinante.trim() };
    await updateDoc(doc(db, 'ordens_de_servico', p.osId), {
      assinaturaCliente: assinatura,
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
    });
    return assinatura;
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível guardar a assinatura. Tente de novo.');
  }
};

// ---------------------------------------------------------------------------
// Concluir atendimento -> Aguardando conferencia
// ---------------------------------------------------------------------------

export const concluirAtendimento = async (p: { tenantId: string; usuario: UsuarioDoCampo; osId: string }): Promise<void> => {
  try {
    let numeroOS = '';
    await runTransaction(db, async (transaction) => {
      const osRef = doc(db, 'ordens_de_servico', p.osId);
      const snap = await transaction.get(osRef);
      if (!snap.exists()) throw new Error('Esta OS não existe mais.');
      const atual = snap.data();
      if (atual.tenantId !== p.tenantId) throw new Error('Esta OS é de outra empresa.');
      if (osEncerrada(atual.status)) throw new Error(`Esta OS já está ${String(atual.status).toLowerCase()}.`);
      numeroOS = String(atual.numeroOS || '');
      transaction.update(osRef, {
        status: STATUS_OS_AGUARDANDO_CONFERENCIA,
        statusColor: CORES_STATUS_OS_CAMPO[STATUS_OS_AGUARDANDO_CONFERENCIA],
        horaSaida: atual.horaSaida || horaAgora(),
        'atendimentoCampo.fim': new Date().toISOString(),
        'atendimentoCampo.concluidoPor': p.usuario.id,
        ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
      });
    });
    createAuditLog({
      tenantId: p.tenantId,
      usuarioId: p.usuario.id,
      usuarioEmail: p.usuario.email,
      modulo: 'Ordens de Serviço',
      acao: 'Concluir atendimento no campo',
      descricao: `OS #${numeroOS} concluída pelo técnico no app; aguardando conferência da oficina`,
      registroRelacionadoId: p.osId,
      status: 'sucesso',
    });
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível concluir o atendimento. Tente de novo.');
  }
};
