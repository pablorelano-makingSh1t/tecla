// Piano acústico por síntesis modal.
// Cada parcial k (inarmónico: f_k = k·f0·√(1+Bk²)/√(1+B)) son dos resonadores de dos polos
// ligeramente desafinados entre sí (las cuerdas del unísono): uno decae rápido y otro lento,
// lo que da el batido y el decaimiento en dos etapas. El martillo fija las amplitudes iniciales
// (filtro según nota y velocidad, muesca por el punto de golpeo) y añade un golpe de ruido
// filtrado. Al soltar, el apagador sube el amortiguamiento de todos los modos.
import { VozBase, BLOQUE, frecuenciaNota, limitar, azar, A_UNIDAD, pasoBanda, panIzq, panDer } from './comun.js';

const MAXP = 56;              // parciales como máximo
const MAXM = MAXP * 2;        // dos resonadores por parcial
const BETA = 1 / 8;           // punto de golpeo (fracción de la cuerda)
const GANANCIA = 0.155;       // calibrada: pico ≈ 0.2 con vel 0.8
const MODO_MUERTO = 1e-7;     // amplitud por debajo de la cual un modo deja de calcularse

// Coeficiente de inarmonicidad B según la nota (crece mucho en los agudos).
function inarmonicidad(nota) {
  if (nota >= 45) return 3.8e-4 * Math.pow(2, ((nota - 60) / 12) * 1.1);
  return 3.8e-4 * Math.pow(2, ((45 - 60) / 12) * 1.1) * Math.pow(2, ((45 - nota) / 12) * 0.7);
}

export class VozPianoClasico extends VozBase {
  constructor(sr) {
    super(sr);
    this.a1 = new Float64Array(MAXM);
    this.a2 = new Float64Array(MAXM);
    this.fr = new Float64Array(MAXM);   // frecuencia de cada modo (Hz)
    this.cw = new Float64Array(MAXM);   // cos(ω)
    this.sg = new Float64Array(MAXM);   // amortiguamiento natural (1/s)
    this.y1 = new Float64Array(MAXM);
    this.y2 = new Float64Array(MAXM);
    this.amp = new Float64Array(MAXM);  // amplitud estimada, para saltar modos ya muertos
    this.rB = new Float64Array(MAXM);   // caída de amplitud por BLOQUE
    this.nM = 0;
    this.bufA = new Float64Array(BLOQUE);  // cuerda rápida
    this.bufB = new Float64Array(BLOQUE);  // cuerda lenta
    this.nc = new Float64Array(3);         // paso banda del ruido de martillo
    this.nx1 = 0; this.nx2 = 0; this.ny1 = 0; this.ny2 = 0;
    this.nEnv = 0; this.nDec = 0;
    this.semilla = 1;
    this.rampa = 0; this.pasoRampa = 0;
    this.gAL = 0; this.gAR = 0; this.gBL = 0; this.gBR = 0;
  }

