// Trompeta.
// Fuente aditiva de banda limitada (Clenshaw en 4 cadenas, como el violín) con un espectro de metal:
// cada armónico cae un factor ρ respecto al anterior y ρ crece con la intensidad del soplo,
// así que al soplar fuerte aparecen muchos más armónicos (lo propio del metal). Encima, un
// formante de campana hacia 1.25 kHz, poca radiación de la fundamental grave y un corte alto
// que también sube con la intensidad. Ataque rápido (≈20 ms) con un pico de brillo, una subida
// de tono desde abajo y aspereza de labios («blat») con ruido de soplo. Vibrato sutil y tardío.
import { VozBase, frecuenciaNota, limitar, azar, A_UNIDAD, pasoBanda, SENO, TAM_SENO, CUARTO, MASCARA, caida, panIzq, panDer } from './comun.js';

const MAXK = 56;
const F_MAX = 12000;
const PODA = 1e-4;              // armónicos por debajo (−80 dB) no se calculan
const SUB = 32;
const GANANCIA = 0.13;          // calibrada: pico ≈ 0.2 con expr 0.6
const TAU_EXPR = 0.0063;        // dos polos en cascada: ≈30 ms hasta el 95 %, sin salto de pendiente
const VIB_RETARDO = 0.4, VIB_FUNDIDO = 0.6, VIB_CENTS = 7, VIB_HZ = 5.2;
const SUBIDA_CENTS = -70;
// Exponenciales que avanzan por sub-bloque: subida del soplo, pico de brillo, nivel,
// golpe de lengua (ruido, aspereza y subida de tono), arranque del ruido y liberación.
const TAUS = [0.008, 0.018, 0.009, 0.02, 0.002, 0.04];
const E_SOPLO = 0, E_PICO = 1, E_NIVEL = 2, E_GOLPE = 3, E_ARRANQUE = 4, E_REL = 5;

export class VozTrompeta extends VozBase {
  constructor(sr) {
    super(sr);
    this.a = new Float64Array(MAXK + 4);   // + relleno hasta el grupo de 4
    this.da = new Float64Array(MAXK + 4);
    this.F = new Float64Array(MAXK + 1);    // formante de campana y radiación, fijo por nota
    this.fk = new Float64Array(MAXK + 1);   // frecuencia de cada armónico
    this.K = 0;
    this.Kef = 0;                           // armónicos que se calculan en este sub-bloque
    this.th = 0; this.inc = 0; this.dInc = 0; this.inc0 = 0;
    this.eObj = 0.6; this.eM = 0.6; this.eS = 0.6;
    this.kSub = new Float64Array(SUB + 1);
    for (let L = 0; L <= SUB; L++) this.kSub[L] = Math.exp(-L / (TAU_EXPR * sr));
    this.g = 0; this.dg = 0; this.gN = 0; this.dgN = 0; this.ap = 0; this.dap = 0;
    this.ts = 0;
    this.ex = new Float64Array(TAUS.length);   // e^(−t/τ) de cada constante (el de liberación hace de «rel»)
    this.fx = new Float64Array(TAUS.length);
    for (let j = 0; j < TAUS.length; j++) this.fx[j] = caida(TAUS[j], SUB, sr);
    this.vFase = 0; this.dR = 0; this.oR = 0; this.cuenta = 0;
    this.semilla = 1;
    this.lab = 0; this.kLab = 1 - Math.exp((-2 * Math.PI * 120) / sr);   // ruido de labios lento
    this.nc = new Float64Array(3);
    pasoBanda(this.nc, 0, Math.min(1600, 0.4 * sr), 1.2, sr);
    this.nx1 = 0; this.nx2 = 0; this.ny1 = 0; this.ny2 = 0;
    this.pl = 0; this.pr = 0;
  }

