import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasModuleAccess, hasTenantFullAccess, isPlatformAdminRole, isTenantManagerRole } from '../src/utils/roles';

test('hasModuleAccess libera dono da empresa mesmo sem a permissao explicita', () => {
  assert.equal(
    hasModuleAccess({ role: 'Funcionario', isOwner: true, permissions: [], requiredPermission: 'cadastros.bandeiras' }),
    true,
  );
});

test('hasModuleAccess libera SuperAdmin e Master independente de permissoes', () => {
  assert.equal(
    hasModuleAccess({ role: 'SuperAdmin', isOwner: false, permissions: null, requiredPermission: 'cadastros.bandeiras' }),
    true,
  );
  assert.equal(
    hasModuleAccess({ role: 'Master', isOwner: false, permissions: undefined, requiredPermission: 'cadastros.bandeiras' }),
    true,
  );
});

test('hasModuleAccess libera funcionario apenas com a permissao especifica', () => {
  assert.equal(
    hasModuleAccess({ role: 'Funcionario', isOwner: false, permissions: ['cadastros.bandeiras'], requiredPermission: 'cadastros.bandeiras' }),
    true,
  );
  assert.equal(
    hasModuleAccess({ role: 'Funcionario', isOwner: false, permissions: ['vendas.pedidos'], requiredPermission: 'cadastros.bandeiras' }),
    false,
  );
});

test('hasModuleAccess nega funcionario sem permissoes e sem ser dono', () => {
  assert.equal(
    hasModuleAccess({ role: 'Funcionario', isOwner: false, permissions: [], requiredPermission: 'cadastros.bandeiras' }),
    false,
  );
});

test('isPlatformAdminRole e isTenantManagerRole continuam corretos (regressao)', () => {
  assert.equal(isPlatformAdminRole('NexarAdmin'), true);
  assert.equal(isPlatformAdminRole('Master'), false);
  assert.equal(isTenantManagerRole('Admin'), true);
  assert.equal(isTenantManagerRole('Funcionario'), false);
});

test('hasTenantFullAccess continua correto (regressao)', () => {
  assert.equal(hasTenantFullAccess('Funcionario', true), true);
  assert.equal(hasTenantFullAccess('Funcionario', false), false);
  assert.equal(hasTenantFullAccess('Admin', false), true);
});
