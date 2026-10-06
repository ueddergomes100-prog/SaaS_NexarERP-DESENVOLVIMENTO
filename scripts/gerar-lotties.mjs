/*
 * ANIMACOES LOTTIE DO SISTEMA (2026-10-06, pedido do dono).
 *
 * Gera os arquivos .json de src/assets/lotties/ a partir de formas simples
 * (circulo, traco, caminho), nas cores da marca. Sao animacoes PEQUENAS de
 * proposito: feedback de sucesso/erro/aviso, lixeira do excluir, anel do
 * splash e a caixa do "nada aqui". Cada uma pesa poucos KB e nenhuma passa
 * de ~1,5 s (as de feedback) -- em sistema de trabalho, animacao e' tempero,
 * nao prato principal.
 *
 *   node scripts/gerar-lotties.mjs
 *
 * A saida e' versionada (nao ha passo de build). Mudou aqui, rode de novo e
 * faca commit dos .json. Quem toca as animacoes: src/utils/animacoes.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DESTINO = resolve('src/assets/lotties');
const FR = 60;

// Cores do tema (src/index.css): a mesma paleta das telas.
const CORES = {
  roxo: '#8b5cf6',
  roxoClaro: '#c4b5fd',
  azul: '#3b82f6',
  verde: '#10b981',
  vermelho: '#ef4444',
  ambar: '#f59e0b',
  cinza: '#71717a',
};

const cor = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round((v / 255) * 1000) / 1000).concat(1);
};

// ---------------------------------------------------------------------------
// Propriedades: fixas ou com quadros-chave
// ---------------------------------------------------------------------------
const fixo = (k) => ({ a: 0, k });

const SUAVE = { ix: 0.25, iy: 1, ox: 0.35, oy: 0 };
const LINEAR = { ix: 1, iy: 1, ox: 0, oy: 0 };
const SALTO = { ix: 0.2, iy: 1.3, ox: 0.4, oy: 0 };

const lista = (v) => (Array.isArray(v) ? v : [v]);

/** quadros = [[t, valor], ...]; o ultimo quadro so' tem o valor final. */
const animado = (quadros, e = SUAVE) => ({
  a: 1,
  k: quadros.map(([t, v], i) => {
    const s = lista(v);
    if (i === quadros.length - 1) return { t, s };
    const n = s.length;
    return {
      t,
      s,
      e: lista(quadros[i + 1][1]),
      i: { x: Array(n).fill(e.ix), y: Array(n).fill(e.iy) },
      o: { x: Array(n).fill(e.ox), y: Array(n).fill(e.oy) },
    };
  }),
});

const prop = (v) => (v && typeof v === 'object' && 'a' in v ? v : fixo(v));

// ---------------------------------------------------------------------------
// Formas
// ---------------------------------------------------------------------------
const transformacao = (extra = {}) => ({
  ty: 'tr',
  p: prop(extra.p ?? [0, 0]),
  a: prop(extra.a ?? [0, 0]),
  s: prop(extra.s ?? [100, 100]),
  r: prop(extra.r ?? 0),
  o: prop(extra.o ?? 100),
  sk: fixo(0),
  sa: fixo(0),
  nm: 'Transformação',
});
const grupo = (itens, extra = {}, nm = 'Grupo') => ({ ty: 'gr', it: [...itens, transformacao(extra)], nm });
const elipse = (p, d) => ({ ty: 'el', d: 1, p: fixo(p), s: fixo(Array.isArray(d) ? d : [d, d]), nm: 'Elipse' });
const caminho = (v, fechado = false) => ({
  ty: 'sh', d: 1, nm: 'Caminho',
  ks: fixo({ i: v.map(() => [0, 0]), o: v.map(() => [0, 0]), v, c: fechado }),
});
const traco = (hex, w, o = 100) => ({ ty: 'st', c: fixo(cor(hex)), o: prop(o), w: fixo(w), lc: 2, lj: 2, ml: 4, bm: 0, nm: 'Traço' });
const preenchimento = (hex, o = 100) => ({ ty: 'fl', c: fixo(cor(hex)), o: prop(o), r: 1, bm: 0, nm: 'Preenchimento' });
const aparar = (s, e, o = 0) => ({ ty: 'tm', s: prop(s), e: prop(e), o: prop(o), m: 1, nm: 'Aparar' });

