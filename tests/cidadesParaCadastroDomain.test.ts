import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cidadeDaEmpresaPeloCnpj, juntarCidadesParaCadastro, type MunicipioIbgeNivelado } from '../src/utils/cidadesParaCadastroDomain';

/*
 * Cidade no cadastro (24/11/2026): Simonesia/MG nao esta na lista de NFS-e da
 * Spedy, mas existe no IBGE e serve para NF-e/NFC-e.
 */

const IBGE: MunicipioIbgeNivelado[] = [
  { 'municipio-id': 3139409, 'municipio-nome': 'Manhuaçu', 'UF-sigla': 'MG' },
  { 'municipio-id': 3167608, 'municipio-nome': 'Simonésia', 'UF-sigla': 'MG' },
  { 'municipio-id': 3170206, 'municipio-nome': 'Uberlândia', 'UF-sigla': 'MG' },
  { 'municipio-id': 3550308, 'municipio-nome': 'São Paulo', 'UF-sigla': 'SP' },
  { 'municipio-id': 2611606, 'municipio-nome': 'Recife', 'UF-sigla': 'PE' },
];
const SPEDY = [{ code: '3139409', name: 'Manhuaçu', state: 'mg' }];

test('busca: cidade fora da lista da Spedy vem do IBGE, marcada sem NFS-e', () => {
  const r = juntarCidadesParaCadastro('simon', SPEDY, IBGE);
  assert.deepEqual(r, [{ code: '3167608', name: 'Simonésia', state: 'MG', nfseNaSpedy: false }]);
  // Sem acento e em maiusculas tambem acha.
  assert.equal(juntarCidadesParaCadastro('SIMONESIA', [], IBGE)[0].code, '3167608');
});

test('busca: a da Spedy vem primeiro e nao repete pelo IBGE; menos de 3 letras nao busca', () => {
  const r = juntarCidadesParaCadastro('manhu', SPEDY, IBGE);
  assert.deepEqual(r, [{ code: '3139409', name: 'Manhuaçu', state: 'MG', nfseNaSpedy: true }]);
  assert.deepEqual(juntarCidadesParaCadastro('ma', SPEDY, IBGE), []);
  // Spedy fora do ar: a busca segue so' com o IBGE.
  assert.equal(juntarCidadesParaCadastro('manhu', [], IBGE)[0].nfseNaSpedy, false);
  // Quem comeca com o termo vem antes de quem so' contem.
  const lista = juntarCidadesParaCadastro('lan', [], IBGE);
  assert.deepEqual(lista.map((c) => c.name), ['Uberlândia']);
});

test('CNPJ: acha pela Spedy ou pelo IBGE; nunca troca por outra cidade da UF', () => {
  assert.deepEqual(cidadeDaEmpresaPeloCnpj({ municipio: 'SIMONESIA', uf: 'MG' }, SPEDY, IBGE),
    { code: '3167608', name: 'Simonésia', state: 'MG', nfseNaSpedy: false });
  assert.equal(cidadeDaEmpresaPeloCnpj({ municipio: 'MANHUACU', uf: 'MG' }, SPEDY, IBGE)?.nfseNaSpedy, true);
  assert.equal(cidadeDaEmpresaPeloCnpj({ municipio: 'X', uf: 'MG', codigoMunicipioIbge: '3167608' }, SPEDY, IBGE)?.name, 'Simonésia');
  // Cidade que nao existe em nenhuma das listas: null (antes pegava Manhuacu, a unica de MG na Spedy).
  assert.equal(cidadeDaEmpresaPeloCnpj({ municipio: 'CIDADE INVENTADA', uf: 'MG' }, SPEDY, IBGE), null);
  // Mesmo nome em outra UF nao vale.
  assert.equal(cidadeDaEmpresaPeloCnpj({ municipio: 'RECIFE', uf: 'MG' }, SPEDY, IBGE), null);
  assert.equal(cidadeDaEmpresaPeloCnpj({ municipio: '', uf: 'MG' }, SPEDY, IBGE), null);
});
