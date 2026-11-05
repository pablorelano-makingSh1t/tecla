// Violín frotado.
// Fuente: movimiento de Helmholtz como suma de armónicos de banda limitada (diente de sierra 1/k
// con las muescas del punto de arco), evaluada por Clenshaw: un seno y un coseno por muestra,
// sin aliasing porque nunca pasa de 0.45·sr. La expresión es la presión/velocidad del arco:
// sube el volumen y abre los armónicos altos. Ruido de arco ligado al periodo, más fuerte al
// atacar. Cuerpo: banco de 5 resonancias en paralelo (aire A0, modos del cuerpo y «colina del
// puente»), fijas, así que el vibrato hace que cada armónico entre y salga de ellas.
// Vibrato con retardo y fundido, con deriva lenta de velocidad, profundidad y afinación.
import { VozBase, BLOQUE, frecuenciaNota, limitar, azar, A_UNIDAD, pasoBanda, SENO, TAM_SENO, CUARTO, MASCARA, caida, panIzq, panDer } from './comun.js';

const MAXK = 64;
const F_MAX = 11000;              // por encima, el cuerpo apenas radia: no merece la pena calcularlo
const SUB = 32;                 // los coeficientes se recalculan cada 32 muestras y se interpolan
const GANANCIA = 0.27;          // calibrada: pico ≈ 0.2 con expr 0.6
const BETA = 0.115;             // punto de arco
const TAU_EXPR = 0.0063;        // dos polos en cascada: ≈30 ms hasta el 95 %, sin salto de pendiente
const VIB_RETARDO = 0.25, VIB_FUNDIDO = 0.45, VIB_CENTS = 20, VIB_HZ = 5.6;
// Resonancias del cuerpo: frecuencia, Q, ganancia izquierda, ganancia derecha.
const CUERPO = [275, 7, 0.9, 0.7, 460, 9, 1.0, 1.15, 560, 9, 0.85, 0.75, 2500, 1.3, 1.35, 1.2, 4200, 2.5, 0.5, 0.65];
const NF = 5;
// Constantes de tiempo de las exponenciales que avanzan por sub-bloque:
// ataque del nivel, agarre del arco, ruido inicial, arranque del ruido y liberación.
const TAUS = [0.035, 0.07, 0.045, 0.004, 0.09];
const E_ATQ = 0, E_ARCO = 1, E_RUIDO = 2, E_ARRANQUE = 3, E_REL = 4;
const DIRECTO = 0.25;
const P_REF = 0.5;               // respuesta de potencia de referencia del cuerpo (calibrada)

export class VozViolin extends VozBase {
  constructor(sr) {
    super(sr);
    this.a = new Float64Array(MAXK + 4);   // + relleno hasta el grupo de 4    // coeficientes actuales
    this.da = new Float64Array(MAXK + 4);   // incremento por muestra
    this.w = new Float64Array(MAXK + 1);    // forma fija de la nota (1/k y muescas)
    this.K = 0;
    this.th = 0; this.inc = 0; this.dInc = 0; this.inc0 = 0;
    this.eObj = 0.6; this.eM = 0.6; this.eS = 0.6;
    this.kSub = new Float64Array(SUB + 1);
    for (let L = 0; L <= SUB; L++) this.kSub[L] = Math.exp(-L / (TAU_EXPR * sr));
    this.g = 0; this.dg = 0; this.gN = 0; this.dgN = 0;
    this.ts = 0;
    this.ex = new Float64Array(TAUS.length);   // e^(−t/τ) de cada constante (el de liberación hace de «rel»)
    this.fx = new Float64Array(TAUS.length);   // su factor por sub-bloque completo
    for (let j = 0; j < TAUS.length; j++) this.fx[j] = caida(TAUS[j], SUB, sr);
    this.vFase = 0; this.dR = 0; this.dP = 0; this.dW = 0; this.oR = 0; this.oP = 0; this.oW = 0; this.cuenta = 0;
    this.semilla = 1;
    // Banco del cuerpo (paso banda en paralelo, entrada compartida).
    this.bc = new Float64Array(NF * 3);
    this.gl = new Float64Array(NF);
    this.gr = new Float64Array(NF);
    for (let j = 0; j < NF; j++) {
      pasoBanda(this.bc, j * 3, Math.min(CUERPO[j * 4], 0.45 * sr), CUERPO[j * 4 + 1], sr);
      this.gl[j] = CUERPO[j * 4 + 2];
      this.gr[j] = CUERPO[j * 4 + 3];
    }
    this.by = new Float64Array(NF * 2);
    this.x1 = 0; this.x2 = 0;
    this.bufX = new Float64Array(BLOQUE);
    this.pl = 0; this.pr = 0;
    this.igual = 1;
  }

