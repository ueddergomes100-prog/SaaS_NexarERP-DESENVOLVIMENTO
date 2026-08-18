import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarBipagem,
  canTransition,
  computeStatusFinal,
  DEFAULT_BLOQUEAR_EXCEDENTE,
  DEFAULT_CONFERENCIA_MERCADORIA,
  DEFAULT_EXIGIR_BIPAGEM,
  DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  ordenarPorLocalizacao,
  podeLancarManual,
  type ConferenciaItem,
} from '../src/utils/conferenciaDomain';

const item = (overrides: Partial<ConferenciaItem> & Pick<ConferenciaItem, 'produtoId' | 'nome' | 'quantidadePedida'>): ConferenciaItem => ({
  quantidadeConferida: 0,
  ...overrides,
});

// --- Guard-rail: a chave-mestra tem que continuar desligada por padrao ---
// (quebra de proposito se alguem trocar o default -- default ligado criaria
// status pendente em todo tenant que nao usa separacao).

test('DEFAULT_CONFERENCIA_MERCADORIA e false (chave-mestra desligada por padrao, obrigatorio)', () => {
  assert.equal(DEFAULT_CONFERENCIA_MERCADORIA, false);
});

test('demais defaults seguem o plano: minuta/bipagem/excedente/ordenacao ligados por padrao', () => {
  assert.equal(DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA, true);
  assert.equal(DEFAULT_EXIGIR_BIPAGEM, true);
  assert.equal(DEFAULT_BLOQUEAR_EXCEDENTE, true);
  assert.equal(DEFAULT_ORDENAR_MINUTA_POR_LOCAL, true);
});

// --- canTransition ---

test('canTransition: aguardando so abre pra em_conferencia', () => {
  assert.equal(canTransition('aguardando', 'em_conferencia'), true);
  assert.equal(canTransition('aguardando', 'conferido'), false);
  assert.equal(canTransition('aguardando', 'divergente'), false);
  assert.equal(canTransition('aguardando', 'aguardando'), false);
});

test('canTransition: em_conferencia fecha em conferido ou divergente', () => {
  assert.equal(canTransition('em_conferencia', 'conferido'), true);
  assert.equal(canTransition('em_conferencia', 'divergente'), true);
  assert.equal(canTransition('em_conferencia', 'aguardando'), false);
});

test('canTransition: conferido e divergente podem ser reabertos (desfecho legitimo, nao erro)', () => {
  assert.equal(canTransition('conferido', 'em_conferencia'), true);
  assert.equal(canTransition('divergente', 'em_conferencia'), true);
});

test('canTransition: conferido/divergente nao pulam direto um pro outro', () => {
  assert.equal(canTransition('conferido', 'divergente'), false);
  assert.equal(canTransition('divergente', 'conferido'), false);
});

// --- podeLancarManual (decisao 6: valvula de escape da trava de bipagem) ---

test('podeLancarManual: com exigirBipagem desligado, sempre permite manual', () => {
  assert.equal(podeLancarManual({ codigoBarras: '789123' }, false), true);
  assert.equal(podeLancarManual({ codigoBarras: undefined }, false), true);
});

test('podeLancarManual: com exigirBipagem ligado, bloqueia produto QUE TEM codigo de barras', () => {
  assert.equal(podeLancarManual({ codigoBarras: '789123' }, true), false);
});

test('podeLancarManual: com exigirBipagem ligado, produto SEM codigo de barras sempre aceita manual', () => {
  assert.equal(podeLancarManual({ codigoBarras: undefined }, true), true);
  assert.equal(podeLancarManual({ codigoBarras: '' }, true), true);
  assert.equal(podeLancarManual({ codigoBarras: '   ' }, true), true);
});

// --- aplicarBipagem ---

const optsPadrao = { bloquearExcedente: true, exigirBipagem: true };

test('aplicarBipagem: bipagem por EAN encontrado incrementa quantidadeConferida', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 10 })];
  const { itens: resultado, resultado: status, produtoId } = aplicarBipagem(itens, '789', 1, optsPadrao);
  assert.equal(status, 'ok');
  assert.equal(produtoId, 'p1');
  assert.equal(resultado[0].quantidadeConferida, 1);
});

test('aplicarBipagem: multiplicador digitado antes da leitura aplica o valor inteiro de uma vez', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Arruela', codigoBarras: '789', quantidadePedida: 10 })];
  const { itens: resultado, resultado: status } = aplicarBipagem(itens, '789', 10, optsPadrao);
  assert.equal(status, 'ok');
  assert.equal(resultado[0].quantidadeConferida, 10);
});