  iniciar(nota, vel, expr) {
    this._empezar(nota);
    const sr = this.sr, f0 = frecuenciaNota(nota);
    this.inc0 = f0 / sr;
    this.inc = this.inc0 * Math.pow(2, SUBIDA_CENTS / 1200);
    this.dInc = 0; this.th = 0;
    let K = Math.floor(Math.min(0.45 * sr, F_MAX) / (f0 * Math.pow(2, 15 / 1200)));
    if (K > MAXK) K = MAXK;
    this.K = K; this.Kef = K;
    this.a.fill(0); this.da.fill(0);
    for (let k = 1; k <= K; k++) {
      const f = k * f0;
      const o = Math.log2(f / 1250);
      const campana = 1 + 1.6 * Math.exp(-(o * o) / (2 * 0.5 * 0.5));
      const radiacion = f / Math.sqrt(f * f + 300 * 300);
      this.fk[k] = f;
      this.F[k] = campana * radiacion;
    }
    const e = limitar(expr, 0, 1);
    this.eObj = e; this.eM = e; this.eS = e;
    this.g = 0; this.dg = 0; this.gN = 0; this.dgN = 0; this.ap = 1; this.dap = 0;
    this.ex.fill(1); this.ts = 0;
    this.semilla = azar(nota * 15485863 + 3);
    this.vFase = 0; this.dR = 0; this.oR = 0; this.cuenta = 0;
    this.lab = 0;
    this.nx1 = 0; this.nx2 = 0; this.ny1 = 0; this.ny2 = 0;
    const p = limitar((nota - 68) / 16, -1, 1) * 0.12;
    this.pl = panIzq(p); this.pr = panDer(p);
  }

  expresion(v) { this.eObj = v < 0 ? 0 : v > 1 ? 1 : v; }

  soltar() {
    if (!this.activa || this.soltada) return;
    this.soltada = true;
  }

  _objetivos(L) {
    const sr = this.sr;
    this.ts += L;
    const t = this.ts / sr;
    const kS = this.kSub[L];
    const eM = this.eObj + (this.eM - this.eObj) * kS;
    const eS = eM + (this.eS - eM) * kS;
    this.eM = eM; this.eS = eS;
    const ex = this.ex, fx = this.fx, entero = L === SUB;
    for (let j = 0; j < E_REL; j++) { ex[j] *= entero ? fx[j] : caida(TAUS[j], L, sr); if (ex[j] < 1e-20) ex[j] = 0; }
    if (this.soltada) ex[E_REL] *= entero ? fx[E_REL] : caida(TAUS[E_REL], L, sr);
    const rel = ex[E_REL];
    // Intensidad: el soplo con un pico breve de brillo hacia los 18 ms (el «blat»).
    const tp = t / 0.018;
    const ataque = 1 - ex[E_SOPLO] + 0.3 * Math.E * tp * ex[E_PICO];
    const I = (0.12 + 0.88 * eS) * ataque * (0.3 + 0.7 * rel);
    const Ii = I > 1.15 ? 1.15 : I;
    let rho = 0.2 + 0.74 * (Ii / Math.sqrt(Math.sqrt(Math.sqrt(Ii + 1e-12))));   // ≈ Ii^0.875
    if (rho > 0.95) rho = 0.95;
    const fc = 1800 + 7000 * Ii;
    const K = this.K, F = this.F, fk = this.fk, a = this.a, da = this.da;
    let p = 1, suma = 0;
    const ifc = 1 / fc;
    for (let k = 1; k <= K; k++) {
      const x = fk[k] * ifc, x2 = x * x;
      const v = (F[k] * p) / (1 + x2 * x2);
      da[k] = v; suma += v * v; p *= rho;
    }
    const norma = suma > 0 ? 1 / Math.sqrt(suma * 0.5) : 0;
    const iL = 1 / L;
    let kef = 1;
    for (let k = 1; k <= K; k++) {
      const v = da[k] * norma;
      if (v > PODA || a[k] > PODA) kef = k;
      da[k] = (v - a[k]) * iL;
    }
    this.Kef = kef;
    // Nivel, ruido de soplo y aspereza de labios.
    const nivel = 0.3 + 0.7 * eS * Math.sqrt(Math.sqrt(eS));   // ≈ eS^1.25
    const g = GANANCIA * nivel * (1 - ex[E_NIVEL]) * rel;
    this.dg = (g - this.g) * iL;
    const burst = ex[E_GOLPE];
    const gN = (0.012 * I + 0.07 * burst) * (1 - ex[E_ARRANQUE]) * rel;
    this.dgN = (gN - this.gN) * iL;
    const ap = 6 * burst + 0.4;          // profundidad de la aspereza (pequeña en el sostén)
    this.dap = (ap - this.ap) * iL;
    // Deriva del vibrato.
    if (--this.cuenta <= 0) {
      let s = (Math.imul(this.semilla, 1664525) + 1013904223) | 0; this.oR = s * A_UNIDAD;
      s = (Math.imul(s, 1664525) + 1013904223) | 0; this.cuenta = Math.round(((0.5 + 0.2 * s * A_UNIDAD) * sr) / SUB);
      this.semilla = s;
    }
    this.dR += (this.oR - this.dR) * (0.006 * L / SUB);
    // Tono: subida inicial desde abajo + vibrato tardío.
    let cents = SUBIDA_CENTS * burst;
    if (t > VIB_RETARDO) {
      let x = (t - VIB_RETARDO) / VIB_FUNDIDO;
      if (x > 1) x = 1;
      this.vFase += (L * (VIB_HZ + 0.3 * this.dR)) / sr;
      if (this.vFase >= 1) this.vFase -= 1;
      cents += x * x * (3 - 2 * x) * VIB_CENTS * (SENO[(this.vFase * TAM_SENO) | 0]);
    }
    const incFin = this.inc0 * Math.pow(2, cents / 1200);
    this.dInc = (incFin - this.inc) * iL;
  }

