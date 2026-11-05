// Teclado táctil de 2 octavas (25 teclas, de C(o) a C(o+2)).
// La parte de arriba son funciones puras (se prueban en Node); la clase Teclado maneja el DOM.
// Cada contacto (dedo, ratón o tecla del ordenador) recibe un id propio de un contador que nunca
// se repite, así dos dedos sobre la misma tecla se sueltan por separado.

import { EXPRESION_INICIAL, OCTAVA_MIN, OCTAVA_MAX } from '../presets.js';

export const NUM_TECLAS = 25;
export const NUM_BLANCAS = 15;
const NEGRAS = new Set([1, 3, 6, 8, 10]);
const NOMBRES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

// Ancho de una tecla negra, en anchos de tecla blanca.
export const ANCHO_NEGRA = 0.58;
// Centro de cada negra dentro de la octava, en anchos de blanca. Como en un piano real:
// Do–Mi se reparte en 5 partes iguales y Fa–Si en 7, y cada negra ocupa la suya.
const CENTRO_NEGRA = { 1: 0.9, 3: 2.1, 6: 3 + 1.5 * (4 / 7), 8: 3 + 3.5 * (4 / 7), 10: 3 + 5.5 * (4 / 7) };
const BLANCAS_ANTES = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6]; // blancas a la izquierda de cada semitono

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const esNegra = (nota) => NEGRAS.has(((nota % 12) + 12) % 12);
export const notaBase = (octava) => 12 * (octava + 1);
export const nombreNota = (nota) => `${NOMBRES[((nota % 12) + 12) % 12]}${Math.floor(nota / 12) - 1}`;

/** Las 25 notas MIDI que muestra el teclado en la octava o: de C(o) a C(o+2). */
export function notasDeOctava(octava) {
  const base = notaBase(octava);
  return Array.from({ length: NUM_TECLAS }, (_, i) => base + i);
}

export const enRango = (nota, rango) => nota >= rango[0] && nota <= rango[1];

/** Octavas permitidas para un rango: dentro de OCTAVA_MIN..OCTAVA_MAX y con al menos una tecla que suene. */
export function limitesOctava(rango, min = OCTAVA_MIN, max = OCTAVA_MAX) {
  let lo = min;
  while (lo < max && notaBase(lo) + NUM_TECLAS - 1 < rango[0]) lo++;
  let hi = max;
  while (hi > lo && notaBase(hi) > rango[1]) hi--;
  return { min: lo, max: hi };
}

/**
 * Expresión de un dedo: se mide desde donde empezó a tocar.
 * expr = clamp(0.6 + (y0 − y) / (alto × 0.5), 0, 1). Subir el dedo (y menor) la aumenta.
 */
export function calcularExpresion(y0, y, alto, inicial = EXPRESION_INICIAL) {
  if (!(alto > 0) || !Number.isFinite(y0) || !Number.isFinite(y)) return inicial;
  return clamp(inicial + (y0 - y) / (alto * 0.5), 0, 1);
}

/**
 * Geometría de las 25 teclas en anchos de tecla blanca (el teclado mide NUM_BLANCAS de ancho).
 * Devuelve [{ indice, negra, x, ancho }], x = borde izquierdo.
 */
export function geometria() {
  return Array.from({ length: NUM_TECLAS }, (_, i) => {
    const pc = i % 12;
    const octavas = Math.floor(i / 12);
    if (NEGRAS.has(pc)) {
      return { indice: i, negra: true, x: octavas * 7 + CENTRO_NEGRA[pc] - ANCHO_NEGRA / 2, ancho: ANCHO_NEGRA };
    }
    return { indice: i, negra: false, x: octavas * 7 + BLANCAS_ANTES[pc], ancho: 1 };
  });
}

let siguienteId = 1;
/** Id de contacto para el motor: entero que nunca se repite en la sesión. */
export const nuevoId = () => siguienteId++;

// ───────────────────────────── DOM ─────────────────────────────

export class Teclado {
  /**
   * @param {HTMLElement} raiz contenedor del teclado
   * @param {{ alPulsar(id, nota, expr): boolean, alSoltar(id): void, alExpresion(id, v): void }} llamadas
   */
  constructor(raiz, llamadas) {
    this.raiz = raiz;
    this.llamadas = llamadas;
    this.octava = 3;
    this.rango = [0, 127];
    this.sostenido = false;
    this.habilitado = false;
    this.contactos = new Map(); // id → { id, indice, nota, y0, alto, expr }
    this.porPuntero = new Map(); // pointerId → id
    this.teclas = [];
    this.#construir();
    this.#escuchar();
  }

