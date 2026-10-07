import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PERMISSAO_UTILIZA_OUTRAS_FILIAIS,
  cnpjValido,
  configuracaoInicialDaFilial,
  filiaisDoUsuario,
  filialAtivaParaGravar,
  lerDadosDaFilial,
  lerGrupo,
  matrizAPartirDaConfiguracao,
  proximoCodigoDeFilial,
  validarDadosDaFilial,
  validarNomeECodigoDaFilial,
  validarTrocaDeFilial, mensalidadeComFiliais, erroLimiteDeFiliais, lerLimiteFiliais, lerPercentualFilial, acharCodigoIbge, identidadeParaConfiguracao, dadosDaFilialNaConfiguracao } from '../src/utils/filialDomain';

const CNPJ_MATRIZ = '11222333000181';
const CNPJ_FILIAL = '11222333000262';

const grupo = lerGrupo('g1', {
  nome: 'Shopping Rural',
  donoUid: 'dono',
  matrizTenantId: 'dono',
  filiais: [
    { tenantId: 'baixada', codigo: '20', nome: 'Loja Baixada', cnpj: CNPJ_FILIAL, uf: 'ES', cidade: 'Serra', tipo: 'cnpj_proprio' },
    { tenantId: 'dono', codigo: '10', nome: 'Loja Centro', cnpj: CNPJ_MATRIZ, uf: 'ES', cidade: 'Vitória', matriz: true },
    { tenantId: 'deposito', codigo: '30', nome: 'Depósito', cnpj: CNPJ_MATRIZ, uf: 'ES', cidade: 'Serra', tipo: 'mesmo_cnpj', ativa: false },
  ],
});

test('grupo: filiais em ordem de codigo, nomes em caixa alta', () => {
  assert.deepEqual(grupo.filiais.map((f) => f.codigo), ['10', '20', '30']);
  assert.equal(grupo.filiais[1].nome, 'LOJA BAIXADA');
  assert.equal(grupo.filiais[2].tipo, 'mesmo_cnpj');
});

test('acesso: dono e admin entram em todas as ativas; funcionario so com "Utiliza outras filiais"', () => {
  assert.deepEqual(filiaisDoUsuario(grupo, { uid: 'dono', role: 'Master', tenantId: 'dono' }).map((f) => f.tenantId), ['dono', 'baixada']);
  assert.deepEqual(filiaisDoUsuario(grupo, { uid: 'a1', role: 'Admin', tenantId: 'baixada' }).map((f) => f.codigo), ['10', '20']);
  assert.deepEqual(filiaisDoUsuario(grupo, { uid: 'f1', role: 'Funcionario', tenantId: 'baixada' }).map((f) => f.codigo), ['20']);
  const comPermissao = { uid: 'f2', role: 'Funcionario', tenantId: 'baixada', permissoes: [PERMISSAO_UTILIZA_OUTRAS_FILIAIS] };
  assert.deepEqual(filiaisDoUsuario(grupo, comPermissao).map((f) => f.codigo), ['10', '20']);
  // Casa fora do grupo (outra empresa): nada, mesmo sendo Master.
  assert.deepEqual(filiaisDoUsuario(grupo, { uid: 'x', role: 'Master', tenantId: 'outra' }), []);
});

test('troca: mensagens em portugues para cada bloqueio', () => {
  const funcionario = { uid: 'f1', role: 'Funcionario', tenantId: 'baixada' };
  assert.match(validarTrocaDeFilial(grupo, funcionario, 'dono') ?? '', /Utiliza outras filiais/);
  assert.equal(validarTrocaDeFilial(grupo, funcionario, 'baixada'), null, 'voltar para a propria filial sempre pode');
  const dono = { uid: 'dono', role: 'Master', tenantId: 'dono' };
  assert.match(validarTrocaDeFilial(grupo, dono, 'deposito') ?? '', /inativa/);
  assert.match(validarTrocaDeFilial(grupo, dono, 'nao-existe') ?? '', /não faz parte/);
  assert.match(validarTrocaDeFilial(null, dono, 'baixada') ?? '', /não tem filiais/);
  assert.equal(validarTrocaDeFilial(grupo, dono, 'baixada'), null);
});

test('troca: voltar para casa apaga a filial ativa', () => {
  assert.equal(filialAtivaParaGravar({ uid: 'dono', tenantId: 'dono' }, 'dono'), null);
  assert.equal(filialAtivaParaGravar({ uid: 'dono', tenantId: 'dono' }, 'baixada'), 'baixada');
});

