import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chaveNomeProduto,
  gtinValido,
  inferirMapeamentoFiscal,
  lerLinhasFiscais,
  mapeamentoVazio,
  ehTabelaIbpt,
  lerTabelaIbpt,
  planejarImportacaoIbpt,
  normalizarCest,
  normalizarCodigoBarras,
  normalizarNcm,
  planejarImportacaoFiscal,
  type LinhaFiscal,
  type ProdutoFiscalAtual,
} from '../src/utils/importacaoFiscalDomain';

const produto = (extra: Partial<ProdutoFiscalAtual> & { id: string; codigo: string; nome: string }): ProdutoFiscalAtual => ({
  codigoBarras: '', ncm: '', cest: '', embalagensBarras: [], ...extra,
});
const linha = (extra: Partial<LinhaFiscal> & { linha?: number }): LinhaFiscal => ({
  linha: 2, codigo: '', produto: '', codigoBarras: '', ncm: '', cest: '',
  cfop: '', csosn: '', cfopInterestadual: '', csosnInterestadual: '', origem: '', cstPis: '', cstCofins: '', cstIpi: '', enquadramentoIpi: '',
  percentualTributosFederal: '', percentualTributosEstadual: '', percentualTributosMunicipal: '', percentualTributos: '', ...extra,
});

test('GTIN: confere o dígito verificador de EAN-13, EAN-8 e UPC-A', () => {
  assert.equal(gtinValido('7898945717076'), true);
  assert.equal(gtinValido('7898945717077'), false);
  assert.equal(gtinValido('96385074'), true); // EAN-8
  assert.equal(gtinValido('036000291452'), true); // UPC-A
  assert.equal(gtinValido('123'), false);
});

test('código de barras: EAN-13 com zero a mais vira EAN-13; inválido e notação científica são explicados', () => {
  assert.deepEqual(normalizarCodigoBarras('07898945717083'), { valor: '7898945717083', erro: '' });
  assert.deepEqual(normalizarCodigoBarras(' 7898945717076 '), { valor: '7898945717076', erro: '' });
  assert.deepEqual(normalizarCodigoBarras(''), { valor: '', erro: '' });
  assert.match(normalizarCodigoBarras('7898945717077').erro, /inválido/);
  assert.match(normalizarCodigoBarras('7.89894571708E+12').erro, /notação científica/);
});

test('NCM: 8 dígitos; o zero da frente que o Excel come é devolvido; lixo é recusado', () => {
  assert.equal(normalizarNcm('17011300').valor, '17011300');
  assert.equal(normalizarNcm('1701.13.00').valor, '17011300');
  assert.equal(normalizarNcm('8132010').valor, '08132010');
  assert.match(normalizarNcm('1701').erro, /8 dígitos/);
  assert.match(normalizarNcm('00000000').erro, /8 dígitos/);
  assert.deepEqual(normalizarNcm(''), { valor: '', erro: '' });
});

test('CEST: 7 dígitos; 6 dígitos recebem o zero da frente', () => {
  assert.equal(normalizarCest('1710300').valor, '1710300');
  assert.equal(normalizarCest('17.103.00').valor, '1710300');
  assert.equal(normalizarCest('100100').valor, '0100100');
  assert.match(normalizarCest('17103').erro, /7 dígitos/);
});

test('cabeçalho: "Código de barras" não vira o "Código" do produto', () => {
  const m = inferirMapeamentoFiscal(['Código', 'Produto', 'Código de barras', 'NCM', 'CEST', 'Observação']);
  assert.deepEqual(m, { ...mapeamentoVazio(), codigo: 0, produto: 1, codigoBarras: 2, ncm: 3, cest: 4 });
  const m2 = inferirMapeamentoFiscal(['Descrição', 'EAN', 'NCM/SH', 'Cód. CEST']);
  assert.equal(m2.produto, 0);
  assert.equal(m2.codigoBarras, 1);
  assert.equal(m2.ncm, 2);
});

test('leitura: pula linha vazia e numera pela linha do arquivo', () => {
  const m = inferirMapeamentoFiscal(['Código', 'Produto', 'Código de barras', 'NCM', 'CEST']);
  const l = lerLinhasFiscais([['10', 'ACUCAR', '789', '1701', ''], ['', '', '', '', ''], ['11', 'ARROZ', '', '', '']], m);
  assert.equal(l.length, 2);
  assert.equal(l[0].linha, 2);
  assert.equal(l[1].linha, 4);
});

