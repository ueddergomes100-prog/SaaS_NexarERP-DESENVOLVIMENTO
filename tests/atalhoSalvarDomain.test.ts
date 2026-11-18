import test from 'node:test';
import assert from 'node:assert/strict';
import { ehBotaoDeSalvar, escolherBotaoDeSalvar } from '../src/utils/atalhoSalvarDomain';

/*
 * F6 salva (18/11/2026): qual botao da tela o atalho aciona.
 */

const botao = (texto: string, extra: Partial<Parameters<typeof ehBotaoDeSalvar>[0]> = {}) => ({
  texto, noCabecalho: false, enviaFormulario: false, temIconeSalvar: false, marca: null, ...extra,
});

test('botao do cabecalho com o disquete e o gravar da tela, mesmo com outro nome', () => {
  assert.equal(ehBotaoDeSalvar(botao('Lançar Nota Avulsa', { noCabecalho: true, temIconeSalvar: true })), true);
  assert.equal(escolherBotaoDeSalvar([botao('Voltar'), botao('Criar Ordem', { noCabecalho: true, temIconeSalvar: true })]), 1);
  // Fora do cabecalho o disquete sozinho nao basta (ha' disquete em botao de linha de tabela).
  assert.equal(ehBotaoDeSalvar(botao('Aplicar', { temIconeSalvar: true })), false);
});

test('o que e botao de salvar', () => {
  assert.equal(ehBotaoDeSalvar(botao('Salvar Produto')), true);
  assert.equal(ehBotaoDeSalvar(botao('  Gravar\n Item ')), true);
  // Enquanto salva, e' o mesmo botao: o F6 nao pode cair em outra funcao.
  assert.equal(ehBotaoDeSalvar(botao('Salvando...')), true);
  // "Cadastrar" so' vale quando envia formulario; solto, costuma ABRIR uma janela ("Cadastrar Cliente").
  assert.equal(ehBotaoDeSalvar(botao('Cadastrar filial', { enviaFormulario: true })), true);
  assert.equal(ehBotaoDeSalvar(botao('Cadastrar Cliente')), false);
  assert.equal(ehBotaoDeSalvar(botao('Cancelar')), false);
  assert.equal(ehBotaoDeSalvar(botao('Confirmar baixa')), false);
  assert.equal(ehBotaoDeSalvar(botao('Buscar', { enviaFormulario: true })), false);
  // "Salvaguarda" nao e' "Salvar".
  assert.equal(ehBotaoDeSalvar(botao('Salvaguarda')), false);
});

test('cadastro comum: o salvar do cabecalho', () => {
  const tela = [botao('Voltar'), botao('Salvar Fornecedor', { noCabecalho: true }), botao('Buscar CEP')];
  assert.equal(escolherBotaoDeSalvar(tela), 1);
});

test('produto: "Salvar Produto" do cabecalho vence "Salvar Composição" la embaixo', () => {
  const tela = [botao('Salvar Produto', { noCabecalho: true }), botao('Salvar Composição')];
  assert.equal(escolherBotaoDeSalvar(tela), 0);
});

test('funcionario: o salvar do formulario vence os "Salvar senha" do meio da tela', () => {
  const tela = [botao('Salvar senha'), botao('Salvar senha'), botao('Cancelar'), botao('Salvar Funcionário', { enviaFormulario: true })];
  assert.equal(escolherBotaoDeSalvar(tela), 3);
});

test('janela com um salvar so', () => {
  assert.equal(escolherBotaoDeSalvar([botao('Cancelar'), botao('Salvar')]), 1);
  assert.equal(escolherBotaoDeSalvar([botao('Cancelar'), botao('Cadastrar filial', { enviaFormulario: true })]), 1);
});

test('na duvida, nao salva nada', () => {
  // Lista: nao tem salvar -- o F6 segue o que a tela ja' fazia.
  assert.equal(escolherBotaoDeSalvar([botao('Novo Produto', { noCabecalho: true }), botao('Mais opções')]), -1);
  // Dois "salvar" soltos e nenhum de formulario nem de cabecalho.
  assert.equal(escolherBotaoDeSalvar([botao('Salvar caixas'), botao('Salvar configuração')]), -1);
  // Dois no cabecalho.
  assert.equal(escolherBotaoDeSalvar([botao('Salvar', { noCabecalho: true }), botao('Salvar e fechar', { noCabecalho: true })]), -1);
  assert.equal(escolherBotaoDeSalvar([]), -1);
});

test('a marca no botao vence a regra', () => {
  // Aponta o certo onde ha' dois.
  assert.equal(escolherBotaoDeSalvar([botao('Salvar caixas'), botao('Salvar configuração', { marca: 'sim' })]), 1);
  // Tira o botao da conta.
  assert.equal(escolherBotaoDeSalvar([botao('Salvar OS', { noCabecalho: true, marca: 'nao' })]), -1);
  // Marca "sim" vale ate' para texto que a regra nao reconhece.
  assert.equal(escolherBotaoDeSalvar([botao('Concluir cadastro', { marca: 'sim' })]), 0);
});