const camada = (nm, ind, shapes, { op, centro, ks = {} }) => ({
  ddd: 0, ind, ty: 4, nm, sr: 1,
  ks: {
    o: prop(ks.o ?? 100),
    r: prop(ks.r ?? 0),
    p: prop(ks.p ?? [...centro, 0]),
    a: fixo([...centro, 0]),
    s: prop(ks.s ?? [100, 100, 100]),
  },
  ao: 0, shapes, ip: 0, op, st: 0, bm: 0,
});

const composicao = (nm, w, h, op, layers) => ({ v: '5.7.4', fr: FR, ip: 0, op, w, h, nm, ddd: 0, assets: [], layers, markers: [] });

// ---------------------------------------------------------------------------
// As animacoes
// ---------------------------------------------------------------------------

/** Sucesso: circulo se desenha, check entra, leve pulo. 0,9 s, toca uma vez. */
const sucesso = () => {
  const c = [60, 60];
  const desenhaCirculo = aparar(0, animado([[0, 0], [26, 100]]));
  const desenhaCheck = aparar(0, animado([[16, 0], [34, 100]]));
  return composicao('sucesso', 120, 120, 54, [
    camada('sucesso', 1, [
      grupo([caminho([[38, 62], [54, 78], [84, 46]]), desenhaCheck, traco(CORES.verde, 9)], {}, 'Check'),
      grupo([elipse(c, 88), desenhaCirculo, traco(CORES.verde, 8)], {}, 'Círculo'),
      grupo([elipse(c, 88), preenchimento(CORES.verde, animado([[0, 0], [26, 14]]))], {}, 'Brilho'),
    ], { op: 54, centro: c, ks: { s: animado([[24, [100, 100, 100]], [34, [108, 108, 100]], [46, [100, 100, 100]]]) } }),
  ]);
};

/** Erro: circulo, X e uma balancada. 1 s, toca uma vez. */
const erro = () => {
  const c = [60, 60];
  return composicao('erro', 120, 120, 60, [
    camada('erro', 1, [
      grupo([caminho([[42, 42], [78, 78]]), aparar(0, animado([[16, 0], [30, 100]])), traco(CORES.vermelho, 9)], {}, 'Risco 1'),
      grupo([caminho([[78, 42], [42, 78]]), aparar(0, animado([[22, 0], [36, 100]])), traco(CORES.vermelho, 9)], {}, 'Risco 2'),
      grupo([elipse(c, 88), aparar(0, animado([[0, 0], [24, 100]])), traco(CORES.vermelho, 8)], {}, 'Círculo'),
      grupo([elipse(c, 88), preenchimento(CORES.vermelho, animado([[0, 0], [24, 14]]))], {}, 'Brilho'),
    ], {
      op: 60, centro: c,
      ks: { p: animado([[36, [60, 60, 0]], [41, [55, 60, 0]], [46, [65, 60, 0]], [51, [57, 60, 0]], [56, [60, 60, 0]]]) },
    }),
  ]);
};

/** Aviso: triangulo se desenha, exclamacao aparece com um pulo. 0,9 s. */
const aviso = () => {
  const c = [60, 62];
  return composicao('aviso', 120, 120, 54, [
    camada('aviso', 1, [
      grupo([elipse([60, 82], 10), preenchimento(CORES.ambar)], { a: [60, 82], p: [60, 82], s: animado([[28, [0, 0]], [38, [120, 120]], [46, [100, 100]]], SALTO) }, 'Ponto'),
      grupo([caminho([[60, 46], [60, 70]]), aparar(0, animado([[20, 0], [32, 100]])), traco(CORES.ambar, 9)], {}, 'Traço'),
      grupo([caminho([[60, 22], [102, 94], [18, 94]], true), aparar(0, animado([[0, 0], [26, 100]])), traco(CORES.ambar, 8)], {}, 'Triângulo'),
      grupo([caminho([[60, 22], [102, 94], [18, 94]], true), preenchimento(CORES.ambar, animado([[0, 0], [26, 12]]))], {}, 'Brilho'),
    ], { op: 54, centro: c }),
  ]);
};

