import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idsDasPromocoes, lerPrecoDigitado, precificarNoApp, precoDaTabelaDoItem, promocaoParaMostrar, trocarPrecoDoItem, type ItemComPrecoDoApp, type PrecosDoApp } from '../src/utils/precoAppVendasDomain';
import { conferirPrecos } from '../src/utils/conferenciaPrecoDomain';
import { reprecificarItens } from '../src/utils/precoVendaDomain';
import type { TabelaDePrecoDoItem } from '../src/utils/precoVendaDomain';
import type { PromocaoDoProduto } from '../src/utils/promocaoDomain';

/* Promocoes no app Vendas (19/10/2026). */

const produto = { id: 'p1', nome: 'RAÇÃO', precoVenda: 100, precoAVista: 95 };

const precos = (args: { promo?: TabelaDePrecoDoItem['promocao']; quota?: number | null; limite?: number | null; vendido?: number; conferida?: boolean } = {}): PrecosDoApp => {
  const promo = args.promo === undefined ? { id: 'pr1', nome: 'SEMANA DO PET', preco: 80, soAVista: false } : args.promo;
  const doProduto: PromocaoDoProduto | null = promo
    ? { promocaoId: promo.id, nome: promo.nome, preco: promo.preco, soAVista: promo.soAVista, quota: args.quota ?? null, limitePorVenda: args.limite ?? null }
    : null;
  return {
    tabelaDe: () => ({ venda: 100, vista: 95, promocao: promo }),
    quantidadeLiberada: (_p, jaNestaVenda) => {
      if (!doProduto) return null;
      const restaQuota = doProduto.quota === null ? null : Math.max(0, doProduto.quota - (args.vendido || 0) - jaNestaVenda);
      const restaLimite = doProduto.limitePorVenda === null ? null : Math.max(0, doProduto.limitePorVenda - jaNestaVenda);
      const liberada = restaQuota === null ? restaLimite : restaLimite === null ? restaQuota : Math.min(restaQuota, restaLimite);
      return { promo: doProduto, liberada };
    },
    quotaConferida: args.conferida ?? true,
  };
};

test('sem tabela de promocoes: preco de venda puro, sem campos', () => {
  assert.deepEqual(precificarNoApp({ precos: null, produto, quantidade: 1, naVenda: [], consomeQuota: true }), { preco: 100, campos: null, aviso: null });
});

test('promocao "todas as formas": item entra no preco dela com os campos do desktop', () => {
  const r = precificarNoApp({ precos: precos(), produto, quantidade: 2, naVenda: [], consomeQuota: true });
  assert.equal(r.preco, 80);
  assert.equal(r.campos?.origemPreco, 'promocao');
  assert.equal(r.campos?.promocaoId, 'pr1');
  assert.equal(r.aviso, null);
});

test('promocao "so a vista": o app (a prazo) fica no preco de venda, mas a tabela leva a promocao para o balcao', () => {
  const r = precificarNoApp({ precos: precos({ promo: { id: 'pr2', nome: 'À VISTA', preco: 85, soAVista: true }, quota: 0 }), produto, quantidade: 1, naVenda: [], consomeQuota: true });
  assert.equal(r.preco, 100);
  assert.equal(r.campos?.origemPreco, 'venda');
  assert.equal(r.campos?.promocaoId, undefined);
  assert.equal(r.campos?.tabelaPreco.promocao?.id, 'pr2');
});

test('pedido: quota e limite por venda contam o que ja esta no pedido; acima disso, preco normal com aviso', () => {
  const comLimite = precos({ limite: 3 });
  const naVenda = [{ id: 'p1', quantidade: 2, promocaoId: 'pr1' }];
  const cabe = precificarNoApp({ precos: comLimite, produto, quantidade: 1, naVenda, consomeQuota: true });
  assert.equal(cabe.preco, 80);
  const passa = precificarNoApp({ precos: comLimite, produto, quantidade: 2, naVenda, consomeQuota: true });
  assert.equal(passa.preco, 100);
  assert.match(String(passa.aviso), /só libera mais 1 unidade\(s\) neste pedido/);
  const acabou = precificarNoApp({ precos: precos({ quota: 10, vendido: 10 }), produto, quantidade: 1, naVenda: [], consomeQuota: true });
  assert.match(String(acabou.aviso), /a quantidade da promoção "SEMANA DO PET" acabou/);
});

test('promocao com quota sem internet para conferir: preco normal com aviso; sem quota vale offline', () => {
  const offline = precificarNoApp({ precos: precos({ quota: 50, conferida: false }), produto, quantidade: 1, naVenda: [], consomeQuota: true });
  assert.equal(offline.preco, 100);
  assert.match(String(offline.aviso), /precisa de internet/);
  const soLimite = precificarNoApp({ precos: precos({ limite: 5, conferida: false }), produto, quantidade: 1, naVenda: [], consomeQuota: true });
  assert.equal(soLimite.preco, 80, 'limite por venda nao depende de internet');
});

