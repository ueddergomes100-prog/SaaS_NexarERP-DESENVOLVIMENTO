/*
 * NF-e DE TRANSFERENCIA ENTRE FILIAIS (Filiais, fase 4 -- 2026-10-06).
 *
 * Regras e montagem em src/utils/notaTransferenciaDomain.ts (compilado em
 * server/domain), com o MESMO item fiscal das telas (notaFiscalItemDomain).
 * Aqui so': ler o banco, chamar a Spedy (com a chave da filial que envia) e
 * gravar a nota em `notas_fiscais` (finalidade "transferencia", sem
 * `pedidoId` -- as telas de venda leem esse campo como "a nota do pedido").
 *
 * A transferencia guarda um espelho da nota em `notaFiscal` (status, numero,
 * chave): a filial de destino nao le as notas da origem (firestore.rules), e
 * e' por esse espelho que ela acompanha a nota. Quem atualiza: este modulo e
 * o webhook da Spedy (routes/spedyWebhook.routes.js).
 */
const { db, admin } = require('../config/firebase');
const nota = require('../domain/notaTransferenciaDomain');
const { DEFAULT_REGIME_TRIBUTARIO } = require('../domain/fiscalDomain');
const { BASE_URLS, loadSpedyConfig } = require('./spedyAcesso');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');
const { ErroTransferencia } = require('./erroTransferencia');

const REGIMES = ['simples_nacional', 'lucro_presumido', 'lucro_real'];
const regimeDaConfig = (config) => (REGIMES.includes(config.regimeTributario) ? config.regimeTributario : DEFAULT_REGIME_TRIBUTARIO);
const rotulo = (codigo, nome) => `${codigo} · ${nome}`;
const agora = () => admin.firestore.FieldValue.serverTimestamp();

const lerConfig = async (tenantId) => {
  const snap = await db.collection('configuracoes').doc(tenantId).get();
  return snap.exists ? snap.data() : {};
};

/** Chave da Spedy da filial que envia; sem ela, mensagem dizendo o que fazer. */
const spedyDaOrigem = async (tenantId, rotuloOrigem) => {
  try {
    return await loadSpedyConfig(tenantId);
  } catch {
    throw new ErroTransferencia(400, `A filial ${rotuloOrigem} ainda não emite nota fiscal pela Spedy. Entre nela e configure a emissão em Configurações, ou use a transferência sem nota.`);
  }
};

/** Itens da transferencia no formato da nota. */
const itensParaNota = (itens) => (itens || []).map((i) => ({
  produtoIdOrigem: String(i.produtoIdOrigem || ''),
  codigo: String(i.codigo || ''),
  nome: String(i.nome || ''),
  unidade: String(i.unidade || ''),
  quantidade: Number(i.quantidade) || 0,
  custoUnitario: Number(i.custoUnitario) || 0,
}));

/** Monta a nota (sem enviar), lendo as configuracoes e o cadastro dos produtos na origem. */
const prepararNota = async ({ tenantOrigem, tenantDestino, rotuloOrigem, rotuloDestino, itens }) => {
  const [configOrigem, configDestino] = await Promise.all([lerConfig(tenantOrigem), lerConfig(tenantDestino)]);
  const ids = [...new Set(itens.map((i) => i.produtoIdOrigem).filter(Boolean))];
  const snaps = await Promise.all(ids.map((id) => db.collection('estoque').doc(id).get()));
  const produtos = {};
  snaps.forEach((s) => { if (s.exists && s.data().tenantId === tenantOrigem) produtos[s.id] = s.data(); });
  const regime = regimeDaConfig(configOrigem);
  const tributacao = nota.parseTributacaoTransferencia(configOrigem.transferenciaNfeTributacao);
  const preparo = nota.prepararNotaTransferencia({
    itens, produtos, configOrigem, configDestino, rotuloOrigem, rotuloDestino, regime, tributacao,
  });
  return { preparo, regime, tributacao };
};