  _generar(bufL, bufR, n) {
    const T = SENO, TS = TAM_SENO, a = this.a, da = this.da, nc = this.nc, b0 = nc[0], na1 = nc[1], na2 = nc[2];
    let th = this.th, inc = this.inc, g = this.g, gN = this.gN, ap = this.ap, lab = this.lab, s = this.semilla;
    let x1 = this.nx1, x2 = this.nx2, z1 = this.ny1, z2 = this.ny2;
    const kLab = this.kLab, pl = this.pl, pr = this.pr;
    let i = 0;
    while (i < n) {
      const L = n - i < SUB ? n - i : SUB;
      this.th = th; this.inc = inc; this.g = g; this.gN = gN; this.ap = ap;
      this._objetivos(L);
      const dInc = this.dInc, dg = this.dg, dgN = this.dgN, dap = this.dap, K = this.Kef;
      s = this.semilla;
      const M = (K + 3) >> 2, K4 = M << 2;
      for (let j = 0; j < L;) {
        const c8 = L - j < 8 ? L - j : 8;
        for (let q = 0; q < c8; q++, j++, i++) {
          const xt = th * TS, it = xt | 0, ft = xt - it, jt = (it + CUARTO) & MASCARA;
          const sn = T[it] + (T[it + 1] - T[it]) * ft;
          const cs = T[jt] + (T[jt + 1] - T[jt]) * ft;
          s = (Math.imul(s, 1664525) + 1013904223) | 0;
          const r = s * A_UNIDAD;
          lab += kLab * (r - lab);                      // ruido lento: aspereza de los labios
          const am = 1 + ap * lab;
          const xn = r * gN * (0.5 + 0.5 * cs);          // soplo ligado al periodo
          const nz = b0 * (xn - x2) - na1 * z1 - na2 * z2;
          x2 = x1; x1 = xn; z2 = z1; z1 = nz;
          // Σ a_k·sin(kθ): Clenshaw en 4 cadenas independientes (k = 4m + r, recurrencia en 4θ),
          // más rápido que una sola cadena serie. b0·sin(rθ) + b1·sin((4 − r)θ) por cadena.
          const s2 = 2 * sn * cs, s3 = sn * (3 - 4 * sn * sn), s4 = 2 * s2 * (1 - 2 * sn * sn);
          const al = 2 * (1 - 2 * s2 * s2);
          let p1 = 0, p2 = 0, q1 = 0, q2 = 0, u1 = 0, u2 = 0, v1 = 0, v2 = 0;
          for (let k = K4 - 3; k >= 1; k -= 4) {
            const p0 = a[k] + al * p1 - p2; p2 = p1; p1 = p0;
            const q0 = a[k + 1] + al * q1 - q2; q2 = q1; q1 = q0;
            const u0 = a[k + 2] + al * u1 - u2; u2 = u1; u1 = u0;
            const v0 = a[k + 3] + al * v1 - v2; v2 = v1; v1 = v0;
          }
          const suma = p1 * sn + p2 * s3 + (q1 + q2) * s2 + u1 * s3 + u2 * sn + v1 * s4;
          const y = suma * g * am + nz;
          bufL[i] = y * pl;
          bufR[i] = y * pr;
          th += inc; if (th >= 1) th -= 1;
          inc += dInc; g += dg; gN += dgN; ap += dap;
        }
        for (let k = 1; k <= K4; k++) a[k] += da[k] * c8;
      }
      this.semilla = s;
    }
    this.th = th; this.inc = inc; this.g = g; this.gN = gN; this.ap = ap; this.lab = lab;
    this.nx1 = x1; this.nx2 = x2; this.ny1 = z1; this.ny2 = z2;
  }
}