  iniciar(nota, vel, expr) {
    this._empezar(nota);
    const sr = this.sr, lim = Math.min(0.45 * sr, 18000);
    const f0 = frecuenciaNota(nota);
    const B = inarmonicidad(nota);
    const r1 = Math.sqrt(1 + B);
    const fcH = 1200 * Math.pow(2, 2.2 * vel) * Math.pow(f0 / 262, 0.35);   // corte del martillo
    const ts = limitar(25 * Math.pow(2, -(nota - 21) / 22), 1.2, 25);       // T60 de la etapa lenta
    const sBase = 6.91 / ts;
    // Desafinación del unísono, determinista por nota (1 a 2.5 cents; menos en los bordones).
    let s = azar(nota * 7919 + 13);
    const cents = (1.75 + 0.75 * s * A_UNIDAD) * (nota < 33 ? 0.4 : 1);
    s = azar(s);
    const signo = s < 0 ? -1 : 1;
    const det = signo * (Math.pow(2, cents / 1200) - 1) * 0.5;
    this.semilla = azar(s);

    let m = 0, norma = 0;
    for (let k = 1; k <= MAXP; k++) {
      const fk = (k * f0 * Math.sqrt(1 + B * k * k)) / r1;
      if (fk > lim) break;
      const x = fk / fcH;
      const golpeo = 0.3 + 0.7 * Math.abs(Math.sin(Math.PI * k * BETA));
      const tabla = fk / Math.sqrt(fk * fk + 8100);              // la tabla radia poco por debajo de 90 Hz
      const A = (Math.pow(k, -0.7) / (1 + x * x)) * golpeo * tabla;
      const sg = sBase + 3.5e-7 * fk * fk;                        // los parciales altos mueren antes
      // Dos resonadores: cuerda rápida (etapa inicial, algo aguda) y lenta (resonancia larga,
      // algo grave). Cada uno arranca en fase seno: y[−1] = 0, y[−2] = −A·sin(ω)/r.
      for (let c = 0; c < 2; c++) {
        const f = c === 0 ? fk * (1 + det) : fk * (1 - det);
        const amort = c === 0 ? 2.5 * sg + 0.6 : sg;
        const Am = c === 0 ? 0.7 * A : 0.3 * A;
        const w = (2 * Math.PI * f) / sr, r = Math.exp(-amort / sr), cw = Math.cos(w);
        this.fr[m] = f; this.cw[m] = cw; this.sg[m] = amort;
        this.a1[m] = 2 * r * cw; this.a2[m] = r * r;
        this.y1[m] = 0; this.y2[m] = (-Am * Math.sin(w)) / r;
        this.amp[m] = Am; this.rB[m] = Math.pow(r, BLOQUE);
        m++;
      }
      norma += A * A;
    }
    this.nM = m;
    const g = norma > 0 ? (GANANCIA * (0.25 + 0.75 * Math.pow(vel, 1.5))) / Math.sqrt(norma) : 0;
    for (let i = 0; i < m; i++) { this.y2[i] *= g; this.amp[i] *= g; }

    // Golpe del martillo: ruido en paso banda que se apaga en unos milisegundos.
    pasoBanda(this.nc, 0, limitar((900 + 1800 * vel) * Math.pow(f0 / 262, 0.2), 400, 0.4 * sr), 0.9, sr);
    this.nx1 = 0; this.nx2 = 0; this.ny1 = 0; this.ny2 = 0;
    this.nEnv = 0.05 * vel * GANANCIA * 4;
    this.nDec = Math.exp(-1 / (0.004 * sr));
    this.rampa = 0;
    this.pasoRampa = 1 / (0.0006 * sr);
    // Panorama: graves a la izquierda, como desde la banqueta; cada cuerda un poco abierta.
    const p = limitar((nota - 64) / 44, -1, 1) * 0.35;
    this.gAL = panIzq(p - 0.1); this.gAR = panDer(p - 0.1);
    this.gBL = panIzq(p + 0.1); this.gBR = panDer(p + 0.1);
  }

  expresion(v) { /* el piano no usa expresión */ }

  // Apagador: amortiguamiento fuerte, mayor en los parciales altos. Sin apagador en el último tramo
  // agudo (como en un piano real) la nota cae con un amortiguamiento moderado.
  soltar() {
    if (!this.activa || this.soltada) return;
    this.soltada = true;
    const td = this.nota > 88 ? 0.7 : 0.16 + 0.003 * (this.nota - 21);
    const sd = 6.91 / td, sr = this.sr;
    for (let m = 0; m < this.nM; m++) {
      const s = sd * (1 + this.fr[m] / 2500);
      if (s <= this.sg[m]) continue;
      const r = Math.exp(-s / sr);
      this.a1[m] = 2 * r * this.cw[m];
      this.a2[m] = r * r;
      this.rB[m] = Math.pow(r, BLOQUE);
    }
  }

