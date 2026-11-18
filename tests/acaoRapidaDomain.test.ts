import test from 'node:test';
import assert from 'node:assert/strict';
import { ehAcaoDeCadastro, textoDoBotao } from '../src/utils/acaoRapidaDomain';

/*
 * Qual botao do cabecalho vai para a barra que acompanha a rolagem (18/11/2026):
 * so' o de cadastrar.
 */

const botao = (texto: string, extra: Partial<Parameters<typeof ehAcaoDeCadastro>[0]> = {}) => ({
  texto, temIconeMais: false, abreMenu: false, marca: null, ...extra,
});

test('botao de cadastrar entra: pelo icone "+" ou pelo comeco do texto', () => {
  assert.equal(ehAcaoDeCadastro(botao('Novo Produto', { temIconeMais: true })), true);
  assert.equal(ehAcaoDeCadastro(botao('Emitir Nota Fiscal', { temIconeMais: true })), true);
  // Sem o icone, vale o texto (Caixa: "Nova Receita"; Transferencias: "Nova transferência").
  assert.equal(ehAcaoDeCadastro(botao('Nova Receita')), true);
  assert.equal(ehAcaoDeCadastro(botao('  Nova\n  transferência ')), true);
  assert.equal(ehAcaoDeCadastro(botao('Lançar Despesa')), true);
  assert.equal(ehAcaoDeCadastro(botao('NOVO')), true);
});

test('o resto do cabecalho fica de fora', () => {
  assert.equal(ehAcaoDeCadastro(botao('Salvar')), false);
  assert.equal(ehAcaoDeCadastro(botao('Gerar relatório')), false);
  assert.equal(ehAcaoDeCadastro(botao('Imprimir 2')), false);
  // "Novamente" nao e' "Novo".
  assert.equal(ehAcaoDeCadastro(botao('Novamente')), false);
  // Botao so' de icone nao tem o que escrever.
  assert.equal(ehAcaoDeCadastro(botao('', { temIconeMais: true })), false);
  // Botao que abre menu ("Nova ação" do Painel): o menu abriria la' em cima, fora da vista.
  assert.equal(ehAcaoDeCadastro(botao('Nova ação', { temIconeMais: true, abreMenu: true })), false);
});

test('a marca no botao vence a convencao', () => {
  assert.equal(ehAcaoDeCadastro(botao('Salvar', { marca: 'sim' })), true);
  assert.equal(ehAcaoDeCadastro(botao('Novo Produto', { temIconeMais: true, marca: 'nao' })), false);
  // Nem a marca "sim" poe na barra um botao que abre menu.
  assert.equal(ehAcaoDeCadastro(botao('Nova ação', { marca: 'sim', abreMenu: true })), false);
});

test('texto do botao sai limpo', () => {
  assert.equal(textoDoBotao('\n   Novo\n   Produto  '), 'Novo Produto');
  assert.equal(textoDoBotao(null), '');
});