test('nome: acento, caixa, hífen e espaço duplo não diferenciam', () => {
  assert.equal(chaveNomeProduto('ORA-PRO-NOBIS  EM PÓ 150 G'), chaveNomeProduto('ora pro nobis em po 150 g'));
});

const base = [
  produto({ id: 'a', codigo: '10', nome: 'ACUCAR MASCAVO 500G' }),
  produto({ id: 'b', codigo: '11', nome: 'ARROZ INTEGRAL 1KG', codigoBarras: '7898945717137', ncm: '10063019', cest: '' }),
  produto({ id: 'c', codigo: '12', nome: 'AVEIA LAMINADA 400G', embalagensBarras: ['7898945717281'] }),
];

test('plano: produto vazio é preenchido nos três campos', () => {
  const { resultados, resumo } = planejarImportacaoFiscal({
    linhas: [linha({ codigo: '10', codigoBarras: '7898945717076', ncm: '17011300', cest: '1710300' })],
    produtos: base, sobrescrever: false,
  });
  assert.equal(resultados[0].status, 'atualizar');
  assert.deepEqual(resultados[0].grava, { codigoBarras: '7898945717076', ncm: '17011300', cest: '1710300' });
  assert.deepEqual(resultados[0].mudancas.map((m) => m.tipo), ['preencher', 'preencher', 'preencher']);
  assert.equal(resumo.atualizar, 1);
});

test('plano: célula vazia na planilha nunca apaga o que o produto já tem', () => {
  const { resultados } = planejarImportacaoFiscal({
    linhas: [linha({ codigo: '11', codigoBarras: '', ncm: '', cest: '1710300' })],
    produtos: base, sobrescrever: true,
  });
  assert.deepEqual(resultados[0].grava, { cest: '1710300' });
});

test('plano: valor já preenchido e diferente é conflito, e só troca com "sobrescrever"', () => {
  const linhas = [linha({ codigo: '11', ncm: '17011300' })];
  const sem = planejarImportacaoFiscal({ linhas, produtos: base, sobrescrever: false });
  assert.equal(sem.resultados[0].status, 'conflito');
  assert.deepEqual(sem.resultados[0].grava, {});
  assert.match(sem.resultados[0].problemas[0], /já preenchido \(10063019\)/);
  const com = planejarImportacaoFiscal({ linhas, produtos: base, sobrescrever: true });
  assert.equal(com.resultados[0].status, 'atualizar');
  assert.equal(com.resultados[0].mudancas[0].tipo, 'trocar');
});

test('plano: valor igual ao do produto é "já está igual"', () => {
  const { resultados } = planejarImportacaoFiscal({ linhas: [linha({ codigo: '11', ncm: '10063019', codigoBarras: '7898945717137' })], produtos: base, sobrescrever: false });
  assert.equal(resultados[0].status, 'sem_mudanca');
});

test('plano: campo inválido é ignorado e explicado, o resto da linha vale', () => {
  const { resultados } = planejarImportacaoFiscal({
    linhas: [linha({ codigo: '10', codigoBarras: '7898945717077', ncm: '17011300' })],
    produtos: base, sobrescrever: false,
  });
  assert.equal(resultados[0].status, 'atualizar');
  assert.deepEqual(resultados[0].grava, { ncm: '17011300' });
  assert.match(resultados[0].problemas.join(' '), /inválido/);
});

test('plano: só campo inválido vira "com problema"', () => {
  const { resultados } = planejarImportacaoFiscal({ linhas: [linha({ codigo: '10', ncm: '17' })], produtos: base, sobrescrever: false });
  assert.equal(resultados[0].status, 'erro');
});

test('plano: o mesmo código de barras em dois produtos da planilha é recusado nos dois', () => {
  const { resultados } = planejarImportacaoFiscal({
    linhas: [linha({ linha: 2, codigo: '10', codigoBarras: '7898945717076' }), linha({ linha: 3, codigo: '12', codigoBarras: '7898945717076' })],
    produtos: base, sobrescrever: false,
  });
  assert.deepEqual(resultados.map((r) => r.status), ['erro', 'erro']);
  assert.match(resultados[0].problemas[0], /também está na linha 3/);
});

