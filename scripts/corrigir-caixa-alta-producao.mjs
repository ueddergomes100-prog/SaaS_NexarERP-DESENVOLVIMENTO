#!/usr/bin/env node
/**
 * Corrige, em PRODUCAO, texto que foi gravado sem caixa alta antes da
 * correcao de 2026-09-23 (aplicarCaixaAltaCadastro, ver
 * src/utils/textoCadastroDomain.ts). NAO roda a partir do dev/CI deste
 * projeto -- e' deliberadamente um script a parte, que voce roda manualmente
 * com a credencial de PRODUCAO, porque este repositorio nunca conecta em
 * producao sozinho (ver CLAUDE.md, secao 5).
 *
 * -----------------------------------------------------------------------
 * COMO RODAR
 * -----------------------------------------------------------------------
 *
 * 1. Credencial: baixe (ou reaproveite) a service account de PRODUCAO
 *    (projeto nexus-erp-2026) -- a mesma que o backend usa na Hostinger
 *    (FIREBASE_SERVICE_ACCOUNT_BASE64 no server/.env de producao, ou
 *    Firebase Console > Configuracoes do projeto > Contas de servico >
 *    Gerar nova chave privada). Salve o JSON num arquivo, por exemplo
 *    em C:\chaves\nexus-erp-2026-producao.json -- NUNCA commite esse
 *    arquivo no git.
 *
 * 2. Instale a dependencia (uma vez so, dentro da pasta do projeto):
 *      npm install firebase-admin --no-save
 *
 * 3. Ache o tenantId da empresa (se ainda nao souber):
 *      node scripts/corrigir-caixa-alta-producao.mjs --buscar-empresa="Sol Natus" --credencial="C:\chaves\nexus-erp-2026-producao.json"
 *
 * 4. Rode em MODO TESTE primeiro (NAO grava nada, so mostra o que mudaria):
 *      node scripts/corrigir-caixa-alta-producao.mjs --tenant-id=<ID> --credencial="C:\chaves\nexus-erp-2026-producao.json"
 *
 * 5. Confira a lista. Se estiver certo, aplique de verdade:
 *      node scripts/corrigir-caixa-alta-producao.mjs --tenant-id=<ID> --credencial="C:\chaves\nexus-erp-2026-producao.json" --aplicar
 *
 * -----------------------------------------------------------------------
 * O QUE ELE FAZ
 * -----------------------------------------------------------------------
 *
 * So mexe em `pedidos_venda.vendedorNome` do tenant informado -- nada mais
 * (escopo pedido: "so Pedidos de Venda"). Pra cada pedido cujo
 * `vendedorNome` (aparado e maiusculizado) for DIFERENTE do valor gravado,
 * grava a versao maiuscula. Nunca cria nem apaga pedido, nunca mexe em
 * outro campo, nunca mexe em outro tenant.
 *
 * Idempotente: rodar duas vezes nao faz mal -- na segunda vez a lista vem
 * vazia, porque tudo ja esta maiusculo.
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [chave, ...resto] = arg.replace(/^--/, '').split('=');
    return [chave, resto.join('=') || 'true'];
  }),
);

if (!args['credencial']) {
  console.error('Falta --credencial="caminho\\para\\service-account.json" (a chave de PRODUCAO, projeto nexus-erp-2026).');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(args['credencial'], 'utf8'));

if (serviceAccount.project_id !== 'nexus-erp-2026') {
  console.error(`ATENCAO: a credencial informada e' do projeto "${serviceAccount.project_id}", nao "nexus-erp-2026" (producao). Script encerrado por seguranca -- confira se pegou a chave certa.`);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const normalizarMaiuscula = (valor) => String(valor ?? '').trim().toUpperCase();

const buscarEmpresa = async (termo) => {
  const termoNormalizado = termo.toLowerCase();
  console.log(`Procurando empresas com nome parecido com "${termo}"...\n`);
  const snap = await db.collection('usuarios').where('role', 'in', ['Master', 'Admin']).get();
  const achados = [];
  snap.forEach((doc) => {
    const dados = doc.data();
    const nome = String(dados.nome || dados.nomeResponsavel || '');
    if (nome.toLowerCase().includes(termoNormalizado)) {
      achados.push({ tenantId: doc.id, nome, role: dados.role });
    }
  });
  if (achados.length === 0) {
    console.log('Nada encontrado com esse termo. Confira a grafia ou peca o tenantId direto pro dono do sistema.');
    return;
  }
  achados.forEach((item) => {
    console.log(`  tenantId: ${item.tenantId}   |   ${item.role}: ${item.nome}`);
  });
  console.log('\nUse o tenantId certo com --tenant-id=<ID> pra rodar a correcao.');
};

const corrigirVendedorNome = async (tenantId, aplicar) => {
  console.log(`Lendo pedidos_venda do tenant ${tenantId}...\n`);
  const snap = await db.collection('pedidos_venda').where('tenantId', '==', tenantId).get();

  const candidatos = [];
  snap.forEach((doc) => {
    const dados = doc.data();
    const atual = dados.vendedorNome;
    if (typeof atual !== 'string' || !atual.trim()) return;
    const correto = normalizarMaiuscula(atual);
    if (correto !== atual) {
      candidatos.push({ id: doc.id, numeroPedido: dados.numeroPedido || '?', atual, correto });
    }
  });

  if (candidatos.length === 0) {
    console.log('Nenhum pedido com vendedorNome fora da caixa alta. Nada a fazer.');
    return;
  }

  console.log(`${candidatos.length} pedido(s) com vendedorNome fora do padrao:\n`);
  candidatos.forEach((item) => {
    console.log(`  #${item.numeroPedido}  "${item.atual}"  ->  "${item.correto}"`);
  });

  if (!aplicar) {
    console.log('\nMODO TESTE -- nada foi gravado. Rode de novo com --aplicar pra gravar de verdade.');
    return;
  }

  console.log('\nGravando...');
  const LOTE = 400; // limite do Firestore e' 500 por batch; 400 da folga.
  for (let inicio = 0; inicio < candidatos.length; inicio += LOTE) {
    const fatia = candidatos.slice(inicio, inicio + LOTE);
    const batch = db.batch();
    fatia.forEach((item) => {
      batch.update(db.collection('pedidos_venda').doc(item.id), { vendedorNome: item.correto });
    });
    await batch.commit();
    console.log(`  ${Math.min(inicio + LOTE, candidatos.length)}/${candidatos.length} gravados.`);
  }
  console.log('\nPronto.');
};

const principal = async () => {
  if (args['buscar-empresa']) {
    await buscarEmpresa(args['buscar-empresa']);
    return;
  }
  if (args['tenant-id']) {
    await corrigirVendedorNome(args['tenant-id'], args['aplicar'] === 'true');
    return;
  }
  console.error('Use --buscar-empresa="nome" pra achar o tenantId, ou --tenant-id=<ID> pra rodar a correcao. Veja os comentarios no topo do arquivo.');
  process.exit(1);
};

principal().then(() => process.exit(0)).catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});
