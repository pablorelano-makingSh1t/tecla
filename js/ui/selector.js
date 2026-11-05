// Selector de instrumento (Piano · Violín · Trompeta), de piano (Moderno · Clásico)
// y de fuente del sonido (Grabado · Sintetizado por Claude).

import { PRESETS, INSTRUMENTOS, modoEfectivo } from '../presets.js';

/** Preset que corresponde a pulsar un instrumento: el piano recuerda el último tipo elegido. */
export function presetDeInstrumento(instrumento, ultimoPiano = 'piano-moderno') {
  if (instrumento === 'piano') return INSTRUMENTOS.piano.presets.includes(ultimoPiano) ? ultimoPiano : 'piano-moderno';
  return INSTRUMENTOS[instrumento]?.presets[0] ?? null;
}

export class Selector {
  /**
   * @param {{ instrumento: HTMLElement, piano: HTMLElement, fuente: HTMLElement }} grupos
   * @param {{ alPreset(preset): void, alModo(modo): void }} llamadas
   */
  constructor(grupos, llamadas) {
    this.g = grupos;
    this.llamadas = llamadas;
    this.ultimoPiano = 'piano-moderno';
    this.estado = { preset: 'piano-moderno', modo: 'muestras', ocupado: false };
    grupos.instrumento.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-valor]');
      if (!b || b.disabled) return;
      const p = presetDeInstrumento(b.dataset.valor, this.ultimoPiano);
      if (p && p !== this.estado.preset) this.llamadas.alPreset(p);
    });
    grupos.piano.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-valor]');
      if (!b || b.disabled || b.dataset.valor === this.estado.preset) return;
      this.llamadas.alPreset(b.dataset.valor);
    });
    grupos.fuente.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-valor]');
      if (!b || b.disabled || b.dataset.valor === this.estado.modo) return;
      this.llamadas.alModo(b.dataset.valor);
    });
  }

  /** modo = preferencia guardada; lo que suena es modoEfectivo(preset, modo). */
  pintar({ preset, modo, ocupado = false }) {
    this.estado = { preset, modo, ocupado };
    const p = PRESETS[preset];
    if (p.instrumento === 'piano') this.ultimoPiano = preset;
    const marcar = (grupo, valor) => {
      for (const b of grupo.querySelectorAll('button[data-valor]')) {
        const si = b.dataset.valor === valor;
        b.setAttribute('aria-checked', String(si));
        b.classList.toggle('activo', si);
      }
    };
    marcar(this.g.instrumento, p.instrumento);
    this.g.piano.hidden = p.instrumento !== 'piano';
    marcar(this.g.piano, preset);
    const efectivo = modoEfectivo(preset, modo);
    marcar(this.g.fuente, efectivo);
    const solo = !!p.soloSintesis;
    this.g.fuente.classList.toggle('solo-sintesis', solo);
    this.g.fuente.setAttribute('aria-disabled', String(solo));
    for (const b of this.g.fuente.querySelectorAll('button')) b.disabled = solo;
    this.g.fuente.title = solo ? 'El piano moderno solo existe sintetizado' : '';
  }
}