/**
 * Envia a nota de uma transferencia JA' RESERVADA (notaFiscal.status =
 * 'reservada', gravado pelo chamador numa transacao).
 * @returns {Promise<{ ok: true, nota: object, avisos: string[] } | { ok: false, motivo: 'nao_emitida' | 'falha_envio', mensagem: string }>}
 */
const enviarNota = async ({ id, user, nomeUsuario }) => {
  const ref = db.collection('transferencias').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new ErroTransferencia(404, 'Transferência não encontrada.');
  const t = snap.data();
  const anterior = t.notaFiscal || {};
  const rotuloOrigem = rotulo(t.origemCodigo, t.origemNome);
  const rotuloDestino = rotulo(t.destinoCodigo, t.destinoNome);
  const tentativa = Number(anterior.tentativa) || 1;
  const integrationId = tentativa === 1 ? `transf-${id}` : `transf-${id}-t${tentativa}`;
  const marcar = (status, mensagem) => ref.update({
    notaFiscal: { ...anterior, status, mensagem: String(mensagem || '').slice(0, 500), integrationId, reservadoEmMs: null },
    historico: [...(t.historico || []), { acao: status === 'falha_envio' ? 'nota sem confirmação da Spedy' : 'nota não emitida', em: new Date().toISOString(), por: nomeUsuario }],
  });

  const { preparo, regime, tributacao } = await prepararNota({
    tenantOrigem: t.tenantOrigem, tenantDestino: t.tenantDestino, rotuloOrigem, rotuloDestino, itens: itensParaNota(t.itens),
  });
  if (!preparo.ok) {
    const mensagem = preparo.erros.join(' ');
    await marcar('nao_emitida', mensagem);
    return { ok: false, motivo: 'nao_emitida', mensagem };
  }

  let apiKey;
  let baseUrl;
  try {
    ({ apiKey, baseUrl } = await spedyDaOrigem(t.tenantOrigem, rotuloOrigem));
  } catch (erro) {
    await marcar('nao_emitida', erro.message);
    return { ok: false, motivo: 'nao_emitida', mensagem: erro.message };
  }

  const payload = nota.montarPayloadTransferencia({
    integrationId, preparo, regime, tributacao, numeroTransferencia: t.numeroTransferencia, rotuloOrigem, rotuloDestino,
  });

  let resposta;
  let corpo;
  try {
    resposta = await fetchComTimeout(`${baseUrl}/product-invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(payload),
    }, PERFIS.spedyEmissao);
    corpo = await resposta.json().catch(() => ({}));
  } catch (erroRede) {
    // Sem resposta: a nota PODE ter sido criada. A nova tentativa usa o mesmo
    // integrationId (tentativa nao sobe), e a Spedy nao duplica.
    const mensagem = erroRede.message || 'A Spedy não respondeu.';
    await marcar('falha_envio', mensagem);
    return { ok: false, motivo: 'falha_envio', mensagem };
  }
  if (!resposta.ok) {
    const mensagem = corpo.errors?.[0]?.message || corpo.error || corpo.message || 'A Spedy recusou a nota de transferência.';
    await marcar('nao_emitida', mensagem);
    return { ok: false, motivo: 'nao_emitida', mensagem };
  }

  // A partir daqui a nota EXISTE na Spedy: falha ao gravar nao pode virar "nao emitida".
  try {
    const nova = db.collection('notas_fiscais').doc();
    const status = corpo.status || 'enqueued';
    await nova.set({
      spedyId: corpo.id,
      number: corpo.number ?? null,
      accessKey: corpo.accessKey || null,
      tipo: 'NF-e',
      finalidade: 'transferencia',
      transferenciaId: id,
      numeroTransferencia: t.numeroTransferencia,
      clienteNome: String(preparo.receiver.name || ''),
      clienteId: null,
      valor: preparo.valorTotal,
      itensFiscais: preparo.itens,
      status,
      processingMessage: corpo.processingDetail?.message || null,
      processingCode: corpo.processingDetail?.code || null,
      integrationId,
      tentativaEmissao: tentativa,
      tenantId: t.tenantOrigem,
      createdAt: agora(),
      data: new Date().toISOString(),
      criadoPor: user.uid,
      criadoEm: agora(),
      alteradoPor: user.uid,
      alteradoEm: agora(),
    });
    const notaFiscal = {
      status,
      notaId: nova.id,
      spedyId: corpo.id,
      number: corpo.number ?? null,
      accessKey: corpo.accessKey || null,
      mensagem: corpo.processingDetail?.message || '',
      tentativa,
      integrationId,
      cfops: preparo.cfops,
      cfopsEntrada: preparo.cfopsEntrada,
      tributacao,
      reservadoEmMs: null,
    };
    await ref.update({
      notaFiscal,
      historico: [...(t.historico || []), { acao: 'nota enviada para a SEFAZ', em: new Date().toISOString(), por: nomeUsuario }],
    });
    return { ok: true, nota: notaFiscal, avisos: preparo.avisos };
  } catch (erroGravacao) {
    console.error('[Transferencia NF-e] nota enviada, mas falhou ao gravar:', erroGravacao);
    throw new ErroTransferencia(500, 'A Spedy recebeu a nota de transferência, mas o sistema não conseguiu guardá-la. Não emita de novo: avise o suporte para conferirmos a nota no painel da Spedy.');
  }
};

/** Copia a situacao da nota para o espelho na transferencia (webhook e consultas). */
const espelharNaTransferencia = async (transferenciaId, dadosNota) => {
  if (!transferenciaId) return;
  await db.collection('transferencias').doc(transferenciaId).update({
    'notaFiscal.status': dadosNota.status,
    'notaFiscal.number': dadosNota.number ?? null,
    'notaFiscal.accessKey': dadosNota.accessKey || null,
    'notaFiscal.mensagem': String(dadosNota.processingMessage || '').slice(0, 500),
  });
};

const STATUS_FINAIS = ['authorized', 'rejected', 'denied', 'canceled'];

/**
 * Consulta a Spedy e atualiza a nota da transferencia (nota local + espelho).
 * Melhor esforco: sem resposta, devolve o que ja' estava gravado.
 */
const atualizarSituacaoDaNota = async (transferencia) => {
  const notaId = transferencia?.notaFiscal?.notaId;
  if (!notaId) return transferencia?.notaFiscal || null;
  const notaRef = db.collection('notas_fiscais').doc(notaId);
  const notaSnap = await notaRef.get();
  if (!notaSnap.exists) return transferencia.notaFiscal;
  const local = notaSnap.data();
  if (STATUS_FINAIS.includes(local.status) && transferencia.notaFiscal.status === local.status) return transferencia.notaFiscal;
  let atual = local;
  if (!STATUS_FINAIS.includes(local.status) && local.spedyId) {
    try {
      const config = await lerConfig(local.tenantId);
      const { apiKey } = await loadSpedyConfig(local.tenantId);
      const env = config.spedyEnvironment === 'production' ? 'production' : 'sandbox';
      const resposta = await fetchComTimeout(`${BASE_URLS[env]}/product-invoices/${encodeURIComponent(local.spedyId)}`, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      }, PERFIS.spedyLeitura);
      if (resposta.ok) {
        const fresca = await resposta.json();
        atual = {
          ...local,
          status: fresca.status || local.status,
          number: fresca.number ?? local.number ?? null,
          accessKey: fresca.accessKey || local.accessKey || null,
          processingMessage: fresca.processingDetail?.message || null,
        };
        await notaRef.update({
          status: atual.status,
          number: atual.number,
          accessKey: atual.accessKey,
          processingMessage: atual.processingMessage,
          processingCode: fresca.processingDetail?.code || null,
          updatedAt: agora(),
        });
      }
    } catch (erro) {
      console.warn('[Transferencia NF-e] não consultou a situação da nota:', erro.message);
    }
  }
  await espelharNaTransferencia(transferencia.id, atual);
  return { ...transferencia.notaFiscal, status: atual.status, number: atual.number ?? null, accessKey: atual.accessKey || null };
};

module.exports = {
  prepararNota,
  itensParaNota,
  enviarNota,
  espelharNaTransferencia,
  atualizarSituacaoDaNota,
  spedyDaOrigem,
  rotulo,
};
