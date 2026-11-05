// Ciclo de vida de Tecla: que nunca quede una nota colgada ni el audio sonando con la app oculta.
// - Página oculta (visibilitychange) o pagehide → allNotesOff y suspender.
// - Vuelve a verse (visibilitychange visible o pageshow) → reanudar, con el estado visible.
// - blur (otra ventana, una notificación, el selector de apps) → allNotesOff.
// - devicechange (auriculares que entran o salen) → allNotesOff.
// - AudioContext 'interrupted' (llamada, otra app con el audio) → aviso en pantalla.

/** ¿El aviso de estado del motor describe una interrupción del sistema? */
export function esInterrupcion(estado, detalle) {
  if (estado === 'interrupted') return true;
  if (detalle === 'interrupted') return true;
  return !!detalle && typeof detalle === 'object' && (detalle.contexto === 'interrupted' || detalle.estado === 'interrupted' || detalle.state === 'interrupted');
}

/**
 * @param {object} o
 * @param {object} o.motor          instancia de MotorAudio
 * @param {() => void} o.alSoltarTodo  la interfaz olvida los contactos (el motor ya hizo allNotesOff)
 * @param {(tipo: string, texto?: string) => void} o.alAviso  'oculta' | 'reanudando' | 'reanudado' | 'no-reanuda' | 'interrumpido' | 'salida'
 * @param {(tipo: string) => void} [o.alEvento]  contador para la sesión de prueba
 */
export function iniciarCiclo({ motor, alSoltarTodo, alAviso, alEvento = () => {} }) {
  const activo = () => motor.estado !== 'apagado' && motor.estado !== 'iniciando';
  let oculta = false;

  const silenciar = () => {
    try { motor.allNotesOff(); } catch { /* motor sin iniciar */ }
    alSoltarTodo();
  };

  const ocultar = async (motivo) => {
    silenciar();
    if (oculta) return;
    oculta = true;
    alEvento(motivo);
    if (!activo()) return;
    alAviso('oculta');
    try { await motor.suspender(); } catch { /* ya estaba suspendido o cerrado */ }
  };

  const volver = async () => {
    if (!oculta) return;
    oculta = false;
    alEvento('vuelta');
    if (!activo()) return;
    alAviso('reanudando');
    try { await motor.reanudar(); } catch { /* lo dice el estado */ }
    // Algunos navegadores piden un gesto para reanudar: la interfaz ofrece un botón.
    alAviso(motor.estado === 'listo' || motor.estado === 'preparando' ? 'reanudado' : 'no-reanuda');
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') ocultar('oculta');
    else volver();
  });
  window.addEventListener('pagehide', () => ocultar('pagehide'));
  window.addEventListener('pageshow', () => { if (document.visibilityState === 'visible') volver(); });
  window.addEventListener('blur', () => { silenciar(); alEvento('blur'); });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    silenciar();
    alEvento('devicechange');
    alAviso('salida');
  });

  return {
    /** Llamar desde motor.onEstado: detecta la interrupción del sistema. */
    alEstadoMotor(estado, detalle) {
      if (esInterrupcion(estado, detalle)) {
        silenciar();
        alEvento('interrupcion');
        alAviso('interrumpido');
      }
    },
    silenciar,
  };
}
