import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchClients } from '../src/utils/clientSearch';

const clients = [
  { id: '1', nome: 'João da Silva', codigo: '10' },
  { id: '2', nome: 'Maria Souza', codigo: '2' },
  { id: '3', nome: 'José Pereira', codigo: '23' },
];

test('searchClients retorna todos quando o termo esta vazio', () => {
  assert.equal(searchClients(clients, '').length, 3);
});

test('searchClients encontra por nome em qualquer posicao, sem acento e sem caixa', () => {
  const result = searchClients(clients, 'jose');
  assert.deepEqual(result.map((c) => c.id), ['3']);
});

test('searchClients encontra ocorrencia no meio do nome', () => {
  const result = searchClients(clients, 'souza');
  assert.deepEqual(result.map((c) => c.id), ['2']);
});

test('searchClients nao encontra nada para termo sem match', () => {
  assert.equal(searchClients(clients, 'zzz').length, 0);
});

test('searchClients encontra por codigo exato', () => {
  const result = searchClients(clients, '2');
  // "2" bate no codigo do cliente 2 (exato) e no codigo do cliente 3 ("23",
  // prefixo) -- ambos sao resultados validos de uma busca parcial.
  assert.deepEqual(result.map((c) => c.id).sort(), ['2', '3']);
});

test('searchClients encontra por prefixo de codigo', () => {
  const result = searchClients(clients, '10');
  assert.deepEqual(result.map((c) => c.id), ['1']);
});

// ---------------------------------------------------------------------------
// Filtro por cidade/estado e busca por documento/telefone (2026-10-06)
// ---------------------------------------------------------------------------
import {
  FILTRO_LOCAL_VAZIO,
  SEM_CIDADE,
  chaveCidadeDoCliente,
  listarLocaisDosClientes,
  rotuloFiltroLocal,
} from '../src/utils/clientSearch';

const base = [
  { id: 'a', nome: 'SUPERMERCADO CANAL LTDA', codigo: '4118', cidade: 'Mucurici', estado: 'ES', documento: '45.545.413/0001-90', telefone: '(27) 3357-1551' },
  { id: 'b', nome: 'SUPERMERCADO PAMI LTDA', codigo: '3930', fantasia: 'ATACAREJO CAPARAO', cidade: 'IUNA', estado: 'es' },
  { id: 'c', nome: 'MERCADO PRECIOSO LTDA', codigo: '3868', cidade: 'Coronel Pacheco', estado: 'MG', bairro: 'Centro' },
  { id: 'd', nome: 'DROGARIA VELASCO LTDA', codigo: '3978', cidade: 'Itaguaçu', estado: 'ES', endereco: 'Rua Supermercado Velho' },
  { id: 'e', nome: 'ELAINE AGUIAR FREITAS', codigo: '4043', cidade: 'ITAGUACU', estado: 'ES' },
  { id: 'f', nome: 'JOAO BATISTA ROSSE', codigo: '3870' },
];

test('cidade e estado ignoram acento e caixa: Itaguaçu e ITAGUACU sao a mesma cidade', () => {
  assert.equal(chaveCidadeDoCliente(base[3]), chaveCidadeDoCliente(base[4]));
  assert.equal(chaveCidadeDoCliente(base[5]), SEM_CIDADE);
});

test('listarLocaisDosClientes conta clientes por cidade e por estado, em ordem alfabetica', () => {
  const locais = listarLocaisDosClientes(base);
  assert.deepEqual(locais.ufs, [{ uf: 'ES', total: 4 }, { uf: 'MG', total: 1 }]);
  assert.deepEqual(locais.cidades.map((c) => [c.cidade, c.uf, c.total]), [
    ['CORONEL PACHECO', 'MG', 1],
    ['ITAGUAÇU', 'ES', 2],
    ['IUNA', 'ES', 1],
    ['MUCURICI', 'ES', 1],
  ]);
  assert.equal(locais.semCidade, 1);
});

test('filtro de cidade: lista so os clientes daquela cidade, com e sem termo', () => {
  const locais = listarLocaisDosClientes(base);
  const itaguacu = locais.cidades.find((c) => c.uf === 'ES' && c.cidade.startsWith('ITAGUA'));
  const filtro = { uf: 'ES', cidade: itaguacu?.chave ?? null };
  assert.deepEqual(searchClients(base, '', filtro).map((c) => c.id), ['d', 'e']);
  assert.deepEqual(searchClients(base, '#', filtro).map((c) => c.id), ['d', 'e']);
  assert.deepEqual(searchClients(base, 'elaine', filtro).map((c) => c.id), ['e']);
  assert.equal(rotuloFiltroLocal(filtro, locais), 'ITAGUAÇU · ES');
});

test('filtro so de estado e opcao "sem cidade"', () => {
  assert.deepEqual(searchClients(base, '', { uf: 'MG', cidade: null }).map((c) => c.id), ['c']);
  assert.deepEqual(searchClients(base, '', { uf: null, cidade: SEM_CIDADE }).map((c) => c.id), ['f']);
  assert.equal(searchClients(base, '', FILTRO_LOCAL_VAZIO).length, base.length);
});