test('cadastro: codigo de 10 em 10, CNPJ valido e sem repetir', () => {
  assert.equal(proximoCodigoDeFilial(grupo), '40');
  assert.equal(proximoCodigoDeFilial(null), '10');
  assert.equal(cnpjValido(CNPJ_FILIAL), true);
  assert.equal(cnpjValido('11222333000180'), false);
  const nova = (extra: Record<string, unknown> = {}) => lerDadosDaFilial({ codigo: '40', nome: 'Loja Norte', uf: 'MG', cidade: 'Mantena', cnpj: '11.222.333/0003-43', ...extra });
  assert.equal(validarDadosDaFilial(nova(), grupo, CNPJ_MATRIZ), null);
  assert.match(validarDadosDaFilial(nova({ codigo: '20' }), grupo, CNPJ_MATRIZ) ?? '', /já é da filial 20 · LOJA BAIXADA/);
  assert.match(validarDadosDaFilial(nova({ cnpj: CNPJ_FILIAL }), grupo, CNPJ_MATRIZ) ?? '', /já é da filial/);
  assert.match(validarDadosDaFilial(nova({ cnpj: CNPJ_MATRIZ }), grupo, CNPJ_MATRIZ) ?? '', /Mesmo CNPJ da matriz/);
  assert.match(validarDadosDaFilial(nova({ cnpj: '123' }), grupo, CNPJ_MATRIZ) ?? '', /não é válido/);
  assert.match(validarDadosDaFilial(nova({ uf: '' }), grupo, CNPJ_MATRIZ) ?? '', /estado/);
  assert.match(validarDadosDaFilial(nova({ nome: '' }), grupo, CNPJ_MATRIZ) ?? '', /nome da filial/);
  assert.equal(validarDadosDaFilial(nova({ tipo: 'mesmo_cnpj', cnpj: '' }), grupo, CNPJ_MATRIZ), null);
  // Editar a propria filial nao acusa o proprio codigo (nem a matriz o proprio CNPJ).
  const baixada = lerDadosDaFilial({ codigo: '20', nome: 'Baixada', uf: 'ES', cidade: 'Serra', cnpj: CNPJ_FILIAL });
  assert.equal(validarDadosDaFilial(baixada, grupo, CNPJ_MATRIZ, 'baixada'), null);
  assert.equal(validarNomeECodigoDaFilial({ nome: 'CENTRO', codigo: '10' }, grupo, 'dono'), null);
  assert.match(validarNomeECodigoDaFilial({ nome: 'CENTRO', codigo: '20' }, grupo, 'dono') ?? '', /já é da filial 20/);
});

test('configuracao da filial: copia as regras da matriz, nunca a identidade nem a Spedy', () => {
  const matriz = {
    tenantId: 'dono', cnpj: CNPJ_MATRIZ, razaoSocial: 'SHOPPING RURAL LTDA', nomeOficina: 'LOJA CENTRO', inscricaoEstadual: '123',
    rua: 'RUA A', cidade: 'VITORIA', uf: 'ES', telefone: '27 3333-0000', spedyApiKey: 'segredo', spedyCompanyId: 'sp1', spedyEnabled: true,
    trabalhaComPreVenda: true, ordemFormasPagamento: ['pix', 'dinheiro'], limiteDescontoPdv: 5, logo: 'https://logo', campoVazio: undefined,
  };
  const dados = lerDadosDaFilial({ codigo: '20', nome: 'Loja Baixada', uf: 'ES', cidade: 'Serra', cnpj: CNPJ_FILIAL, razaoSocial: 'SHOPPING RURAL BAIXADA LTDA' });
  const contexto = { tenantId: 'baixada', grupoId: 'g1', cnpjMatriz: CNPJ_MATRIZ, razaoSocialMatriz: 'SHOPPING RURAL LTDA' };
  const config = configuracaoInicialDaFilial(matriz, dados, contexto);
  assert.equal(config.tenantId, 'baixada');
  assert.equal(config.grupoId, 'g1');
  assert.equal(config.cnpj, CNPJ_FILIAL);
  assert.equal(config.razaoSocial, 'SHOPPING RURAL BAIXADA LTDA');
  assert.equal(config.nomeOficina, 'LOJA BAIXADA');
  assert.equal(config.inscricaoEstadual, '');
  assert.equal(config.telefone, '');
  assert.equal(config.spedyEnabled, false);
  assert.equal('spedyApiKey' in config, false);
  assert.equal('spedyCompanyId' in config, false);
  assert.equal(config.trabalhaComPreVenda, true);
  assert.deepEqual(config.ordemFormasPagamento, ['pix', 'dinheiro']);
  assert.equal(config.logo, 'https://logo');
  assert.equal(Object.values(config).some((v) => v === undefined), false, 'nunca grava undefined');
  // Mesmo CNPJ: CNPJ e razao social da matriz.
  const dadosDeposito = lerDadosDaFilial({ codigo: '30', nome: 'Depósito', uf: 'ES', cidade: 'Serra', tipo: 'mesmo_cnpj' });
  const deposito = configuracaoInicialDaFilial(matriz, dadosDeposito, { ...contexto, tenantId: 'dep' });
  assert.equal(deposito.cnpj, CNPJ_MATRIZ);
  assert.equal(deposito.razaoSocial, 'SHOPPING RURAL LTDA');
});

