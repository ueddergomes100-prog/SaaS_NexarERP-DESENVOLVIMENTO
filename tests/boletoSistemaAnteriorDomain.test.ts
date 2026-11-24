import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  erroDoDigitoDoNossoNumero,
  lerPedidoDeVinculo,
  lerPlanilhaBoletosAnteriores,
  normalizarNossoNumeroAnterior,
  planejarVinculo,
} from '../src/utils/boletoSistemaAnteriorDomain';

/*
 * Boletos do sistema anterior (24/11/2026, Embala Minas): as contas da migracao
 * ganham o nosso numero do boleto que o sistema antigo registrou, para o retorno
 * do banco dar baixa nelas.
 */

// Convenio real da Embala Minas: cooperativa 3049, codigo do cliente 58049-0.
const EMBALA = { cooperativa: '3049', conta: '24424', contaDv: '4', codigoCliente: '580490' };

test('nosso numero: "3978-9" e 10 digitos viram a chave que o retorno traz', () => {
  assert.equal(normalizarNossoNumeroAnterior('3978-9'), '0000039789');
  assert.equal(normalizarNossoNumeroAnterior(' 0000039789 '), '0000039789');
  assert.equal(normalizarNossoNumeroAnterior('3978'), null);
  assert.equal(normalizarNossoNumeroAnterior('39-78-9'), null);
  assert.equal(normalizarNossoNumeroAnterior(''), null);
});

test('digito: confere com o convenio da Embala (4062 a 4069 do sistema anterior e 4070-3)', () => {
  assert.equal(erroDoDigitoDoNossoNumero('0000039789', EMBALA, 'SICOOB'), null);
  assert.equal(erroDoDigitoDoNossoNumero(normalizarNossoNumeroAnterior('4070-3')!, EMBALA, 'SICOOB'), null);
  const erro = erroDoDigitoDoNossoNumero(normalizarNossoNumeroAnterior('4070-4')!, EMBALA, 'SICOOB');
  assert.match(erro || '', /4070-4 não é do convênio do banco SICOOB \(o dígito seria 3\)/);
});

test('planilha: le as colunas pelo nome, aceita acento e BOM, aponta a linha com problema', () => {
  const texto = '\uFEFFChave;Nosso número;Vencimento;Emissão;Valor do boleto;Arquivo de remessa;Cliente\n'
    + 'clidoc-56992;3978-9;23/11/2026;10/10/2026;271,20;CNAB240_1.txt;MERCEARIA DO ZE\n'
    + 'clidoc-1;abc;23/11/2026;;10,00;;X\n'
    + 'clidoc-56993;3979-6;2026-11-30;;1.271,20;;\n'
    + 'clidoc-56993;3980-4;07/12/2026;;271,20;;\n'
    + '\n';
  const { linhas, erros } = lerPlanilhaBoletosAnteriores(texto);
  assert.deepEqual(linhas.map((l) => [l.chave, l.nossoNumero, l.vencimento, l.emissao, l.valorBoletoCentavos]), [
    ['clidoc-56992', '0000039789', '2026-11-23', '2026-10-10', 27120],
    ['clidoc-56993', '0000039796', '2026-11-30', '', 127120],
  ]);
  assert.equal(linhas[0].arquivoRemessa, 'CNAB240_1.txt');
  assert.deepEqual(erros, [
    'Linha 3: nosso número "abc" inválido (use o formato 3978-9).',
    'Linha 5: a chave clidoc-56993 aparece mais de uma vez.',
  ]);
  assert.match(lerPlanilhaBoletosAnteriores('Descrição;Valor\nx;1').erros[0], /não tem a\(s\) coluna\(s\): Chave, Nosso número, Vencimento/);
});

