/*
 * ESPELHO DOS CADASTROS DO GRUPO (Filiais, fase 1 -- 2026-10-06).
 *
 * Clientes e o cadastro de produtos sao do grupo (decisao do dono), mas cada
 * filial e' uma empresa (tenant) com a sua copia -- ver
 * src/utils/cadastroGrupoDomain.ts. Este servico escuta, por grupo, as
 * colecoes espelhadas das filiais e, a cada documento criado ou alterado,
 * aplica o planejamento do dominio: cria a copia que falta, liga cadastro
 * igual (unidade UN, categoria...) e repete nas outras filiais o que mudou
 * no cadastro do grupo. Preco, custo e estoque nunca saem da filial.
 *
 * Por que escutar (e nao chamar a cada tela): cliente e produto nascem em
 * mais de 15 lugares (cadastro, cadastro rapido, importacao, entrada de nota,
 * app Vendas...). Escutando, todos ficam cobertos sem mexer em nenhum, e o
 * que mudou com o servidor fora do ar e' acertado quando ele volta (a
 * primeira leitura de cada colecao reprocessa tudo, sem regravar o que ja'
 * esta igual).
 *
 * Desligar (emergencia): ESPELHO_CADASTROS=desligado no ambiente.
 */
const { db, admin } = require('../config/firebase');
const espelho = require('../domain/cadastroGrupoDomain');
const { lerGrupo } = require('../domain/filialDomain');

const LIMITE_DO_LOTE = 400;
// Consulta "in" do Firestore aceita ate 30 valores.
const LIMITE_DE_FILIAIS = 30;

const estados = new Map();

const criarIndices = () => Object.fromEntries(espelho.COLECOES_ESPELHADAS.map((c) => [c, espelho.criarIndice()]));

/**
 * Processa um lote de documentos (criados/alterados) de uma colecao do grupo:
 * indexa, planeja em cima da versao mais nova de cada um e grava. Exportado
 * para os testes (que passam um `gravar` falso).
 */
const processarLote = async ({ grupo, colecao, indices, docs, gravar }) => {
  const indice = indices[colecao];
  docs.forEach((doc) => espelho.indexar(colecao, indice, doc));
  const contexto = {
    colecao,
    filiais: grupo.filiais.map((f) => f.tenantId),
    matrizTenantId: grupo.matrizTenantId,
    indice,
    unidadeNaFilial: (tenantId, sigla) => {
      const natural = espelho.chaveNatural('unidades_medida', { sigla });
      const unidade = natural ? indices.unidades_medida.porNatural.get(tenantId)?.get(natural) : null;
      return unidade ? unidade.id : null;
    },
  };
  const gravacoes = [];
  for (const doc of docs) {
    // A versao do indice ja' inclui o que foi planejado antes neste mesmo lote.
    const atual = indice.porId.get(doc.id);
    if (!atual) continue;
    const planejadas = espelho.planejarEspelho(contexto, atual);
    espelho.aplicarNoIndice(colecao, indice, planejadas);
    gravacoes.push(...planejadas);
  }
  if (gravacoes.length > 0) await gravar(colecao, gravacoes);
  return gravacoes;
};

const gravarNoFirestore = async (colecao, gravacoes) => {
  const agora = admin.firestore.FieldValue.serverTimestamp();
  for (let i = 0; i < gravacoes.length; i += LIMITE_DO_LOTE) {
    const parte = gravacoes.slice(i, i + LIMITE_DO_LOTE);
    const lote = db.batch();
    parte.forEach((g) => {
      const ref = db.collection(colecao).doc(g.id);
      if (g.tipo === 'criar') lote.set(ref, { ...g.campos, createdAt: agora });
      else lote.update(ref, g.campos);
    });
    try {
      await lote.commit();
    } catch (erro) {
      // Um documento apagado no meio derruba o lote inteiro: refaz um a um e
      // segue com os outros.
      console.error(`[Espelho] lote de ${colecao} falhou (${erro.message}); gravando um a um.`);
      for (const g of parte) {
        const ref = db.collection(colecao).doc(g.id);
        try {
          if (g.tipo === 'criar') await ref.set({ ...g.campos, createdAt: agora });
          else await ref.update(g.campos);
        } catch (erroDoItem) {
          console.error(`[Espelho] ${colecao}/${g.id} nao gravou: ${erroDoItem.message}`);
        }
      }
    }
  }
  console.log(`[Espelho] ${colecao}: ${gravacoes.length} gravação(ões).`);
};

