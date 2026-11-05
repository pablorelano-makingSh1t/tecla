// Cola circular preasignada de eventos de nota (arrays tipados, sin objetos por evento).
// Se escribe en el manejador de mensajes y se vacía al empezar cada process().

export const EV_ON = 1, EV_OFF = 2, EV_EXPR = 3, EV_TODO_OFF = 4;

export class Cola {
  constructor(capacidad = 256) {
    this.cap = capacidad;
    this.tipo = new Uint8Array(capacidad);
    this.id = new Int32Array(capacidad);
    this.nota = new Int16Array(capacidad);
    this.a = new Float32Array(capacidad);   // vel (on) o valor (expr)
    this.b = new Float32Array(capacidad);   // expr (on)
    this.lec = 0;
    this.esc = 0;
    this.n = 0;
    this.desbordes = 0;
    this.todoOffPendiente = false;  // se activa al desbordar: el consumidor hace todo-off
  }

  get longitud() { return this.n; }

  // Devuelve false si estaba llena: el evento se descarta, se cuenta y se pide todo-off.
  meter(tipo, id, nota, a, b) {
    if (this.n >= this.cap) {
      this.desbordes++;
      this.todoOffPendiente = true;
      return false;
    }
    const i = this.esc;
    this.tipo[i] = tipo;
    this.id[i] = id;
    this.nota[i] = nota;
    this.a[i] = a;
    this.b[i] = b;
    this.esc = i + 1 === this.cap ? 0 : i + 1;
    this.n++;
    return true;
  }

  // Devuelve el índice del evento más antiguo o -1. Los datos se leen de los arrays.
  sacar() {
    if (this.n === 0) return -1;
    const i = this.lec;
    this.lec = i + 1 === this.cap ? 0 : i + 1;
    this.n--;
    return i;
  }

  vaciar() { this.lec = 0; this.esc = 0; this.n = 0; }
}
