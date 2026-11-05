// Tecla: arranque de la interfaz. Conecta el teclado, los controles, el ciclo de vida
// y el panel de diagnóstico con MotorAudio (js/audio/motor.js, de la pieza MOTOR).
// La interfaz solo manda eventos; el audio lo genera el motor de forma continua.

import { PRESETS, VELOCIDAD_FIJA, modoEfectivo } from './presets.js';
import { Teclado, limitesOctava, clamp, geometria, NUM_BLANCAS } from './ui/teclado.js';
import { TecladoPC, etiquetasPC } from './ui/teclas-pc.js';
import { Selector } from './ui/selector.js';
import { Controles, leerVolumen } from './ui/controles.js';
import { PanelDiagnostico } from './ui/diagnostico.js';
import { iniciarCiclo, esInterrupcion } from './ciclo.js';

const $ = (id) => document.getElementById(id);

// ── Preferencias (el almacenamiento puede fallar en modo privado: nunca es imprescindible) ──
const guardado = {
  leer(k) { try { return localStorage.getItem(`tecla.${k}`); } catch { return null; } },
  poner(k, v) { try { localStorage.setItem(`tecla.${k}`, String(v)); } catch { /* sin almacenamiento */ } },
};

const NOMBRE_MODO = { muestras: 'grabado', sintesis: 'sintetizado por Claude' };
const nombrePreset = (p) => (PRESETS[p].instrumento === 'piano' ? `Piano ${PRESETS[p].nombre.toLowerCase()}` : PRESETS[p].nombre);
const ESTADOS = {
  apagado: 'Apagado', iniciando: 'Iniciando', preparando: 'Preparando', listo: 'Listo',
  suspendido: 'En pausa', error: 'Error', interrupted: 'Interrumpido', interrumpido: 'Interrumpido',
};

const app = {
  preset: 'piano-moderno',
  modo: guardado.leer('fuente') === 'sintesis' ? 'sintesis' : 'muestras', // preferencia «Grabado · Sintetizado»
  octava: PRESETS['piano-moderno'].octavaInicial,
  volumen: leerVolumen(guardado.leer('volumen')),
  silenciado: false,
  arrancado: false,
  preparando: false,
  deseado: null,
  avisoActivo: null,
};

// ── Estado visible ──
function pintarEstado(estado) {
  const el = $('estado');
  el.dataset.estado = estado;
  $('estado-texto').textContent = ESTADOS[estado] ?? String(estado);
}

const velo = {
  mostrar({ tipo, titulo, texto = '', boton = null }) {
    const v = $('velo');
    v.dataset.tipo = tipo;
    $('velo-titulo').textContent = titulo;
    $('velo-texto').textContent = texto;
    const b = $('velo-boton');
    b.hidden = !boton;
    if (boton) { b.textContent = boton.texto; b.onclick = boton.accion; }
    v.hidden = false;
  },
  ocultar() { $('velo').hidden = true; },
};

let avisoT = 0;
function avisoBreve(texto) {
  const el = $('aviso-breve');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisoT);
  avisoT = setTimeout(() => { el.hidden = true; }, 2400);
}

// ── Pantalla de inicio ──
const inicio = {
  estado(texto, ocupado = true) { $('inicio-estado').textContent = texto; $('inicio-error').hidden = true; $('inicio').classList.toggle('ocupado', ocupado); },
  error(titulo, detalle) {
    const e = $('inicio-error');
    e.textContent = detalle ? `${titulo}: ${detalle}` : titulo;
    e.hidden = false;
    $('inicio').classList.remove('ocupado');
    $('inicio-estado').textContent = 'Toca de nuevo para reintentar.';
    $('inicio-boton').textContent = 'Reintentar';
    $('inicio-boton').disabled = false;
  },
  ocultar() { $('inicio').hidden = true; },
};

