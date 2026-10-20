import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agruparVariacoes,
  bloqueioParaDesligarGrade,
  bloqueioParaLigarGrade,
  camposDaVariacao,
  codigoDaVariacao,
  codigoDeBarrasGerado,
  combinacoes,
  digitoVerificadorEan13,
  gradeEmUso,
  lerFilho,
  lerGrade,
  lerOpcoesDigitadas,
  montarLinhasDaGrade,
  nomeDaVariacao,
  numeroDaVariacao,
  opcoesEmUso,
  planejarVariacoes,
  proximoNumeroDaVariacao,
  skuDaVariacao,
  somaDasVariacoes,
  variacaoPrecisaAtualizar,
  type FilhoExistente,
  type LinhaDaGrade,
} from '../src/utils/gradeProdutosDomain';

const TAMANHO = { nome: 'TAMANHO', opcoes: ['P', 'M'] };
const COR = { nome: 'COR', opcoes: ['AZUL', 'PRETO'] };

test('lerGrade limpa, poe em caixa alta e recusa repetida/vazia com mensagem em portugues', () => {
  const ok = lerGrade(' tamanho ', [' p', 'M ', '', 'g']);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.valor, { nome: 'TAMANHO', opcoes: ['P', 'M', 'G'] });

  const casos: Array<[unknown, unknown, RegExp]> = [
    ['', ['P'], /Informe o nome da grade/],
    ['COR', [], /pelo menos uma opção/],
    ['COR', ['Azul', 'AZUL'], /"AZUL" está repetida/],
    ['COR', ['Açúcar', 'ACUCAR'], /está repetida/],
    ['X'.repeat(31), ['P'], /passa de 30 letras/],
    ['COR', ['A'.repeat(31)], /passa de 30 letras/],
    ['COR', Array.from({ length: 61 }, (_, i) => `C${i}`), /até 60 opções/],
  ];
  for (const [nome, opcoes, mensagem] of casos) {
    const r = lerGrade(nome, opcoes);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.erro, mensagem);
  }
});

test('lerOpcoesDigitadas separa por virgula, ponto-e-virgula e linha, sem repetir', () => {
  assert.deepEqual(lerOpcoesDigitadas('p, m; g\nGG\n\n m '), ['P', 'M', 'G', 'GG']);
  assert.deepEqual(lerOpcoesDigitadas(''), []);
});

test('combinacoes: a 1a grade manda e a 2a varia dentro dela; ate duas grades', () => {
  assert.deepEqual(combinacoes([TAMANHO, COR]), [['P', 'AZUL'], ['P', 'PRETO'], ['M', 'AZUL'], ['M', 'PRETO']]);
  assert.deepEqual(combinacoes([TAMANHO]), [['P'], ['M']]);
  assert.deepEqual(combinacoes([]), []);
  assert.deepEqual(combinacoes([TAMANHO, COR, { nome: 'TECIDO', opcoes: ['ALGODAO'] }]).length, 4);
});

test('nome, codigo e SKU da variacao seguem o pai', () => {
  assert.equal(nomeDaVariacao('camiseta basica ', ['P', 'Azul']), 'CAMISETA BASICA P AZUL');
  assert.equal(codigoDaVariacao('123', 7), '123.07');
  assert.equal(codigoDaVariacao('123', 123), '123.123');
  assert.equal(skuDaVariacao('NX-123', 7), 'NX-123-07');
  assert.equal(numeroDaVariacao('123.07', '123'), 7);
  assert.equal(numeroDaVariacao('1234.07', '123'), null);
  assert.equal(numeroDaVariacao('123', '123'), null);
  assert.equal(numeroDaVariacao('123.x', '123'), null);
});

test('proximo numero nunca reaproveita (maior usado + 1)', () => {
  assert.equal(proximoNumeroDaVariacao([], '123'), 1);
  assert.equal(proximoNumeroDaVariacao([{ codigo: '123.01' }, { codigo: '123.05' }, { codigo: 'outro' }], '123'), 6);
});

test('codigo de barras gerado e um EAN-13 valido com prefixo 2 e deterministico', () => {
  assert.equal(digitoVerificadorEan13('789100012345'), '4');
  const barras = codigoDeBarrasGerado('123', 7);
  assert.equal(barras, '2000012300073');
  assert.equal(barras.length, 13);
  assert.equal(digitoVerificadorEan13(barras.slice(0, 12)), barras[12]);
  assert.equal(codigoDeBarrasGerado('123', 7), barras);
  assert.notEqual(codigoDeBarrasGerado('123', 8), barras);
  // Codigo do pai com letras usa so' os digitos; sem digito nenhum vira zeros.
  assert.equal(codigoDeBarrasGerado('AB12', 1).startsWith('2000001200010'.slice(0, 12)), true);
  assert.equal(codigoDeBarrasGerado('ABC', 1).slice(0, 12), '200000000001');
});