test('aplicarBipagem: codigo nao encontrado em nenhum item retorna nao_encontrado sem mudar nada', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Porca', codigoBarras: '789', quantidadePedida: 10 })];
  const { itens: resultado, resultado: status } = aplicarBipagem(itens, '000', 1, optsPadrao);
  assert.equal(status, 'nao_encontrado');
  assert.equal(resultado, itens);
});

test('aplicarBipagem: codigo vazio/so espacos retorna nao_encontrado', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Porca', codigoBarras: '789', quantidadePedida: 10 })];
  assert.equal(aplicarBipagem(itens, '', 1, optsPadrao).resultado, 'nao_encontrado');
  assert.equal(aplicarBipagem(itens, '   ', 1, optsPadrao).resultado, 'nao_encontrado');
});

test('aplicarBipagem: tambem encontra por produtoId (lancamento manual selecionando a linha)', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Porca', codigoBarras: undefined, quantidadePedida: 10 })];
  const { itens: resultado, resultado: status } = aplicarBipagem(itens, 'p1', 3, { ...optsPadrao, manual: true });
  assert.equal(status, 'ok');
  assert.equal(resultado[0].quantidadeConferida, 3);
});

test('aplicarBipagem: bloquearExcedente ligado recusa bipar alem da quantidade pedida', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 5, quantidadeConferida: 5 })];
  const { itens: resultado, resultado: status } = aplicarBipagem(itens, '789', 1, optsPadrao);
  assert.equal(status, 'excedente');
  assert.equal(resultado[0].quantidadeConferida, 5);
});

test('aplicarBipagem: bloquearExcedente desligado permite conferir acima do pedido', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 5, quantidadeConferida: 5 })];
  const { itens: resultado, resultado: status } = aplicarBipagem(itens, '789', 1, { ...optsPadrao, bloquearExcedente: false });
  assert.equal(status, 'ok');
  assert.equal(resultado[0].quantidadeConferida, 6);
});

test('aplicarBipagem: exatamente na quantidade pedida (limite) e aceito mesmo com bloquearExcedente ligado', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 5, quantidadeConferida: 4 })];
  const { resultado: status } = aplicarBipagem(itens, '789', 1, optsPadrao);
  assert.equal(status, 'ok');
});

test('aplicarBipagem: manual bloqueado quando exigirBipagem ligado e produto tem codigo de barras', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 5 })];
  const { itens: resultado, resultado: status } = aplicarBipagem(itens, 'p1', 1, { ...optsPadrao, manual: true });
  assert.equal(status, 'bloqueado_manual');
  assert.equal(resultado[0].quantidadeConferida, 0);
});

test('aplicarBipagem: manual permitido quando produto nao tem codigo de barras, mesmo com exigirBipagem ligado', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso avulso', codigoBarras: undefined, quantidadePedida: 5 })];
  const { resultado: status } = aplicarBipagem(itens, 'p1', 1, { ...optsPadrao, manual: true });
  assert.equal(status, 'ok');
});

test('aplicarBipagem: manual permitido em qualquer produto quando exigirBipagem desligado', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 5 })];
  const { resultado: status } = aplicarBipagem(itens, 'p1', 1, { ...optsPadrao, exigirBipagem: false, manual: true });
  assert.equal(status, 'ok');
});

test('aplicarBipagem: leitura por EAN (nao manual) nunca e bloqueada por exigirBipagem', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 5 })];
  const { resultado: status } = aplicarBipagem(itens, '789', 1, optsPadrao);
  assert.equal(status, 'ok');
});

test('aplicarBipagem: multiplicador invalido (zero, negativo ou NaN) cai para 1', () => {
  const base = { produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 10 } as const;
  assert.equal(aplicarBipagem([item(base)], '789', 0, optsPadrao).itens[0].quantidadeConferida, 1);
  assert.equal(aplicarBipagem([item(base)], '789', -3, optsPadrao).itens[0].quantidadeConferida, 1);
  assert.equal(aplicarBipagem([item(base)], '789', Number.NaN, optsPadrao).itens[0].quantidadeConferida, 1);
});

test('aplicarBipagem: nao muta o array de itens recebido', () => {
  const itens = [item({ produtoId: 'p1', nome: 'Parafuso', codigoBarras: '789', quantidadePedida: 10 })];
  const original = itens[0];
  aplicarBipagem(itens, '789', 1, optsPadrao);
  assert.equal(itens[0], original);
  assert.equal(itens[0].quantidadeConferida, 0);
});

// --- computeStatusFinal ---

