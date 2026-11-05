// Piano eléctrico de síntesis FM, estilo púa metálica (tine).
// Cuerpo: portadora modulada por una moduladora 1:1 cuyo índice baja con el tiempo
// (ataque brillante que se redondea). Una portadora afinada en el centro y dos desafinadas
// ±2.5 cents, una por canal, hacen de chorus sin mover la afinación media. Púa: un segundo par 1:14 muy breve que pone el «ping» metálico del ataque.
// Amplitud en dos etapas que cae mientras se mantiene la tecla, trémolo estéreo suave
// y liberación corta al soltar (fieltro del apagador). Índices limitados para no aliasar.
import { VozBase, frecuenciaNota, limitar, SENO, TAM_SENO, panIzq, panDer } from './comun.js';

const GANANCIA = 0.24;        // calibrada: pico ≈ 0.2 con vel 0.8
const CHORUS = Math.pow(2, 2.5 / 1200) - 1;
const TREMOLO_HZ = 4.7;
const TREMOLO = 0.16;

export class VozPianoModerno extends VozBase {
  constructor(sr) {
    super(sr);
    this.pC = 0; this.pL = 0; this.pR = 0; this.pT = 0; this.pTM = 0; this.pLfo = 0;
    this.inc = 0; this.incLfo = TREMOLO_HZ / sr;
    this.iMax = 0; this.iMin = 0; this.eI = 0; this.dI = 0;    // índice del cuerpo (en ciclos)
    this.e1 = 0; this.d1 = 0; this.e2 = 0; this.d2 = 0;        // amplitud en dos etapas
    this.et = 0; this.dt = 0; this.bt = 0; this.dbt = 0;       // púa: amplitud e índice
    this.rel = 1; this.dRel = 1;
    this.rampa = 0; this.pasoRampa = 0;
    this.g = 0; this.gL = 0; this.gR = 0;
  }

  iniciar(nota, vel, expr) {
    this._empezar(nota);
    const sr = this.sr, f = frecuenciaNota(nota);
    this.inc = f / sr;
    this.pC = 0; this.pL = 0; this.pR = 0; this.pT = 0; this.pTM = 0;
    this.pLfo = ((nota * 0.137) % 1);   // fase del trémolo distinta por nota, determinista
    // Índice del cuerpo: más con la velocidad, menos en los agudos; Carson (I+2)·f < 0.42·sr.
    const escala = limitar(1.25 - (nota - 40) / 80, 0.45, 1.25);
    const tope = Math.max(0, (0.42 * sr) / f - 2);
    const iMax = Math.min(tope, (0.5 + 2.0 * vel) * escala);
    this.iMax = (iMax * 0.82) / (2 * Math.PI);
    this.iMin = (iMax * 0.18) / (2 * Math.PI);
    this.eI = 1;
    this.dI = Math.exp(-1 / (0.28 * Math.pow(2, -(nota - 60) / 24) * sr));
    // Amplitud: caída rápida (35 %) + caída larga (T60 según la nota).
    const t60 = limitar(14 * Math.pow(2, -(nota - 21) / 24), 1.5, 14);
    this.e1 = 0.35; this.d1 = Math.exp(-1 / (0.3 * Math.pow(2, -(nota - 60) / 36) * sr));
    this.e2 = 0.65; this.d2 = Math.exp(-6.91 / (t60 * sr));
    // Púa 1:14, solo si sus bandas laterales caben bajo Nyquist.
    const btMax = limitar((0.45 * sr - f) / (14 * f) - 1, 0, 2.2);
    this.et = btMax > 0.05 ? 0.2 * vel * vel : 0;
    this.dt = Math.exp(-1 / (0.12 * sr));
    this.bt = btMax / (2 * Math.PI);
    this.dbt = Math.exp(-1 / (0.03 * sr));
    this.rel = 1; this.dRel = 1;
    this.rampa = 0; this.pasoRampa = 1 / (0.0015 * sr);
    const p = limitar((nota - 64) / 44, -1, 1) * 0.3;
    this.g = GANANCIA * (0.3 + 0.7 * vel);
    this.gL = panIzq(p); this.gR = panDer(p);
  }

