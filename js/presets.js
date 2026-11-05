// Presets de Tecla: datos compartidos por la interfaz, el motor y los sintetizadores.
// rango: notas MIDI que suenan; las teclas fuera de rango se ven apagadas y no suenan.
// sostenido: la nota se mantiene mientras el dedo esté apoyado y responde a la expresión.
// soloSintesis: no tiene versión grabada (el piano moderno es un sintetizador por naturaleza).
// octavaInicial o: el teclado muestra de C(o) a C(o+2), es decir, MIDI 12*(o+1) … 12*(o+1)+24.

export const PRESETS = {
  'piano-moderno': { instrumento: 'piano', nombre: 'Moderno', rango: [21, 108], sostenido: false, soloSintesis: true, octavaInicial: 3 },
  'piano-clasico': { instrumento: 'piano', nombre: 'Clásico', rango: [21, 108], sostenido: false, soloSintesis: false, octavaInicial: 3 },
  violin: { instrumento: 'violin', nombre: 'Violín', rango: [55, 100], sostenido: true, soloSintesis: false, octavaInicial: 4 },
  trompeta: { instrumento: 'trompeta', nombre: 'Trompeta', rango: [52, 84], sostenido: true, soloSintesis: false, octavaInicial: 4 },
};

export const INSTRUMENTOS = {
  piano: { nombre: 'Piano', presets: ['piano-moderno', 'piano-clasico'] },
  violin: { nombre: 'Violín', presets: ['violin'] },
  trompeta: { nombre: 'Trompeta', presets: ['trompeta'] },
};

// Fuente del sonido: grabaciones reales o síntesis hecha por Claude.
export const MODOS = ['muestras', 'sintesis'];

export const MAX_VOCES = 16;
export const VELOCIDAD_FIJA = 0.8;
export const EXPRESION_INICIAL = 0.6;
export const OCTAVA_MIN = 0;
export const OCTAVA_MAX = 6;

export const frecuencia = (nota) => 440 * 2 ** ((nota - 69) / 12);
export const modoEfectivo = (preset, modo) => (PRESETS[preset].soloSintesis ? 'sintesis' : modo);