test('plano: código de barras que já é de outro produto (ou embalagem) é recusado', () => {
  const { resultados } = planejarImportacaoFiscal({
    linhas: [linha({ codigo: '10', codigoBarras: '7898945717137' }), linha({ codigo: '10', codigoBarras: '7898945717281' })],
    produtos: base, sobrescrever: false,
  });
  assert.equal(resultados[0].status, 'erro');
  assert.match(resultados[0].problemas[0], /já pertence a "ARROZ INTEGRAL 1KG"/);
  assert.equal(resultados[1].status, 'erro');
  assert.match(resultados[1].problemas[0], /já pertence a "AVEIA LAMINADA 400G"/);
});

test('plano: o código de barras do próprio produto não conta como "de outro"', () => {
  const { resultados } = planejarImportacaoFiscal({ linhas: [linha({ codigo: '11', codigoBarras: '7898945717137' })], produtos: base, sobrescrever: false });
  assert.equal(resultados[0].status, 'sem_mudanca');
});

test('achar o produto: por código (ignora zero da frente), senão por nome; nunca chuta', () => {
  const { resultados } = planejarImportacaoFiscal({
    linhas: [
      linha({ codigo: '010', ncm: '17011300' }),
      linha({ produto: 'arroz integral 1kg', ncm: '10063019', cest: '1710300' }),
      linha({ codigo: '999', ncm: '17011300' }),
      linha({}),
    ],
    produtos: base, sobrescrever: false,
  });
  assert.equal(resultados[0].produto?.id, 'a');
  assert.equal(resultados[1].produto?.id, 'b');
  assert.equal(resultados[2].status, 'nao_encontrado');
  assert.match(resultados[2].problemas[0], /Nenhum produto com o código 999/);
  assert.equal(resultados[3].status, 'nao_encontrado');
});

test('achar o produto: código repetido ou nome repetido no cadastro é ambíguo, não escolhe', () => {
  const dup = [produto({ id: 'x', codigo: '5', nome: 'CAFE' }), produto({ id: 'y', codigo: '5', nome: 'CAFE' })];
  const { resultados } = planejarImportacaoFiscal({ linhas: [linha({ codigo: '5', ncm: '17011300' }), linha({ produto: 'café', ncm: '17011300' })], produtos: dup, sobrescrever: false });
  assert.deepEqual(resultados.map((r) => r.status), ['ambiguo', 'ambiguo']);
});

test('CEST sem NCM (na planilha e no produto) avisa', () => {
  const { resultados } = planejarImportacaoFiscal({ linhas: [linha({ codigo: '10', cest: '1710300' })], produtos: base, sobrescrever: false });
  assert.equal(resultados[0].status, 'atualizar');
  assert.match(resultados[0].problemas.join(' '), /não tem NCM/);
});

test('tributação: cabeçalho do modelo é reconhecido coluna a coluna', () => {
  const m = inferirMapeamentoFiscal(['Código', 'Produto', 'Código de barras', 'NCM', 'CEST', 'CFOP', 'CSOSN/CST ICMS', 'CFOP interestadual', 'CSOSN/CST interestadual', 'Origem', 'CST PIS', 'CST COFINS', 'CST IPI', 'Enquadramento IPI', '% Tributos']);
  assert.deepEqual(m, {
    codigo: 0, produto: 1, codigoBarras: 2, ncm: 3, cest: 4, cfop: 5, csosn: 6, cfopInterestadual: 7, csosnInterestadual: 8, origem: 9, cstPis: 10, cstCofins: 11, cstIpi: 12, enquadramentoIpi: 13,
    percentualTributosFederal: null, percentualTributosEstadual: null, percentualTributosMunicipal: null, percentualTributos: 14,
  });
});

test('tributação: formatos do ERP antigo são normalizados (CFOP 5.1020, CST 060, PIS 1)', () => {
  const produtos = [produto({ id: 'a', codigo: '28', nome: 'FARINHA DE AVEIA 500G', ncm: '11041200', csosn: '00' })];
  const { resultados } = planejarImportacaoFiscal({
    linhas: [linha({ codigo: '28', cfop: '5.1020', csosn: '102', origem: '0', cstPis: '99', cstCofins: '99', cstIpi: '99', enquadramentoIpi: '999', percentualTributos: '13,45' })],
    produtos, sobrescrever: true, regime: 'simples_nacional',
  });
  assert.equal(resultados[0].status, 'atualizar');
  assert.deepEqual(resultados[0].grava, { cfop: '5102', csosn: '102', origem: '0', cstPis: '99', cstCofins: '99', cstIpi: '99', enquadramentoIpi: '999', percentualTributos: 13.45 });
});

