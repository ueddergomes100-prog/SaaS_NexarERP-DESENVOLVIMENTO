import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveGrupoVinculo,
  inferirMapeamentoColunasConta,
  montarContaImportada,
  normalizarDocumentoParte,
  processarLinhasContas,
  resolverVinculoParte,
  sementeIdImportacao,
  type ParteCadastrada,
} from '../src/utils/importacaoContasDomain';

const parte = (p: Partial<ParteCadastrada> & { id: string; nome: string }): ParteCadastrada => ({
  documento: '', codigo: '', cidade: '', ativo: true, ...p,
});

test('documento: so digitos, zero a esquerda devolvido, zerado vira vazio', () => {
  assert.equal(normalizarDocumentoParte('21.145.317/0001-96'), '21145317000196');
  assert.equal(normalizarDocumentoParte('7576006000150'), '07576006000150'); // Excel comeu o zero
  assert.equal(normalizarDocumentoParte('5384884681'), '05384884681');
  assert.equal(normalizarDocumentoParte('00.000.000/0000-00'), '');
  assert.equal(normalizarDocumentoParte('000.000.000-00'), '');
  assert.equal(normalizarDocumentoParte(''), '');
});

test('com CPF/CNPJ, o documento vincula mesmo com nome diferente (MEI limpo)', () => {
  const partes = [parte({ id: 'a', nome: 'ROSANA VIANNA SILVA DE MEDEIROS', documento: '21145317000196' })];
  const v = resolverVinculoParte('21.145.317/0001-96', '21.145.317 ROSANA VIANNA', partes);
  assert.equal(v.situacao, 'vinculado');
  assert.equal(v.id, 'a');
  assert.equal(v.nome, 'ROSANA VIANNA SILVA DE MEDEIROS');
});

test('com CPF/CNPJ sem cadastro, NAO cai pro nome -- homonimo vira so aviso', () => {
  const partes = [parte({ id: 'a', nome: 'SUPERMERCADO LALINHO LTDA', documento: '' })];
  const v = resolverVinculoParte('65.206.241/0001-37', 'SUPERMERCADO LALINHO LTDA', partes);
  assert.equal(v.situacao, 'sem_cadastro');
  assert.equal(v.id, null);
  assert.match(v.aviso, /sem CPF\/CNPJ/);
});

test('mesmo documento em dois cadastros ativos = ambiguo, nunca o primeiro', () => {
  const partes = [
    parte({ id: 'a', nome: 'SUPERMERCADO SILVA EIRELI', documento: '10233892000124' }),
    parte({ id: 'b', nome: 'SUPERMERCADO SILVA LTDA', documento: '10233892000124' }),
  ];
  const v = resolverVinculoParte('10233892000124', 'SUPERMERCADO SILVA LTDA', partes);
  assert.equal(v.situacao, 'ambiguo');
  assert.equal(v.id, null);
  assert.equal(v.candidatos.length, 2);
});

test('cadastro inativo nao recebe titulo; se for o unico, o aviso manda reativar', () => {
  const partes = [
    parte({ id: 'a', nome: 'X', documento: '10233892000124', ativo: false }),
    parte({ id: 'b', nome: 'X', documento: '10233892000124' }),
  ];
  assert.equal(resolverVinculoParte('10233892000124', 'X', partes).id, 'b');
  const soInativo = resolverVinculoParte('10233892000124', 'X', [partes[0]]);
  assert.equal(soInativo.situacao, 'sem_cadastro');
  assert.match(soInativo.aviso, /inativo/);
});

test('sem documento: vincula pelo nome so quando ele e unico', () => {
  const partes = [
    parte({ id: 'a', nome: 'IMPOSTOS' }),
    parte({ id: 'b', nome: 'IMPOSTOS' }),
    parte({ id: 'c', nome: 'DESPESAS ADMINISTRATIVAS' }),
  ];
  assert.equal(resolverVinculoParte('', 'DESPESAS  administrativas', partes).id, 'c');
  const imp = resolverVinculoParte('00.000.000/0000-00', 'IMPOSTOS', partes);
  assert.equal(imp.situacao, 'ambiguo');
  assert.deepEqual(imp.candidatos.map((p) => p.id), ['a', 'b']);
  assert.equal(resolverVinculoParte('', 'NINGUEM', partes).situacao, 'sem_cadastro');
});

