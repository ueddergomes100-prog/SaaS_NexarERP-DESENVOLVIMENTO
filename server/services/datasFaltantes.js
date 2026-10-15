/**
 * PREENCHER AS DATAS QUE FALTAM (decisao do dono, 2026-10-14).
 *
 * A regra de cada documento mora em server/utils/datasFaltantesDomain.js; este
 * servico percorre as colecoes e grava em lotes. Usado por dois caminhos, que
 * por isso nunca podem divergir:
 *  - o script server/scripts/preencher-datas-faltantes.js (linha de comando,
 *    com as credenciais da maquina onde roda -- no PC, so' o dev);
 *  - a rota POST /api/manutencao/datas-faltantes (botao do Painel da
 *    Plataforma), que roda no backend do proprio ambiente. Foi criada em
 *    15/10/2026 porque a producao nao tem um terminal com as credenciais dela:
 *    o backend de producao e' o unico lugar com acesso ao banco de producao.
 *
 * Cada campo preenchido ganha a marca `<campo>PreenchidaPorMigracao: true`,
 * para o modo desfazer saber exatamente o que voltar. Rodar de novo e' seguro:
 * documento que ja' tem a data e' contado como "ok" e nao muda.
 */
const { decidirDataVenda, decidirDataDoLancamento } = require('../utils/datasFaltantesDomain');

const ESCRITAS_POR_LOTE = 400;
/** Quantos itens de cada lista voltam detalhados (o total vem sempre). */
const LIMITE_LISTA = 50;

const marca = (campo) => `${campo}PreenchidaPorMigracao`;

const COLECOES = [
  { nome: 'pedidos_venda', campo: 'dataVenda', decidir: decidirDataVenda, rotulo: (d) => `pedido #${d.numeroPedido || '?'}` },
  { nome: 'transacoes', campo: 'dataPagamento', decidir: decidirDataDoLancamento, rotulo: (d) => `lançamento "${String(d.descricao || '?').slice(0, 50)}"` },
];

const processarColecao = async ({ db, apagar }, { nome, campo, decidir, rotulo }, { tenantId, aplicar, desfazer }) => {
  let consulta = db.collection(nome);
  if (tenantId) consulta = consulta.where('tenantId', '==', tenantId);
  if (desfazer) consulta = consulta.where(marca(campo), '==', true);
  const snap = await consulta.get();

  const resumo = { lidos: snap.size, ok: 0, alterados: 0, semData: [], pendentesSemVencimento: [] };
  let lote = db.batch();
  let noLote = 0;
  const gravarLote = async () => {
    if (noLote === 0) return;
    if (aplicar) await lote.commit();
    lote = db.batch();
    noLote = 0;
  };

  for (const doc of snap.docs) {
    const dados = doc.data();
    const quem = `${dados.tenantId || '?'} / ${rotulo(dados)} (${doc.id})`;
    if (desfazer) {
      lote.update(doc.ref, { [campo]: apagar(), [marca(campo)]: apagar() });
    } else {
      const decisao = decidir(dados);
      if (decisao.acao === 'ok') { resumo.ok += 1; continue; }
      if (decisao.acao === 'sem_data') { resumo.semData.push(quem); continue; }
      if (decisao.acao === 'pendente_sem_vencimento') { resumo.pendentesSemVencimento.push(quem); continue; }
      lote.update(doc.ref, { [decisao.campo]: decisao.valor, [marca(decisao.campo)]: true });
    }
    resumo.alterados += 1;
    noLote += 1;
    if (noLote >= ESCRITAS_POR_LOTE) await gravarLote();
  }
  await gravarLote();
  return resumo;
};

/**
 * Percorre as colecoes. Sem `aplicar`, so' conta o que faria (nada e' gravado).
 * `apagar` e' o FieldValue.delete() do Admin SDK (so' o desfazer usa).
 * Devolve, por colecao: lidos, ok (ja' tinham), alterados, e as listas
 * semData / pendentesSemVencimento (ate' LIMITE_LISTA itens + o total).
 */
const preencherDatasFaltantes = async ({ db, apagar, tenantId = '', aplicar = false, desfazer = false }) => {
  const colecoes = [];
  for (const colecao of COLECOES) {
    const resumo = await processarColecao({ db, apagar }, colecao, { tenantId, aplicar, desfazer });
    colecoes.push({
      nome: colecao.nome,
      campo: colecao.campo,
      lidos: resumo.lidos,
      ok: resumo.ok,
      alterados: resumo.alterados,
      totalSemData: resumo.semData.length,
      semData: resumo.semData.slice(0, LIMITE_LISTA),
      totalPendentesSemVencimento: resumo.pendentesSemVencimento.length,
      pendentesSemVencimento: resumo.pendentesSemVencimento.slice(0, LIMITE_LISTA),
    });
  }
  return { tenantId: tenantId || null, aplicar, desfazer, colecoes };
};

module.exports = { preencherDatasFaltantes, marca, COLECOES, LIMITE_LISTA };