const desligarGrupo = (grupoId) => {
  const estado = estados.get(grupoId);
  if (!estado) return;
  estado.cancelar.forEach((cancelar) => { try { cancelar(); } catch { /* ja' desligado */ } });
  estados.delete(grupoId);
};

const ligarGrupo = (grupoId, dados) => {
  const grupo = lerGrupo(grupoId, dados);
  const tenants = grupo.filiais.map((f) => f.tenantId).sort();
  const assinatura = tenants.join(',');
  const atual = estados.get(grupoId);
  if (atual && atual.assinatura === assinatura) {
    atual.grupo = grupo;
    return;
  }
  desligarGrupo(grupoId);
  if (tenants.length < 2) return;
  if (tenants.length > LIMITE_DE_FILIAIS) {
    console.error(`[Espelho] grupo ${grupo.nome} tem ${tenants.length} filiais; o espelho cobre ate ${LIMITE_DE_FILIAIS}.`);
    return;
  }

  const estado = { assinatura, grupo, indices: criarIndices(), cancelar: [], fila: Promise.resolve() };
  estados.set(grupoId, estado);
  console.log(`[Espelho] ligado para o grupo ${grupo.nome} (${tenants.length} filiais).`);

  // Uma colecao por vez, na ordem do dominio: as unidades precisam estar no
  // indice antes dos produtos (o produto da filial aponta para a unidade dela).
  let anterior = Promise.resolve();
  for (const colecao of espelho.COLECOES_ESPELHADAS) {
    anterior = anterior.then(() => new Promise((pronto) => {
      if (estados.get(grupoId) !== estado) { pronto(); return; }
      let primeiraLeitura = true;
      const cancelar = db.collection(colecao).where('tenantId', 'in', tenants).onSnapshot((snap) => {
        const docs = snap.docChanges()
          .filter((m) => m.type !== 'removed')
          .map((m) => ({ id: m.doc.id, tenantId: m.doc.data().tenantId, dados: m.doc.data() }));
        estado.fila = estado.fila
          .then(() => processarLote({ grupo: estado.grupo, colecao, indices: estado.indices, docs, gravar: gravarNoFirestore }))
          .catch((erro) => console.error(`[Espelho] ${grupo.nome}/${colecao}:`, erro))
          .finally(() => { if (primeiraLeitura) { primeiraLeitura = false; pronto(); } });
      }, (erro) => {
        console.error(`[Espelho] escuta de ${colecao} do grupo ${grupo.nome} caiu:`, erro.message);
        pronto();
      });
      estado.cancelar.push(cancelar);
    }));
  }
};

const iniciarEspelhoDosCadastros = () => {
  if (process.env.ESPELHO_CADASTROS === 'desligado') {
    console.log('[Espelho] desligado por ESPELHO_CADASTROS=desligado.');
    return () => {};
  }
  const cancelarGrupos = db.collection('grupos').onSnapshot((snap) => {
    snap.docChanges().forEach((m) => {
      if (m.type === 'removed') desligarGrupo(m.doc.id);
      else ligarGrupo(m.doc.id, m.doc.data());
    });
  }, (erro) => console.error('[Espelho] escuta dos grupos caiu:', erro.message));
  return () => {
    cancelarGrupos();
    [...estados.keys()].forEach(desligarGrupo);
  };
};

module.exports = { iniciarEspelhoDosCadastros, processarLote };
