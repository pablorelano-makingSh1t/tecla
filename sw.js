// Service worker de Tecla: la app entera funciona sin conexión.
// Al instalarse precachea la interfaz, las fuentes, los iconos, todos los módulos JS que cuelgan de
// js/main.js y de worklet/procesador.js (siguiendo sus import) y todo lo que lista
// assets/instrumentos/manifest.json. Las cachés de versiones anteriores se borran al activarse.
// Cambia VERSION en cada publicación para que los móviles descarguen la versión nueva.

const VERSION = 'tecla-v1';
const PREFIJO = 'tecla-';

const SHELL = [
  './',
  'index.html',
  'css/tecla.css',
  'manifest.webmanifest',
  'iconos/tecla-192.png',
  'iconos/tecla-512.png',
  'iconos/tecla-maskable-512.png',
  'fuentes/tektur-latin.woff2',
  'fuentes/chakra-petch-400-latin.woff2',
  'fuentes/chakra-petch-500-latin.woff2',
  'fuentes/chakra-petch-600-latin.woff2',
];
// Puntos de entrada de los módulos: desde aquí se siguen los import estáticos y dinámicos.
const ENTRADAS = ['js/main.js', 'worklet/procesador.js'];

const base = new URL('./', self.location).href;
const abs = (ruta) => new URL(ruta, base).href;

// import … from './x.js', import './x.js', import('./x.js') y export … from './x.js' con rutas relativas.
const RE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

async function guardar(cache, url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await cache.put(url, r.clone());
  return r;
}

async function modulos(cache) {
  const vistos = new Set();
  const pendientes = ENTRADAS.map(abs);
  while (pendientes.length) {
    const url = pendientes.pop();
    if (vistos.has(url)) continue;
    vistos.add(url);
    const texto = await (await guardar(cache, url)).text();
    // Quita los comentarios para no seguir import que solo aparecen en ellos.
    const codigo = texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const m of codigo.matchAll(RE_IMPORT)) pendientes.push(new URL(m[1], url).href);
  }
}

async function muestras(cache) {
  let manifiesto;
  try {
    manifiesto = await (await guardar(cache, abs('assets/instrumentos/manifest.json'))).json();
  } catch {
    return; // sin manifiesto de muestras no hay nada más que guardar
  }
  const archivos = new Set();
  for (const p of Object.values(manifiesto.presets ?? {})) {
    for (const z of p.zonas ?? []) if (z.archivo) archivos.add(abs(`assets/instrumentos/${z.archivo}`));
  }
  // De pocos en pocos para no saturar la red del móvil.
  const lista = [...archivos];
  for (let i = 0; i < lista.length; i += 6) await Promise.all(lista.slice(i, i + 6).map((u) => guardar(cache, u)));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const ruta of SHELL) await guardar(cache, abs(ruta));
    await modulos(cache);
    await muestras(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre.startsWith(PREFIJO) && nombre !== VERSION) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

// Primero la caché; si no está, la red (y se guarda para la próxima vez).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(base)) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const guardada = await cache.match(req, { ignoreSearch: true });
    if (guardada) return guardada;
    try {
      const r = await fetch(req);
      if (r.ok && r.type === 'basic' && !req.headers.has('range')) cache.put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match(abs('index.html'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
