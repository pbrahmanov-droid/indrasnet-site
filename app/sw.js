/* global clients */
// public/sw.js
// Service worker веб-сборки: приложение открывается без сети (DL-162).
// Файл отдаётся по адресу /app/sw.js, поэтому область его власти — /app/.
// Регистрация — src/web/registerServiceWorker.ts, только из веб-входа
// index.web.js; Android этого кода не видит (DL-159 п.3).
//
// VERSION поднимается на каждом веб-выпуске и называется в заметках выпуска.
// Кеш привязан к версии: при подъёме номера новый кеш пуст, всё
// перезапрашивается, старые кеши удаляются в activate. Поэтому хешированные
// файлы можно брать из кеша не спрашивая сеть — устареть внутри одной версии
// им нечем.
const VERSION = 2;

// Адрес подпапки, под которой лежит PWA. Записан ещё в app.config.js
// (experiments.baseUrl) и в manifest.webmanifest; менять — во всех трёх.
const BASE = "/app";

const CACHE = `ll-web-v${VERSION}`;

// Оболочка: имена без хешей, известны заранее.
const PRECACHE = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/maskable-512.png`,
  `${BASE}/icons/apple-touch-icon-180.png`,
];

// Имя сообщения от страницы: перечень уже загруженных ею ресурсов.
const MESSAGE_LOADED = "ll-sw-loaded-resources";

// Хешированные выдачи экспорта: бандл, шрифты, картинки. Имя меняется вместе
// с содержимым, поэтому берутся из кеша первым делом.
function isImmutable(pathname) {
  return (
    pathname.startsWith(`${BASE}/_expo/`) || pathname.startsWith(`${BASE}/assets/`)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Поштучно, а не cache.addAll: один недоступный файл не должен
      // отменить установку целиком.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (e) {
            console.log("[LL][SW] precache miss", url, e);
          }
        })
      );
      // Ждать закрытия всех окон не нужно: страница, которая уже открыта,
      // доигрывает на своём бандле, а следующий запуск берёт новый. Так на
      // старой версии не застрять.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name))
      );
      await clients.claim();
    })()
  );
});

// Догон первого запуска. Страницу первого запуска service worker не ведёт:
// он в этот момент только ставится, а запросы бандла, шрифтов и картинок уже
// ушли мимо него и в кеш не попали. Поэтому страница сама присылает перечень
// того, что загрузила (src/web/registerServiceWorker.ts), а здесь
// недостающее докладывается в кеш. Без этого второй запуск без сети открыл бы
// оболочку и встал на первом же обращении к бандлу.
self.addEventListener("message", (event) => {
  const data = event.data;

  if (!data || data.type !== MESSAGE_LOADED || !Array.isArray(data.urls)) {
    return;
  }

  event.waitUntil(addMissing(data.urls));
});

async function addMissing(urls) {
  const cache = await caches.open(CACHE);

  for (const raw of urls) {
    let url;

    try {
      url = new URL(raw, self.location.origin);
    } catch {
      continue;
    }

    // Отбор — здесь, а не в странице: правило, что можно держать в кеше,
    // живёт в одном месте с fetch.
    if (url.origin !== self.location.origin || !isImmutable(url.pathname)) {
      continue;
    }

    const request = new Request(url.href);

    if (await cache.match(request)) {
      continue;
    }

    try {
      // Без cache: "reload": файл только что загружен страницей, и браузер
      // отдаст его из своего кеша, не ходя в сеть второй раз.
      const response = await fetch(request);
      await put(cache, request, response);
    } catch (e) {
      console.log("[LL][SW] catch-up miss", url.href, e);
    }
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Чужие источники и всё вне /app/ — мимо: не наше дело.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(`${BASE}/`)) {
    return;
  }

  // Сам себя не кешируем ни при каких условиях: иначе новую версию не
  // увидеть. Регистрация просит браузер не брать этот файл и из HTTP-кеша
  // (updateViaCache: "none").
  if (url.pathname === `${BASE}/sw.js`) {
    return;
  }

  if (isImmutable(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Переходы (открытие приложения) — сеть вперёд кеша: при сети человек
  // всегда получает свежую оболочку со ссылкой на свежий бандл, без сети —
  // ту, что лежит в кеше.
  event.respondWith(networkFirst(request, request.mode === "navigate"));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);

  if (hit) {
    return hit;
  }

  const response = await fetch(request);
  await put(cache, request, response);
  return response;
}

async function networkFirst(request, isNavigation) {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);
    await put(cache, request, response);
    return response;
  } catch (e) {
    const hit = await cache.match(request);

    if (hit) {
      return hit;
    }

    if (isNavigation) {
      // Любой адрес внутри приложения ведёт в ту же оболочку: маршрут
      // разбирает expo-router уже в странице.
      const shell = await cache.match(`${BASE}/index.html`);

      if (shell) {
        return shell;
      }
    }

    throw e;
  }
}

async function put(cache, request, response) {
  if (!response || !response.ok || response.type === "opaque") {
    return;
  }

  try {
    await cache.put(request, response.clone());
  } catch (e) {
    console.log("[LL][SW] cache put refused", request.url, e);
  }
}
