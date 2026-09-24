// Teste do script de padronizacao (node --test scripts/sol-life-padronizar-produtos.test.mjs).
// Usa um "Firestore" falso em memoria: o script NUNCA e' testado contra producao.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarDesfazer,
  aplicarPadronizacao,
  camposParaGravar,
  montarBackup,
  planejarDesfazer,
  planejarPadronizacao,
  regimeAceitaCst,
  verificarPreCondicoes,
} from './sol-life-padronizar-produtos.mjs';

const ALVO = { categoria: 'SEMIACABADOS', cst: '00' };

class BancoFalso {
  constructor(colecoes) { this.colecoes = colecoes; this.lotes = 0; }
  collection(nome) {
    const dados = this.colecoes[nome] || (this.colecoes[nome] = {});
    const banco = this;
    return {
      doc: (id) => ({ colecao: nome, id, get: async () => ({ exists: id in dados, data: () => dados[id] }) }),
      where: (campo, _op, valor) => ({
        get: async () => ({ docs: Object.entries(dados).filter(([, v]) => v[campo] === valor).map(([id, v]) => ({ id, data: () => v })) }),
      }),
    };
  }
  batch() {
    const banco = this;
    const pendentes = [];
    return {
      update: (ref, campos) => pendentes.push([ref, campos]),
      commit: async () => {
        banco.lotes += 1;
        pendentes.forEach(([ref, campos]) => {
          const doc = banco.colecoes[ref.colecao][ref.id];
          Object.entries(campos).forEach(([k, v]) => {
            if (v && v.__apagar) delete doc[k]; else doc[k] = v;
          });
        });
      },
    };
  }
}
const FieldValueFalso = { serverTimestamp: () => 'AGORA', delete: () => ({ __apagar: true }) };

const produtos = () => ({
  a: { tenantId: 'sol', codigo: '1', nome: 'A', categoria: 'ANTIPULGAS', csosn: '102', cest: '1710300' },
  b: { tenantId: 'sol', codigo: '2', nome: 'B', categoria: 'SEMIACABADOS', csosn: '00' },
  c: { tenantId: 'sol', codigo: '3', nome: 'C', categoria: 'OLEOS' },
  d: { tenantId: 'outra', codigo: '4', nome: 'D', categoria: 'X', csosn: '60' },
});

const lista = (banco) => Object.entries(banco.colecoes.estoque).map(([id, v]) => ({ id, ...v })).filter((p) => p.tenantId === 'sol');

test('plano: só muda o que difere; quem já está certo fica de fora; conta CEST e distribuições', () => {
  const plano = planejarPadronizacao(lista({ colecoes: { estoque: produtos() } }), ALVO);
  assert.equal(plano.total, 3);
  assert.equal(plano.jaCertos, 1);
  assert.equal(plano.alterar.length, 2);
  assert.equal(plano.mudaCategoria, 2);
  assert.equal(plano.mudaCst, 2);
  assert.equal(plano.comCestRecebendoCst, 1);
  assert.deepEqual(plano.porCst.map(([v]) => v).sort(), ['(vazio)', '00', '102'].sort());
});

test('plano: categoria só muda o CST quando a categoria já está certa (e vice-versa)', () => {
  const plano = planejarPadronizacao([{ id: 'x', categoria: 'SEMIACABADOS', csosn: '10' }, { id: 'y', categoria: 'OUTRA', csosn: '00' }], ALVO);
  assert.deepEqual(plano.alterar.map((a) => [a.id, a.mudaCategoria, a.mudaCst]), [['x', false, true], ['y', true, false]]);
  assert.deepEqual(camposParaGravar(plano.alterar[0], ALVO), { csosn: '00' });
  assert.deepEqual(camposParaGravar(plano.alterar[1], ALVO), { categoria: 'SEMIACABADOS' });
});

test('regime: Simples Nacional (ou sem regime) não recebe CST 00', () => {
  assert.equal(regimeAceitaCst('lucro_presumido'), true);
  assert.equal(regimeAceitaCst('lucro_real'), true);
  assert.equal(regimeAceitaCst('simples_nacional'), false);
  assert.equal(regimeAceitaCst(undefined), false);
});

