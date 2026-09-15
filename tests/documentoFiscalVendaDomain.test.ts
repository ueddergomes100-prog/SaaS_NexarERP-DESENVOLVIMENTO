import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declarouDocumentosFiscais,
  resolveDocumentoFiscalVenda,
  rotaEmissaoNFe,
  rotuloAcaoFiscalVenda,
} from '../src/utils/documentoFiscalVendaDomain';

test('empresa que nao controla fiscal nao recebe documento nenhum', () => {
  assert.equal(resolveDocumentoFiscalVenda(false, { emiteNFe: true }), 'nenhum');
  assert.equal(resolveDocumentoFiscalVenda(false, { emiteNFCe: true }), 'nenhum');
  assert.equal(resolveDocumentoFiscalVenda(false, {}), 'nenhum');
});

test('LEGADO: quem nunca marcou nada continua com NFC-e', () => {
  // Os campos nasceram `false` e nunca governaram nada. Ler ao pe da letra
  // sumiria com o cupom de quem emite todo dia.
  assert.equal(resolveDocumentoFiscalVenda(true, {}), 'nfce');
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFe: false, emiteNFCe: false, emiteNFSe: false }), 'nfce');
  assert.equal(resolveDocumentoFiscalVenda(true, null), 'nfce');
  assert.equal(resolveDocumentoFiscalVenda(true, undefined), 'nfce');
});

test('so NF-e marcada troca o fim da venda para NF-e', () => {
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFe: true }), 'nfe');
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFe: true, emiteNFCe: false }), 'nfe');
});

test('NFC-e vence NF-e quando as duas estao marcadas', () => {
  // Cupom e o documento do balcao; NF-e desse publico e excecao caso a caso.
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFe: true, emiteNFCe: true }), 'nfce');
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFCe: true }), 'nfce');
});

test('so NFS-e nao oferece documento no pedido de venda de produto', () => {
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFSe: true }), 'nenhum');
});

test('NFS-e marcada ja conta como empresa que declarou os documentos', () => {
  // Isso importa: quem marcou so NFS-e escolheu, e nao pode cair no legado
  // e voltar a receber cupom.
  assert.equal(declarouDocumentosFiscais({ emiteNFSe: true }), true);
  assert.equal(declarouDocumentosFiscais({}), false);
  assert.equal(declarouDocumentosFiscais({ emiteNFe: false }), false);
});

test('so `true` conta como marcado -- string nao liga documento', () => {
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFe: 'sim' }), 'nfce');
  assert.equal(resolveDocumentoFiscalVenda(true, { emiteNFe: 1 }), 'nfce');
});

test('rotulo do botao acompanha o documento', () => {
  assert.equal(rotuloAcaoFiscalVenda('nfce'), 'Emitir Cupom Fiscal (NFC-e)');
  assert.equal(rotuloAcaoFiscalVenda('nfe'), 'Emitir NF-e');
  assert.equal(rotuloAcaoFiscalVenda('nenhum'), 'Imprimir Recibo');
});

test('rota da NF-e leva o pedido escapado na query string', () => {
  assert.equal(rotaEmissaoNFe('abc123'), '/fiscal/nfe?pedido=abc123');
  assert.equal(rotaEmissaoNFe('a/b c'), '/fiscal/nfe?pedido=a%2Fb%20c');
});
