import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  erroDaContaNoAcerto,
  erroDeDevedoresDiferentes,
  FORMA_ACERTO_FORNECEDOR,
  fraseDoComprovante,
  lerPedidoDeAcerto,
  lerPedidoDeDesfazerAcerto,
  reaisDoAcerto,
  textoDoAcertoNaConta,
  totalDoLado,
} from '../src/utils/acertoFornecedorDomain';
import { BLOQUEIO_ESTORNO_DO_ACERTO, planejarEstornoPagar, planejarEstornoReceber } from '../src/utils/baixaFinanceiraDomain';

/*
 * Acerto com fornecedor (24/11/2026, Jomarly): o cliente paga direto o
 * fornecedor. Leitura do pedido, conta que pode entrar e o bloqueio do estorno avulso.
 */

const HOJE = '2026-11-24';
const erroDe = (r: { erro: string } | object): string => ('erro' in r ? r.erro : '');

const corpo = (extra: Record<string, unknown> = {}) => ({
  idAcerto: 'a1',
  receber: [{ transacaoId: 'r1', valorCentavos: 100000 }],
  pagar: [{ transacaoId: 'p1', valorCentavos: 50000 }, { transacaoId: 'p2', valorCentavos: 50000 }],
  data: HOJE,
  observacao: '  combinado   por telefone ',
  ...extra,
});

test('pedido: os dois lados somam igual; sem conta repetida; data valida', () => {
  const ok = lerPedidoDeAcerto(corpo(), HOJE);
  assert.ok('pedido' in ok);
  assert.equal(totalDoLado(ok.pedido.receber), 100000);
  assert.equal(ok.pedido.observacao, 'combinado por telefone');

  assert.match(erroDe(lerPedidoDeAcerto(corpo({ pagar: [{ transacaoId: 'p1', valorCentavos: 80000 }] }), HOJE)), /somam R\$ 1\.000,00 e as dos fornecedores R\$ 800,00/);
  assert.match(erroDe(lerPedidoDeAcerto(corpo({ receber: [] }), HOJE)), /ao menos uma conta do cliente/);
  assert.match(erroDe(lerPedidoDeAcerto(corpo({ pagar: [] }), HOJE)), /ao menos uma conta de fornecedor/);
  assert.match(erroDe(lerPedidoDeAcerto(corpo({ pagar: [{ transacaoId: 'p1', valorCentavos: 50000 }, { transacaoId: 'p1', valorCentavos: 50000 }] }), HOJE)), /duas vezes/);
  assert.match(erroDe(lerPedidoDeAcerto(corpo({ pagar: [{ transacaoId: 'r1', valorCentavos: 100000 }] }), HOJE)), /dos dois lados/);
  assert.match(erroDe(lerPedidoDeAcerto(corpo({ receber: [{ transacaoId: 'r1', valorCentavos: 0 }] }), HOJE)), /maior que zero/);
  assert.match(erroDe(lerPedidoDeAcerto(corpo({ receber: [{ transacaoId: 'r1', valorCentavos: 10.5 }] }), HOJE)), /maior que zero/);
  assert.match(erroDe(lerPedidoDeAcerto(corpo({ idAcerto: '' }), HOJE)), /Acerto inválido/);
  assert.ok(erroDe(lerPedidoDeAcerto(corpo({ data: '2026-11-25' }), HOJE)), 'data futura e recusada');
  assert.ok(erroDe(lerPedidoDeAcerto(corpo({ data: '' }), HOJE)));
});

test('conta: so pendente, do lado certo e ate o saldo', () => {
  const conta = { existe: true, tipo: 'entrada', status: 'Pendente', saldoCentavos: 60000, descricao: 'Venda #100' };
  assert.equal(erroDaContaNoAcerto('receber', conta, 60000), '');
  assert.equal(erroDaContaNoAcerto('receber', conta, 100), '');
  assert.match(erroDaContaNoAcerto('receber', conta, 60001), /"Venda #100" tem R\$ 600,00 em aberto/);
  assert.match(erroDaContaNoAcerto('pagar', conta, 100), /não é uma conta a pagar/);
  assert.match(erroDaContaNoAcerto('receber', { ...conta, status: 'Paga' }, 100), /já foi recebida/);
  assert.match(erroDaContaNoAcerto('pagar', { ...conta, tipo: 'saida', status: 'Paga' }, 100), /já foi paga/);
  assert.match(erroDaContaNoAcerto('receber', { ...conta, status: 'Cancelada' }, 100), /está cancelada/);
  assert.match(erroDaContaNoAcerto('receber', { ...conta, bloqueio: 'ela tem boleto emitido.' }, 100), /não pode entrar no acerto: ela tem boleto emitido/);
  assert.match(erroDaContaNoAcerto('receber', { existe: false, saldoCentavos: 0 }, 100), /não existe mais/);

  assert.equal(erroDeDevedoresDiferentes(['cliente:1', 'cliente:1', '']), '');
  assert.match(erroDeDevedoresDiferentes(['cliente:1', 'cliente:2']), /clientes diferentes/);
});

test('textos: o que fica em cada conta e no comprovante', () => {
  assert.equal(FORMA_ACERTO_FORNECEDOR, 'Acerto com Fornecedor');
  assert.equal(reaisDoAcerto(123456), 'R$ 1.234,56');
  const nomes = { cliente: 'JOAO DA OBRA', fornecedores: ['CIMENTOS SA', 'AREAL DO ZE'] };
  assert.equal(textoDoAcertoNaConta('receber', nomes), 'Pago direto a CIMENTOS SA, AREAL DO ZE');
  assert.equal(textoDoAcertoNaConta('pagar', nomes), 'Pago por JOAO DA OBRA');
  assert.match(fraseDoComprovante({ cliente: 'JOAO DA OBRA', empresa: 'JOMARLY', totalCentavos: 100000, fornecedores: nomes.fornecedores }), /^JOAO DA OBRA pagou R\$ 1\.000,00 diretamente a CIMENTOS SA, AREAL DO ZE, por conta e ordem de JOMARLY\./);
});

test('estorno avulso de baixa de acerto e bloqueado; desfazer pede motivo', () => {
  const marca = { origem: 'contas_receber' as const, formaPagamento: 'Acerto com Fornecedor', dataPagamento: HOJE, valorCentavos: 1000 };
  const receber = planejarEstornoReceber({ status: 'Paga', formaPagamento: 'Acerto com Fornecedor', baixaManual: marca, acertoFornecedor: { id: 'acerto_a1' } });
  assert.equal(receber.permitido, false);
  assert.equal(receber.bloqueio, BLOQUEIO_ESTORNO_DO_ACERTO);
  assert.equal(receber.mostrarBotao, true, 'mostra o botao para a pessoa ler o caminho');
  const pagar = planejarEstornoPagar({ status: 'Paga', formaPagamento: 'Acerto com Fornecedor', baixaManual: { ...marca, origem: 'contas_pagar' }, acertoFornecedor: { id: 'acerto_a1' } });
  assert.equal(pagar.permitido, false);
  // Sem a marca (o servidor tira ao desfazer o acerto), a baixa volta normalmente.
  assert.equal(planejarEstornoReceber({ status: 'Paga', formaPagamento: 'Acerto com Fornecedor', baixaManual: marca, acertoFornecedor: null }).permitido, true);

  assert.match(erroDe(lerPedidoDeDesfazerAcerto({ acertoId: 'acerto_a1', motivo: 'x' })), /motivo/);
  assert.ok('pedido' in lerPedidoDeDesfazerAcerto({ acertoId: 'acerto_a1', motivo: 'cliente não pagou o fornecedor' }));
});