const filho = (extra: Partial<FilhoExistente>): FilhoExistente => ({
  id: 'f1', variacao: ['P', 'AZUL'], codigo: '123.01', codigoBarras: '2000012300013', precoProprio: false, precoVenda: 0,
  quantidade: 0, quantidadeReservada: 0, ativo: true, ...extra,
});

test('lerFilho le o documento de estoque de uma variacao', () => {
  const f = lerFilho('f9', { variacao: ['p', 'azul'], codigo: '123.01', codigoBarras: '789', precoProprio: true, precos: { venda: 59.9 }, quantidade: 3, statusAtivo: false });
  assert.deepEqual(f, { id: 'f9', variacao: ['P', 'AZUL'], codigo: '123.01', codigoBarras: '789', precoProprio: true, precoVenda: 59.9, quantidade: 3, quantidadeReservada: 0, ativo: false });
});

test('montarLinhasDaGrade casa combinacoes com os filhos e mantem filho fora da grade no fim', () => {
  const filhos = [filho({ id: 'f1', variacao: ['P', 'AZUL'], quantidade: 4 }), filho({ id: 'f2', variacao: ['GG', 'AZUL'], codigo: '123.02', ativo: false })];
  const linhas = montarLinhasDaGrade([TAMANHO, COR], filhos);
  assert.equal(linhas.length, 5);
  assert.deepEqual(linhas.map((l) => l.rotulo), ['P / AZUL', 'P / PRETO', 'M / AZUL', 'M / PRETO', 'GG / AZUL']);
  assert.equal(linhas[0].filhoId, 'f1');
  assert.equal(linhas[0].ligada, true);
  assert.equal(linhas[0].quantidade, 4);
  assert.equal(linhas[1].filhoId, null);
  assert.equal(linhas[1].ligada, false);
  assert.equal(linhas[4].foraDaGrade, true);
  assert.equal(linhas[4].ligada, false);
  assert.equal(linhas[4].filhoAtivo, false);
});

const linha = (extra: Partial<LinhaDaGrade>): LinhaDaGrade => ({
  opcoes: ['P', 'AZUL'], rotulo: 'P / AZUL', ligada: true, filhoId: null, filhoAtivo: false, codigo: '', codigoBarras: '',
  precoProprio: false, precoVenda: '', quantidadeInicial: '', quantidade: 0, quantidadeReservada: 0, foraDaGrade: false, ...extra,
});

const pedido = (linhas: LinhaDaGrade[], filhos: FilhoExistente[] = [], emUso: Array<[string, string]> = []) => ({
  linhas, filhos, codigoPai: '123', skuPai: 'NX-123', nomePai: 'CAMISETA', codigosDeBarrasEmUso: new Map(emUso), unidadeFracionada: false,
});

test('planejarVariacoes: cria as ligadas com numero, codigo, SKU, nome e codigo de barras gerado', () => {
  const r = planejarVariacoes(pedido([
    linha({ opcoes: ['P', 'AZUL'], rotulo: 'P / AZUL', quantidadeInicial: '5' }),
    linha({ opcoes: ['P', 'PRETO'], rotulo: 'P / PRETO', ligada: false }),
    linha({ opcoes: ['M', 'AZUL'], rotulo: 'M / AZUL', precoProprio: true, precoVenda: '79,90', codigoBarras: '7891000123456' }),
  ]));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plano.criar.length, 2);
  assert.deepEqual(r.plano.criar[0], {
    opcoes: ['P', 'AZUL'], rotulo: 'P / AZUL', numero: 1, codigo: '123.01', sku: 'NX-123-01', nome: 'CAMISETA P AZUL',
    codigoBarras: codigoDeBarrasGerado('123', 1), precoProprio: false, precoVenda: 0, quantidadeInicial: 5,
  });
  assert.equal(r.plano.criar[1].numero, 2);
  assert.equal(r.plano.criar[1].codigoBarras, '7891000123456');
  assert.equal(r.plano.criar[1].precoVenda, 79.9);
  assert.deepEqual(r.plano.atualizar, []);
});

