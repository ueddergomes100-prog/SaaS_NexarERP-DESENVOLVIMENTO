import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizarBusca, podeAbrirCaminho, telasDaBusca } from '../src/utils/buscaTelasDomain';

const GRUPOS = [
  { label: 'Comercial', items: [{ label: 'Pedidos de Venda', to: '/pedidos-venda' }, { label: 'Orçamentos', to: '/orcamentos' }] },
  { label: 'Financeiro', items: [{ label: 'Contas a Receber', to: '/financeiro/contas-receber' }, { label: 'Contas a Pagar', to: '/financeiro/contas-pagar' }] },
  { label: 'Configurações', items: [{ label: 'Configurações Gerais', to: '/configuracoes' }, { label: 'Filiais', to: '/configuracoes/filiais' }] },
];

test('normaliza sem acento e sem diferenca de maiuscula', () => {
  assert.equal(normalizarBusca('  Orçamentos  DE  Venda '), 'orcamentos de venda');
  assert.equal(normalizarBusca(null), '');
});

test('acha a tela pelo nome ou pelo grupo, cada palavra em qualquer ordem', () => {
  assert.deepEqual(telasDaBusca(GRUPOS, 'orcam').map((t) => t.to), ['/orcamentos']);
  assert.deepEqual(telasDaBusca(GRUPOS, 'receber contas').map((t) => t.to), ['/financeiro/contas-receber']);
  assert.deepEqual(telasDaBusca(GRUPOS, 'financeiro').map((t) => t.to).sort(), ['/financeiro/contas-pagar', '/financeiro/contas-receber']);
  assert.deepEqual(telasDaBusca(GRUPOS, ''), []);
});

test('nome que comeca com o termo vem primeiro', () => {
  const r = telasDaBusca(GRUPOS, 'contas');
  assert.equal(r[0].label.startsWith('Contas'), true);
});

test('Filiais e Permissao de Usuarios nunca aparecem (pedido do dono)', () => {
  assert.deepEqual(telasDaBusca(GRUPOS, 'filia'), []);
  const comPermissao = [{ label: 'Administração', items: [{ label: 'Permissão de Usuários', to: '/configuracoes/permissoes' }] }];
  assert.deepEqual(telasDaBusca(comPermissao, 'permiss'), []);
  assert.deepEqual(telasDaBusca(GRUPOS, 'configura').map((t) => t.to), ['/configuracoes']);
});

test('pode abrir: dono/plataforma sim; funcionario so com a permissao da rota; modulo bloqueado barra', () => {
  const base = { acessoTotal: false, plataforma: false, permissoes: ['cadastros.clientes'], modulosBloqueados: [] as string[] };
  assert.equal(podeAbrirCaminho({ ...base, caminho: '/clientes/editar/1' }), true);
  assert.equal(podeAbrirCaminho({ ...base, caminho: '/fornecedores/editar/1' }), false);
  assert.equal(podeAbrirCaminho({ ...base, acessoTotal: true, caminho: '/fornecedores/editar/1' }), true);
  assert.equal(podeAbrirCaminho({ ...base, acessoTotal: true, modulosBloqueados: ['cadastros.fornecedores'], caminho: '/fornecedores' }), false);
  assert.equal(podeAbrirCaminho({ ...base, plataforma: true, acessoTotal: true, modulosBloqueados: ['cadastros.fornecedores'], caminho: '/fornecedores' }), true);
});
