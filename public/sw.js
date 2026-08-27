// Service worker minimo do Hennder ERP -- existe SO pra habilitar "Instalar
// app" no Chrome/Edge. Nao guarda cache nenhum de proposito.
//
// Por que nao cachear: o sistema busca dado financeiro/fiscal em tempo real
// (Firestore, backend). Um service worker que guarda resposta antiga pode
// mostrar saldo, estoque ou preco desatualizado sem o usuario perceber --
// pior que nao ter app instalavel nenhum. E main.tsx ja trata chunk JS
// obsoleto apos deploy (window.addEventListener('vite:preloadError', ...)
// forcando reload); um cache aqui reintroduziria exatamente esse problema
// por outro caminho.
//
// O fetch handler abaixo e' so passthrough (busca sempre da rede) --
// existe porque versoes mais antigas do Chrome exigem um service worker
// com fetch handler pra considerar o site instalavel; sem ele, o botao
// "Instalar app" nao aparece nesses navegadores.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