test('pré-condições: para se o regime é Simples, se a categoria não existe ou está inativa', async () => {
  const base = (regime, categorias) => new BancoFalso({ configuracoes: { sol: { regimeTributario: regime } }, categorias });
  const ok = await verificarPreCondicoes(base('lucro_presumido', { c1: { tenantId: 'sol', nome: 'Semiacabados', ativo: true } }), 'sol', 'SEMIACABADOS');
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.nomeDaCategoria, 'Semiacabados'); // grava o nome como esta cadastrado
  assert.match((await verificarPreCondicoes(base('simples_nacional', { c1: { tenantId: 'sol', nome: 'SEMIACABADOS' } }), 'sol', 'SEMIACABADOS')).erros[0], /Simples Nacional/);
  assert.match((await verificarPreCondicoes(base('lucro_real', {}), 'sol', 'SEMIACABADOS')).erros[0], /não existe/);
  assert.match((await verificarPreCondicoes(base('lucro_real', { c1: { tenantId: 'sol', nome: 'SEMIACABADOS', ativo: false } }), 'sol', 'SEMIACABADOS')).erros[0], /INATIVA/);
  assert.match((await verificarPreCondicoes(new BancoFalso({ configuracoes: {}, categorias: {} }), 'sol', 'SEMIACABADOS')).erros[0], /configuração da empresa/);
});

test('aplicar: grava só nos produtos do plano, só as chaves que mudam, nada de undefined, e não toca em outro tenant', async () => {
  const banco = new BancoFalso({ estoque: produtos() });
  const plano = planejarPadronizacao(lista(banco), ALVO);
  await aplicarPadronizacao(banco, FieldValueFalso, plano, ALVO);
  assert.equal(banco.colecoes.estoque.a.categoria, 'SEMIACABADOS');
  assert.equal(banco.colecoes.estoque.a.csosn, '00');
  assert.equal(banco.colecoes.estoque.c.csosn, '00');
  assert.equal(banco.colecoes.estoque.b.updatedAt, undefined, 'produto já certo não é tocado');
  assert.equal(banco.colecoes.estoque.d.categoria, 'X', 'outro tenant intacto');
  assert.equal(banco.colecoes.estoque.d.csosn, '60');
  assert.equal(Object.values(banco.colecoes.estoque.a).some((v) => v === undefined), false);
  // idempotente: rodar de novo não tem nada a fazer
  assert.equal(planejarPadronizacao(lista(banco), ALVO).alterar.length, 0);
});

test('aplicar: mais de 400 produtos vão em mais de um lote', async () => {
  const muitos = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`p${i}`, { tenantId: 'sol', codigo: String(i), nome: `P${i}`, categoria: 'X', csosn: '102' }]));
  const banco = new BancoFalso({ estoque: muitos });
  await aplicarPadronizacao(banco, FieldValueFalso, planejarPadronizacao(lista(banco), ALVO), ALVO);
  assert.equal(banco.lotes, 3);
});

test('desfazer: volta ao valor de antes, apaga o campo que não existia e respeita quem mudou depois', async () => {
  const banco = new BancoFalso({ estoque: produtos() });
  const plano = planejarPadronizacao(lista(banco), ALVO);
  const backup = montarBackup(plano, { tenantId: 'sol', ...ALVO });
  await aplicarPadronizacao(banco, FieldValueFalso, plano, ALVO);
  banco.colecoes.estoque.a.categoria = 'ALGUMA OUTRA'; // alguem mexeu depois do script

  const planoDesfazer = planejarDesfazer(JSON.parse(JSON.stringify(backup)), lista(banco));
  assert.equal(planoDesfazer.ignorados.length, 1);
  assert.match(planoDesfazer.ignorados[0].motivo, /categoria mudou depois/);
  await aplicarDesfazer(banco, FieldValueFalso, planoDesfazer);

  assert.equal(banco.colecoes.estoque.a.csosn, '102', 'CST de A voltou');
  assert.equal(banco.colecoes.estoque.a.categoria, 'ALGUMA OUTRA', 'quem mudou depois não é desfeito');
  assert.equal(banco.colecoes.estoque.c.categoria, 'OLEOS');
  assert.equal('csosn' in banco.colecoes.estoque.c, false, 'C não tinha CST: o campo é apagado, não vira null');
});
