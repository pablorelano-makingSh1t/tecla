// Voz que reproduce una zona del banco grabado. Misma interfaz que las voces de síntesis:
// iniciar / expresion / soltar / cortar / render / activa / nota.
// Afinación por relación de frecuencias respecto a la raíz, interpolación cúbica Hermite
// y bucle de fin a inicio (el fundido cruzado viene cocinado en el archivo).
import { Envolvente, Suave } from './envolvente.js';

const TAU_EXPR = 0.01;     // ≈30 ms hasta el 95 %
const FUNDIDO_FIN = 0.005; // fundido de seguridad en los últimos 5 ms de una muestra sin bucle

export class VozMuestra {
  constructor(sr) {
    this.sr = sr;
    this.env = new Envolvente(sr);
    this.expr = new Suave(sr, TAU_EXPR, 0.6);
    this.banco = null;  // { zonas, ataque, liberacion, sostenido }: lo fija el procesador
    this.nota = -1;
    // Estado capturado al iniciar (el banco puede cambiar mientras la voz se apaga)
    this.zona = null;
    this.izqC = null;
    this.derC = null;
    this.largo = 0;
    this.bIni = 0;
    this.bFin = 0;    // 0 = sin bucle
    this.bLon = 0;
    this.pos = 0;
    this.paso = 1;
    this.ganancia = 0;
    this.sostenido = false;
    this.liberacion = 0.2;
    this.fundido = 1;
    // Filtro de brillo de un polo (por canal)
    this.fI = 0;
    this.fD = 0;
  }

  get activa() { return this.env.activa; }

  iniciar(nota, vel, expr) {
    const b = this.banco;
    this.nota = nota;
    let z = null;
    if (b) {
      const zs = b.zonas;
      for (let i = 0; i < zs.length; i++) {
        if (nota >= zs[i].desde && nota <= zs[i].hasta) { z = zs[i]; break; }
      }
    }
    if (!z) { this.env.apagar(); this.zona = null; return; }  // fuera de las zonas: silencio
    this.zona = z;
    this.izqC = z.canales[0];
    this.derC = z.canales.length > 1 ? z.canales[1] : z.canales[0];
    this.largo = this.izqC.length;
    if (z.bucle && z.bucle.fin > z.bucle.inicio + 1) {
      this.bIni = z.bucle.inicio;
      this.bFin = z.bucle.fin < this.largo ? z.bucle.fin : this.largo;
      this.bLon = this.bFin - this.bIni;
    } else {
      this.bIni = 0; this.bFin = 0; this.bLon = 0;
    }
    this.paso = 2 ** ((nota - z.raiz) / 12) * (z.sr / this.sr);
    this.pos = 0;
    this.ganancia = vel * (z.ganancia ?? 1);
    this.sostenido = !!b.sostenido;
    this.liberacion = b.liberacion ?? 0.2;
    this.fundido = FUNDIDO_FIN * z.sr;
    this.expr.saltar(expr);
    this.fI = 0;
    this.fD = 0;
    this.env.g = 0;
    this.env.iniciar(b.ataque ?? 0);
  }

  expresion(v) { this.expr.fijar(v < 0 ? 0 : v > 1 ? 1 : v); }
  soltar() { this.env.soltar(this.liberacion); }
  cortar() { this.env.cortar(); }

  // Muestra k del canal c, con bucle o con ceros más allá del final.
  _x(c, k) {
    if (k < 0) return c[0];
    if (this.bFin > 0) {
      if (k >= this.bFin) k = this.bIni + ((k - this.bFin) % this.bLon);
      return c[k];
    }
    return k < this.largo ? c[k] : 0;
  }

  // Interpolación cúbica Hermite (Catmull-Rom) entre k y k+1.
  _hermite(c, k, f) {
    const xm = this._x(c, k - 1), x0 = this._x(c, k), x1 = this._x(c, k + 1), x2 = this._x(c, k + 2);
    const c1 = 0.5 * (x1 - xm);
    const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }

  // SUMA n muestras en izq/der desde el índice «desde».
  render(izq, der, desde, n) {
    if (!this.env.activa || this.zona === null) return;
    const L = this.izqC, R = this.derC, mono = L === R;
    const sost = this.sostenido;
    // Coeficiente del filtro de brillo según la expresión actual (se recalcula por bloque).
    // expr 0 → ≈800 Hz; expr 0.6 → ≈4,8 kHz; expr 1 → ≈16 kHz (casi transparente).
    let a = 1;
    if (sost) {
      const fc = 800 * 2 ** (this.expr.v * 4.3);
      a = 1 - Math.exp(-2 * Math.PI * fc / this.sr);
    }
    for (let i = 0; i < n; i++) {
      const e = this.env.siguiente();
      if (!this.env.activa) break;
      let g = this.ganancia * e;
      if (sost) g *= 0.35 + 0.65 * this.expr.siguiente();
      const k = Math.floor(this.pos);
      const f = this.pos - k;
      let l = this._hermite(L, k, f);
      let r = mono ? l : this._hermite(R, k, f);
      if (sost) {
        this.fI += a * (l - this.fI);
        l = this.fI;
        if (mono) r = l; else { this.fD += a * (r - this.fD); r = this.fD; }
      }
      if (this.bFin === 0) {
        const resto = this.largo - 1 - this.pos;
        if (resto < this.fundido) g *= resto > 0 ? resto / this.fundido : 0;
      }
      izq[desde + i] += l * g;
      der[desde + i] += r * g;
      this.pos += this.paso;
      if (this.bFin > 0) {
        if (this.pos >= this.bFin) this.pos -= this.bLon;
      } else if (this.pos >= this.largo - 1) {
        this.env.apagar();  // fin de la muestra (ya fundida a 0)
        break;
      }
    }
  }
}