test('pedido no servidor: banco, limite e campos conferidos de novo', () => {
  const ok = lerPedidoDeVinculo({ bancoId: 'b1', boletos: [{ chave: 'clidoc-1', nossoNumero: '3978-9', vencimento: '2026-11-23', valorBoletoCentavos: 100 }] });
  assert.ok(!('erro' in ok));
  if (!('erro' in ok)) assert.equal(ok.boletos[0].nossoNumero, '0000039789');
  assert.deepEqual(lerPedidoDeVinculo({ boletos: [] }), { erro: 'Escolha o banco que emitiu os boletos.' });
  assert.ok('erro' in lerPedidoDeVinculo({ bancoId: 'b1', boletos: [{ chave: 'c', nossoNumero: '1-1', vencimento: '23/11/2026', valorBoletoCentavos: 1 }] }));
  assert.ok('erro' in lerPedidoDeVinculo({ bancoId: 'b1', boletos: Array.from({ length: 501 }, (_, i) => ({ chave: `c${i}`, nossoNumero: `${i + 1}-0`, vencimento: '2026-11-23', valorBoletoCentavos: 1 })) }));
});

const pedido = { chave: 'clidoc-56992', nossoNumero: '0000039789', vencimento: '2026-11-23', emissao: '2026-10-10', valorBoletoCentavos: 27120, arquivoRemessa: 'CNAB240_1.txt' };
const titulo = { id: 't1', tipo: 'entrada', status: 'Pendente', descricao: 'Contrato 104198 parc. 1', clienteNome: 'ZE', valorCentavos: 27120, origemImportacao: 'migracao_cadastro' };

test('plano: conta migrada em aberto recebe o boleto "Em remessa", marcado do sistema anterior', () => {
  const p = planejarVinculo(pedido, titulo, null, '2026-11-24');
  assert.equal(p.acao, 'vincular');
  if (p.acao !== 'vincular') return;
  assert.deepEqual(p.boleto, {
    nossoNumero: '0000039789', linhaDigitavel: '', codigoBarras: '', vencimento: '2026-11-23', dataEmissao: '2026-10-10',
    status: 'em_remessa', numeroRemessa: 0, sistemaAnterior: true, remessaSistemaAnterior: 'CNAB240_1.txt',
  });
  assert.equal(p.aviso, undefined);
  // Parte paga no sistema anterior: vincula e avisa a diferenca.
  const parcial = planejarVinculo({ ...pedido, valorBoletoCentavos: 18587 }, { ...titulo, valorCentavos: 2152 }, null, '2026-11-24');
  assert.equal(parcial.acao, 'vincular');
  if (parcial.acao === 'vincular') {
    assert.equal(parcial.boleto.valorNoBancoCentavos, 18587);
    assert.match(parcial.aviso || '', /no banco ele vale R\$ 185,87 e a conta aqui está em R\$ 21,52/);
  }
});

test('plano: repetir nao muda; paga, cancelada, de outro boleto ou numero em uso ficam de fora', () => {
  assert.deepEqual(planejarVinculo(pedido, { ...titulo, boleto: { nossoNumero: '0000039789' } }, null, '2026-11-24'), { acao: 'ja_vinculado' });
  assert.deepEqual(planejarVinculo(pedido, { ...titulo, status: 'Paga' }, null, '2026-11-24'), { acao: 'ja_pago' });
  const recusa = (p: ReturnType<typeof planejarVinculo>) => (p.acao === 'recusar' ? p.motivo : `nao recusou (${p.acao})`);
  assert.match(recusa(planejarVinculo(pedido, null, null, '2026-11-24')), /chave clidoc-56992 não foi encontrada/);
  assert.match(recusa(planejarVinculo(pedido, { ...titulo, status: 'Cancelada' }, null, '2026-11-24')), /está cancelada/);
  assert.match(recusa(planejarVinculo(pedido, { ...titulo, boleto: { nossoNumero: '0000040710' } }, null, '2026-11-24')), /já tem outro boleto \(nosso número 4071-0\)/);
  assert.match(recusa(planejarVinculo(pedido, { ...titulo, origemImportacao: null }, null, '2026-11-24')), /não é uma conta a receber importada/);
  assert.match(recusa(planejarVinculo(pedido, titulo, { id: 'outro', descricao: 'Venda #9' }, '2026-11-24')), /já está no título "Venda #9"/);
});