test('planejarVariacoes: filho existente atualiza; desligado inativa; religado reativa; numero continua do maior', () => {
  const filhos = [filho({ id: 'f1', codigo: '123.03', ativo: true }), filho({ id: 'f2', variacao: ['M', 'AZUL'], codigo: '123.01', ativo: false })];
  const r = planejarVariacoes(pedido([
    linha({ filhoId: 'f1', filhoAtivo: true, ligada: false, codigo: '123.03', codigoBarras: '2000012300037' }),
    linha({ opcoes: ['M', 'AZUL'], rotulo: 'M / AZUL', filhoId: 'f2', filhoAtivo: false, ligada: true, codigo: '123.01', codigoBarras: '2000012300013' }),
    linha({ opcoes: ['M', 'PRETO'], rotulo: 'M / PRETO' }),
  ], filhos));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plano.inativar, [{ id: 'f1', rotulo: 'P / AZUL' }]);
  assert.deepEqual(r.plano.reativar, [{ id: 'f2', rotulo: 'M / AZUL' }]);
  assert.equal(r.plano.atualizar.length, 2);
  assert.equal(r.plano.atualizar[1].nome, 'CAMISETA M AZUL');
  assert.equal(r.plano.criar[0].numero, 4);
  assert.equal(r.plano.criar[0].codigo, '123.04');
});

test('planejarVariacoes: codigo de barras gerado pula o que ja esta em uso', () => {
  const ocupado = codigoDeBarrasGerado('123', 1);
  const r = planejarVariacoes(pedido([linha({})], [], [[ocupado, 'outro-produto']]));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plano.criar[0].numero, 2);
  assert.equal(r.plano.criar[0].codigoBarras, codigoDeBarrasGerado('123', 2));
});

test('planejarVariacoes recusa com mensagem em portugues', () => {
  const casos: Array<[ReturnType<typeof pedido>, RegExp]> = [
    [pedido([linha({ ligada: false })]), /Ligue pelo menos uma combinação/],
    [pedido([linha({ precoProprio: true, precoVenda: '' })]), /preço próprio da variação P \/ AZUL/],
    [pedido([linha({ codigoBarras: '111' }), linha({ opcoes: ['M', 'AZUL'], rotulo: 'M / AZUL', codigoBarras: '111' })]), /código de barras 111 está repetido/],
    [pedido([linha({ codigoBarras: '111' })], [], [['111', 'outro']]), /já está em outro produto/],
    [pedido([linha({ quantidadeInicial: '-1' })]), /maior ou igual a zero/],
    [pedido([linha({ quantidadeInicial: '1,5' })]), /não pode ter fração/],
    [{ ...pedido([linha({})]), codigoPai: '' }, /precisa de código interno/],
  ];
  for (const [p, mensagem] of casos) {
    const r = planejarVariacoes(p);
    assert.equal(r.ok, false, mensagem.source);
    if (!r.ok) assert.match(r.erro, mensagem);
  }
  // O proprio filho pode continuar com o codigo de barras que ja' e' dele.
  const proprio = planejarVariacoes(pedido([linha({ filhoId: 'f1', filhoAtivo: true, codigoBarras: '111' })], [filho({ codigoBarras: '111' })], [['111', 'f1']]));
  assert.equal(proprio.ok, true);
});

test('camposDaVariacao: herda o cadastro do pai, nunca saldo/situacao/historico, e trata o preco', () => {
  const pai = {
    nome: 'CAMISETA', codigo: '123', skuSistema: 'NX-123', slugUrl: 'camiseta', codigoBarras: '789', categoria: 'ROUPAS', ncm: '61091000',
    precoCusto: 20, precoVenda: 50, precoAVista: 45, precoAPrazo: 55, precoPromocional: 40,
    precos: { venda: 50, custo: 20, aVista: 45, aPrazo: 55, promocional: 40 },
    quantidade: 0, quantidadeReservada: 0, ativo: true, statusAtivo: true, historicoPrecos: [{ precoNovo: 50 }],
    temGrade: true, gradeNomes: ['TAMANHO', 'COR'], grupoChave: 'pai', filialOrigem: 'loja', cadastroHash: 'x', createdAt: 'ontem',
    embalagens: [{ id: 'e1', codigoBarras: '555', fatorConversao: 12 }],
    ecommerce: { skuSistema: 'NX-123', slugUrl: 'camiseta', seoTitulo: 'Camiseta' },
    tags: ['verao'], fiscal: { ncm: '61091000' },
  };
  const identidade = { nome: 'CAMISETA P AZUL', codigo: '123.01', sku: 'NX-123-01', codigoBarras: '2000012300013', opcoes: ['P', 'AZUL'], rotulo: 'P / AZUL', produtoPaiChave: 'pai', precoProprio: false, precoVenda: 0 };

  const igual = camposDaVariacao(pai, identidade);
  assert.equal(igual.nome, 'CAMISETA P AZUL');
  assert.equal(igual.codigo, '123.01');
  assert.equal(igual.skuSistema, 'NX-123-01');
  assert.equal(igual.slugUrl, 'camiseta-p-azul');
  assert.equal(igual.codigoBarras, '2000012300013');
  assert.equal(igual.categoria, 'ROUPAS');
  assert.equal(igual.ehVariacao, true);
  assert.equal(igual.produtoPaiChave, 'pai');
  assert.deepEqual(igual.variacao, ['P', 'AZUL']);
  assert.equal(igual.variacaoRotulo, 'P / AZUL');
  assert.equal(igual.precoVenda, 50);
  assert.equal(igual.precoAVista, 45);
  assert.equal(igual.precoAPrazo, 55);
  assert.equal(igual.margemLucro, 150);
  assert.deepEqual(igual.embalagens, [{ id: 'e1', codigoBarras: '', fatorConversao: 12 }]);
  assert.deepEqual(igual.ecommerce, { skuSistema: 'NX-123-01', slugUrl: 'camiseta-p-azul', seoTitulo: 'Camiseta' });
  for (const campo of ['quantidade', 'quantidadeReservada', 'ativo', 'statusAtivo', 'historicoPrecos', 'temGrade', 'gradeNomes', 'grupoChave', 'filialOrigem', 'cadastroHash', 'createdAt']) {
    assert.equal(campo in igual, false, campo);
  }

  const proprio = camposDaVariacao(pai, { ...identidade, precoProprio: true, precoVenda: 60 });
  assert.equal(proprio.precoVenda, 60);
  assert.equal('precoAVista' in proprio, false);
  assert.equal('precoAPrazo' in proprio, false);
  assert.equal(proprio.precoPromocional, 0);
  assert.deepEqual(proprio.precos, { venda: 60, custo: 20, promocional: 0, margemLucro: 200, lucroEstimado: 40 });
  assert.equal(proprio.precoProprio, true);
});

