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
    const entrada = request.url.includes('/caixa') ? '/caixa.html' : request.url.includes('/vendedor') ? '/vendedor.html' : '/index.html';
    const guardada = await cache.match(request) || await cache.match(entrada);
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

// AVISOS NO CELULAR (21/10/2026): o Firebase Cloud Messaging entrega o push
// aqui; mostramos a notificacao e, no toque, abrimos a tela certa do app
// (primeiro uso: "Liberar desconto?"). Sem a biblioteca do FCM no worker: o
// payload chega como JSON { notification, data } e basta isto.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const n = payload.notification || {};
  const d = payload.data || {};
  const titulo = n.title || d.titulo || 'Hennder';
  const corpo = n.body || d.corpo || '';
  const link = d.link || (payload.fcmOptions && payload.fcmOptions.link) || '/vendedor';
  event.waitUntil(self.registration.showNotification(titulo, {
    body: corpo,
    icon: '/icon-vendedor-192.png',
    badge: '/icon-vendedor-192.png',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    requireInteraction: true,
    data: { link },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/vendedor';
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const janela of janelas) {
      if ('focus' in janela) {
        await janela.focus();
        if ('navigate' in janela) {
          try { await janela.navigate(link); } catch { /* fica na tela que esta' */ }
        }
        return;
      }
    }
    await self.clients.openWindow(link);
  })());
});

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
