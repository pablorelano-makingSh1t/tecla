// Panel de diagnóstico: lo que dice motor.diagnostico() cada segundo, una sesión de prueba
// de 10 minutos con contadores y un informe que se puede copiar.
// Regla: ninguna cifra inventada. Lo que el motor o el navegador no dan se muestra como «no disponible».

export const NO_DISP = 'no disponible';
export const DURACION_SESION = 10 * 60 * 1000;

const esNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const ms = (seg) => (esNum(seg) ? `${(seg * 1000).toFixed(1)} ms` : NO_DISP);
export const entero = (v) => (esNum(v) ? String(Math.round(v)) : NO_DISP);
export const reloj = (t) => {
  const s = Math.max(0, Math.round(t / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function pico(v) {
  if (!esNum(v)) return NO_DISP;
  const db = v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '−∞ dB';
  return `${v.toFixed(3)} · ${db}`;
}

/** Búfer de salida derivado de baseLatency × sampleRate (solo si existen los dos). */
export function bufer(d) {
  if (!esNum(d?.baseLatency) || !esNum(d?.sampleRate)) return NO_DISP;
  return `≈${Math.round(d.baseLatency * d.sampleRate)} muestras`;
}

/** Huecos de audio: solo si el navegador expone AudioContext.playbackStats. */
export function huecos(d) {
  const p = d?.playbackStats;
  if (!p || typeof p !== 'object') return NO_DISP;
  const partes = [];
  if (esNum(p.underrunEvents)) partes.push(String(p.underrunEvents));
  if (esNum(p.underrunDuration)) partes.push(ms(p.underrunDuration));
  return partes.length ? partes.join(' · ') : NO_DISP;
}

/** Filas del bloque «en vivo»: [etiqueta, valor]. */
export function filasEnVivo(d, extra = {}) {
  d = d ?? {};
  const voces = esNum(d.voces) ? `${d.voces}${esNum(d.maxVoces) ? ` / ${d.maxVoces}` : ''}` : NO_DISP;
  return [
    ['Estado', d.estado ?? NO_DISP],
    ['Frecuencia', esNum(d.sampleRate) ? `${d.sampleRate} Hz` : NO_DISP],
    ['baseLatency', ms(d.baseLatency)],
    ['outputLatency', ms(d.outputLatency)],
    ['Búfer', bufer(d)],
    ['Voces', voces],
    ['Eventos', entero(d.eventos)],
    ['Desbordes', entero(d.desbordes)],
    ['Robos de voz', entero(d.robos)],
    ['Bloques', esNum(d.bloques) ? `${d.bloques}${esNum(extra.bloquesPorSeg) ? ` · ${extra.bloquesPorSeg.toFixed(0)}/s` : ''}` : NO_DISP],
    ['Pico', pico(d.picoSalida)],
    ['Huecos', huecos(d)],
  ];
}

/** Sesión de prueba: acumula lo que se observa; nada se estima. */
export function crearSesion(ahora = Date.now()) {
  return {
    inicio: ahora, fin: null, motivoFin: null,
    lecturas: 0, primera: null, ultima: null,
    notas: 0, rechazadas: 0, vocesMax: null, picoMax: null, alLimite: 0,
    sucesos: { oculta: 0, pagehide: 0, vuelta: 0, blur: 0, devicechange: 0, interrupcion: 0, error: 0 },
    errores: [],
  };
}

export function registrarLectura(s, d) {
  if (!d) return;
  s.lecturas++;
  s.primera ??= d;
  s.ultima = d;
  if (esNum(d.voces)) s.vocesMax = Math.max(s.vocesMax ?? 0, d.voces);
  if (esNum(d.picoSalida)) {
    s.picoMax = Math.max(s.picoMax ?? 0, d.picoSalida);
    if (d.picoSalida >= 0.99) s.alLimite++;
  }
}

const delta = (s, clave) => {
  const a = s.primera?.[clave];
  const b = s.ultima?.[clave];
  return esNum(a) && esNum(b) ? String(b - a) : NO_DISP;
};
const deltaHuecos = (s) => {
  const a = s.primera?.playbackStats?.underrunEvents;
  const b = s.ultima?.playbackStats?.underrunEvents;
  return esNum(a) && esNum(b) ? String(b - a) : NO_DISP;
};

export function filasSesion(s, ahora = Date.now()) {
  if (!s) return [];
  const t = (s.fin ?? ahora) - s.inicio;
  return [
    ['Tiempo', `${reloj(t)} / ${reloj(DURACION_SESION)}`],
    ['Notas tocadas', String(s.notas)],
    ['Notas rechazadas', String(s.rechazadas)],
    ['Voces (máx.)', s.vocesMax === null ? NO_DISP : String(s.vocesMax)],
    ['Desbordes nuevos', delta(s, 'desbordes')],
    ['Robos nuevos', delta(s, 'robos')],
    ['Huecos nuevos', deltaHuecos(s)],
    ['Pico máximo', pico(s.picoMax ?? undefined)],
    ['Lecturas ≥ 0.99', s.lecturas ? String(s.alLimite) : NO_DISP],
    ['Ocultaciones', String(s.sucesos.oculta + s.sucesos.pagehide)],
    ['Interrupciones', String(s.sucesos.interrupcion)],
    ['Cambios de salida', String(s.sucesos.devicechange)],
  ];
}

/** Informe de texto para copiar y pegar. */
export function construirInforme({ ahora = new Date(), dispositivo = {}, diag = null, extra = {}, sesion = null, preset = NO_DISP, modo = NO_DISP }) {
  const L = [];
  const fila = ([k, v]) => L.push(`${k}: ${v}`);
  L.push('TECLA · informe de diagnóstico');
  L.push(`Fecha: ${ahora.toISOString()}`);
  fila(['Dispositivo', dispositivo.userAgent ?? NO_DISP]);
  fila(['URL', dispositivo.url ?? NO_DISP]);
  fila(['Pantalla', dispositivo.pantalla ?? NO_DISP]);
  fila(['Instalada', dispositivo.instalada ?? NO_DISP]);
  fila(['Salida de audio', diag?.ruta ?? diag?.sinkId ?? NO_DISP]);
  fila(['Instrumento', `${preset} · ${modo}`]);
  L.push('', '— Motor (última lectura) —');
  filasEnVivo(diag, extra).forEach(fila);
  if (diag?.playbackStats && typeof diag.playbackStats === 'object') {
    for (const [k, v] of Object.entries(diag.playbackStats)) if (esNum(v)) fila([`playbackStats.${k}`, v]);
  }
  L.push('', '— Sesión de prueba —');
  if (!sesion) L.push('No realizada.');
  else {
    const estado = sesion.fin === null ? 'en curso' : sesion.motivoFin === 'completa' ? 'completa' : 'detenida antes de tiempo';
    L.push(`Estado: ${estado}`);
    filasSesion(sesion, ahora.getTime()).forEach(fila);
    if (sesion.errores.length) L.push(`Errores: ${sesion.errores.join(' | ')}`);
  }
  L.push('', 'Búfer = baseLatency × frecuencia. Bloques/s = bloques medidos entre dos lecturas. Huecos = AudioContext.playbackStats (huecos · duración), solo si el navegador lo expone.');
  L.push('Estas cifras no son la latencia acústica completa (tocar → oír); esa requiere una medición externa.');
  return L.join('\n');
}

// ───────────────────────────── DOM ─────────────────────────────

export class PanelDiagnostico {
  /**
   * @param {HTMLElement} raiz  <section id="diag">
   * @param {{ motor, info(): { preset, modo }, alCambiarVisible(visible), alTic(texto|null) }} o
   */
  constructor(raiz, { motor, info, alCambiarVisible = () => {}, alTic = () => {} }) {
    this.raiz = raiz;
    this.motor = motor;
    this.info = info;
    this.alCambiarVisible = alCambiarVisible;
    this.alTic = alTic;
    this.diag = null;
    this.extra = {};
    this.sesion = null;
    this.temporizador = null;
    this.anterior = null; // { t, bloques } para medir bloques por segundo
    this.$ = (s) => raiz.querySelector(s);
    this.$('[data-accion="cerrar"]').addEventListener('click', () => this.mostrar(false));
    this.$('[data-accion="sesion"]').addEventListener('click', () => (this.sesion && this.sesion.fin === null ? this.terminarSesion('detenida') : this.empezarSesion()));
    this.$('[data-accion="copiar"]').addEventListener('click', () => this.copiar());
    this.#pintar();
  }

  get visible() { return !this.raiz.hidden; }

  mostrar(si) {
    this.raiz.hidden = !si;
    this.alCambiarVisible(si);
    this.#programar();
    if (si) this.leer();
  }

  // Lee cada segundo mientras el panel se ve o la sesión corre.
  #programar() {
    const hace = this.visible || (this.sesion && this.sesion.fin === null);
    if (hace && !this.temporizador) this.temporizador = setInterval(() => this.leer(), 1000);
    if (!hace && this.temporizador) { clearInterval(this.temporizador); this.temporizador = null; }
  }

  async leer() {
    if (this.motor.estado !== 'apagado' && this.motor.estado !== 'iniciando') {
      try {
        const d = await this.motor.diagnostico();
        const t = performance.now();
        if (d && typeof d.bloques === 'number' && this.anterior && t > this.anterior.t) {
          this.extra.bloquesPorSeg = ((d.bloques - this.anterior.bloques) * 1000) / (t - this.anterior.t);
        }
        if (d && typeof d.bloques === 'number') this.anterior = { t, bloques: d.bloques };
        this.diag = d;
        if (this.sesion && this.sesion.fin === null) registrarLectura(this.sesion, d);
      } catch (e) {
        if (this.sesion && this.sesion.fin === null) { this.sesion.sucesos.error++; this.sesion.errores.push(String(e?.message ?? e)); }
      }
    }
    if (this.sesion && this.sesion.fin === null && Date.now() - this.sesion.inicio >= DURACION_SESION) this.terminarSesion('completa');
    this.#pintar();
  }

  empezarSesion() {
    this.sesion = crearSesion();
    this.#programar();
    this.leer();
  }

  terminarSesion(motivo) {
    if (!this.sesion || this.sesion.fin !== null) return;
    this.sesion.fin = Date.now();
    this.sesion.motivoFin = motivo;
    this.#programar();
    this.#pintar();
  }

  /** La interfaz cuenta las notas: ok = lo que devolvió noteOn. */
  nota(ok) {
    if (!this.sesion || this.sesion.fin !== null) return;
    if (ok) this.sesion.notas++; else this.sesion.rechazadas++;
  }

  suceso(tipo) {
    if (!this.sesion || this.sesion.fin !== null) return;
    if (tipo in this.sesion.sucesos) this.sesion.sucesos[tipo]++;
  }

  informe() {
    const { preset, modo } = this.info();
    const instalada = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ? 'sí (pantalla completa o app)' : 'no (pestaña del navegador)';
    return construirInforme({
      dispositivo: {
        userAgent: navigator.userAgent,
        url: location.href,
        pantalla: `${innerWidth}×${innerHeight} CSS px · devicePixelRatio ${devicePixelRatio}`,
        instalada,
      },
      diag: this.diag, extra: this.extra, sesion: this.sesion, preset, modo,
    });
  }

  async copiar() {
    const texto = this.informe();
    const caja = this.$('.diag-informe');
    caja.value = texto;
    const aviso = this.$('.diag-copiado');
    let ok = false;
    try { await navigator.clipboard.writeText(texto); ok = true; } catch { /* sin permiso: se copia a mano */ }
    if (!ok) {
      caja.hidden = false;
      caja.focus();
      caja.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    aviso.textContent = ok ? 'Informe copiado' : 'No se pudo copiar: selecciona el texto';
    aviso.hidden = false;
    clearTimeout(this.avisoT);
    this.avisoT = setTimeout(() => { aviso.hidden = true; }, 2600);
  }

  #pintar() {
    const tabla = (filas) => filas.map(([k, v]) => `<div class="dato${String(v).startsWith(NO_DISP) ? ' nd' : ''}"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    this.$('.diag-vivo').innerHTML = tabla(filasEnVivo(this.diag, this.extra));
    const s = this.sesion;
    const corre = s && s.fin === null;
    const boton = this.$('[data-accion="sesion"]');
    boton.textContent = corre ? 'Detener prueba' : s ? 'Repetir prueba' : 'Prueba · 10 min';
    boton.classList.toggle('peligro', !!corre);
    const ses = this.$('.diag-sesion');
    ses.hidden = !s;
    ses.innerHTML = s ? tabla(filasSesion(s)) : '';
    this.$('.diag-vacio').hidden = !!s;
    const t = s ? Math.min(1, ((s.fin ?? Date.now()) - s.inicio) / DURACION_SESION) : 0;
    this.$('.diag-progreso i').style.width = `${(t * 100).toFixed(1)}%`;
    const estado = !s ? 'sin empezar' : corre ? `en curso · quedan ${reloj(DURACION_SESION - (Date.now() - s.inicio))}` : s.motivoFin === 'completa' ? 'completa' : 'detenida';
    this.$('.diag-estado-sesion').textContent = estado;
    this.alTic(corre ? reloj(DURACION_SESION - (Date.now() - s.inicio)) : null);
  }
}
