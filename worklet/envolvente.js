// Envolventes y suavizadores sin clics. No usan globales del worklet: reciben sr.
// Nada de lo que se llama por muestra crea objetos.

export const T_CORTE = 0.015;      // liberación rápida (robo, silenciar, cambio de preset)
export const ATAQUE_MIN = 0.0015;  // ataque mínimo para no arrancar con un escalón
const UMBRAL = 1e-4;               // −80 dB: por debajo, la voz se da por terminada
const LN_UMBRAL = Math.log(1 / UMBRAL);

// Fases
const PARADA = 0, ATAQUE = 1, SOSTEN = 2, LIBERACION = 3, CORTE = 4;

export class Envolvente {
  constructor(sr) {
    this.sr = sr;
    this.g = 0;
    this.fase = PARADA;
    this.paso = 0;   // incremento lineal (ataque y corte)
    this.coef = 0;   // factor exponencial (liberación)
  }

  get activa() { return this.fase !== PARADA; }

  // Arranca desde el nivel actual (si se reutiliza en marcha, no salta a 0).
  iniciar(ataque) {
    const t = ataque > ATAQUE_MIN ? ataque : ATAQUE_MIN;
    this.paso = 1 / (t * this.sr);
    this.fase = ATAQUE;
  }

  // Caída exponencial que llega a −80 dB en «liberacion» segundos.
  soltar(liberacion) {
    if (this.fase === PARADA || this.fase === CORTE || this.fase === LIBERACION) return;
    const t = liberacion > 0.005 ? liberacion : 0.005;
    this.coef = Math.exp(-LN_UMBRAL / (t * this.sr));
    this.fase = LIBERACION;
  }

  // Rampa lineal a 0 en T_CORTE desde el nivel actual.
  cortar() {
    if (this.fase === PARADA) return;
    const g = this.g > 1e-6 ? this.g : 1e-6;
    const paso = g / (T_CORTE * this.sr);
    // Si ya estaba cortando más deprisa, se respeta.
    if (this.fase !== CORTE || paso > this.paso) this.paso = paso;
    this.fase = CORTE;
  }

  // Parada inmediata (solo cuando la señal ya es silencio, p. ej. fin de muestra).
  apagar() { this.g = 0; this.fase = PARADA; }

  siguiente() {
    switch (this.fase) {
      case ATAQUE:
        this.g += this.paso;
        if (this.g >= 1) { this.g = 1; this.fase = SOSTEN; }
        break;
      case LIBERACION:
        this.g *= this.coef;
        if (this.g < UMBRAL) { this.g = 0; this.fase = PARADA; }
        break;
      case CORTE:
        this.g -= this.paso;
        if (this.g <= 0) { this.g = 0; this.fase = PARADA; }
        break;
      default:
        break;
    }
    return this.g;
  }
}

// Suavizador de un polo: «tau» segundos de constante de tiempo (≈3·tau hasta el 95 %).
export class Suave {
  constructor(sr, tau, inicial = 0) {
    this.v = inicial;
    this.obj = inicial;
    this.a = 1 - Math.exp(-1 / (tau * sr));
  }
  fijar(v) { this.obj = v; }
  saltar(v) { this.v = v; this.obj = v; }
  siguiente() {
    this.v += this.a * (this.obj - this.v);
    return this.v;
  }
}