  expresion(v) { /* no sostenido: sin expresión */ }

  soltar() {
    if (!this.activa || this.soltada) return;
    this.soltada = true;
    const tau = this.nota > 84 ? 0.18 : 0.1;
    this.dRel = Math.exp(-1 / (tau * this.sr));
    this.dI = Math.exp(-1 / (0.05 * this.sr));   // el fieltro apaga antes los armónicos
  }

  _generar(bufL, bufR, n) {
    let pC = this.pC, pL = this.pL, pR = this.pR, pT = this.pT, pTM = this.pTM, pLfo = this.pLfo;
    let eI = this.eI, e1 = this.e1, e2 = this.e2, et = this.et, bt = this.bt, rel = this.rel, rampa = this.rampa;
    const inc = this.inc, incL = inc * (1 + CHORUS), incR = inc * (1 - CHORUS), incT = inc * 14, incLfo = this.incLfo;
    const iMax = this.iMax, iMin = this.iMin, dI = this.dI, d1 = this.d1, d2 = this.d2;
    const dt = this.dt, dbt = this.dbt, dRel = this.dRel, pr = this.pasoRampa;
    const gL = this.g * this.gL, gR = this.g * this.gR;
    const T = SENO, TS = TAM_SENO;
    for (let i = 0; i < n; i++) {
      if (rampa < 1) { rampa += pr; if (rampa > 1) rampa = 1; }
      // Senos por tabla, en línea. Cada portadora lleva su moduladora 1:1 con su misma fase
      // (si las de chorus compartieran la del centro, su banda lateral inferior caería en ±δ·f ≈ 1 Hz).
      const ind = iMin + iMax * eI;
      let x = pC * TS, j = x | 0;
      let ph = pC + ind * (T[j] + (T[j + 1] - T[j]) * (x - j));
      ph -= Math.floor(ph); x = ph * TS; j = x | 0;
      const c0 = T[j] + (T[j + 1] - T[j]) * (x - j);
      x = pL * TS; j = x | 0;
      ph = pL + ind * (T[j] + (T[j + 1] - T[j]) * (x - j));
      ph -= Math.floor(ph); x = ph * TS; j = x | 0;
      const cL = T[j] + (T[j + 1] - T[j]) * (x - j);
      x = pR * TS; j = x | 0;
      ph = pR + ind * (T[j] + (T[j + 1] - T[j]) * (x - j));
      ph -= Math.floor(ph); x = ph * TS; j = x | 0;
      const cR = T[j] + (T[j + 1] - T[j]) * (x - j);
      let tine = 0;
      if (et > 1e-6) {
        x = pTM * TS; j = x | 0;
        ph = pT + bt * (T[j] + (T[j + 1] - T[j]) * (x - j)); ph -= Math.floor(ph); x = ph * TS; j = x | 0;
        tine = et * (T[j] + (T[j + 1] - T[j]) * (x - j));
        et *= dt; bt *= dbt;
        pT += inc; if (pT >= 1) pT -= 1;
        pTM += incT; if (pTM >= 1) pTM -= 1;
      }
      const amp = (e1 + e2) * rel * rampa;
      x = pLfo * TS; j = x | 0;
      const trem = TREMOLO * (T[j] + (T[j + 1] - T[j]) * (x - j));
      bufL[i] = amp * (0.6 * c0 + 0.4 * cL + tine) * gL * (1 + trem);
      bufR[i] = amp * (0.6 * c0 + 0.4 * cR + tine) * gR * (1 - trem);
      eI *= dI; e1 *= d1; e2 *= d2; rel *= dRel;
      pC += inc; if (pC >= 1) pC -= 1;
      pL += incL; if (pL >= 1) pL -= 1;
      pR += incR; if (pR >= 1) pR -= 1;
      pLfo += incLfo; if (pLfo >= 1) pLfo -= 1;
    }
    this.pC = pC; this.pL = pL; this.pR = pR; this.pT = pT; this.pTM = pTM; this.pLfo = pLfo;
    this.eI = eI; this.e1 = e1; this.e2 = e2; this.et = et; this.bt = bt; this.rel = rel; this.rampa = rampa;
  }
}
