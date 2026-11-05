// MotorAudio: ciclo de vida del AudioContext y del worklet 'tecla' (ver docs/contrato.md).
// El hilo principal solo envía eventos; todo el audio se genera en worklet/procesador.js.
import { PRESETS, MODOS, MAX_VOCES, VELOCIDAD_FIJA, EXPRESION_INICIAL, modoEfectivo } from '../presets.js';
import { Cargador } from './cargador.js';

const ESPERA_LISTO = 5000;  // ms para que el worklet confirme el preset
const ESPERA_DIAG = 1000;   // ms para la respuesta de diagnóstico

const lim01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class MotorAudio {
  constructor({ base = './' } = {}) {
    this.base = new URL(base, typeof location !== 'undefined' ? location.href : 'http://localhost/');
    this.cargador = new Cargador(this.base);
    this.ctx = null;
    this.nodo = null;
    this._base = 'apagado';     // estado propio; 'suspendido' se deriva del AudioContext
    this._emitido = null;
    this._peticion = 0;
    this._vigente = 0;          // última petición de preparar()
    this._esperas = new Map();  // peticion → { resolver, temporizador }
    this._enviados = new Set(); // bancos que ya tiene el worklet de este AudioContext
    this._volumen = 1;
    this.presetActual = null;
    this.modoActual = null;
    this.avisos = [];
    this.ultimoError = null;
    this.onEstado = null;
  }

  get estado() {
    const b = this._base;
    if (b === 'listo' && this.ctx && this.ctx.state !== 'running') return 'suspendido';
    return b;
  }

  _emitir(detalle, forzar = false) {
    const e = this.estado;
    if (!forzar && e === this._emitido && detalle === undefined) return;
    this._emitido = e;
    if (typeof this.onEstado === 'function') {
      try { this.onEstado(e, detalle); } catch (err) { console.error(err); }
    }
  }

  _fijar(base, detalle) { this._base = base; this._emitir(detalle); }

  // Crea el AudioContext, carga el worklet y conecta. Llamar desde un gesto del usuario.
  async iniciar() {
    if (this.ctx && this.ctx.state !== 'closed' && this.nodo) return { ok: true };
    this._fijar('iniciando');
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) throw new Error('Este navegador no tiene Web Audio');
      const ctx = new Ctx({ latencyHint: 'interactive' });
      this.ctx = ctx;
      if (!ctx.audioWorklet) throw new Error('Este navegador no admite AudioWorklet');
      ctx.onstatechange = () => this._emitir({ contexto: ctx.state }, true);
      await ctx.audioWorklet.addModule(new URL('worklet/procesador.js', this.base).href);
      const nodo = new AudioWorkletNode(ctx, 'tecla', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      nodo.port.onmessage = (e) => this._mensaje(e.data);
      nodo.onprocessorerror = () => {
        this.ultimoError = 'El procesador de audio se ha detenido';
        this._fijar('error', { error: this.ultimoError });
      };
      nodo.connect(ctx.destination);
      this.nodo = nodo;
      nodo.port.postMessage({ t: 'volumen', v: this._volumen });
      // resume() puede quedar pendiente sin gesto: no se espera; el estado lo refleja.
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      this._fijar('listo');
      return { ok: true };
    } catch (e) {
      const error = e && e.message ? e.message : String(e);
      this.ultimoError = error;
      this._liberar();
      this._fijar('error', { error });
      return { ok: false, error };
    }
  }

  _mensaje(d) {
    if (!d || typeof d.t !== 'string') return;
    if ((d.t === 'listo' || d.t === 'diag' || d.t === 'error') && d.peticion !== undefined && this._esperas.has(d.peticion)) {
      const { resolver, temporizador } = this._esperas.get(d.peticion);
      clearTimeout(temporizador);
      this._esperas.delete(d.peticion);
      resolver(d);
      return;
    }
    if (d.t === 'error') {
      this.ultimoError = d.mensaje;
      this._emitir({ error: d.mensaje }, true);
    }
  }

  // Envía un mensaje con número de petición y espera la respuesta (o null si vence el plazo).
  _pedir(msg, ms) {
    const peticion = ++this._peticion;
    return new Promise((resolver) => {
      const temporizador = setTimeout(() => { this._esperas.delete(peticion); resolver(null); }, ms);
      this._esperas.set(peticion, { resolver, temporizador });
      this.nodo.port.postMessage({ ...msg, peticion });
    });
  }

  async preparar(preset, modo) {
    if (!this.nodo) return { ok: false, error: 'El motor no está iniciado' };
    if (!PRESETS[preset]) return { ok: false, error: `Preset desconocido: ${preset}` };
    if (!MODOS.includes(modo)) return { ok: false, error: `Modo desconocido: ${modo}` };
    const m = modoEfectivo(preset, modo);
    const yo = ++this._vigente;
    this.allNotesOff();
    this._fijar('preparando', { preset, modo: m });
    const fin = (r) => {
      if (yo !== this._vigente) return { ok: false, error: 'Sustituida por otra preparación' };
      if (this._base === 'preparando') this._fijar('listo', r.ok ? undefined : { error: r.error });
      return r;
    };
    try {
      if (m === 'muestras' && !this._enviados.has(preset)) {
        const b = await this.cargador.cargar(preset, this.ctx);
        if (yo !== this._vigente) return fin({ ok: false });
        if (!this.nodo) return { ok: false, error: 'El motor se cerró mientras cargaba' };
        this.avisos = b.avisos;
        this.nodo.port.postMessage(
          { t: 'banco', preset, zonas: b.zonas, ataque: b.ataque, liberacion: b.liberacion },
          b.transferibles,
        );
        this._enviados.add(preset);
      }
      const r = await this._pedir({ t: 'preset', preset, modo: m }, ESPERA_LISTO);
      if (r === null) { this.presetActual = null; this.modoActual = null; return fin({ ok: false, error: 'El audio no respondió a tiempo' }); }
      if (r.t === 'error') return fin({ ok: false, error: r.mensaje });
      if (yo === this._vigente) { this.presetActual = preset; this.modoActual = m; }
      return fin({ ok: true });
    } catch (e) {
      return fin({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  noteOn(id, nota, vel = VELOCIDAD_FIJA, expr = EXPRESION_INICIAL) {
    if (this.estado !== 'listo' || !this.presetActual || !this.nodo) return false;
    const [a, b] = PRESETS[this.presetActual].rango;
    if (!Number.isInteger(nota) || nota < a || nota > b) return false;
    this.nodo.port.postMessage({ t: 'on', id, nota, vel: lim01(vel), expr: lim01(expr) });
    return true;
  }

  // Soltar siempre se envía (aunque no esté listo): mejor sobrar que dejar una nota colgada.
  noteOff(id) {
    if (!this.nodo) return false;
    this.nodo.port.postMessage({ t: 'off', id });
    return true;
  }

  setExpression(id, v) {
    if (!this.nodo) return false;
    this.nodo.port.postMessage({ t: 'expr', id, v: lim01(v) });
    return true;
  }

  allNotesOff() { if (this.nodo) this.nodo.port.postMessage({ t: 'todo-off' }); }

  setVolumen(v) {
    this._volumen = lim01(Number(v) || 0);
    if (this.nodo) this.nodo.port.postMessage({ t: 'volumen', v: this._volumen });
  }

  async diagnostico() {
    const ctx = this.ctx;
    const d = {
      estado: this.estado,
      sampleRate: ctx ? ctx.sampleRate : null,
      baseLatency: ctx && typeof ctx.baseLatency === 'number' ? ctx.baseLatency : null,
      outputLatency: ctx && typeof ctx.outputLatency === 'number' ? ctx.outputLatency : null,
      voces: null, maxVoces: MAX_VOCES, eventos: null, desbordes: null, robos: null, bloques: null, picoSalida: null,
    };
    if (this.nodo) {
      const r = await this._pedir({ t: 'diag' }, ESPERA_DIAG);
      if (r && r.t === 'diag') {
        for (const k of ['voces', 'maxVoces', 'eventos', 'desbordes', 'robos', 'bloques', 'picoSalida']) d[k] = r[k];
      }
    }
    // Solo si el navegador lo expone (detección de características): nunca se inventa.
    if (ctx && 'playbackStats' in ctx && ctx.playbackStats) {
      const s = ctx.playbackStats;
      if (typeof s.toJSON === 'function') d.playbackStats = s.toJSON();
      else {
        d.playbackStats = {};
        for (const k in s) if (typeof s[k] !== 'function') d.playbackStats[k] = s[k];
      }
    }
    return d;
  }

  async suspender() {
    this.allNotesOff();
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
    this._emitir();
  }

  async reanudar() {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') await this.ctx.resume();
    this._emitir();
  }

  _liberar() {
    for (const { resolver, temporizador } of this._esperas.values()) { clearTimeout(temporizador); resolver(null); }
    this._esperas.clear();
    if (this.nodo) {
      try { this.nodo.port.postMessage({ t: 'todo-off' }); this.nodo.disconnect(); this.nodo.port.close(); } catch { /* ya cerrado */ }
    }
    if (this.ctx) {
      this.ctx.onstatechange = null;
      if (this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
    }
    this.nodo = null;
    this.ctx = null;
    this._enviados.clear();
    this.presetActual = null;
    this.modoActual = null;
  }

  cerrar() {
    this._vigente++;
    this._liberar();
    this._fijar('apagado');
  }
}
