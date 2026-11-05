// Teclado del ordenador: fila A S D F G H J K L Ñ para las blancas, W E T Y U O P para las negras,
// Z y X para bajar y subir de octava. Se usa event.code (posición física), así funciona igual
// con distribución española o inglesa; la Ñ española es la tecla física «Semicolon».

// Posición (0..24) de cada tecla física dentro del teclado de 2 octavas.
export const MAPA_TECLAS = Object.freeze({
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8,
  KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
});

export const TECLAS_OCTAVA = Object.freeze({ KeyZ: -1, KeyX: +1 });

const ETIQUETA = { Semicolon: 'Ñ' };

/** Qué hace una pulsación: { tipo: 'nota', indice } | { tipo: 'octava', delta } | null. */
export function accionDeTecla({ code = '', key = '', ctrlKey = false, metaKey = false, altKey = false } = {}) {
  if (ctrlKey || metaKey || altKey) return null;
  if (code in MAPA_TECLAS) return { tipo: 'nota', indice: MAPA_TECLAS[code] };
  if (code in TECLAS_OCTAVA) return { tipo: 'octava', delta: TECLAS_OCTAVA[code] };
  // Respaldo por carácter, solo si el navegador no da code (algunos teclados virtuales).
  if (code && code !== 'Unidentified') return null;
  const k = String(key).toLowerCase();
  if (k === 'ñ') return { tipo: 'nota', indice: 16 };
  if (!/^[a-z]$/.test(k)) return null;
  const c = `Key${k.toUpperCase()}`;
  if (c in MAPA_TECLAS) return { tipo: 'nota', indice: MAPA_TECLAS[c] };
  if (c in TECLAS_OCTAVA) return { tipo: 'octava', delta: TECLAS_OCTAVA[c] };
  return null;
}

/** Letra que se dibuja en cada una de las 25 teclas ('' si no tiene). */
export function etiquetasPC() {
  const t = Array(25).fill('');
  for (const [code, i] of Object.entries(MAPA_TECLAS)) t[i] = ETIQUETA[code] ?? code.slice(3);
  return t;
}

/** Conecta el teclado del ordenador con el Teclado táctil (comparten contactos e ids). */
export class TecladoPC {
  constructor(teclado, { alOctava }) {
    this.teclado = teclado;
    this.alOctava = alOctava;
    this.pulsadas = new Map(); // code → id
    window.addEventListener('keydown', (e) => this.#abajo(e));
    window.addEventListener('keyup', (e) => this.#arriba(e));
  }

  #abajo(e) {
    const t = e.target;
    if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
    const a = accionDeTecla(e);
    if (!a) return;
    e.preventDefault();
    if (e.repeat) return;
    if (a.tipo === 'octava') { this.alOctava(a.delta); return; }
    const previo = this.pulsadas.get(e.code);
    if (previo !== undefined) this.teclado.soltarId(previo);
    const id = this.teclado.pulsarIndice(a.indice);
    if (id === null) this.pulsadas.delete(e.code);
    else this.pulsadas.set(e.code, id);
  }

  #arriba(e) {
    const id = this.pulsadas.get(e.code);
    if (id === undefined) return;
    this.pulsadas.delete(e.code);
    this.teclado.soltarId(id);
  }

  olvidar() { this.pulsadas.clear(); }
}