  iniciar(nota, vel, expr) {
    this._empezar(nota);
    const sr = this.sr, f0 = frecuenciaNota(nota);
    this.inc0 = f0 / sr; this.inc = this.inc0; this.dInc = 0; this.th = 0;
    let K = Math.floor(Math.min(0.45 * sr, F_MAX) / (f0 * Math.pow(2, 40 / 1200)));
    if (K > MAXK) K = MAXK;
    this.K = K;
    this.a.fill(0); this.da.fill(0);
    for (let k = 1; k <= K; k++) {
      const muesca = k * BETA < 0.5 ? 1 : 0.3 + 0.7 * Math.abs(Math.sin(Math.PI * k * BETA));
      this.w[k] = muesca / k;
    }
    // Igualación parcial por nota: el cuerpo realza mucho las notas que caen en sus resonancias
    // (La4 sobre 460 Hz). Se mide su respuesta sobre los armónicos y se compensa el 70 % en dB.
    const bc = this.bc;
    let pot = 0, ref = 0, pk = 1;
    for (let k = 1; k <= K; k++) {
      const w = (2 * Math.PI * k * f0) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      let hr = DIRECTO, hi = 0;
      for (let f = 0; f < NF; f++) {
        const b0 = bc[f * 3], a1 = bc[f * 3 + 1], a2 = bc[f * 3 + 2];
        const nr = b0 * (1 - c2), ni = b0 * s2;                    // b0·(1 − e^{−2jw})
        const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
        const d2 = dr * dr + di * di, gm = 0.5 * (this.gl[f] + this.gr[f]);
        hr += (gm * (nr * dr + ni * di)) / d2;
        hi += (gm * (ni * dr - nr * di)) / d2;
      }
      const amp = this.w[k] * pk;
      pot += amp * amp * (hr * hr + hi * hi);
      ref += amp * amp;
      pk *= 0.86;
    }
    this.igual = pot > 0 ? Math.pow((P_REF * ref) / pot, 0.35) : 1;
    const e = limitar(expr, 0, 1);
    this.eObj = e; this.eM = e; this.eS = e;
    this.g = 0; this.dg = 0; this.gN = 0; this.dgN = 0;
    this.ex.fill(1); this.ts = 0;
    this.semilla = azar(nota * 104729 + 7);
    this.vFase = 0; this.dR = 0; this.dP = 0; this.dW = 0; this.oR = 0; this.oP = 0; this.oW = 0; this.cuenta = 0;
    this.by.fill(0); this.x1 = 0; this.x2 = 0;
    const p = limitar((nota - 77) / 23, -1, 1) * 0.2;
    this.pl = panIzq(p); this.pr = panDer(p);
  }

  expresion(v) { this.eObj = v < 0 ? 0 : v > 1 ? 1 : v; }

  soltar() {
    if (!this.activa || this.soltada) return;
    this.soltada = true;
  }