test('orcamento e OS nao consomem quota (como no desktop)', () => {
  const r = precificarNoApp({ precos: precos({ quota: 1, vendido: 1, conferida: false }), produto, quantidade: 5, naVenda: [], consomeQuota: false });
  assert.equal(r.preco, 80);
  assert.equal(r.aviso, null);
});

test('busca mostra a promocao; ids das promocoes do pedido sem repetir', () => {
  assert.deepEqual(promocaoParaMostrar(precos(), produto), { preco: 80, soAVista: false, nome: 'SEMANA DO PET' });
  assert.equal(promocaoParaMostrar(precos({ promo: null }), produto), null);
  assert.deepEqual(idsDasPromocoes([{ promocaoId: 'a' }, {}, { promocaoId: 'a' }, { promocaoId: 'b' }]), ['a', 'b']);
});

/* Trocar o preco do item no app (05/11/2026). */

const itemDeTabela: ItemComPrecoDoApp & { id: string; nome: string; desconto: number } = {
  id: 'p1',
  nome: 'FILTRO',
  precoUnitario: 260,
  quantidade: 3,
  desconto: 0,
  subtotal: 780,
  tabelaPreco: { venda: 260, vista: 240, promocao: null },
  origemPreco: 'venda',
};

test('lerPrecoDigitado: virgula, milhar e ponto decimal do teclado do celular', () => {
  assert.equal(lerPrecoDigitado('129,90'), 129.9);
  assert.equal(lerPrecoDigitado('129,9'), 129.9);
  assert.equal(lerPrecoDigitado('1.250,50'), 1250.5);
  assert.equal(lerPrecoDigitado('129.90'), 129.9, 'nunca 12.990');
  assert.equal(lerPrecoDigitado('1.250'), 1250);
  assert.equal(lerPrecoDigitado('260'), 260);
  assert.equal(lerPrecoDigitado('R$ 45,00'), 45);
  for (const ruim of ['', '0', '0,00', 'abc', '1,2,3', '12,345', '-5']) assert.equal(lerPrecoDigitado(ruim), null, ruim);
});

test('trocar preco: vira manual, refaz o subtotal e nao troca sozinho ao receber a vista', () => {
  const novo = trocarPrecoDoItem(itemDeTabela, 199.9);
  assert.equal(novo.precoUnitario, 199.9);
  assert.equal(novo.origemPreco, 'manual');
  assert.equal(novo.subtotal, 599.7);
  assert.equal(precoDaTabelaDoItem(novo), 260);
  const { itens, alterados } = reprecificarItens([novo], 'vista');
  assert.equal(alterados, 0);
  assert.equal(itens[0].precoUnitario, 199.9);
});

test('trocar preco: digitar o da tabela volta ao automatico', () => {
  const volta = trocarPrecoDoItem(trocarPrecoDoItem(itemDeTabela, 199.9), 260);
  assert.equal(volta.origemPreco, 'venda');
  assert.equal(volta.subtotal, 780);
});

test('trocar preco de item em promocao: sai da promocao (nao gasta quota) e volta se digitar o preco dela', () => {
  const emPromocao: typeof itemDeTabela = {
    ...itemDeTabela,
    precoUnitario: 200,
    subtotal: 600,
    tabelaPreco: { venda: 260, vista: 240, promocao: { id: 'pr1', nome: 'SEMANA', preco: 200, soAVista: false } },
    origemPreco: 'promocao',
    promocaoId: 'pr1',
    promocaoNome: 'SEMANA',
  };
  const manual = trocarPrecoDoItem(emPromocao, 150);
  assert.equal(manual.origemPreco, 'manual');
  assert.ok(!Object.keys(manual).includes('promocaoId'), 'sem chave undefined no Firestore');
  assert.ok(!Object.keys(manual).includes('promocaoNome'));
  const volta = trocarPrecoDoItem(manual, 200);
  assert.equal(volta.origemPreco, 'promocao');
  assert.equal(volta.promocaoId, 'pr1');
});

test('trocar preco de item sem tabela: manual, sem chave undefined', () => {
  const semTabela: ItemComPrecoDoApp = { precoUnitario: 10, quantidade: 2, subtotal: 20 };
  const novo = trocarPrecoDoItem(semTabela, 12.5);
  assert.equal(novo.origemPreco, 'manual');
  assert.equal(novo.subtotal, 25);
  assert.ok(!Object.values(novo).some((v) => v === undefined));
  assert.equal(precoDaTabelaDoItem(novo), 0);
});

test('preco alterado abaixo da tabela conta como desconto ao faturar; acima e livre', () => {
  const conferir = (precoUnitario: number) => conferirPrecos({
    itens: [{ ...trocarPrecoDoItem(itemDeTabela, precoUnitario) }],
    produtos: { p1: { precoVenda: 260 } as never },
    promocoes: [],
    hoje: '2026-11-05',
    condicao: 'prazo',
  });
  assert.equal(conferir(200).diferencaTotalCentavos, 18000);
  assert.equal(conferir(300).diferencaTotalCentavos, 0);
});