  #construir() {
    const geo = geometria();
    const pista = document.createElement('div');
    pista.className = 'pista';
    for (const g of geo) {
      const el = document.createElement('div');
      el.className = g.negra ? 'tecla negra' : 'tecla blanca';
      el.dataset.indice = g.indice;
      el.style.left = `${(g.x / NUM_BLANCAS) * 100}%`;
      el.style.width = `${(g.ancho / NUM_BLANCAS) * 100}%`;
      el.innerHTML = '<span class="expr" aria-hidden="true"><i></i></span><span class="pc" aria-hidden="true"></span><span class="nombre"></span>';
      pista.append(el);
      this.teclas.push(el);
    }
    this.raiz.append(pista);
  }

  #escuchar() {
    const r = this.raiz;
    r.addEventListener('pointerdown', (e) => this.#abajo(e));
    r.addEventListener('pointermove', (e) => this.#mover(e));
    for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      r.addEventListener(tipo, (e) => this.#arriba(e));
    }
    for (const tipo of ['contextmenu', 'selectstart', 'dragstart', 'touchstart', 'dblclick']) {
      r.addEventListener(tipo, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    }
  }

  #abajo(e) {
    if (e.button > 0) return; // solo botón principal o contacto
    if (e.cancelable) e.preventDefault();
    const el = e.target.closest?.('.tecla');
    if (!el || !this.habilitado || el.classList.contains('muda')) return;
    // Un pointerId que ya estaba tocando (no debería pasar): suéltalo antes.
    const previo = this.porPuntero.get(e.pointerId);
    if (previo !== undefined) this.soltarId(previo);
    try { el.setPointerCapture(e.pointerId); } catch { /* el puntero ya no existe */ }
    const r = el.getBoundingClientRect();
    const id = this.pulsarIndice(+el.dataset.indice, { y0: e.clientY, alto: r.height });
    if (id !== null) this.porPuntero.set(e.pointerId, id);
  }

  #mover(e) {
    const id = this.porPuntero.get(e.pointerId);
    if (id === undefined || !this.sostenido) return;
    const c = this.contactos.get(id);
    if (!c || !(c.alto > 0)) return;
    const v = calcularExpresion(c.y0, e.clientY, c.alto);
    if (Math.abs(v - c.expr) < 0.004) return;
    c.expr = v;
    this.llamadas.alExpresion(id, v);
    this.#pintar(c.indice);
  }

  #arriba(e) {
    const id = this.porPuntero.get(e.pointerId);
    if (id === undefined) return;
    this.porPuntero.delete(e.pointerId);
    this.soltarId(id);
  }

  /** Pulsa la tecla de posición indice (0..24) con la nota de la octava actual. Devuelve el id o null. */
  pulsarIndice(indice, { y0 = NaN, alto = 0 } = {}) {
    if (!this.habilitado || indice < 0 || indice >= NUM_TECLAS) return null;
    const nota = notaBase(this.octava) + indice;
    if (!enRango(nota, this.rango)) return null;
    const id = nuevoId();
    const expr = EXPRESION_INICIAL;
    if (!this.llamadas.alPulsar(id, nota, expr)) return null;
    this.contactos.set(id, { id, indice, nota, y0, alto, expr });
    this.#pintar(indice);
    return id;
  }

  /** Suelta un contacto por su id (si ya no existe, no hace nada). */
  soltarId(id) {
    const c = this.contactos.get(id);
    if (!c) return false;
    this.contactos.delete(id);
    this.llamadas.alSoltar(id);
    this.#pintar(c.indice);
    return true;
  }

  /**
   * Olvida todos los contactos. Con avisar = false no llama a alSoltar (el que llama ya hizo allNotesOff).
   * Los dedos que sigan apoyados no vuelven a sonar hasta una pulsación nueva.
   */
  soltarTodo({ avisar = false } = {}) {
    const indices = new Set();
    for (const c of this.contactos.values()) {
      indices.add(c.indice);
      if (avisar) this.llamadas.alSoltar(c.id);
    }
    this.contactos.clear();
    this.porPuntero.clear();
    for (const i of indices) this.#pintar(i);
  }

  habilitar(si) {
    this.habilitado = !!si;
    this.raiz.classList.toggle('deshabilitado', !si);
    this.raiz.setAttribute('aria-disabled', String(!si));
    if (!si) this.soltarTodo();
  }

  /** Cambia de octava. Las notas que ya suenan no cambian (cada contacto guarda su nota). */
  setOctava(o) {
    this.octava = o;
    this.#etiquetar();
  }

  setPreset({ rango, sostenido }) {
    this.rango = rango;
    this.sostenido = !!sostenido;
    this.raiz.classList.toggle('sostenido', this.sostenido);
    this.#etiquetar();
  }

  /** Etiquetas de las teclas del ordenador (solo se ven en escritorio). */
  setEtiquetasPC(etiquetas) {
    this.teclas.forEach((el, i) => { el.querySelector('.pc').textContent = etiquetas[i] ?? ''; });
  }

  #etiquetar() {
    const notas = notasDeOctava(this.octava);
    this.teclas.forEach((el, i) => {
      const nota = notas[i];
      const muda = !enRango(nota, this.rango);
      el.classList.toggle('muda', muda);
      el.dataset.nota = nota;
      el.setAttribute('aria-label', `${nombreNota(nota)}${muda ? ', fuera del rango' : ''}`);
      el.querySelector('.nombre').textContent = nota % 12 === 0 ? nombreNota(nota).toUpperCase() : '';
    });
  }

  #pintar(indice) {
    const el = this.teclas[indice];
    if (!el) return;
    let n = 0;
    let expr = 0;
    for (const c of this.contactos.values()) {
      if (c.indice === indice) { n++; expr = Math.max(expr, c.expr); }
    }
    el.classList.toggle('activa', n > 0);
    el.style.setProperty('--expr', n > 0 ? expr.toFixed(3) : '0');
  }
}