test('variacaoPrecisaAtualizar acusa apenas quando algum campo mudou', () => {
  assert.equal(variacaoPrecisaAtualizar({ nome: 'A', variacao: ['P'], extra: 1 }, { nome: 'A', variacao: ['P'] }), false);
  assert.equal(variacaoPrecisaAtualizar({ nome: 'A' }, { nome: 'B' }), true);
  assert.equal(variacaoPrecisaAtualizar({}, { precoAVista: undefined }), false);
});

test('ligar a grade exige saldo e reserva zerados; desligar exige nao ter filhos', () => {
  assert.equal(bloqueioParaLigarGrade({ quantidade: 0 }), null);
  assert.match(bloqueioParaLigarGrade({ quantidade: 3 }) ?? '', /tem 3 em estoque/);
  assert.match(bloqueioParaLigarGrade({ quantidade: 0, quantidadeReservada: 2 }) ?? '', /2 reservado/);
  assert.equal(bloqueioParaDesligarGrade(false), null);
  assert.match(bloqueioParaDesligarGrade(true) ?? '', /não volta a ser produto simples/);
});

test('agruparVariacoes poe as variacoes embaixo do pai e devolve orfas ao nivel de cima', () => {
  const itens = [
    { id: 'pai', temGrade: true },
    { id: 'f1', ehVariacao: true, produtoPaiChave: 'pai', quantidade: 2, quantidadeReservada: 1 },
    { id: 'f2', ehVariacao: true, produtoPaiChave: 'pai', quantidade: 5, ativo: false },
    { id: 'orfa', ehVariacao: true, produtoPaiChave: 'sumiu', quantidade: 1 },
    { id: 'comum', quantidade: 9 },
  ];
  const { principais, variacoesPorPai } = agruparVariacoes(itens, (i) => i.id);
  assert.deepEqual(principais.map((p) => p.id), ['pai', 'orfa', 'comum']);
  assert.deepEqual(variacoesPorPai.get('pai')?.map((v) => v.id), ['f1', 'f2']);
  assert.deepEqual(somaDasVariacoes(variacoesPorPai.get('pai') ?? []), { quantidade: 2, quantidadeReservada: 1 });
});

test('opcoesEmUso e gradeEmUso: o que alguma variacao usa nao pode sair da grade', () => {
  const pais = [{ chave: 'pai', gradeNomes: ['TAMANHO', 'COR'] }, { chave: 'outro', gradeNomes: ['COR'] }];
  const filhos = [
    { produtoPaiChave: 'pai', variacao: ['P', 'Azul'] },
    { produtoPaiChave: 'pai', variacao: ['M', 'AZUL'] },
    { produtoPaiChave: 'outro', variacao: ['PRETO'] },
    { produtoPaiChave: 'sumiu', variacao: ['GG', 'ROSA'] },
  ];
  assert.deepEqual([...opcoesEmUso('cor', pais, filhos)].sort(), ['AZUL', 'PRETO']);
  assert.deepEqual([...opcoesEmUso('TAMANHO', pais, filhos)].sort(), ['M', 'P']);
  assert.deepEqual([...opcoesEmUso('TECIDO', pais, filhos)], []);
  assert.equal(gradeEmUso('Cor', pais), true);
  assert.equal(gradeEmUso('TECIDO', pais), false);
});
