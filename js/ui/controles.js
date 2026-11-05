// Octava −/+, volumen, Silenciar y el botón de Diagnóstico.

import { nombreNota, notaBase, NUM_TECLAS } from './teclado.js';

/** Volumen guardado (0..1) a partir de lo que haya en almacenamiento; por defecto 0.8. */
export function leerVolumen(texto) {
  const v = Number.parseFloat(texto);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8;
}

/** Texto de la octava y del tramo de notas que se ve: { octava: 'OCT 3', tramo: 'DO3–DO5' }. */
export function textoOctava(o) {
  const a = nombreNota(notaBase(o)).toUpperCase();
  const b = nombreNota(notaBase(o) + NUM_TECLAS - 1).toUpperCase();
  return { octava: `OCT ${o}`, tramo: `${a}–${b}` };
}

export class Controles {
  /**
   * @param {object} el  { menos, mas, octava, tramo, volumen, volValor, silenciar, diag, diagTic }
   * @param {{ alOctava(delta), alVolumen(v), alSilenciar(si), alDiag() }} llamadas
   */
  constructor(el, llamadas) {
    this.el = el;
    el.menos.addEventListener('click', () => llamadas.alOctava(-1));
    el.mas.addEventListener('click', () => llamadas.alOctava(+1));
    el.volumen.addEventListener('input', () => {
      const v = +el.volumen.value / 100;
      this.#pintarVolumen(v);
      llamadas.alVolumen(v);
    });
    el.silenciar.addEventListener('click', () => llamadas.alSilenciar(el.silenciar.getAttribute('aria-pressed') !== 'true'));
    el.diag.addEventListener('click', () => llamadas.alDiag());
  }

  octava(o, { min, max }) {
    const t = textoOctava(o);
    this.el.octava.textContent = t.octava;
    this.el.tramo.textContent = t.tramo;
    this.el.menos.disabled = o <= min;
    this.el.mas.disabled = o >= max;
  }

  volumen(v) {
    this.el.volumen.value = String(Math.round(v * 100));
    this.#pintarVolumen(v);
  }

  #pintarVolumen(v) {
    this.el.volValor.textContent = String(Math.round(v * 100));
    this.el.volumen.style.setProperty('--v', `${(v * 100).toFixed(1)}%`);
  }

  silenciado(si) {
    this.el.silenciar.setAttribute('aria-pressed', String(si));
    this.el.silenciar.classList.toggle('activo', si);
    this.el.silenciar.querySelector('.etq').textContent = si ? 'Silenciado' : 'Silenciar';
  }

  /** Cuenta atrás de la sesión de prueba en el botón (null = sin sesión). */
  ticDiag(texto) {
    this.el.diagTic.hidden = !texto;
    this.el.diagTic.textContent = texto ?? '';
  }
}
