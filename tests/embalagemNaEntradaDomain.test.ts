import test from 'node:test';
import assert from 'node:assert/strict';
import {
  edicaoInicialDasEmbalagens,
  embalagensParaGravar,
  embalagensParaGravarSemLancar,
  numeroDoCampoDeEmbalagem,
  type EdicaoDasEmbalagens,
} from '../src/utils/embalagemNaEntradaDomain';

const SACO = { id: 'sc20', unidadeMedidaId: 'u-sc', unidadeMedidaSigla: 'SC', unidadeMedidaCasasDecimais: 0, unidadeMedidaFracionado: false, descricao: '', fatorConversao: 20, precoVenda: 180, precoAVista: 0, precoCusto: 0, codigoBarras: '789', ativo: true, extra: 'fica' };
const base = { siglaBase: 'KG', podePreco: true, podeCusto: true, novoId: () => 'novo1' };

test('abre com as embalagens ativas e os valores de hoje (vazio = sem valor proprio)', () => {
  const ed = edicaoInicialDasEmbalagens([SACO, { ...SACO, id: 'velho', ativo: false }]);
  assert.deepEqual(ed, { existentes: [{ id: 'sc20', precoCusto: '', precoVenda: '180', precoAVista: '' }], novas: [] });
  assert.deepEqual(edicaoInicialDasEmbalagens(undefined), { existentes: [], novas: [] });
});

test('numero do campo: virgula, ponto, vazio e invalido', () => {
  assert.equal(numeroDoCampoDeEmbalagem('12,50'), 12.5);
  assert.equal(numeroDoCampoDeEmbalagem('1.234,56'), 1234.56);
  assert.equal(numeroDoCampoDeEmbalagem('12.5'), 12.5);
  assert.equal(numeroDoCampoDeEmbalagem(''), 0);
  assert.equal(numeroDoCampoDeEmbalagem('-1'), null);
  assert.equal(numeroDoCampoDeEmbalagem('abc'), null);
});

test('sem mexer, nada a gravar; corrigir custo e preco mantem os outros campos', () => {
  const sem = embalagensParaGravar({ ...base, atuais: [SACO], edicao: edicaoInicialDasEmbalagens([SACO]) });
  assert.equal(sem.embalagens, null);
  const edicao: EdicaoDasEmbalagens = { existentes: [{ id: 'sc20', precoCusto: '150', precoVenda: '199,90', precoAVista: '' }], novas: [] };
  const r = embalagensParaGravar({ ...base, atuais: [SACO], edicao });
  assert.equal(r.erro, null);
  assert.equal(r.embalagens?.length, 1);
  assert.equal(r.embalagens?.[0].precoCusto, 150);
  assert.equal(r.embalagens?.[0].precoVenda, 199.9);
  assert.equal(r.embalagens?.[0].codigoBarras, '789');
  assert.equal(r.embalagens?.[0].extra, 'fica');
});

test('sem a permissao, o campo nao muda', () => {
  const edicao: EdicaoDasEmbalagens = { existentes: [{ id: 'sc20', precoCusto: '150', precoVenda: '250', precoAVista: '' }], novas: [] };
  const soCusto = embalagensParaGravar({ ...base, podePreco: false, atuais: [SACO], edicao });
  assert.equal(soCusto.embalagens?.[0].precoVenda, 180);
  assert.equal(soCusto.embalagens?.[0].precoCusto, 150);
  const nada = embalagensParaGravar({ ...base, podePreco: false, podeCusto: false, atuais: [SACO], edicao });
  assert.equal(nada.embalagens, null);
});

test('embalagem nova: cadastra com a unidade escolhida; recusas dizem o que fazer', () => {
  const nova = { chave: 'k', unidadeMedidaId: 'u-cx', sigla: 'CX', casasDecimais: 0, fracionado: false, fator: '12', precoCusto: '', precoVenda: '60', precoAVista: '' };
  const r = embalagensParaGravar({ ...base, siglaBase: 'UN', atuais: [], edicao: { existentes: [], novas: [nova] } });
  assert.equal(r.erro, null);
  assert.deepEqual(r.embalagens, [{
    id: 'novo1', unidadeMedidaId: 'u-cx', unidadeMedidaSigla: 'CX', unidadeMedidaCasasDecimais: 0, unidadeMedidaFracionado: false,
    descricao: '', fatorConversao: 12, precoVenda: 60, precoAVista: 0, precoCusto: 0, codigoBarras: '', ativo: true,
  }]);
  const semUnidade = embalagensParaGravar({ ...base, atuais: [], edicao: { existentes: [], novas: [{ ...nova, unidadeMedidaId: '', sigla: '' }] } });
  assert.match(String(semUnidade.erro), /Escolha a unidade da embalagem nova/);
  const semFator = embalagensParaGravar({ ...base, atuais: [], edicao: { existentes: [], novas: [{ ...nova, fator: '' }] } });
  assert.match(String(semFator.erro), /quantos KG cabem em 1 CX/);
  const repetida = embalagensParaGravar({ ...base, atuais: [SACO], edicao: { existentes: [], novas: [{ ...nova, unidadeMedidaId: 'u-sc', sigla: 'SC', fator: '20' }] } });
  assert.match(String(repetida.erro), /já tem a embalagem SC de 20/);
  const propria = embalagensParaGravar({ ...base, atuais: [], edicao: { existentes: [], novas: [{ ...nova, unidadeMedidaId: 'u-kg', sigla: 'KG', fator: '1' }] } });
  assert.match(String(propria.erro), /própria unidade do produto/);
  const semPermissao = embalagensParaGravar({ ...base, podePreco: false, atuais: [], edicao: { existentes: [], novas: [nova] } });
  assert.match(String(semPermissao.erro), /Estoque: alterar o preço/);
});

test('valor digitado invalido volta como mensagem (nao derruba a tela)', () => {
  const edicao: EdicaoDasEmbalagens = { existentes: [{ id: 'sc20', precoCusto: 'abc', precoVenda: '', precoAVista: '' }], novas: [] };
  const r = embalagensParaGravarSemLancar({ ...base, atuais: [SACO], edicao });
  assert.equal(r.embalagens, null);
  assert.match(String(r.erro), /Confira o custo da embalagem SC de 20/);
});
