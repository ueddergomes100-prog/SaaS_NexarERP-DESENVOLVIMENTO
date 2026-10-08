import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CORES_STATUS_OS_CAMPO,
  LIMITE_FOTOS_OS,
  STATUS_OS_AGUARDANDO_CONFERENCIA,
  STATUS_OS_EM_ATENDIMENTO,
  caminhoDaFotoOS,
  descricaoDoEquipamento,
  equipamentoDoCadastro,
  filtrarOsDoApp,
  itemPickerParaPeca,
  montarNovaOsDeCampo,
  pecaParaItemPicker,
  podeAdicionarFotos,
  podeAtenderNoApp,
  resumoDaOsParaLista,
  servicoDeCatalogo,
  totalDoAtendimentoCentavos,
  validarConclusaoAtendimento,
} from '../src/utils/osCampoDomain';

test('status do campo: app atende o que nao encerrou; cores definidas', () => {
  assert.equal(podeAtenderNoApp(STATUS_OS_EM_ATENDIMENTO), true);
  assert.equal(podeAtenderNoApp('Orçamento Pendente'), true);
  assert.equal(podeAtenderNoApp('Finalizada'), false);
  assert.equal(podeAtenderNoApp('Cancelada'), false);
  assert.ok(CORES_STATUS_OS_CAMPO[STATUS_OS_EM_ATENDIMENTO]);
  assert.ok(CORES_STATUS_OS_CAMPO[STATUS_OS_AGUARDANDO_CONFERENCIA]);
});

test('fotos: limite de 10 com mensagem em portugues; caminho seguro no Storage', () => {
  assert.equal(podeAdicionarFotos([], 1).ok, true);
  assert.equal(podeAdicionarFotos(new Array(9).fill({}), 1).ok, true);
  const cheia = podeAdicionarFotos(new Array(LIMITE_FOTOS_OS).fill({}), 1);
  assert.equal(cheia.ok, false);
  if (!cheia.ok) assert.match(cheia.erro, /já tem 10 fotos/);
  const quaseCheia = podeAdicionarFotos(new Array(8).fill({}), 3);
  if (!quaseCheia.ok) assert.match(quaseCheia.erro, /Cabem só mais 2 fotos/);
  assert.equal(caminhoDaFotoOS('t1', 'os/../x', 123, 0), 'empresas/t1/os/osx/foto-123-0.jpg');
});

test('pecas: ida e volta com o item do picker, sem undefined', () => {
  const item = itemPickerParaPeca({ id: 'p1', nome: 'Filtro', precoUnitario: 50, quantidade: 2, desconto: 0, subtotal: 100, unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0 });
  assert.deepEqual(item, { id: 'p1', nome: 'Filtro', preco: 50, quantidade: 2, unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0 });
  assert.equal('codigo' in item, false, 'sem codigo nao grava a chave');
  const volta = pecaParaItemPicker({ ...item, codigo: 'F-1' });
  assert.equal(volta.subtotal, 100);
  assert.equal(volta.codigo, 'F-1');
  const servico = servicoDeCatalogo({ id: 's1', nome: 'Revisão', preco: 150 }, 2);
  assert.equal(totalDoAtendimentoCentavos([item], [servico]), 10000 + 30000);
});

test('nova OS de campo: documento completo, status Em atendimento, sem undefined', () => {
  const equipamento = equipamentoDoCadastro({ placa: 'abc1234', modelo: 'TL75', marca: 'New Holland', frota: '12', serie: 'hx17', horimetro: 1600, tipoEquipamento: 'Trator' });
  assert.equal(equipamento.placa, 'ABC1234');
  assert.equal(equipamento.serie, 'HX17');
  assert.equal(equipamento.horimetro, '1600');
  assert.equal(descricaoDoEquipamento('maquinas_pesadas', equipamento), 'Frota 12 · New Holland TL75');
  assert.equal(descricaoDoEquipamento('veiculos', equipamento), 'ABC1234 · New Holland TL75');
  const doc = montarNovaOsDeCampo({
    tenantId: 't1', numeroOS: '14', tecnico: { id: 'u1', nome: 'Cleber' },
    cliente: { id: 'c1', nome: 'Maria', telefone: '27 9' }, equipamento, reclamacao: 'Vazamento', data: '2026-10-08', hora: '08:30',
  });
  assert.equal(doc.status, STATUS_OS_EM_ATENDIMENTO);
  assert.equal(doc.clienteNome, 'MARIA');
  assert.equal(doc.mecanicoId, 'u1');
  assert.equal(doc.origem, 'app_tecnico');
  assert.equal(Object.values(doc).some((v) => v === undefined), false, 'Firestore recusa undefined');
});

test('concluir: assinatura so\' trava quando a empresa exige; avisos nao travam', () => {
  const base = { status: STATUS_OS_EM_ATENDIMENTO, relatorioTecnico: '', temAssinatura: false, pecas: [], servicos: [] };
  const livre = validarConclusaoAtendimento({ ...base, exigirAssinatura: false });
  assert.equal(livre.ok, true);
  assert.equal(livre.avisos.length, 2);
  const exigida = validarConclusaoAtendimento({ ...base, exigirAssinatura: true });
  assert.equal(exigida.ok, false);
  assert.match(exigida.erros[0], /exige a assinatura/);
  const encerrada = validarConclusaoAtendimento({ ...base, status: 'Finalizada', exigirAssinatura: false });
  assert.equal(encerrada.ok, false);
});

test('lista do app: Minhas filtra pelo tecnico, encerradas ficam de fora, em atendimento primeiro', () => {
  const lista = [
    resumoDaOsParaLista('maquinas_pesadas', 'a', { numeroOS: '1', status: 'Finalizada', mecanicoId: 'u1', createdAt: { seconds: 5 } }),
    resumoDaOsParaLista('maquinas_pesadas', 'b', { numeroOS: '2', status: 'Orçamento Pendente', mecanicoId: 'u1', createdAt: { seconds: 9 }, frota: '12', modelo: 'TL75' }),
    resumoDaOsParaLista('maquinas_pesadas', 'c', { numeroOS: '3', status: STATUS_OS_EM_ATENDIMENTO, mecanicoId: 'u2', createdAt: { seconds: 1 } }),
    resumoDaOsParaLista('maquinas_pesadas', 'd', { numeroOS: '4', status: STATUS_OS_AGUARDANDO_CONFERENCIA, mecanicoId: 'u1', createdAt: { seconds: 2 } }),
  ];
  assert.deepEqual(filtrarOsDoApp(lista, 'minhas', 'u1').map((o) => o.numeroOS), ['4', '2']);
  assert.deepEqual(filtrarOsDoApp(lista, 'todas', 'u1').map((o) => o.numeroOS), ['3', '4', '2']);
  assert.equal(lista[1].equipamento, 'Frota 12 · TL75');
  assert.equal(lista[2].statusColor, CORES_STATUS_OS_CAMPO[STATUS_OS_EM_ATENDIMENTO]);
});
