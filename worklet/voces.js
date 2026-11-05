// Asignación de voces por id de contacto sobre el pool del preset activo.
// Cada ranura es una voz del pool. Dos ids en la misma nota ocupan ranuras distintas
// y se sueltan por separado. Robo: primero la voz más antigua ya soltada; si no, la más
// antigua. La voz robada se corta (≈15 ms) y la nota nueva arranca cuando termina el corte.

const ESPERA_MAX = 40;  // bloques que se espera a que termine un corte antes de forzar el arranque

export class Voces {
  constructor(max = 16) {
    this.max = max;
    this.pool = null;
    this.ids = new Int32Array(max);
    this.ocupada = new Uint8Array(max);   // la ranura tiene un id vivo (sonando o pendiente)
    this.orden = new Float64Array(max);   // orden de llegada de la nota
    this.pend = new Uint8Array(max);      // hay una nota esperando a que acabe el corte
    this.pendNota = new Int16Array(max);
    this.pendVel = new Float32Array(max);
    this.pendExpr = new Float32Array(max);
    this.pendEspera = new Uint16Array(max);
    this.contador = 0;
    this.robos = 0;
  }

  // Cambia de pool (cambio de preset). Quien llama corta antes las voces que sonaban.
  usarPool(pool) {
    this.pool = pool;
    this.ocupada.fill(0);
    this.pend.fill(0);
  }

  buscar(id) {
    for (let s = 0; s < this.max; s++) if (this.ocupada[s] === 1 && this.ids[s] === id) return s;
    return -1;
  }

  on(id, nota, vel, expr) {
    const pool = this.pool;
    if (pool === null) return;
    if (this.buscar(id) >= 0) this.off(id);  // el id ya sonaba: se suelta primero
    // 1) Ranura libre (voz terminada y sin nada pendiente).
    let s = -1;
    for (let i = 0; i < this.max; i++) {
      if (!pool[i].activa && this.pend[i] === 0) { s = i; break; }
    }
    if (s >= 0) {
      this._ocupar(s, id);
      pool[s].iniciar(nota, vel, expr);
      return;
    }
    // 2) Robo: la más antigua ya soltada; si no hay, la más antigua.
    let mejor = -1, mejorOrden = Infinity;
    for (let i = 0; i < this.max; i++) {
      if (this.ocupada[i] === 0 && this.orden[i] < mejorOrden) { mejor = i; mejorOrden = this.orden[i]; }
    }
    if (mejor < 0) {
      for (let i = 0; i < this.max; i++) {
        if (this.orden[i] < mejorOrden) { mejor = i; mejorOrden = this.orden[i]; }
      }
    }
    s = mejor;
    this.robos++;
    pool[s].cortar();
    this._ocupar(s, id);
    this.pend[s] = 1;
    this.pendNota[s] = nota;
    this.pendVel[s] = vel;
    this.pendExpr[s] = expr;
    this.pendEspera[s] = 0;
  }

  _ocupar(s, id) {
    this.ids[s] = id;
    this.ocupada[s] = 1;
    this.orden[s] = ++this.contador;
    this.pend[s] = 0;
  }

  off(id) {
    const s = this.buscar(id);
    if (s < 0) return;
    this.ocupada[s] = 0;
    if (this.pend[s] === 1) { this.pend[s] = 0; return; }  // aún no había arrancado
    this.pool[s].soltar();
  }

  expresion(id, v) {
    const s = this.buscar(id);
    if (s < 0) return;
    if (this.pend[s] === 1) this.pendExpr[s] = v;
    else this.pool[s].expresion(v);
  }

  // Liberación rápida de todo el pool activo.
  todoOff() {
    const pool = this.pool;
    if (pool === null) return;
    for (let s = 0; s < this.max; s++) {
      if (pool[s].activa) pool[s].cortar();
      this.ocupada[s] = 0;
      this.pend[s] = 0;
    }
  }

  // Al empezar cada bloque: arranca las notas cuyo corte ya terminó.
  arrancarPendientes() {
    const pool = this.pool;
    if (pool === null) return;
    for (let s = 0; s < this.max; s++) {
      if (this.pend[s] === 0) continue;
      if (!pool[s].activa || ++this.pendEspera[s] > ESPERA_MAX) {
        this.pend[s] = 0;
        pool[s].iniciar(this.pendNota[s], this.pendVel[s], this.pendExpr[s]);
      }
    }
  }
}