  // Calcula los objetivos al final de un sub-bloque de L muestras.
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
    const atk = 1 - ex[E_ATQ];
    // Arco: brillo según la expresión; al atacar el arco aún no ha «agarrado» del todo.
    const arco = eS * (0.55 + 0.45 * (1 - ex[E_ARCO])) * (0.4 + 0.6 * rel);
    const rho = 0.55 + 0.4 * arco;      // más arco, más armónicos
    const K = this.K, w = this.w, a = this.a, da = this.da;
    let p = 1, suma = 0;
    for (let k = 1; k <= K; k++) { const v = w[k] * p; da[k] = v; suma += v * v; p *= rho; }
    const norma = suma > 0 ? 1 / Math.sqrt(suma * 0.5) : 0;
    const iL = 1 / L;
    for (let k = 1; k <= K; k++) da[k] = (da[k] * norma - a[k]) * iL;   // incremento por muestra
    // Nivel.
    const nivel = 0.3 + 0.7 * eS * Math.sqrt(eS);
    const g = GANANCIA * this.igual * nivel * atk * rel;
    this.dg = (g - this.g) * iL;
    // Ruido de arco relativo al tono: ≈ −30 dB en el sostén y un rascado fuerte al atacar,
    // antes de que la cuerda «agarre» (el tono todavía está subiendo).
    const gN = GANANCIA * this.igual * nivel * (0.05 + 0.04 * eS + 0.6 * ex[E_RUIDO]) * (1 - ex[E_ARRANQUE]) * rel;
    this.dgN = (gN - this.gN) * iL;
    // Deriva lenta: cada 0.3–0.6 s, nuevos objetivos aleatorios hacia los que se desliza.
    if (--this.cuenta <= 0) {
      let s = (Math.imul(this.semilla, 1664525) + 1013904223) | 0; this.oR = s * A_UNIDAD;
      s = (Math.imul(s, 1664525) + 1013904223) | 0; this.oP = s * A_UNIDAD;
      s = (Math.imul(s, 1664525) + 1013904223) | 0; this.oW = s * A_UNIDAD;
      s = (Math.imul(s, 1664525) + 1013904223) | 0; this.cuenta = Math.round(((0.45 + 0.15 * s * A_UNIDAD) * sr) / SUB);
      this.semilla = s;
    }
    const kd = 0.006 * L / SUB;
    this.dR += (this.oR - this.dR) * kd;
    this.dP += (this.oP - this.dP) * kd;
    this.dW += (this.oW - this.dW) * kd;
    // Vibrato con retardo y fundido (suave).
    let cents = 0;
    if (t > VIB_RETARDO) {
      let x = (t - VIB_RETARDO) / VIB_FUNDIDO;
      if (x > 1) x = 1;
      const fundido = x * x * (3 - 2 * x);
      this.vFase += (L * (VIB_HZ + 0.4 * this.dR)) / sr;
      if (this.vFase >= 1) this.vFase -= 1;
      cents = fundido * (VIB_CENTS * (1 + 0.2 * this.dP) * (SENO[(this.vFase * TAM_SENO) | 0]) + 1.5 * this.dW);
    }
    const incFin = this.inc0 * Math.pow(2, cents / 1200);
    this.dInc = (incFin - this.inc) * iL;
  }

  _generar(bufL, bufR, n) {
    // 1) Fuente (armónicos + ruido de arco) en bufX.
    const a = this.a, da = this.da, K = this.K, X = this.bufX, T = SENO, TS = TAM_SENO;
    let th = this.th, inc = this.inc, g = this.g, gN = this.gN, s = this.semilla;
    let i = 0;
    while (i < n) {
      const L = n - i < SUB ? n - i : SUB;
      this.th = th; this.inc = inc; this.g = g; this.gN = gN;
      this._objetivos(L);
      const dInc = this.dInc, dg = this.dg, dgN = this.dgN;
      s = this.semilla;
      const M = (K + 3) >> 2, K4 = M << 2;
      for (let j = 0; j < L;) {
        // Coeficientes constantes en trozos de 8 muestras; se avanzan al final de cada trozo.
        const c8 = L - j < 8 ? L - j : 8;
        for (let q = 0; q < c8; q++, j++, i++) {
          const xt = th * TS, it = xt | 0, ft = xt - it, jt = (it + CUARTO) & MASCARA;
          const sn = T[it] + (T[it + 1] - T[it]) * ft;
          const cs = T[jt] + (T[jt + 1] - T[jt]) * ft;
          s = (Math.imul(s, 1664525) + 1013904223) | 0;
          const ruido = s * A_UNIDAD * gN * (0.6 + 0.4 * cs);   // ruido de arco ligado al periodo
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
          X[i] = suma * g + ruido;
          th += inc; if (th >= 1) th -= 1;
          inc += dInc; g += dg; gN += dgN;
        }
        for (let k = 1; k <= K4; k++) a[k] += da[k] * c8;
      }
      this.semilla = s;
    }
    this.th = th; this.inc = inc; this.g = g; this.gN = gN;
    // 2) Cuerpo: camino directo + cada resonancia recorre el bloque con su estado en locales.
    const pl = this.pl, pr = this.pr, dl = DIRECTO * pl, dr = DIRECTO * pr;
    for (let j = 0; j < n; j++) { bufL[j] = X[j] * dl; bufR[j] = X[j] * dr; }
    const bc = this.bc, by = this.by;
    for (let f = 0; f < NF; f++) {
      const b0 = bc[f * 3], a1 = bc[f * 3 + 1], a2 = bc[f * 3 + 2];
      const gl = this.gl[f] * pl, gr = this.gr[f] * pr;
      let y1 = by[f * 2], y2 = by[f * 2 + 1], x1 = this.x1, x2 = this.x2;
      for (let j = 0; j < n; j++) {
        const x = X[j];
        const y = b0 * (x - x2) - a1 * y1 - a2 * y2;
        y2 = y1; y1 = y; x2 = x1; x1 = x;
        bufL[j] += gl * y;
        bufR[j] += gr * y;
      }
      by[f * 2] = y1; by[f * 2 + 1] = y2;
    }
    this.x2 = n > 1 ? X[n - 2] : this.x1;   // n ≥ 1 siempre
    this.x1 = X[n - 1];
  }
}