// Créditos de las grabaciones, leídos del manifiesto de MUESTRAS (nada escrito a mano).
async function creditos() {
  let m;
  try {
    const r = await fetch('assets/instrumentos/manifest.json');
    if (!r.ok) return;
    m = await r.json();
  } catch { return; } // sin manifiesto: no se muestra nada
  const lista = document.querySelector('.diag-creditos');
  const licencias = new Set();
  const vistos = new Set();
  for (const [id, p] of Object.entries(m.presets ?? {})) {
    if (!p.fuente) continue;
    if (p.licencia) licencias.add(p.licencia);
    const clave = `${p.fuente}|${p.autor}|${p.licencia}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = PRESETS[id] ? nombrePreset(id) : id;
    li.append(b, `: ${[p.fuente, p.autor, p.licencia].filter(Boolean).join(' — ')}`);
    lista.append(li);
  }
  if (vistos.size) {
    const h = document.createElement('li');
    h.textContent = 'Créditos de las grabaciones (assets/instrumentos/LICENCIAS.md):';
    lista.prepend(h);
    $('inicio-creditos').textContent = `Grabaciones libres (${[...licencias].join(' · ')}). Autoría completa en Diagnóstico.`;
  }
}

// Silueta del teclado en la pantalla de inicio (la misma geometría que el teclado de verdad).
function siluetaInicio() {
  const caja = document.querySelector('.inicio-teclas');
  caja.innerHTML = geometria().map((g) => `<i class="${g.negra ? 'n' : 'b'}" style="left:${(g.x / NUM_BLANCAS) * 100}%;width:${(g.ancho / NUM_BLANCAS) * 100}%"></i>`).join('');
}

// ── Orientación ──
const instalada = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
function bloquearHorizontal() {
  if (!instalada()) return;
  try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* no se puede bloquear aquí */ }
}

async function main() {
  siluetaInicio();
  creditos();
  // El motor se importa aquí para poder enseñar el error en pantalla si falta o falla.
  let MotorAudio;
  try {
    ({ MotorAudio } = await import('./audio/motor.js'));
  } catch (e) {
    inicio.error('No se pudo cargar el motor de audio', e?.message ?? String(e));
    $('inicio-boton').disabled = true;
    return;
  }
  const motor = new MotorAudio({ base: './' });

  const teclado = new Teclado($('teclado'), {
    alPulsar(id, nota, expr) {
      const ok = motor.noteOn(id, nota, VELOCIDAD_FIJA, expr);
      panel.nota(ok);
      return ok;
    },
    alSoltar: (id) => motor.noteOff(id),
    alExpresion: (id, v) => motor.setExpression(id, v),
  });
  teclado.setEtiquetasPC(etiquetasPC());

  const soltarTodoUI = () => { teclado.soltarTodo(); pc.olvidar(); };

  const limites = () => limitesOctava(PRESETS[app.preset].rango);
  function ponerOctava(o) {
    const l = limites();
    app.octava = clamp(o, l.min, l.max);
    teclado.setOctava(app.octava);
    controles.octava(app.octava, l);
  }

  const pc = new TecladoPC(teclado, { alOctava: (d) => ponerOctava(app.octava + d) });

  const controles = new Controles({
    menos: $('oct-menos'), mas: $('oct-mas'), octava: $('oct-valor'), tramo: $('oct-tramo'),
    volumen: $('volumen'), volValor: $('vol-valor'), silenciar: $('btn-silenciar'), diag: $('btn-diag'), diagTic: $('diag-tic'),
  }, {
    alOctava: (d) => ponerOctava(app.octava + d),
    alVolumen(v) {
      app.volumen = v;
      guardado.poner('volumen', v.toFixed(2));
      if (app.silenciado) { app.silenciado = false; controles.silenciado(false); }
      if (app.arrancado) motor.setVolumen(v);
    },
    alSilenciar(si) {
      app.silenciado = si;
      controles.silenciado(si);
      if (!app.arrancado) return;
      if (si) { motor.allNotesOff(); soltarTodoUI(); }
      motor.setVolumen(si ? 0 : app.volumen);
    },
    alDiag: () => panel.mostrar(!panel.visible),
  });

  const panel = new PanelDiagnostico($('diag'), {
    motor,
    info: () => ({ preset: app.preset, modo: modoEfectivo(app.preset, app.modo) }),
    alCambiarVisible: (si) => $('btn-diag').classList.toggle('activo', si),
    alTic: (t) => controles.ticDiag(t),
  });

  const selector = new Selector({ instrumento: $('sel-instrumento'), piano: $('sel-piano'), fuente: $('sel-fuente') }, {
    alPreset(p) {
      if (PRESETS[p].instrumento !== PRESETS[app.preset].instrumento) app.octava = PRESETS[p].octavaInicial;
      app.preset = p;
      cambiar();
    },
    alModo(m) {
      app.modo = m;
      guardado.poner('fuente', m);
      cambiar();
    },
  });

  function pintarPreset() {
    selector.pintar({ preset: app.preset, modo: app.modo, ocupado: app.preparando });
    teclado.setPreset(PRESETS[app.preset]);
    ponerOctava(app.octava);
  }

  /**
   * Secuencia segura de cambio de instrumento o de fuente:
   * teclado deshabilitado → todas las notas sueltas → motor.preparar con su estado visible → teclado habilitado.
   * Si llegan varios cambios mientras prepara, gana el último.
   */
  async function cambiar() {
    teclado.habilitar(false);
    pc.olvidar();
    if (app.arrancado) motor.allNotesOff();
    pintarPreset();
    app.deseado = { preset: app.preset, modo: modoEfectivo(app.preset, app.modo) };
    if (!app.arrancado) return { ok: false, error: 'el audio no ha arrancado' };
    if (app.preparando) return { ok: true, encolado: true };
    app.preparando = true;
    let r = { ok: false };
    while (app.deseado) {
      const d = app.deseado;
      app.deseado = null;
      velo.mostrar({ tipo: 'preparando', titulo: 'Preparando', texto: `${nombrePreset(d.preset)} · ${NOMBRE_MODO[d.modo]}` });
      try { r = await motor.preparar(d.preset, d.modo); } catch (e) { r = { ok: false, error: e?.message ?? String(e) }; }
    }
    app.preparando = false;
    if (!r.ok) {
      panel.suceso('error');
      velo.mostrar({
        tipo: 'error', titulo: 'No se pudo preparar', texto: `${nombrePreset(app.preset)} · ${NOMBRE_MODO[modoEfectivo(app.preset, app.modo)]}: ${r.error ?? 'error desconocido'}`,
        boton: { texto: 'Reintentar', accion: () => cambiar() },
      });
      return r;
    }
    velo.ocultar();
    if (!app.avisoActivo) teclado.habilitar(true);
    return r;
  }

  // ── Ciclo de vida ──
  function reanudarAMano() {
    velo.mostrar({ tipo: 'preparando', titulo: 'Reanudando', texto: 'Recuperando el audio…' });
    motor.reanudar().catch(() => {}).finally(() => {
      if (motor.estado === 'listo') { app.avisoActivo = null; velo.ocultar(); teclado.habilitar(!app.preparando); }
      else velo.mostrar({ tipo: 'aviso', titulo: 'Audio en pausa', texto: 'El sistema no deja reanudar todavía.', boton: { texto: 'Reanudar audio', accion: reanudarAMano } });
    });
  }
  const ciclo = iniciarCiclo({
    motor,
    alSoltarTodo: soltarTodoUI,
    alEvento: (t) => panel.suceso(t),
    alAviso(tipo) {
      if (!app.arrancado) return;
      if (tipo === 'interrumpido' || tipo === 'no-reanuda') {
        app.avisoActivo = tipo;
        teclado.habilitar(false);
        velo.mostrar({
          tipo: 'aviso',
          titulo: tipo === 'interrumpido' ? 'Audio interrumpido' : 'Audio en pausa',
          texto: tipo === 'interrumpido' ? 'El sistema ha cortado el audio (una llamada u otra app). Las notas se han soltado.' : 'Toca para reanudar el sonido.',
          boton: { texto: 'Reanudar audio', accion: reanudarAMano },
        });
      } else if (tipo === 'reanudado') {
        if (app.avisoActivo) { app.avisoActivo = null; velo.ocultar(); }
        if (!app.preparando) teclado.habilitar(true);
        avisoBreve('Audio reanudado');
      } else if (tipo === 'salida') {
        avisoBreve('Ha cambiado la salida de audio: notas soltadas');
      }
    },
  });

  motor.onEstado = (estado, detalle) => {
    pintarEstado(esInterrupcion(estado, detalle) ? 'interrupted' : estado);
    ciclo.alEstadoMotor(estado, detalle);
  };

  // ── Arranque (necesita un gesto) ──
  let arrancando = false;
  async function arrancar() {
    if (arrancando) return;
    arrancando = true;
    $('inicio-boton').disabled = true;
    bloquearHorizontal();
    try {
      if (!app.arrancado) {
        inicio.estado('Iniciando el audio…');
        let r;
        try { r = await motor.iniciar(); } catch (e) { r = { ok: false, error: e?.message ?? String(e) }; }
        if (!r?.ok) { inicio.error('No se pudo iniciar el audio', r?.error); return; }
        app.arrancado = true;
        motor.setVolumen(app.silenciado ? 0 : app.volumen);
      }
      inicio.estado(`Preparando ${nombrePreset(app.preset).toLowerCase()} · ${NOMBRE_MODO[modoEfectivo(app.preset, app.modo)]}…`);
      const r = await cambiar();
      if (!r.ok) { velo.ocultar(); inicio.error('No se pudo preparar el instrumento', r.error); return; }
      inicio.ocultar();
    } finally {
      arrancando = false;
    }
  }
  $('inicio').addEventListener('click', arrancar);

  // ── Orientación ──
  const vertical = matchMedia('(orientation: portrait)');
  vertical.addEventListener?.('change', () => { if (vertical.matches) bloquearHorizontal(); });
  if (vertical.matches) bloquearHorizontal();
  $('girar').addEventListener('click', bloquearHorizontal);

  // Ningún menú contextual ni selección en la app (el teclado ya lo impide por su cuenta).
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('textarea')) e.preventDefault(); });

  pintarEstado(motor.estado ?? 'apagado');
  pintarPreset();
  controles.volumen(app.volumen);
  controles.silenciado(false);

  // Puertas para las pruebas automáticas (no cambian nada de la app).
  globalThis.__tecla = { app, teclado, motor, panel, cambiar };
}

main();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