test('tributação: CSOSN "00" (CST) sobre produto com CST é conflito sem "sobrescrever"; CST numa empresa do Simples é recusado', () => {
  const produtos = [produto({ id: 'a', codigo: '28', nome: 'X', csosn: '00' })];
  const semSobrescrever = planejarImportacaoFiscal({ linhas: [linha({ codigo: '28', csosn: '102' })], produtos, sobrescrever: false, regime: 'simples_nacional' });
  assert.equal(semSobrescrever.resultados[0].status, 'conflito');
  const cstNoSimples = planejarImportacaoFiscal({ linhas: [linha({ codigo: '28', csosn: '060' })], produtos, sobrescrever: true, regime: 'simples_nacional' });
  assert.equal(cstNoSimples.resultados[0].status, 'erro');
  assert.match(cstNoSimples.resultados[0].problemas[0], /não é um CSOSN/);
  const cstNoNormal = planejarImportacaoFiscal({ linhas: [linha({ codigo: '28', csosn: '060' })], produtos, sobrescrever: true, regime: 'lucro_real' });
  assert.deepEqual(cstNoNormal.resultados[0].grava, { csosn: '60' });
});

test('tributação: CST de IPI de entrada, CFOP de entrada e percentual absurdo são explicados', () => {
  const produtos = [produto({ id: 'a', codigo: '1', nome: 'X' })];
  const { resultados } = planejarImportacaoFiscal({ linhas: [linha({ codigo: '1', cstIpi: '01', cfop: '1102', percentualTributos: '150' })], produtos, sobrescrever: false });
  assert.equal(resultados[0].status, 'erro');
  assert.equal(resultados[0].problemas.length, 3);
});

test('IBPT: reconhece o arquivo oficial, ignora serviços e exceções, aplica pelo NCM e pela origem', () => {
  const cab = ['codigo', 'ex', 'tipo', 'descricao', 'nacionalfederal', 'importadosfederal', 'estadual', 'municipal', 'vigenciainicio', 'vigenciafim', 'chave', 'versao', 'fonte'];
  assert.equal(ehTabelaIbpt(cab), true);
  assert.equal(ehTabelaIbpt(['Código', 'Produto', 'NCM']), false);
  const tabela = lerTabelaIbpt(cab, [
    ['11041200', '', '0', 'Grãos esmagados de aveia', '4,20', '6,10', '9,25', '0,00', '01/07/2026', '31/12/2026', 'X', '26.2.A', 'IBPT'],
    ['11041200', '01', '0', 'Exceção', '1', '1', '1', '0', '', '', '', '', ''],
    ['1401', '', '1', 'Serviço', '5', '5', '0', '2', '', '', '', '', ''],
    ['8132010', '', '0', 'Ameixa', '3', '5', '18', '0', '', '', '', '', ''],
  ]);
  assert.equal(tabela.porNcm.size, 2);
  assert.equal(tabela.versao, '26.2.A');
  assert.deepEqual(tabela.porNcm.get('11041200'), { nacionalFederal: 4.2, importadosFederal: 6.1, estadual: 9.25, municipal: 0 });
  assert.ok(tabela.porNcm.has('08132010'));

  const produtos = [
    produto({ id: 'a', codigo: '1', nome: 'AVEIA', ncm: '11041200', origem: '0', percentualTributos: '13.45' }),
    produto({ id: 'b', codigo: '2', nome: 'AVEIA IMPORTADA', ncm: '11041200', origem: '1' }),
    produto({ id: 'c', codigo: '3', nome: 'SEM NCM', ncm: '' }),
  ];
  const { resultados, resumo } = planejarImportacaoIbpt({ tabela, produtos });
  assert.deepEqual(resultados[0].grava, { percentualTributosFederal: 4.2, percentualTributosEstadual: 9.25, percentualTributosMunicipal: 0, percentualTributos: 0 });
  assert.equal(resultados[1].grava.percentualTributosFederal, 6.1);
  assert.equal(resultados[2].status, 'erro');
  assert.equal(resumo.atualizar, 2);
});
