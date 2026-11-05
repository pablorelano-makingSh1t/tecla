// Piezas comunes de las voces de síntesis (hilo de audio).
// Sin globales del worklet: todo recibe sr. Nada de lo que se llama desde render crea objetos.

export const BLOQUE = 128;          // trozo interno de render (los búferes se preasignan a este tamaño)
export const TAM_SENO = 4096;       // tabla de seno: error de interpolación lineal ≈ 3e-7 (−130 dB)
export const MASCARA = TAM_SENO - 1;
export const CUARTO = TAM_SENO >> 2;

// Tabla de seno compartida, creada una sola vez al cargar el módulo (nunca en render).
// En los bucles por muestra se consulta en línea (sin llamar a funciones): una función que
// devuelve un double y que el JIT no incrusta lo «empaqueta» en el montón en cada llamada.
export const SENO = new Float64Array(TAM_SENO + 1);
for (let i = 0; i <= TAM_SENO; i++) SENO[i] = Math.sin((2 * Math.PI * i) / TAM_SENO);

// Seno de una fase en ciclos (cualquier valor ≥ 0).
export function seno(fase) {
  const x = (fase - Math.floor(fase)) * TAM_SENO;
  const i = x | 0;
  const a = SENO[i];
  return a + (SENO[i + 1] - a) * (x - i);
}

// Factor de caída e^(−L/(τ·sr)) para L muestras.
export const caida = (tau, L, sr) => Math.exp(-L / (tau * sr));

export const frecuenciaNota = (nota) => 440 * Math.pow(2, (nota - 69) / 12);
export const limitar = (x, a, b) => (x < a ? a : x > b ? b : x);

// Generador congruencial de 32 bits: estado entero → siguiente estado.
// (En los bucles por muestra se escribe en línea: (Math.imul(s, 1664525) + 1013904223) | 0.)
export function azar(s) { return (Math.imul(s, 1664525) + 1013904223) | 0; }
export const A_UNIDAD = 4.656612873077393e-10;   // estado * A_UNIDAD ∈ [−1, 1)

// Coeficientes de paso banda RBJ (ganancia 1 en el pico) en c[k..k+2] = b0, a1, a2 (b1 = 0, b2 = −b0).
export function pasoBanda(c, k, f, q, sr) {
  const w = (2 * Math.PI * f) / sr;
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  c[k] = al / a0;
  c[k + 1] = (-2 * Math.cos(w)) / a0;
  c[k + 2] = (1 - al) / a0;
}

// Ganancias de panorama de potencia constante: p ∈ [−1, 1].
export const panIzq = (p) => Math.cos((p + 1) * Math.PI * 0.25);
export const panDer = (p) => Math.sin((p + 1) * Math.PI * 0.25);

const UMBRAL_SILENCIO = 2e-5;   // −80 dB respecto al nivel nominal (≈0.2)
const T_CORTE = 0.015;          // liberación rápida de cortar()

// Base de todas las voces: corte rápido, antichoque al reutilizar una voz que sonaba,
// detección de final (activa = false) y suma en los búferes de salida.
// Las subclases implementan _generar(bufL, bufR, m), que ESCRIBE (=) m muestras.
export class VozBase {
  constructor(sr) {
    this.sr = sr;
    this.activa = false;
    this.nota = -1;
    this.soltada = false;
    this.t = 0;                         // muestras desde iniciar
    this.bufL = new Float64Array(BLOQUE);
    this.bufR = new Float64Array(BLOQUE);
    this.corte = 1;
    this.pasoCorte = 0;                 // > 0 mientras corta
    this.dcL = 0; this.dcR = 0;         // desvío que se funde al arrancar sobre una voz viva
    this.ultL = 0; this.ultR = 0;
    this.kDc = Math.exp(-1 / (0.0015 * sr));
    this.silencio = 0;
    this.minSilencio = Math.round(0.04 * sr);
    this.minVida = Math.round(0.1 * sr);
  }

  // Lo llama iniciar() de cada instrumento antes de preparar su estado.
  _empezar(nota) {
    if (this.activa) { this.dcL = this.ultL; this.dcR = this.ultR; }
    else { this.dcL = 0; this.dcR = 0; }
    this.activa = true;
    this.nota = nota;
    this.soltada = false;
    this.corte = 1;
    this.pasoCorte = 0;
    this.t = 0;
    this.silencio = 0;
  }

  cortar() {
    if (!this.activa || this.pasoCorte > 0) return;
    this.pasoCorte = 1 / (T_CORTE * this.sr);
  }

  _apagar() {
    this.activa = false;
    this.ultL = 0; this.ultR = 0;
    this.dcL = 0; this.dcR = 0;
  }

  // SUMA (+=) n muestras en izq/der a partir de «desde».
  render(izq, der, desde, n) {
    const bufL = this.bufL, bufR = this.bufR, kDc = this.kDc;
    let hecho = 0;
    while (hecho < n && this.activa) {
      const m = n - hecho < BLOQUE ? n - hecho : BLOQUE;
      this._generar(bufL, bufR, m);
      let corte = this.corte, dcL = this.dcL, dcR = this.dcR, l = 0, r = 0, pico = 0;
      const paso = this.pasoCorte, base = desde + hecho;
      for (let i = 0; i < m; i++) {
        if (paso > 0) { corte -= paso; if (corte < 0) corte = 0; }
        l = (bufL[i] + dcL) * corte;
        r = (bufR[i] + dcR) * corte;
        dcL *= kDc; dcR *= kDc;
        izq[base + i] += l;
        der[base + i] += r;
        const a = l < 0 ? -l : l, b = r < 0 ? -r : r;
        if (a > pico) pico = a;
        if (b > pico) pico = b;
      }
      if (dcL < 1e-12 && dcL > -1e-12) dcL = 0;   // evita desnormales
      if (dcR < 1e-12 && dcR > -1e-12) dcR = 0;
      this.corte = corte; this.dcL = dcL; this.dcR = dcR;
      this.ultL = l; this.ultR = r;
      this.t += m;
      hecho += m;
      if (paso > 0 && corte <= 0) { this._apagar(); break; }
      // Final natural: silencio sostenido tras el arranque.
      if (this.t > this.minVida && pico < UMBRAL_SILENCIO) {
        this.silencio += m;
        if (this.silencio >= this.minSilencio) this._apagar();
      } else this.silencio = 0;
    }
  }
}
