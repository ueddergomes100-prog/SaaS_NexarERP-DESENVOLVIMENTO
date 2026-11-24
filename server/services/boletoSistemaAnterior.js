/*
 * BOLETOS DO SISTEMA ANTERIOR (24/11/2026, Embala Minas).
 *
 * Liga as contas a receber da migracao ao boleto que o sistema antigo ja'
 * registrou no banco, para o arquivo de retorno dar baixa nelas. Regra em
 * src/utils/boletoSistemaAnteriorDomain.ts (copiada para server/domain).
 *
 * So' mexe no titulo: grava o boleto (nosso numero, "Em remessa", marca de
 * sistema anterior), a forma "Boleto" e o banco. Valor, vencimento, saldo do
 * banco, caixa e estoque ficam como estao. Repetir a mesma planilha nao muda
 * nada (o que ja' esta' vinculado e' contado como "ja' vinculado").
 */
const { db } = require('../config/firebase');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const {
  lerPedidoDeVinculo,
  erroDoDigitoDoNossoNumero,
  planejarVinculo,
} = require('../domain/boletoSistemaAnteriorDomain');
const { ErroBaixa, agora } = require('./baixaFinanceira');

const LOTE_IN = 30;
const LOTE_GRAVACAO = 400;

const emLotes = (lista, tamanho) => {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
};

/** Documentos de `transacoes` da empresa cujo `campo` esta' em `valores` (em lotes do "in"). */
const buscarPor = async (tenantId, campo, valores) => {
  const achados = [];
  for (const lote of emLotes(valores, LOTE_IN)) {
    const snap = await db.collection('transacoes').where('tenantId', '==', tenantId).where(campo, 'in', lote).get();
    snap.docs.forEach((d) => achados.push({ id: d.id, ref: d.ref, ...d.data() }));
  }
  return achados;
};

/**
 * POST /api/financeiro/boleto/sistema-anterior
 *   { bancoId, boletos: [{ chave, nossoNumero, vencimento, emissao?, valorBoletoCentavos, arquivoRemessa? }] }
 */
const vincularBoletosAnteriores = async ({ user, tenantId, corpo, hoje }) => {
  const pedido = lerPedidoDeVinculo(corpo);
  if ('erro' in pedido) throw new ErroBaixa(400, pedido.erro);

  const bancoSnap = await db.collection('bancos').doc(pedido.bancoId).get();
  const banco = bancoSnap.exists ? bancoSnap.data() : null;
  if (!banco || banco.tenantId !== tenantId) {
    throw new ErroBaixa(400, 'Banco não encontrado. Confira o cadastro de bancos e tente de novo.');
  }
  const nomeDoBanco = String(banco.nome || 'escolhido');
  if (!banco.boleto || !banco.boleto.ativo || !banco.agencia) {
    throw new ErroBaixa(400, `O banco ${nomeDoBanco} não está preparado para boleto. Abra Cadastros Auxiliares → Bancos e complete a configuração de boleto dele.`);
  }
  const convenio = {
    cooperativa: String(banco.agencia || ''),
    conta: String(banco.conta || ''),
    contaDv: String(banco.boleto.contaDv || ''),
    ...(banco.boleto.codigoCliente ? { codigoCliente: String(banco.boleto.codigoCliente) } : {}),
  };

  const recusados = [];
  const avisos = [];
  const validos = [];
  for (const b of pedido.boletos) {
    const erro = erroDoDigitoDoNossoNumero(b.nossoNumero, convenio, nomeDoBanco);
    if (erro) recusados.push({ chave: b.chave, motivo: erro });
    else validos.push(b);
  }

  // Todas as leituras antes de qualquer gravacao.
  const titulos = await buscarPor(tenantId, 'chaveImportacao', validos.map((b) => b.chave));
  const comONumero = await buscarPor(tenantId, 'boleto.nossoNumero', validos.map((b) => b.nossoNumero));
  const tituloDaChave = new Map();
  titulos.forEach((t) => {
    // Chave repetida em duas contas (importada duas vezes por outro caminho): nao adivinha.
    tituloDaChave.set(t.chaveImportacao, tituloDaChave.has(t.chaveImportacao) ? 'repetida' : t);
  });
  const donoDoNumero = new Map(comONumero.map((t) => [t.boleto && t.boleto.nossoNumero, t]));

  const gravacoes = [];
  let jaVinculados = 0;
  let jaPagos = 0;
  for (const b of validos) {
    const titulo = tituloDaChave.get(b.chave);
    if (titulo === 'repetida') {
      recusados.push({ chave: b.chave, motivo: `A chave ${b.chave} está em mais de uma conta a receber. Confira em Contas a Receber qual é a certa.` });
      continue;
    }
    const plano = planejarVinculo(b, titulo || null, donoDoNumero.get(b.nossoNumero) || null, hoje);
    if (plano.acao === 'ja_vinculado') { jaVinculados += 1; continue; }
    if (plano.acao === 'ja_pago') { jaPagos += 1; continue; }
    if (plano.acao === 'recusar') { recusados.push({ chave: b.chave, motivo: plano.motivo }); continue; }
    if (plano.aviso) avisos.push(plano.aviso);
    gravacoes.push({ titulo, boleto: plano.boleto, valorCentavos: Number(titulo.valorCentavos ?? Math.round(Number(titulo.valor || 0) * 100)) });
  }

  for (const lote of emLotes(gravacoes, LOTE_GRAVACAO)) {
    const batch = db.batch();
    lote.forEach((g) => {
      batch.update(g.titulo.ref, {
        boleto: g.boleto,
        formaPagamento: 'Boleto',
        bancoId: pedido.bancoId,
        bancoNome: nomeDoBanco,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Boleto do sistema anterior vinculado'),
      });
    });
    await batch.commit();
  }

  return {
    vinculados: gravacoes.length,
    totalCentavos: gravacoes.reduce((soma, g) => soma + g.valorCentavos, 0),
    jaVinculados,
    jaPagos,
    recusados,
    avisos,
    bancoNome: nomeDoBanco,
    idsVinculados: gravacoes.map((g) => g.titulo.id),
  };
};

module.exports = { vincularBoletosAnteriores };