test('sem documento e sem nome = sem_parte', () => {
  assert.equal(resolverVinculoParte('', '', []).situacao, 'sem_parte');
});

test('grupo de escolha: por documento, ou por nome quando nao ha documento', () => {
  assert.equal(chaveGrupoVinculo({ documentoParte: '10233892000124', parteNomeBruto: 'A' }), 'doc:10233892000124');
  assert.equal(
    chaveGrupoVinculo({ documentoParte: '', parteNomeBruto: 'Impostos ' }),
    chaveGrupoVinculo({ documentoParte: '', parteNomeBruto: 'IMPOSTOS' }),
  );
});

test('mapeamento reconhece o arquivo gerado da migracao sem confundir CPF/CNPJ com nome', () => {
  const m = inferirMapeamentoColunasConta(['Descrição', 'Cliente', 'CPF/CNPJ', 'Valor', 'Vencimento', 'Categoria', 'Chave de importação']);
  assert.deepEqual(m, {
    descricao: 0, parte: 1, documentoParte: 2, valor: 3, vencimento: 4, categoria: 5, chave: 6,
    status: null, dataPagamento: null,
  });
});

test('a coluna "CPF/CNPJ do cliente" nao vira a coluna do nome', () => {
  const m = inferirMapeamentoColunasConta(['Descrição', 'CPF/CNPJ do cliente', 'Cliente', 'Valor', 'Vencimento']);
  assert.equal(m.documentoParte, 1);
  assert.equal(m.parte, 2);
});

test('linha processada carrega documento normalizado e chave', () => {
  const m = inferirMapeamentoColunasConta(['Descrição', 'Fornecedor', 'CPF/CNPJ', 'Valor', 'Vencimento', 'Categoria', 'Chave de importação']);
  const [c] = processarLinhasContas([
    ['DOC 13259 - PARC 1', '7 ABELHAS', '49.883.103/0001-36', '527,52', '01/09/2026', 'FORNECEDORES', 'SOLNATUS-CP-401-13259-1-20260901'],
  ], m);
  assert.equal(c.documentoParte, '49883103000136');
  assert.equal(c.chave, 'SOLNATUS-CP-401-13259-1-20260901');
  assert.equal(c.valor, 527.52);
  assert.equal(c.vencimento, '2026-09-01');
  assert.equal(c.status, 'OK');
});

test('titulo gravado leva a chave; sem chave, nenhum campo a mais (nunca undefined)', () => {
  const base = {
    descricao: 'X', categoria: '', valor: 10, vencimento: '2026-09-01',
    statusPagamento: 'Pendente' as const, dataPagamento: '', parteId: 'a', parteNome: 'A',
  };
  const comChave = montarContaImportada({ ...base, chave: ' K1 ' }, 'entrada', 't', 'u', 'ts');
  assert.equal(comChave.chaveImportacao, 'K1');
  const semChave = montarContaImportada(base, 'entrada', 't', 'u', 'ts');
  assert.equal('chaveImportacao' in semChave, false);
  assert.equal(Object.values(semChave).includes(undefined), false);
});

test('semente do id separa tenant e tipo', () => {
  assert.notEqual(sementeIdImportacao('t1', 'entrada', 'K'), sementeIdImportacao('t2', 'entrada', 'K'));
  assert.notEqual(sementeIdImportacao('t1', 'entrada', 'K'), sementeIdImportacao('t1', 'saida', 'K'));
  assert.equal(sementeIdImportacao('t1', 'entrada', ' K '), sementeIdImportacao('t1', 'entrada', 'K'));
});

test('mensagem de sem cadastro mostra o CPF/CNPJ pontuado', () => {
  const v = resolverVinculoParte('11222333000181', 'X', []);
  assert.match(v.aviso, /11\.222\.333\/0001-81/);
});
