import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIG_MAQUINAS_PESADAS_PADRAO,
  TEXTO_CONCORDANCIA_PADRAO,
  aplicarDeslocamentoNosServicos,
  configMaquinasDoForm,
  configMaquinasParaForm,
  identificacaoBateBusca,
  identificacaoCurta,
  kmDoDeslocamento,
  modoDaConfiguracao,
  parseConfigMaquinasPesadas,
  parseDeslocamento,
  rotulosOficina,
  temDeslocamento,
  validarIdentificacaoEquipamento,
  valorDeslocamentoCentavos,
  type LinhaServico,
} from '../src/utils/oficinaDomain';

test('configuracao: desligada por padrao; lixo vira padrao; formulario ida e volta', () => {
  assert.deepEqual(parseConfigMaquinasPesadas(undefined), CONFIG_MAQUINAS_PESADAS_PADRAO);
  assert.equal(modoDaConfiguracao(parseConfigMaquinasPesadas(undefined)), 'veiculos');
  const c = parseConfigMaquinasPesadas({ ativo: true, tiposEquipamento: ['Trator', ' ', 'Gerador'], precoKmCentavos: 250, valorVisitaCentavos: -5, textoConcordancia: '' });
  assert.equal(modoDaConfiguracao(c), 'maquinas_pesadas');
  assert.deepEqual(c.tiposEquipamento, ['Trator', 'Gerador']);
  assert.equal(c.precoKmCentavos, 250);
  assert.equal(c.valorVisitaCentavos, 0, 'negativo vira 0');
  assert.equal(c.textoConcordancia, TEXTO_CONCORDANCIA_PADRAO);
  const form = configMaquinasParaForm(c);
  assert.equal(form.precoKm, '2,50');
  assert.equal(form.valorVisita, '');
  const volta = configMaquinasDoForm({ ...form, valorVisita: '150,00', tiposEquipamento: 'Trator\nColheitadeira, Gerador' });
  assert.equal(volta.ok, true);
  if (volta.ok) {
    assert.equal(volta.config.valorVisitaCentavos, 15000);
    assert.deepEqual(volta.config.tiposEquipamento, ['Trator', 'Colheitadeira', 'Gerador']);
  }
  const invalido = configMaquinasDoForm({ ...form, precoKm: 'abc' });
  assert.equal(invalido.ok, false);
  if (!invalido.ok) assert.match(invalido.erro, /Preço do km/);
});

test('rotulos e identificacao: veiculo exige placa; maquina aceita frota, placa ou serie', () => {
  assert.equal(rotulosOficina('veiculos').placa, 'Placa');
  assert.equal(rotulosOficina('maquinas_pesadas').veiculo, 'Equipamento');
  assert.equal(rotulosOficina('maquinas_pesadas').km, 'Horímetro');
  assert.equal(validarIdentificacaoEquipamento('veiculos', { placa: '' }).ok, false);
  assert.equal(validarIdentificacaoEquipamento('veiculos', { placa: 'ABC1234' }).ok, true);
  const semNada = validarIdentificacaoEquipamento('maquinas_pesadas', { placa: '', frota: '', serie: '' });
  assert.equal(semNada.ok, false);
  if (!semNada.ok) assert.match(semNada.erro, /frota, placa ou série/);
  assert.equal(validarIdentificacaoEquipamento('maquinas_pesadas', { frota: '12' }).ok, true);
  assert.equal(validarIdentificacaoEquipamento('maquinas_pesadas', { serie: 'HX17-001' }).ok, true);
  assert.equal(identificacaoCurta('maquinas_pesadas', { frota: '12', placa: 'abc1234' }), 'Frota 12');
  assert.equal(identificacaoCurta('maquinas_pesadas', { placa: 'abc1234' }), 'ABC1234');
  assert.equal(identificacaoCurta('maquinas_pesadas', { serie: 'HX17' }), 'Série HX17');
  assert.equal(identificacaoCurta('veiculos', { frota: '12' }), '-');
  assert.equal(identificacaoBateBusca('maquinas_pesadas', { serie: 'HX17-001' }, 'hx17'), true);
  assert.equal(identificacaoBateBusca('veiculos', { serie: 'HX17-001', placa: 'ABC' }, 'hx17'), false);
});

test('deslocamento: km por inicial/final ou direto; valor = km x preco + visita; vira UMA linha de servico', () => {
  const config = parseConfigMaquinasPesadas({ ativo: true, precoKmCentavos: 250, valorVisitaCentavos: 10000 });
  const d = parseDeslocamento({ kmInicial: '1000', kmFinal: '1040', local: 'Fazenda Boa Vista' });
  assert.equal(kmDoDeslocamento(d), 40);
  assert.equal(temDeslocamento(d), true);
  assert.equal(kmDoDeslocamento(parseDeslocamento({ kmInicial: 50, kmFinal: 10, km: 7.5 })), 7.5, 'final menor que inicial: usa o km digitado');
  assert.equal(temDeslocamento(parseDeslocamento(undefined)), false);
  assert.equal(valorDeslocamentoCentavos(40, config), 40 * 250 + 10000);
  assert.equal(valorDeslocamentoCentavos(0, config), 0, 'sem km nao cobra nem a visita');
  const servicos: LinhaServico[] = [{ id: 's1', nome: 'Revisão', preco: 300, quantidade: 1 }];
  const com = aplicarDeslocamentoNosServicos(servicos, 40, config);
  assert.equal(com.length, 2);
  assert.equal(com[1].id, 'deslocamento');
  assert.equal(com[1].nome, 'Deslocamento — 40 km');
  assert.equal(com[1].preco, 200);
  assert.equal(com[1].detalhamento, '40 km × R$ 2,50 + visita R$ 100,00');
  const trocado = aplicarDeslocamentoNosServicos(com, 10, config);
  assert.equal(trocado.length, 2, 'nao duplica a linha');
  assert.equal(trocado[1].preco, 125);
  assert.deepEqual(aplicarDeslocamentoNosServicos(com, 0, config), servicos, 'zero km tira a linha');
  const semPreco = parseConfigMaquinasPesadas({ ativo: true });
  assert.deepEqual(aplicarDeslocamentoNosServicos(com, 40, semPreco), servicos, 'sem preco configurado nao lanca nada');
});