  _generar(bufL, bufR, n) {
    const A = this.bufA, B = this.bufB;
    A.fill(0, 0, n);
    B.fill(0, 0, n);
    const a1 = this.a1, a2 = this.a2, y1 = this.y1, y2 = this.y2, amp = this.amp, rB = this.rB;
    // Modos de 4 en 4 (dos parciales: rápida, lenta, rápida, lenta): cuatro cadenas
    // independientes y la mitad de lecturas y escrituras de búfer por modo.
    const nM = this.nM;
    let m = 0;
    for (; m + 3 < nM; m += 4) {
      // Un modo muerto se pone a cero (si no, acabaría en números desnormales, muy lentos).
      let vivos = 4;
      for (let j = m; j < m + 4; j++) if (amp[j] < MODO_MUERTO) { amp[j] = 0; y1[j] = 0; y2[j] = 0; vivos--; }
      if (vivos === 0) continue;
      const c1 = a1[m], c2 = a2[m], d1 = a1[m + 1], d2 = a2[m + 1];
      const e1 = a1[m + 2], e2 = a2[m + 2], f1 = a1[m + 3], f2 = a2[m + 3];
      let p1 = y1[m], p2 = y2[m], q1 = y1[m + 1], q2 = y2[m + 1];
      let u1 = y1[m + 2], u2 = y2[m + 2], v1 = y1[m + 3], v2 = y2[m + 3];
      for (let i = 0; i < n; i++) {
        const p = c1 * p1 - c2 * p2; p2 = p1; p1 = p;
        const q = d1 * q1 - d2 * q2; q2 = q1; q1 = q;
        const u = e1 * u1 - e2 * u2; u2 = u1; u1 = u;
        const v = f1 * v1 - f2 * v2; v2 = v1; v1 = v;
        A[i] += p + u;
        B[i] += q + v;
      }
      y1[m] = p1; y2[m] = p2; y1[m + 1] = q1; y2[m + 1] = q2;
      y1[m + 2] = u1; y2[m + 2] = u2; y1[m + 3] = v1; y2[m + 3] = v2;
      amp[m] *= rB[m]; amp[m + 1] *= rB[m + 1]; amp[m + 2] *= rB[m + 2]; amp[m + 3] *= rB[m + 3];
    }
    if (m < nM) {   // queda un parcial suelto (dos modos)
      for (let j = m; j < nM; j++) if (amp[j] < MODO_MUERTO) { amp[j] = 0; y1[j] = 0; y2[j] = 0; }
      const c1 = a1[m], c2 = a2[m], d1 = a1[m + 1], d2 = a2[m + 1];
      let p1 = y1[m], p2 = y2[m], q1 = y1[m + 1], q2 = y2[m + 1];
      for (let i = 0; i < n; i++) {
        const p = c1 * p1 - c2 * p2; p2 = p1; p1 = p;
        const q = d1 * q1 - d2 * q2; q2 = q1; q1 = q;
        A[i] += p;
        B[i] += q;
      }
      y1[m] = p1; y2[m] = p2; y1[m + 1] = q1; y2[m + 1] = q2;
      amp[m] *= rB[m]; amp[m + 1] *= rB[m + 1];
    }
    // Mezcla estéreo + rampa de ataque (0.6 ms) + ruido de martillo.
    const nc = this.nc, b0 = nc[0], na1 = nc[1], na2 = nc[2];
    let x1 = this.nx1, x2 = this.nx2, z1 = this.ny1, z2 = this.ny2, ne = this.nEnv, s = this.semilla;
    const nd = this.nDec, gAL = this.gAL, gAR = this.gAR, gBL = this.gBL, gBR = this.gBR;
    let rampa = this.rampa;
    const pr = this.pasoRampa;
    for (let i = 0; i < n; i++) {
      if (rampa < 1) { rampa += pr; if (rampa > 1) rampa = 1; }
      let nz = 0;
      if (ne > 1e-7) {
        s = (Math.imul(s, 1664525) + 1013904223) | 0;   // azar() en línea
        const x = s * A_UNIDAD * ne;
        nz = b0 * (x - x2) - na1 * z1 - na2 * z2;
        x2 = x1; x1 = x; z2 = z1; z1 = nz;
        ne *= nd;
        if (ne <= 1e-7) { ne = 0; x1 = 0; x2 = 0; z1 = 0; z2 = 0; }
      }
      const a = A[i] * rampa, b = B[i] * rampa;
      bufL[i] = a * gAL + b * gBL + nz;
      bufR[i] = a * gAR + b * gBR + nz;
    }
    this.nx1 = x1; this.nx2 = x2; this.ny1 = z1; this.ny2 = z2; this.nEnv = ne; this.semilla = s;
    this.rampa = rampa;
  }
}
