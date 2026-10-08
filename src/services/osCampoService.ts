import { addDoc, arrayRemove, arrayUnion, collection, doc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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
import { NUMERO_OS_PROVISORIO, type Pendencia } from '../utils/offlineDomain';
import { adicionarPendencia, existePendencia, novoIdPendencia } from '../utils/filaOffline';

/*
 * OS NO CAMPO -- gravacao (maquinas pesadas, fase 3 -- 2026-10-08; offline na
 * fase 4, mesmo dia).
 *
 * Tudo que o app do tecnico escreve passa por aqui, em funcoes pequenas e
 * independentes de tela. Regras (firestore.rules): `ordens_de_servico` e
 * `veiculos` aceitam quem tem `mecanica.os`; a reserva mexe so' em
 * quantidade/quantidadeReservada do estoque (canAdjustStockQuantity).
 * Storage: empresas/{tenant}/os/{osId}.
 *
 * SEM SINAL (fase 4): o Firestore do app tem cache persistente, entao
 * set/update entram na fila do proprio SDK -- aqui eles NAO sao aguardados
 * quando offline (a promessa so' resolve quando o servidor confirma). O que
 * exige servidor (numero da OS, reserva de estoque) ou arquivo (foto,
 * assinatura) vira PENDENCIA em utils/filaOffline.ts, reproduzida por
 * sincronizacaoOfflineService.ts quando a rede volta. Ver offlineDomain.ts.
 *
 * O app NUNCA finaliza a OS: "Concluir atendimento" deixa em "Aguardando
 * conferencia" e a oficina fecha no desktop (pagamento, baixa, comissao).
 */

export interface UsuarioDoCampo {
  id: string;
  nome: string;
  email: string;
}

export const estaOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

const horaAgora = () => new Date().toTimeString().slice(0, 5);

/** Offline: nao espera a confirmacao do servidor (ficaria pendurado); o SDK guarda e envia depois. */
const gravar = async (promessa: Promise<unknown>): Promise<void> => {
  if (estaOnline()) { await promessa; return; }
  promessa.catch((erro) => console.error('Gravacao offline recusada ao sincronizar:', erro));
};

const novaPendencia = (p: { tenantId: string; usuarioId: string; osId: string }, resto: Omit<Pendencia, 'id' | 'tenantId' | 'usuarioId' | 'osId' | 'criadoEm' | 'tentativas' | 'ultimoErro' | 'ultimaTentativaEm'>): Pendencia => ({
  id: novoIdPendencia(),
  tenantId: p.tenantId,
  usuarioId: p.usuarioId,
  osId: p.osId,
  criadoEm: new Date().toISOString(),
  tentativas: 0,
  ultimoErro: '',
  ultimaTentativaEm: '',
  ...resto,
} as Pendencia);

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

export const abrirOsNoCampo = async (p: AbrirOsNoCampoParams): Promise<{ id: string; numeroOS: string; numeroProvisorio: boolean }> => {
  try {
    const osRef = doc(collection(db, 'ordens_de_servico'));
    const online = estaOnline();
    let numeroOS = NUMERO_OS_PROVISORIO;
    const documento = (numero: string) => ({
      ...montarNovaOsDeCampo({
        tenantId: p.tenantId,
        numeroOS: numero,
        tecnico: { id: p.usuario.id, nome: p.usuario.nome },
        cliente: p.cliente,
        equipamento: p.equipamento,
        reclamacao: p.reclamacao,
        data: getDateInputInTimeZone(),
        hora: horaAgora(),
      }),
      numeroProvisorio: numero === NUMERO_OS_PROVISORIO,
      reservaPendente: false,
      createdAt: serverTimestamp(),
      ...buildDocumentMetadata(p.usuario.id, serverTimestamp()),
    });

    if (online) {
      const maiorNumero = await getCurrentMaxSequence(db, 'ordens_de_servico', p.tenantId, 'numeroOS').catch(() => 0);
      await runTransaction(db, async (transaction) => {
        const proximo = await getNextTenantSequenceValue(transaction, db, p.tenantId, 'ordens_de_servico', maiorNumero);
        numeroOS = formatSequenceValue(proximo, 2);
        writeTenantSequenceValue(transaction, db, p.tenantId, 'ordens_de_servico', proximo);
        transaction.set(osRef, documento(numeroOS));
      });
    } else {
      // Sem servidor nao ha numero: a OS nasce "nº pendente" e a sincronizacao numera.
      await gravar(setDoc(osRef, documento(NUMERO_OS_PROVISORIO)));
      await adicionarPendencia(novaPendencia({ tenantId: p.tenantId, usuarioId: p.usuario.id, osId: osRef.id }, { tipo: 'numero_os' }));
    }

    if (p.salvarEquipamentoNoCadastro && p.cliente.id) {
      // Fora da transacao de proposito: falhar aqui nao pode derrubar a OS ja aberta.
      try {
        await gravar(addDoc(collection(db, 'veiculos'), {
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
        }));
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
      descricao: `OS ${numeroOS === NUMERO_OS_PROVISORIO ? '(nº pendente)' : `#${numeroOS}`} aberta pelo app do técnico para ${p.cliente.nome}${online ? '' : ' (sem conexão)'}`,
      registroRelacionadoId: osRef.id,
      status: 'sucesso',
    });
    return { id: osRef.id, numeroOS, numeroProvisorio: numeroOS === NUMERO_OS_PROVISORIO };
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
  /** Status conhecido pela tela (para a checagem offline, onde nao da para ler o servidor). */
  statusAtual?: string;
}

const camposDoAtendimento = (p: SalvarAtendimentoParams) => {
  const totalCentavos = totalDoAtendimentoCentavos(p.pecas, p.servicos);
  return {
    pecas: p.pecas,
    servicos: p.servicos,
    deslocamento: temDeslocamento(p.deslocamento) ? { ...p.deslocamento, km: kmDoDeslocamento(p.deslocamento) } : null,
    horimetro: p.horimetro,
    relatorioTecnico: p.relatorioTecnico,
    valorTotal: totalCentavos / 100,
    valorTotalCentavos: totalCentavos,
    'atendimentoCampo.ultimoEnvio': new Date().toISOString(),
    ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
  };
};

export const salvarAtendimento = async (p: SalvarAtendimentoParams): Promise<void> => {
  try {
    const osRef = doc(db, 'ordens_de_servico', p.osId);
    if (!estaOnline()) {
      if (osEncerrada(p.statusAtual)) throw new Error(`Esta OS já está ${String(p.statusAtual).toLowerCase()} e não pode ser alterada pelo app.`);
      const precisaReservar = p.momentoBaixaEstoque === 'pedido' && p.pecas.length > 0;
      await gravar(updateDoc(osRef, { ...camposDoAtendimento(p), reservaPendente: precisaReservar }));
      if (precisaReservar && !(await existePendencia(p.osId, 'reserva_os'))) {
        await adicionarPendencia(novaPendencia({ tenantId: p.tenantId, usuarioId: p.usuario.id, osId: p.osId }, { tipo: 'reserva_os' }));
      }
      return;
    }
    await runTransaction(db, async (transaction) => {
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
      transaction.update(osRef, { ...camposDoAtendimento(p), estoqueReservado, reservaPendente: false });
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

/** Foto ja' reduzida -> Storage + documento. Usada online e pela sincronizacao. */
export const enviarFotoReduzida = async (p: { tenantId: string; usuario: UsuarioDoCampo; osId: string; blob: Blob; legenda: string; indice: number }): Promise<FotoOS> => {
  const caminho = caminhoDaFotoOS(p.tenantId, p.osId, Date.now(), p.indice);
  const destino = storageRef(storage, caminho);
  await uploadBytes(destino, p.blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000' });
  const url = await getDownloadURL(destino);
  const foto: FotoOS = { caminho, url, legenda: p.legenda.trim(), em: new Date().toISOString(), por: p.usuario.nome };
  await updateDoc(doc(db, 'ordens_de_servico', p.osId), {
    fotos: arrayUnion(foto),
    ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
  });
  return foto;
};

/** Devolve a foto gravada, ou null quando ficou na fila do aparelho (sem conexao). */
export const adicionarFotoOs = async (p: AdicionarFotoParams): Promise<FotoOS | null> => {
  const cabe = podeAdicionarFotos(p.fotosAtuais, 1);
  if (!cabe.ok) throw new Error(cabe.erro);
  try {
    const reduzida = await comprimirImagem(p.arquivo, LADO_MAXIMO_FOTO_PX);
    if (reduzida.size > TAMANHO_MAXIMO_FOTO_BYTES) throw new Error('A foto ficou grande demais mesmo reduzida. Tire outra com menos zoom.');
    if (!estaOnline()) {
      await adicionarPendencia({
        ...novaPendencia({ tenantId: p.tenantId, usuarioId: p.usuario.id, osId: p.osId }, { tipo: 'foto', legenda: p.legenda.trim(), nomeArquivo: `foto-${Date.now()}.jpg` } as Omit<Pendencia, 'id' | 'tenantId' | 'usuarioId' | 'osId' | 'criadoEm' | 'tentativas' | 'ultimoErro' | 'ultimaTentativaEm'>),
        blob: reduzida,
      });
      return null;
    }
    return await enviarFotoReduzida({ tenantId: p.tenantId, usuario: p.usuario, osId: p.osId, blob: reduzida, legenda: p.legenda, indice: p.indice ?? p.fotosAtuais.length });
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível enviar a foto. Tente de novo.');
  }
};

export const removerFotoOs = async (p: { usuario: UsuarioDoCampo; osId: string; foto: FotoOS }): Promise<void> => {
  try {
    await gravar(updateDoc(doc(db, 'ordens_de_servico', p.osId), {
      fotos: arrayRemove(p.foto),
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
    }));
    // O arquivo sai depois do documento: se falhar, sobra um arquivo orfao, nunca uma foto fantasma na OS.
    if (estaOnline()) await deleteObject(storageRef(storage, p.foto.caminho)).catch(() => undefined);
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível apagar a foto. Tente de novo.');
  }
};

export const salvarLegendasDasFotos = async (p: { usuario: UsuarioDoCampo; osId: string; fotos: FotoOS[] }): Promise<void> => {
  try {
    await gravar(updateDoc(doc(db, 'ordens_de_servico', p.osId), {
      fotos: p.fotos,
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
    }));
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível salvar as legendas. Tente de novo.');
  }
};

// ---------------------------------------------------------------------------
// Assinatura do cliente
// ---------------------------------------------------------------------------

export const enviarAssinatura = async (p: { tenantId: string; usuario: UsuarioDoCampo; osId: string; png: Blob; nomeAssinante: string }): Promise<AssinaturaOS> => {
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
};

/** Devolve a assinatura gravada, ou null quando ficou na fila do aparelho (sem conexao). */
export const salvarAssinaturaOs = async (p: { tenantId: string; usuario: UsuarioDoCampo; osId: string; png: Blob; nomeAssinante: string }): Promise<AssinaturaOS | null> => {
  try {
    if (!estaOnline()) {
      await adicionarPendencia({
        ...novaPendencia({ tenantId: p.tenantId, usuarioId: p.usuario.id, osId: p.osId }, { tipo: 'assinatura', nomeAssinante: p.nomeAssinante.trim() } as Omit<Pendencia, 'id' | 'tenantId' | 'usuarioId' | 'osId' | 'criadoEm' | 'tentativas' | 'ultimoErro' | 'ultimaTentativaEm'>),
        blob: p.png,
      });
      return null;
    }
    return await enviarAssinatura(p);
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível guardar a assinatura. Tente de novo.');
  }
};

// ---------------------------------------------------------------------------
// Concluir atendimento -> Aguardando conferencia
// ---------------------------------------------------------------------------

export const concluirAtendimento = async (p: { tenantId: string; usuario: UsuarioDoCampo; osId: string; statusAtual?: string; numeroOS?: string }): Promise<void> => {
  try {
    const osRef = doc(db, 'ordens_de_servico', p.osId);
    let numeroOS = p.numeroOS || '';
    const mudanca = (horaSaidaAtual?: string) => ({
      status: STATUS_OS_AGUARDANDO_CONFERENCIA,
      statusColor: CORES_STATUS_OS_CAMPO[STATUS_OS_AGUARDANDO_CONFERENCIA],
      horaSaida: horaSaidaAtual || horaAgora(),
      'atendimentoCampo.fim': new Date().toISOString(),
      'atendimentoCampo.concluidoPor': p.usuario.id,
      ...buildDocumentUpdateMetadata(p.usuario.id, serverTimestamp()),
    });
    if (!estaOnline()) {
      if (osEncerrada(p.statusAtual)) throw new Error(`Esta OS já está ${String(p.statusAtual).toLowerCase()}.`);
      await gravar(updateDoc(osRef, mudanca()));
    } else {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(osRef);
        if (!snap.exists()) throw new Error('Esta OS não existe mais.');
        const atual = snap.data();
        if (atual.tenantId !== p.tenantId) throw new Error('Esta OS é de outra empresa.');
        if (osEncerrada(atual.status)) throw new Error(`Esta OS já está ${String(atual.status).toLowerCase()}.`);
        numeroOS = String(atual.numeroOS || '');
        transaction.update(osRef, mudanca(atual.horaSaida));
      });
    }
    createAuditLog({
      tenantId: p.tenantId,
      usuarioId: p.usuario.id,
      usuarioEmail: p.usuario.email,
      modulo: 'Ordens de Serviço',
      acao: 'Concluir atendimento no campo',
      descricao: `OS ${numeroOS && numeroOS !== NUMERO_OS_PROVISORIO ? `#${numeroOS}` : '(nº pendente)'} concluída pelo técnico no app; aguardando conferência da oficina`,
      registroRelacionadoId: p.osId,
      status: 'sucesso',
    });
  } catch (erro) {
    throw erroEmPortugues(erro, 'Não foi possível concluir o atendimento. Tente de novo.');
  }
};