/** Excluir: lixeira com a tampa abrindo e fechando. 1,4 s em laco (fica no pop-up de confirmacao). */
const excluir = () => {
  const c = [60, 66];
  return composicao('excluir', 120, 120, 84, [
    camada('tampa', 1, [
      grupo([
        caminho([[36, 46], [84, 46]]),
        caminho([[52, 46], [52, 38], [68, 38], [68, 46]]),
        traco(CORES.vermelho, 7),
      ], { a: [84, 46], p: [84, 46], r: animado([[6, 0], [20, 22], [46, 22], [60, 0], [84, 0]]) }, 'Tampa'),
    ], { op: 84, centro: c }),
    camada('corpo', 2, [
      grupo([
        caminho([[52, 62], [54, 86]]), caminho([[60, 62], [60, 86]]), caminho([[68, 62], [66, 86]]),
        traco(CORES.vermelho, 5, 55),
      ], {}, 'Frisos'),
      grupo([caminho([[42, 52], [78, 52], [74, 96], [46, 96]], true), traco(CORES.vermelho, 7)], {}, 'Corpo'),
      grupo([caminho([[42, 52], [78, 52], [74, 96], [46, 96]], true), preenchimento(CORES.vermelho, 10)], {}, 'Brilho'),
    ], { op: 84, centro: c }),
  ]);
};

/** Carregando: tres arcos nas cores da marca girando em volta do logo. 6 s em laco (voltas inteiras). */
const carregando = () => {
  const c = [80, 80];
  const arco = (nm, ind, diametro, trecho, hex, largura, opacidade, voltas) => camada(nm, ind, [
    grupo([elipse(c, diametro), aparar(0, trecho), traco(hex, largura, opacidade)], {}, nm),
  ], { op: 360, centro: c, ks: { r: animado([[0, 0], [360, voltas * 360]], LINEAR) } });
  return composicao('carregando', 160, 160, 360, [
    arco('Arco externo', 1, 136, 18, CORES.roxoClaro, 4, 70, 2),
    arco('Arco principal', 2, 112, 38, CORES.roxo, 7, 100, 4),
    arco('Arco interno', 3, 88, 28, CORES.azul, 6, 100, -3),
    camada('Trilho', 4, [grupo([elipse(c, 112), traco(CORES.roxo, 7, 14)], {}, 'Trilho')], { op: 360, centro: c }),
  ]);
};

/** Vazio: caixa aberta flutuando, com brilhos piscando. 2,5 s em laco, bem discreto. */
const vazio = () => {
  const c = [100, 84];
  return composicao('vazio', 200, 160, 150, [
    camada('Brilho 1', 1, [
      grupo([caminho([[150, 32], [150, 48]]), caminho([[142, 40], [158, 40]]), traco(CORES.roxo, 4)], {}, 'Mais'),
    ], { op: 150, centro: [150, 40], ks: { o: animado([[0, 0], [30, 100], [60, 0], [150, 0]]), s: animado([[0, [60, 60, 100]], [30, [100, 100, 100]], [60, [60, 60, 100]], [150, [60, 60, 100]]]) } }),
    camada('Brilho 2', 2, [grupo([elipse([44, 48], 7), preenchimento(CORES.roxoClaro)], {}, 'Ponto')], {
      op: 150, centro: [44, 48], ks: { o: animado([[0, 0], [60, 0], [90, 100], [120, 0], [150, 0]]) },
    }),
    camada('Caixa', 3, [
      grupo([caminho([[56, 76], [40, 94]]), caminho([[144, 76], [160, 94]]), traco(CORES.cinza, 5)], {}, 'Abas'),
      grupo([caminho([[66, 54], [134, 54], [144, 76], [56, 76]], true), traco(CORES.cinza, 5), preenchimento(CORES.roxo, 18)], {}, 'Abertura'),
      grupo([caminho([[56, 76], [144, 76], [138, 124], [62, 124]], true), traco(CORES.cinza, 5), preenchimento(CORES.cinza, 14)], {}, 'Corpo'),
    ], { op: 150, centro: c, ks: { p: animado([[0, [100, 84, 0]], [75, [100, 78, 0]], [150, [100, 84, 0]]]) } }),
    camada('Sombra', 4, [grupo([elipse([100, 138], [72, 10]), preenchimento(CORES.cinza, animado([[0, 22], [75, 12], [150, 22]]))], {}, 'Sombra')], { op: 150, centro: [100, 138] }),
  ]);
};

mkdirSync(DESTINO, { recursive: true });
const todas = { sucesso, erro, aviso, excluir, carregando, vazio };
for (const [nome, gerar] of Object.entries(todas)) {
  const json = JSON.stringify(gerar());
  writeFileSync(resolve(DESTINO, `${nome}.json`), json);
  process.stdout.write(`${nome}.json  ${(json.length / 1024).toFixed(1)} KB\n`);
}
