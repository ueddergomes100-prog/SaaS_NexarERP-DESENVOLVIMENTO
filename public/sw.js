// Service worker do Hennder ERP (refeito em 2026-10-08 para o app do tecnico
// trabalhar sem sinal -- antes era passthrough puro, so' para habilitar
// "Instalar app").
//
// O QUE E' GUARDADO: so' ARQUIVOS DO APP (HTML, JS, CSS, fontes, icones,
// manifest) do proprio dominio. Dado nenhum: Firestore e o backend nao
// passam por aqui (o SDK fala por WebSocket/fetch proprio e tem o seu cache
// persistente; chamadas /api/ sao sempre rede). Entao saldo, estoque e preco
// continuam vindo ao vivo -- o medo original de "cache mostrando dado velho"
// nao se aplica a arquivos com hash no nome.
//
// COMO:
//  - navegacao (abrir /vendedor, /os...): REDE PRIMEIRO; sem rede, a copia
//    guardada do HTML (o app abre offline). HTML novo apos deploy chega na
//    primeira abertura com sinal.
//  - /assets/* (hash no nome, imutaveis) e arquivos estaticos: CACHE PRIMEIRO,
//    atualizando em segundo plano. Chunk que sumiu apos deploy ja' e' tratado
//    pelo main.tsx (vite:preloadError -> reload).
//  - resto: passa direto.
const CACHE = 'hennder-app-v1';
const ESTATICO = /\.(?:js|css|woff2?|ttf|png|svg|ico|webmanifest|json)$/;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const mesmaOrigem = (url) => url.origin === self.location.origin;

const redePrimeiro = async (request) => {
  const cache = await caches.open(CACHE);
  try {
    const resposta = await fetch(request);
    if (resposta && resposta.ok) cache.put(request, resposta.clone());
    return resposta;
  } catch (erro) {
    const guardada = await cache.match(request) || await cache.match(request.url.includes('/vendedor') ? '/vendedor.html' : '/index.html');
    if (guardada) return guardada;
    throw erro;
  }
};

const cachePrimeiro = async (request) => {
  const cache = await caches.open(CACHE);
  const guardada = await cache.match(request);
  const atualizar = fetch(request).then((resposta) => {
    if (resposta && resposta.ok) cache.put(request, resposta.clone());
    return resposta;
  }).catch(() => undefined);
  if (guardada) {
    // Atualiza em segundo plano; quem pediu recebe a copia na hora.
    atualizar.catch(() => undefined);
    return guardada;
  }
  const resposta = await atualizar;
  if (resposta) return resposta;
  return new Response('', { status: 504, statusText: 'Sem conexão' });
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!mesmaOrigem(url)) return;
  // Dev server do Vite (/src/, /@vite/, /node_modules/): nao mexe, o HMR cuida.
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules/')) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(redePrimeiro(request));
    return;
  }
  if (url.pathname.startsWith('/assets/') || ESTATICO.test(url.pathname)) {
    event.respondWith(cachePrimeiro(request));
  }
});
