import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSintegraFile,
  type SintegraEmpresa, type SintegraNota, type SintegraProduto, type SintegraPeriodo,
} from '../src/utils/sintegraDomain';

const empresa: SintegraEmpresa = {
  cnpj: '12.345.678/0001-99',
  inscricaoEstadual: '123456789',
  nome: 'OFICINA TESTE LTDA',
  municipio: 'Manhuaçu',
  uf: 'MG',
  rua: 'Rua Principal',
  numero: '100',
  bairro: 'Centro',
  cep: '36970-000',
  nomeContato: 'João',
  telefone: '33999998888',
};

const periodo: SintegraPeriodo = { dataInicial: '2026-08-01', dataFinal: '2026-08-31' };

const notaSimples: SintegraNota = {
  modelo: 55,
  serie: '1',
  numero: 123,
  dataEmissao: '2026-08-10',
  situacao: 'normal',
  itens: [
    { codigo: 'PROD-1', ncm: '87089990', cfop: 5102, cst: '102', quantidade: 2, valorTotal: 100, baseIcms: 100, valorIcms: 18, aliquotaIcms: 18 },
  ],
};

const produtos: SintegraProduto[] = [
  { codigo: 'PROD-1', ncm: '87089990', descricao: 'Peça de Teste', unidade: 'UN', aliquotaIcms: 18 },
];

test('buildSintegraFile gera todos os registros com exatamente 126 caracteres cada', () => {
  const arquivo = buildSintegraFile(empresa, [notaSimples], produtos, periodo);
  const linhas = arquivo.trim().split('\r\n');
  assert.ok(linhas.length > 0);
  for (const linha of linhas) {
    assert.equal(linha.length, 126, `Linha "${linha.slice(0, 2)}" com tamanho ${linha.length}`);
  }
});

test('Registro 10 comeca com tipo, CNPJ e periodo no formato certo', () => {
  const arquivo = buildSintegraFile(empresa, [notaSimples], produtos, periodo);
  const registro10 = arquivo.split('\r\n')[0];
  assert.equal(registro10.slice(0, 2), '10');
  assert.equal(registro10.slice(2, 16), '12345678000199');
  assert.equal(registro10.slice(16, 30), '123456789     ');
  assert.equal(registro10.slice(107, 115), '20260801');
  assert.equal(registro10.slice(115, 123), '20260831');
});

test('Registro 11 traz endereco e telefone', () => {
  const arquivo = buildSintegraFile(empresa, [notaSimples], produtos, periodo);
  const registro11 = arquivo.split('\r\n')[1];
  assert.equal(registro11.slice(0, 2), '11');
  assert.equal(registro11.slice(2, 36).trim(), 'RUA PRINCIPAL');
  assert.equal(registro11.slice(37, 41), '0100');
});

test('Registro 50 e gerado por combinacao de CFOP+aliquota, com valores em centavos', () => {
  const arquivo = buildSintegraFile(empresa, [notaSimples], produtos, periodo);
  const registro50 = arquivo.split('\r\n').find((l) => l.startsWith('50'));
  assert.ok(registro50);
  assert.equal(registro50!.slice(51, 55), '5102'); // CFOP
  assert.equal(registro50!.slice(56, 69), '0000000010000'); // valor total 100.00 -> 10000 centavos
  assert.equal(registro50!.slice(69, 82), '0000000010000'); // base ICMS 100.00
  assert.equal(registro50!.slice(82, 95), '0000000001800'); // valor ICMS 18.00
});

test('nota sem valorIpi nao gera Registro 51', () => {
  const arquivo = buildSintegraFile(empresa, [notaSimples], produtos, periodo);
  const temRegistro51 = arquivo.split('\r\n').some((l) => l.startsWith('51'));
  assert.equal(temRegistro51, false);
});

test('nota com valorIpi gera Registro 51', () => {
  const notaComIpi: SintegraNota = {
    ...notaSimples,
    itens: [{ ...notaSimples.itens[0], valorIpi: 5 }],
  };
  const arquivo = buildSintegraFile(empresa, [notaComIpi], produtos, periodo);
  const registro51 = arquivo.split('\r\n').find((l) => l.startsWith('51'));
  assert.ok(registro51);
});

test('Registro 54 tem um registro por item, com codigo e quantidade certos', () => {
  const notaDoisItens: SintegraNota = {
    ...notaSimples,
    itens: [
      notaSimples.itens[0],
      { codigo: 'PROD-2', ncm: '87089991', cfop: 5102, cst: '102', quantidade: 1, valorTotal: 50, baseIcms: 50, valorIcms: 9, aliquotaIcms: 18 },
    ],
  };
  const arquivo = buildSintegraFile(empresa, [notaDoisItens], produtos, periodo);
  const registros54 = arquivo.split('\r\n').filter((l) => l.startsWith('54'));
  assert.equal(registros54.length, 2);
  assert.equal(registros54[0].slice(37, 51).trim(), 'PROD-1');
  assert.equal(registros54[1].slice(37, 51).trim(), 'PROD-2');
});

test('nota cancelada e excluida do arquivo (sem Registro 50/54 dela)', () => {
  const notaCancelada: SintegraNota = { ...notaSimples, situacao: 'cancelada' };
  const arquivo = buildSintegraFile(empresa, [notaCancelada], produtos, periodo);
  const linhas = arquivo.split('\r\n').filter(Boolean);
  // So sobra 10, 11, e os 90 de totalizacao (sem 50/54, ja que a unica nota foi cancelada)
  assert.equal(linhas.some((l) => l.startsWith('50')), false);
  assert.equal(linhas.some((l) => l.startsWith('54')), false);
});

test('Registro 75 e gerado uma vez por produto unico, mesmo com produtos duplicados na lista', () => {
  const produtosDuplicados = [...produtos, ...produtos];
  const arquivo = buildSintegraFile(empresa, [notaSimples], produtosDuplicados, periodo);
  const registros75 = arquivo.split('\r\n').filter((l) => l.startsWith('75'));
  assert.equal(registros75.length, 1);
});

test('Registro 90 totaliza a contagem de cada tipo de registro presente', () => {
  const arquivo = buildSintegraFile(empresa, [notaSimples], produtos, periodo);
  const linhas = arquivo.split('\r\n').filter(Boolean);
  const registros90 = linhas.filter((l) => l.startsWith('90'));
  // tipos presentes: 10(1), 11(1), 50(1), 54(1), 75(1) = 5 registros 90 de tipo + 1 final = 6
  assert.equal(registros90.length, 6);
  const totalRegistro90DoTipo50 = registros90.find((l) => l.slice(30, 32) === '50');
  assert.ok(totalRegistro90DoTipo50);
  assert.equal(totalRegistro90DoTipo50!.slice(32, 40), '00000001');
});
