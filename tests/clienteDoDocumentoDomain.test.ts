import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  escolherCadastroDoCliente,
  idDoClienteDoDocumento,
  nomeDoClienteDoDocumento,
} from '../src/utils/clienteDoDocumentoDomain.js';

const EMPRESA = 'jomarly';
const matriz = { tenantId: EMPRESA, codigo: 657, nome: 'LIMA PETROLEO LTDA', cpfCnpj: '05417714000113' };
const filial = { tenantId: EMPRESA, codigo: 254, nome: 'LIMA PETROLEO LTDA', cpfCnpj: '05417714000202' };

test('cliente do documento: o id guardado manda, mesmo com outro cliente de mesmo nome (caso LIMA PETROLEO, 23/11/2026)', () => {
  assert.equal(escolherCadastroDoCliente({ tenantId: EMPRESA, porId: matriz, porNome: [filial, matriz] }), matriz);
});

test('cliente do documento: sem id e com dois clientes de mesmo nome, nao chuta -- cabecalho sai so com o nome', () => {
  assert.equal(escolherCadastroDoCliente({ tenantId: EMPRESA, porId: null, porNome: [filial, matriz] }), null);
});

test('cliente do documento: sem id e com um cliente so daquele nome, usa esse (documento antigo)', () => {
  assert.equal(escolherCadastroDoCliente({ tenantId: EMPRESA, porId: null, porNome: [filial] }), filial);
  assert.equal(escolherCadastroDoCliente({ tenantId: EMPRESA, porId: null, porNome: [] }), null);
});

test('cliente do documento: cadastro de outra empresa nunca vale, nem pelo id nem pelo nome', () => {
  const deOutra = { ...matriz, tenantId: 'outra' };
  assert.equal(escolherCadastroDoCliente({ tenantId: EMPRESA, porId: deOutra, porNome: [] }), null);
  assert.equal(escolherCadastroDoCliente({ tenantId: EMPRESA, porId: deOutra, porNome: [deOutra, filial] }), filial);
});

test('cliente do documento: id e nome lidos sem espaco e sem undefined', () => {
  assert.equal(idDoClienteDoDocumento({ clienteId: ' abc ' }), 'abc');
  assert.equal(idDoClienteDoDocumento({}), '');
  assert.equal(idDoClienteDoDocumento(null), '');
  assert.equal(nomeDoClienteDoDocumento({ clienteNome: ' LIMA ' }), 'LIMA');
  assert.equal(nomeDoClienteDoDocumento(undefined), '');
});