test('busca por fantasia, CPF/CNPJ e telefone com ou sem pontuacao', () => {
  assert.deepEqual(searchClients(base, 'caparao').map((c) => c.id), ['b']);
  assert.deepEqual(searchClients(base, '45545413').map((c) => c.id), ['a']);
  assert.deepEqual(searchClients(base, '45.545.413').map((c) => c.id), ['a']);
  assert.deepEqual(searchClients(base, '3357-1551').map((c) => c.id), ['a']);
});

test('nome que comeca com o termo vem antes; quem so casou pelo endereco vem por ultimo', () => {
  // "supermercado": dois nomes comecam com ele; a drogaria so tem no endereco.
  assert.deepEqual(searchClients(base, 'supermercado').map((c) => c.id), ['a', 'b', 'd']);
  // "mercado": comeca o nome do MERCADO PRECIOSO; os supermercados casam no meio.
  assert.deepEqual(searchClients(base, 'mercado').map((c) => c.id), ['c', 'a', 'b', 'd']);
});

test('codigo exato vem primeiro e "+" junta nome com cidade', () => {
  assert.equal(searchClients(base, '3868')[0].id, 'c');
  assert.deepEqual(searchClients(base, 'drogaria+itaguacu').map((c) => c.id), ['d']);
  assert.deepEqual(searchClients(base, 'mercado+centro').map((c) => c.id), ['c']);
});

// ---------------------------------------------------------------------------
// Todos os filtros da consulta (Integra): situacao, "buscar em", comeca/contem
// ---------------------------------------------------------------------------
import { FILTROS_CONSULTA_PADRAO, contarFiltrosAtivos, resumoDosFiltros } from '../src/utils/clientSearch';

const comInativo = [
  ...base,
  { id: 'g', nome: 'SUPERMERCADO FECHADO', codigo: '5000', cidade: 'Serra', estado: 'ES', ativo: false, bairro: 'Jacaraipe' },
];

test('situacao: padrao das telas esconde inativo; "inativos" e "todos" mostram', () => {
  const padrao = FILTROS_CONSULTA_PADRAO;
  assert.equal(searchClients(comInativo, 'supermercado', padrao).some((c) => c.id === 'g'), false);
  assert.deepEqual(searchClients(comInativo, '', { ...padrao, situacao: 'inativos' }).map((c) => c.id), ['g']);
  assert.equal(searchClients(comInativo, 'supermercado', { ...padrao, situacao: 'todos' }).some((c) => c.id === 'g'), true);
  // Sem filtros (chamadas antigas): nao filtra por situacao.
  assert.equal(searchClients(comInativo, 'fechado').length, 1);
});

test('buscar em: cada campo procura so nele', () => {
  const f = { ...FILTROS_CONSULTA_PADRAO, situacao: 'todos' as const };
  assert.deepEqual(searchClients(comInativo, 'supermercado', { ...f, campo: 'nome' }).map((c) => c.id), ['a', 'b', 'g']);
  assert.deepEqual(searchClients(comInativo, 'supermercado', { ...f, campo: 'endereco' }).map((c) => c.id), ['d']);
  assert.deepEqual(searchClients(comInativo, 'caparao', { ...f, campo: 'fantasia' }).map((c) => c.id), ['b']);
  assert.deepEqual(searchClients(comInativo, 'caparao', { ...f, campo: 'nome' }).map((c) => c.id), []);
  assert.deepEqual(searchClients(comInativo, '45545', { ...f, campo: 'documento' }).map((c) => c.id), ['a']);
  assert.deepEqual(searchClients(comInativo, '3357', { ...f, campo: 'telefone' }).map((c) => c.id), ['a']);
  assert.deepEqual(searchClients(comInativo, 'jacara', { ...f, campo: 'bairro' }).map((c) => c.id), ['g']);
});

test('comeca com (procura exata) x contem (procura avancada)', () => {
  const f = { ...FILTROS_CONSULTA_PADRAO, situacao: 'todos' as const, campo: 'nome' as const };
  assert.deepEqual(searchClients(comInativo, 'mercado', { ...f, modo: 'comeca' }).map((c) => c.id), ['c']);
  assert.deepEqual(searchClients(comInativo, 'mercado', f).map((c) => c.id), ['c', 'a', 'b', 'g']);
  assert.deepEqual(searchClients(comInativo, '45.545', { ...f, campo: 'documento', modo: 'comeca' }).map((c) => c.id), ['a']);
  assert.deepEqual(searchClients(comInativo, '545', { ...f, campo: 'documento', modo: 'comeca' }).map((c) => c.id), []);
});

test('etiqueta do campo: conta e resume os filtros fora do padrao', () => {
  const locais = listarLocaisDosClientes(comInativo);
  const serra = locais.cidades.find((c) => c.cidade === 'SERRA');
  assert.equal(contarFiltrosAtivos(FILTROS_CONSULTA_PADRAO), 0);
  assert.equal(resumoDosFiltros(FILTROS_CONSULTA_PADRAO, locais), '');
  const filtros = { ...FILTROS_CONSULTA_PADRAO, uf: 'ES', cidade: serra?.chave ?? null, situacao: 'todos' as const };
  assert.equal(contarFiltrosAtivos(filtros), 2);
  assert.equal(resumoDosFiltros(filtros, locais), 'SERRA · ES +1');
  assert.equal(resumoDosFiltros({ ...FILTROS_CONSULTA_PADRAO, campo: 'documento' }, locais), 'Em CPF/CNPJ');
});