test('computeStatusFinal: conferido quando todo item bate exatamente pedido == conferido', () => {
  const itens = [
    item({ produtoId: 'p1', nome: 'A', quantidadePedida: 10, quantidadeConferida: 10 }),
    item({ produtoId: 'p2', nome: 'B', quantidadePedida: 3, quantidadeConferida: 3 }),
  ];
  assert.equal(computeStatusFinal(itens), 'conferido');
});

test('computeStatusFinal: divergente quando falta item (conferido menor que pedido)', () => {
  const itens = [item({ produtoId: 'p1', nome: 'A', quantidadePedida: 10, quantidadeConferida: 8 })];
  assert.equal(computeStatusFinal(itens), 'divergente');
});

test('computeStatusFinal: divergente quando sobra item (conferido maior que pedido)', () => {
  const itens = [item({ produtoId: 'p1', nome: 'A', quantidadePedida: 10, quantidadeConferida: 12 })];
  assert.equal(computeStatusFinal(itens), 'divergente');
});

test('computeStatusFinal: um unico item divergente basta pra fechar a venda inteira como divergente', () => {
  const itens = [
    item({ produtoId: 'p1', nome: 'A', quantidadePedida: 10, quantidadeConferida: 10 }),
    item({ produtoId: 'p2', nome: 'B', quantidadePedida: 3, quantidadeConferida: 2 }),
  ];
  assert.equal(computeStatusFinal(itens), 'divergente');
});

// --- ordenarPorLocalizacao ---

test('ordenarPorLocalizacao: ordena alfabeticamente por localizacaoEstoque', () => {
  const itens = [
    item({ produtoId: 'p1', nome: 'A', quantidadePedida: 1, localizacaoEstoque: 'C-04-02' }),
    item({ produtoId: 'p2', nome: 'B', quantidadePedida: 1, localizacaoEstoque: 'A-01-03' }),
    item({ produtoId: 'p3', nome: 'C', quantidadePedida: 1, localizacaoEstoque: 'A-02-01' }),
  ];
  const ordenado = ordenarPorLocalizacao(itens);
  assert.deepEqual(ordenado.map((i) => i.produtoId), ['p2', 'p3', 'p1']);
});

test('ordenarPorLocalizacao: itens sem localizacao vao pro FIM, nao pro comeco', () => {
  const itens = [
    item({ produtoId: 'p1', nome: 'Sem local', quantidadePedida: 1, localizacaoEstoque: undefined }),
    item({ produtoId: 'p2', nome: 'Com local', quantidadePedida: 1, localizacaoEstoque: 'A-01-03' }),
  ];
  const ordenado = ordenarPorLocalizacao(itens);
  assert.deepEqual(ordenado.map((i) => i.produtoId), ['p2', 'p1']);
});

test('ordenarPorLocalizacao: localizacao vazia/so espacos conta como sem localizacao', () => {
  const itens = [
    item({ produtoId: 'p1', nome: 'Vazio', quantidadePedida: 1, localizacaoEstoque: '' }),
    item({ produtoId: 'p2', nome: 'Espacos', quantidadePedida: 1, localizacaoEstoque: '   ' }),
    item({ produtoId: 'p3', nome: 'Com local', quantidadePedida: 1, localizacaoEstoque: 'A-01-03' }),
  ];
  const ordenado = ordenarPorLocalizacao(itens);
  assert.equal(ordenado[0].produtoId, 'p3');
  assert.deepEqual(new Set(ordenado.slice(1).map((i) => i.produtoId)), new Set(['p1', 'p2']));
});

test('ordenarPorLocalizacao: nao muta o array recebido', () => {
  const itens = [
    item({ produtoId: 'p1', nome: 'A', quantidadePedida: 1, localizacaoEstoque: 'B' }),
    item({ produtoId: 'p2', nome: 'B', quantidadePedida: 1, localizacaoEstoque: 'A' }),
  ];
  const copiaOrdem = itens.map((i) => i.produtoId);
  ordenarPorLocalizacao(itens);
  assert.deepEqual(itens.map((i) => i.produtoId), copiaOrdem);
});

test('ordenarPorLocalizacao: lista vazia retorna lista vazia', () => {
  assert.deepEqual(ordenarPorLocalizacao([]), []);
});

test('ordenarPorLocalizacao: e generica -- funciona com qualquer shape que tenha localizacaoEstoque (ex: item da minuta, Fatia 2, que nao tem produtoId nem quantidadePedida)', () => {
  const itensMinuta = [
    { nome: 'Sem local', localizacaoEstoque: undefined },
    { nome: 'Com local', localizacaoEstoque: 'A-01-03' },
  ];
  const ordenado = ordenarPorLocalizacao(itensMinuta);
  assert.deepEqual(ordenado.map((i) => i.nome), ['Com local', 'Sem local']);
});
