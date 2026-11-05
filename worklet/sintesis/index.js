// Voces de síntesis de Tecla («sonido sintetizado por Claude»).
// Cada voz se crea una vez (todo preasignado) y cumple la interfaz del contrato:
// iniciar / expresion / soltar / cortar / render / activa / nota.
import { VozPianoModerno } from './piano-moderno.js';
import { VozPianoClasico } from './piano-clasico.js';
import { VozViolin } from './violin.js';
import { VozTrompeta } from './trompeta.js';

// Crea una voz preasignada del preset. sr: frecuencia de muestreo.
export function crearVozSintesis(preset, sr) {
  switch (preset) {
    case 'piano-moderno': return new VozPianoModerno(sr);
    case 'piano-clasico': return new VozPianoClasico(sr);
    case 'violin': return new VozViolin(sr);
    case 'trompeta': return new VozTrompeta(sr);
    default: throw new Error(`Preset de síntesis desconocido: ${preset}`);
  }
}
