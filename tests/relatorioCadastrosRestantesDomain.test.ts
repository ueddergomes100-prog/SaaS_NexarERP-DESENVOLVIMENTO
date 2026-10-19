import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarDocumentoBancos, montarDocumentoBandeiras } from '../src/utils/relatorioCadastrosFinanceirosDomain';
import {
  loginDoUsuario,
  montarDocumentoEquipe,
  montarDocumentoFrota,
  montarDocumentoMotoristas,
  montarDocumentoVendedores,
  textoDaComissao,
} from '../src/utils/relatorioEquipeFrotaDomain';
import type { ColunaRelatorio } from '../src/utils/relatorioPdfDomain';

/* Relatorios que faltavam nos cadastros (19/10/2026): Bandeiras, Bancos, Equipe, Vendedores, Motoristas e Frota. */

const coluna = <T,>(doc: { secoes: Array<{ colunas: ColunaRelatorio<T>[] }> }, id: string) => {
  const c = doc.secoes[0].colunas.find((col) => col.id === id);
  assert.ok(c, `coluna ${id}`);
  return c;
};

test('bandeiras: taxa de debito e de cada parcela em %, prazos em dias, so as parcelas usuais marcadas', () => {
  const doc = montarDocumentoBandeiras([
    { id: 'b1', nome: 'VISA', ativo: true, taxaDebitoPercentual: 1.5, taxasCreditoPorParcela: { 1: 2.49, 2: 3.1 }, prazoRecebimentoCreditoDias: 30, prazoRecebimentoDebitoDias: 1 },
    { id: 'b2', nome: 'ELO', ativo: false },
  ], { filtrosAplicados: ['Busca: "v"'] });
  const visa = doc.secoes[0].linhas[0];
  assert.equal(coluna(doc, 'debito').valor(visa), '1,50%');
  assert.equal(coluna(doc, 'credito1x').valor(visa), '2,49%');
  assert.equal(coluna(doc, 'credito2x').valor(visa), '3,10%');
  assert.equal(coluna(doc, 'prazoCredito').valor(visa), 30);
  assert.equal(coluna(doc, 'credito1x').padrao, true);
  assert.equal(coluna(doc, 'credito4x').padrao, false);
  assert.equal(coluna(doc, 'prazoCredito').total, 'nenhum');
  assert.deepEqual(doc.indicadores.map((i) => i.valor), ['2', '1', '1']);
  assert.deepEqual(doc.filtros, ['Busca: "v"']);
});

test('bancos: conta com digito, saldo em centavos somado e indicador do total', () => {
  const doc = montarDocumentoBancos([
    { id: 'c1', nome: 'SICOOB', banco: '756', agencia: '3001', conta: '12345', contaDv: '6', saldoCentavos: 42589, ativo: true, boleto: { ativo: true } },
    { id: 'c2', nome: 'CAIXA', saldoCentavos: -1000, ativo: false },
  ], { filtrosAplicados: [] });
  const sicoob = doc.secoes[0].linhas[0];
  assert.equal(coluna(doc, 'conta').valor(sicoob), '12345-6');
  assert.equal(coluna(doc, 'boleto').valor(sicoob), 'Sim');
  assert.equal(coluna(doc, 'saldo').valor(sicoob), 42589);
  assert.equal(coluna(doc, 'saldo').tipo, 'moeda');
  assert.equal(doc.indicadores[2].valor, 'R$ 415,89');
});

test('equipe: login sem o prefixo da empresa, gestor ve tudo, comissao como na tela', () => {
  assert.equal(loginDoUsuario({ username: 'loja-maria' }), 'maria');
  assert.equal(loginDoUsuario({ email: 'a@b.com' }), 'a@b.com');
  const doc = montarDocumentoEquipe([
    { id: 'dono', nome: 'DONO', role: 'Master' },
    { id: 'u2', nome: 'ANA', role: 'Funcionario', nivelAcesso: 'supervisor', permissoes: ['vendas.pedidos', 'mecanica.os'], status: 'Ativo', recebeComissaoPecas: true, comissaoPercentualPecas: 2.5 },
    { id: 'u3', nome: 'JOAO', role: 'Funcionario', status: 'Inativo' },
  ], { filtrosAplicados: [], donoId: 'dono' });
  const [dono, ana, joao] = doc.secoes[0].linhas;
  assert.equal(coluna(doc, 'perfil').valor(dono), 'Dono / Master');
  assert.equal(coluna(doc, 'nivel').valor(dono), 'Gerente');
  assert.equal(coluna(doc, 'permissoes').valor(dono), 'Todas');
  assert.equal(coluna(doc, 'nivel').valor(ana), 'Supervisor');
  assert.equal(coluna(doc, 'permissoes').valor(ana), '2');
  assert.equal(coluna(doc, 'comissao').valor(ana), 'Produtos 2,5%');
  assert.equal(coluna(doc, 'situacao').valor(joao), 'Inativo');
  assert.deepEqual(doc.indicadores.map((i) => i.valor), ['3', '2', '1']);
});

test('vendedores: senha so como cadastrada ou nao (nunca o PIN) e comissao', () => {
  assert.equal(textoDaComissao({}), 'Não recebe');
  assert.equal(textoDaComissao({ recebeComissaoPecas: true, recebeComissaoServicos: true, comissaoPercentualServicos: 10 }), 'Produtos padrão · Serviços 10%');
  const doc = montarDocumentoVendedores([
    { id: 'v1', nome: 'CARLA', codigoVendedor: '07', pinDefinidoEm: '2026-10-01' },
    { id: 'v2', nome: 'PAULO', status: 'Inativo' },
  ], { filtrosAplicados: [] });
  const [carla, paulo] = doc.secoes[0].linhas;
  assert.equal(coluna(doc, 'senha').valor(carla), 'Cadastrada');
  assert.equal(coluna(doc, 'senha').valor(paulo), 'Sem senha — não vende');
  assert.equal(coluna(doc, 'codigo').valor(paulo), '--');
  assert.deepEqual(doc.indicadores.map((i) => i.valor), ['2', '1', '1']);
});

test('motoristas e frota: placa formatada, KM sem total, situacao', () => {
  const motoristas = montarDocumentoMotoristas([{ id: 'm1', nome: 'ZE', telefone: '33999', cnh: '123', ativo: false }], { filtrosAplicados: [] });
  assert.equal(coluna(motoristas, 'situacao').valor(motoristas.secoes[0].linhas[0]), 'Inativo');
  const frota = montarDocumentoFrota([{ id: 'f1', placa: 'abc1d23', modelo: 'ACCELO', marca: 'MB', tipo: 'Caminhão', kmAtual: 120000, motoristaPadraoNome: 'ZE' }], { filtrosAplicados: [] });
  const caminhao = frota.secoes[0].linhas[0];
  assert.equal(coluna(frota, 'placa').valor(caminhao), 'ABC-1D23');
  assert.equal(coluna(frota, 'veiculo').valor(caminhao), 'MB ACCELO');
  assert.equal(coluna(frota, 'km').valor(caminhao), 120000);
  assert.equal(coluna(frota, 'km').total, 'nenhum');
});