test('matriz: a empresa atual vira a filial 10 com os dados dela', () => {
  const m = matrizAPartirDaConfiguracao('dono', { nomeOficina: 'Loja Centro', cnpj: '11.222.333/0001-81', uf: 'es', cidade: 'Vitória' });
  assert.deepEqual(m, { tenantId: 'dono', codigo: '10', nome: 'LOJA CENTRO', cnpj: CNPJ_MATRIZ, uf: 'ES', cidade: 'VITÓRIA', tipo: 'cnpj_proprio', matriz: true, ativa: true });
});

test('cobranca: filial ativa alem da matriz paga um % da mensalidade; sem % definido nao soma', () => {
  const filial = (codigo: string, matriz: boolean, ativa = true) => ({ tenantId: codigo, codigo, nome: codigo, cnpj: '', uf: '', cidade: '', tipo: 'cnpj_proprio' as const, matriz, ativa });
  const grupo = { filiais: [filial('10', true), filial('20', false), filial('30', false), filial('40', false, false)] };
  assert.deepEqual(mensalidadeComFiliais(149.9, grupo, 30), { filiais: 2, percentual: 30, valorPorFilial: 44.97, adicional: 89.94, total: 239.84 });
  assert.deepEqual(mensalidadeComFiliais(149.9, grupo, undefined), { filiais: 2, percentual: 0, valorPorFilial: 0, adicional: 0, total: 149.9 });
  assert.deepEqual(mensalidadeComFiliais(149.9, null, 30), { filiais: 0, percentual: 30, valorPorFilial: 44.97, adicional: 0, total: 149.9 });
  assert.equal(lerPercentualFilial(150), 100);
});

test('cidade da filial: codigo IBGE casado pelo nome sem acento; identidade só grava a cidade fiscal quando tem o codigo', () => {
  const municipios = [{ id: 3205309, nome: 'Vitória' }, { id: 3205002, nome: 'Serra' }, { id: 3201308, nome: 'Cachoeiro de Itapemirim' }];
  assert.equal(acharCodigoIbge(municipios, 'VITORIA'), '3205309');
  assert.equal(acharCodigoIbge(municipios, 'cachoeiro de itapemirim'), '3201308');
  assert.equal(acharCodigoIbge(municipios, 'Vila Velha'), '');
  const base = lerDadosDaFilial({ codigo: '20', nome: 'Baixada', cidade: 'Serra', uf: 'es', codigoIbge: '3205002' });
  const com = identidadeParaConfiguracao(base);
  assert.deepEqual([com.nfseCidadeCodigo, com.nfseCidadeNome, com.nfseCidadeEstado, com.codigoIbge], ['3205002', 'SERRA', 'ES', '3205002']);
  const sem = identidadeParaConfiguracao(lerDadosDaFilial({ ...base, codigoIbge: '12' }));
  assert.equal('nfseCidadeCodigo' in sem, false, 'codigo invalido e\' descartado e a cidade fiscal fica como estava');
  assert.equal(dadosDaFilialNaConfiguracao({ tenantId: 'x', codigo: '20', nome: 'B', cnpj: '', uf: 'ES', cidade: 'SERRA', tipo: 'cnpj_proprio', matriz: false, ativa: true }, { nfseCidadeCodigo: '3205002' }).codigoIbge, '3205002');
});

test('limite de filiais do plano: matriz nao conta; 0 = nao liberado', () => {
  const filial = (codigo: string, matriz: boolean, ativa = true) => ({ tenantId: codigo, codigo, nome: codigo, cnpj: '', uf: '', cidade: '', tipo: 'cnpj_proprio' as const, matriz, ativa });
  const grupo = { filiais: [filial('10', true), filial('20', false), filial('30', false, false)] };
  assert.match(String(erroLimiteDeFiliais(null, 0)), /não tem filiais liberadas/);
  assert.equal(erroLimiteDeFiliais(null, 1), null);
  assert.match(String(erroLimiteDeFiliais(grupo, 1)), /já usa a filial do plano/);
  assert.equal(erroLimiteDeFiliais(grupo, 2), null, 'a inativa (30) nao conta');
  assert.equal(lerLimiteFiliais('3.7'), 3);
  assert.equal(lerLimiteFiliais(undefined), 0);
});
