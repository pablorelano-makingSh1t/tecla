// AudioWorkletProcessor 'tecla' (estéreo). Todo el audio de Tecla se genera aquí.
// El núcleo (NucleoTecla) no depende de los globales del worklet para poder probarlo en Node.
import { crearVozSintesis } from './sintesis/index.js';
import { PRESETS, MAX_VOCES } from '../js/presets.js';
import { Cola, EV_ON, EV_OFF, EV_EXPR, EV_TODO_OFF } from './cola.js';
import { Voces } from './voces.js';
import { Mezcla } from './mezcla.js';
import { VozMuestra } from './voz-muestra.js';

const BLOQUE_MAX = 4096;  // tamaño máximo de bloque para el búfer auxiliar (salida mono)

const num = (v, d) => (typeof v === 'number' && v === v ? v : d);
const lim01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class NucleoTecla {
  // sr: frecuencia de muestreo. crearVoz: fábrica de voces de síntesis. enviar: postMessage.
  constructor(sr, crearVoz, enviar) {
    this.sr = sr;
    this.enviar = enviar;
    this.cola = new Cola(256);
    this.voces = new Voces(MAX_VOCES);
    this.mezcla = new Mezcla(sr);
    this.todas = [];      // todas las voces (para renderizar las colas de cualquier pool)
    this.muestra = [];
    for (let i = 0; i < MAX_VOCES; i++) this.muestra.push(new VozMuestra(sr));
    this.todas.push(...this.muestra);
    this.sintesis = {};
    this.erroresSintesis = [];
    for (const preset of Object.keys(PRESETS)) {
      try {
        const pool = [];
        for (let i = 0; i < MAX_VOCES; i++) pool.push(crearVoz(preset, sr));
        this.sintesis[preset] = pool;
        this.todas.push(...pool);
      } catch (e) {
        this.erroresSintesis.push(`${preset}: ${e && e.message ? e.message : e}`);
      }
    }
    this.bancos = {};
    this.preset = null;
    this.modo = null;
    this.eventos = 0;
    this.bloques = 0;
    this.fallos = 0;
    if (this.erroresSintesis.length) {
      this.enviar({ t: 'error', mensaje: `No se pudieron crear voces de síntesis: ${this.erroresSintesis.join('; ')}` });
    }
  }

  // Manejador de mensajes del hilo principal (fuera de process(): aquí sí se puede asignar).
  mensaje(d) {
    if (!d || typeof d.t !== 'string') return;
    const c = this.cola;
    switch (d.t) {
      case 'on':
        c.meter(EV_ON, d.id | 0, d.nota | 0, lim01(num(d.vel, 0.8)), lim01(num(d.expr, 0.6)));
        break;
      case 'off':
        c.meter(EV_OFF, d.id | 0, 0, 0, 0);
        break;
      case 'expr':
        c.meter(EV_EXPR, d.id | 0, 0, lim01(num(d.v, 0.6)), 0);
        break;
      case 'todo-off':
        c.meter(EV_TODO_OFF, 0, 0, 0, 0);
        break;
      case 'volumen':
        this.mezcla.volumen(num(d.v, 1));
        break;
      case 'banco':
        this.guardarBanco(d);
        break;
      case 'preset':
        this.activarPreset(d);
        break;
      case 'diag':
        this.enviar(this.diagnostico(d.peticion));
        break;
      default:
        break;
    }
  }

  guardarBanco(d) {
    if (!PRESETS[d.preset] || !Array.isArray(d.zonas) || d.zonas.length === 0) {
      this.enviar({ t: 'error', mensaje: `Banco no válido para ${d.preset}` });
      return;
    }
    for (const z of d.zonas) {
      if (!z || !Array.isArray(z.canales) || !(z.canales[0] instanceof Float32Array) || !(z.sr > 0)) {
        this.enviar({ t: 'error', mensaje: `Zona no válida en el banco de ${d.preset}` });
        return;
      }
    }
    // ataque y liberacion: ampliación del contrato (vienen del manifiesto, por preset).
    this.bancos[d.preset] = {
      zonas: d.zonas,
      ataque: num(d.ataque, 0.002),
      liberacion: num(d.liberacion, 0.2),
      sostenido: !!PRESETS[d.preset].sostenido,
    };
    if (this.modo === 'muestras' && this.preset === d.preset) {
      for (const v of this.muestra) v.banco = this.bancos[d.preset];
    }
  }

  activarPreset(d) {
    const { preset, modo, peticion } = d;
    let pool = null;
    if (modo === 'muestras') {
      const b = this.bancos[preset];
      if (!b) { this.enviar({ t: 'error', mensaje: `No hay banco cargado para ${preset}`, peticion }); return; }
      pool = this.muestra;
    } else if (modo === 'sintesis') {
      pool = this.sintesis[preset] || null;
      if (!pool) { this.enviar({ t: 'error', mensaje: `No hay síntesis para ${preset}`, peticion }); return; }
    } else {
      this.enviar({ t: 'error', mensaje: `Modo desconocido: ${modo}`, peticion });
      return;
    }
    this.vaciarCola();          // los eventos anteriores se aplican al preset anterior
    this.cortarTodas();
    if (modo === 'muestras') for (const v of this.muestra) v.banco = this.bancos[preset];
    this.voces.usarPool(pool);
    this.preset = preset;
    this.modo = modo;
    this.enviar({ t: 'listo', peticion, preset, modo });
  }

  cortarTodas() {
    const t = this.todas;
    for (let i = 0; i < t.length; i++) if (t[i].activa) t[i].cortar();
  }

  vaciarCola() {
    const c = this.cola, v = this.voces;
    let i;
    while ((i = c.sacar()) >= 0) {
      this.eventos++;
      switch (c.tipo[i]) {
        case EV_ON: v.on(c.id[i], c.nota[i], c.a[i], c.b[i]); break;
        case EV_OFF: v.off(c.id[i]); break;
        case EV_EXPR: v.expresion(c.id[i], c.a[i]); break;
        case EV_TODO_OFF: v.todoOff(); break;
        default: break;
      }
    }
    if (c.todoOffPendiente) {  // hubo desborde: nada puede quedar colgado
      c.todoOffPendiente = false;
      v.todoOff();
    }
  }

  // Un bloque de audio. Sin asignaciones ni closures.
  procesar(izq, der, n) {
    this.bloques++;
    izq.fill(0, 0, n);
    der.fill(0, 0, n);
    this.vaciarCola();
    this.voces.arrancarPendientes();
    const t = this.todas;
    for (let i = 0; i < t.length; i++) if (t[i].activa) t[i].render(izq, der, 0, n);
    this.mezcla.aplicar(izq, der, n);
  }

  vocesActivas() {
    let n = 0;
    const t = this.todas;
    for (let i = 0; i < t.length; i++) if (t[i].activa) n++;
    return n;
  }

  diagnostico(peticion) {
    return {
      t: 'diag', peticion,
      voces: this.vocesActivas(),
      maxVoces: MAX_VOCES,
      eventos: this.eventos,
      desbordes: this.cola.desbordes,
      robos: this.voces.robos,
      bloques: this.bloques,
      picoSalida: this.mezcla.leerPico(),
    };
  }
}

if (typeof registerProcessor === 'function') {
  class ProcesadorTecla extends AudioWorkletProcessor {
    constructor() {
      super();
      this.aux = new Float32Array(BLOQUE_MAX);
      this.nucleo = new NucleoTecla(sampleRate, crearVozSintesis, (m) => this.port.postMessage(m));
      this.port.onmessage = (e) => this.nucleo.mensaje(e.data);
    }

    process(_entradas, salidas) {
      const out = salidas[0];
      if (!out || out.length === 0) return true;
      const izq = out[0];
      const der = out.length > 1 ? out[1] : this.aux;
      const n = izq.length < BLOQUE_MAX ? izq.length : BLOQUE_MAX;
      try {
        this.nucleo.procesar(izq, der, n);
      } catch (e) {
        // Un fallo no debe matar el procesador: silencio y aviso (solo la primera vez).
        izq.fill(0);
        if (out.length > 1) der.fill(0);
        if (++this.nucleo.fallos === 1) this.port.postMessage({ t: 'error', mensaje: `Fallo en process(): ${e && e.message}` });
      }
      return true;
    }
  }
  registerProcessor('tecla', ProcesadorTecla);
}
