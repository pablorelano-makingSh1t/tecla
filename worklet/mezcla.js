// Mezcla final: volumen maestro suavizado y limitador suave tipo tanh.
import { Suave } from './envolvente.js';

export const UMBRAL_LIMITADOR = 0.6;  // por debajo, la señal pasa intacta
const RODILLA = 1 - UMBRAL_LIMITADOR;

// Lineal hasta el umbral y tanh por encima (pendiente continua): |y| ≤ 1 siempre.
// NaN se convierte en silencio para que nunca llegue a la salida.
export function limitar(x) {
  if (x !== x) return 0;
  const a = x < 0 ? -x : x;
  if (a <= UMBRAL_LIMITADOR) return x;
  const y = UMBRAL_LIMITADOR + RODILLA * Math.tanh((a - UMBRAL_LIMITADOR) / RODILLA);
  return x < 0 ? -y : y;
}

export class Mezcla {
  constructor(sr, volumen = 1) {
    this.vol = new Suave(sr, 0.015, volumen);
    this.pico = 0;   // pico absoluto de salida desde el último diag
  }

  volumen(v) { this.vol.fijar(v < 0 ? 0 : v > 1 ? 1 : v); }

  // Aplica volumen y limitador sobre izq/der en su sitio.
  aplicar(izq, der, n) {
    let pico = this.pico;
    for (let i = 0; i < n; i++) {
      const g = this.vol.siguiente();
      const l = limitar(izq[i] * g);
      const r = limitar(der[i] * g);
      izq[i] = l;
      der[i] = r;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > pico) pico = al;
      if (ar > pico) pico = ar;
    }
    this.pico = pico;
  }

  leerPico() { const p = this.pico; this.pico = 0; return p; }
}
