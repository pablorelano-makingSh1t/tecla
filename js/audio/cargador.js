// Carga de bancos grabados: lee el manifiesto, descarga, decodifica y prepara las zonas
// para transferirlas al worklet. Caché por preset de los archivos comprimidos: los
// Float32Array decodificados se transfieren (sin copia), así que se decodifica una vez por
// AudioContext y el worklet conserva el banco en memoria.
import { PRESETS } from '../presets.js';

const CONCURRENCIA = 4;

// Convierte una zona del manifiesto + su AudioBuffer en una zona del contrato.
// El bucle pasa de segundos a fotogramas con buffer.sampleRate.
export function prepararZona(z, buffer) {
  const sr = buffer.sampleRate;
  const canales = [];
  const nc = Math.min(buffer.numberOfChannels, 2);
  for (let c = 0; c < nc; c++) {
    const datos = new Float32Array(buffer.length);
    if (typeof buffer.copyFromChannel === 'function') buffer.copyFromChannel(datos, c);
    else datos.set(buffer.getChannelData(c));
    canales.push(datos);
  }
  let bucle = null;
  if (z.bucle && Number.isFinite(z.bucle.inicio) && Number.isFinite(z.bucle.fin)) {
    const inicio = Math.max(0, Math.round(z.bucle.inicio * sr));
    const fin = Math.min(buffer.length, Math.round(z.bucle.fin * sr));
    if (fin - inicio >= 2) bucle = { inicio, fin };
  }
  return { raiz: z.raiz, desde: z.desde, hasta: z.hasta, sr, canales, bucle, ganancia: z.ganancia ?? 1 };
}

// Notas del rango del preset que ninguna zona cubre (o cubren varias).
export function revisarCobertura(preset, zonas) {
  const [a, b] = PRESETS[preset].rango;
  const avisos = [];
  for (let n = a; n <= b; n++) {
    const k = zonas.filter((z) => n >= z.desde && n <= z.hasta).length;
    if (k !== 1) avisos.push(`${preset}: la nota ${n} está en ${k} zonas`);
  }
  return avisos;
}

export class Cargador {
  // base: URL absoluta de la app (termina en /).
  constructor(base) {
    this.dir = new URL('assets/instrumentos/', base);
    this._manifiesto = null;
    this._comprimidos = new Map();  // preset → Promise<ArrayBuffer[]>
  }

  manifiesto() {
    if (!this._manifiesto) {
      this._manifiesto = fetch(new URL('manifest.json', this.dir))
        .then((r) => {
          if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
          return r.json();
        })
        .catch((e) => { this._manifiesto = null; throw e; });
    }
    return this._manifiesto;
  }

  async datos(preset) {
    const m = await this.manifiesto();
    const p = m && m.presets && m.presets[preset];
    if (!p || !Array.isArray(p.zonas) || p.zonas.length === 0) throw new Error(`No hay muestras de ${preset} en el manifiesto`);
    return p;
  }

  // Descarga los archivos del preset (comprimidos) con concurrencia limitada.
  comprimidos(preset) {
    if (!this._comprimidos.has(preset)) {
      const prom = this.datos(preset).then(async (p) => {
        const res = new Array(p.zonas.length);
        let sig = 0;
        const trabajador = async () => {
          while (sig < p.zonas.length) {
            const i = sig++;
            const url = new URL(p.zonas[i].archivo, this.dir);
            const r = await fetch(url);
            if (!r.ok) throw new Error(`${p.zonas[i].archivo}: HTTP ${r.status}`);
            res[i] = await r.arrayBuffer();
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, p.zonas.length) }, trabajador));
        return res;
      });
      prom.catch(() => this._comprimidos.delete(preset));
      this._comprimidos.set(preset, prom);
    }
    return this._comprimidos.get(preset);
  }

  // Decodifica en ctx y devuelve { zonas, ataque, liberacion, transferibles, avisos }.
  async cargar(preset, ctx) {
    const p = await this.datos(preset);
    const bytes = await this.comprimidos(preset);
    const zonas = [];
    for (let i = 0; i < p.zonas.length; i++) {
      // decodeAudioData desconecta el ArrayBuffer: se le pasa una copia para conservar la caché.
      const buffer = await ctx.decodeAudioData(bytes[i].slice(0));
      zonas.push(prepararZona(p.zonas[i], buffer));
    }
    const transferibles = zonas.flatMap((z) => z.canales.map((c) => c.buffer));
    return {
      zonas,
      ataque: p.ataque ?? 0.002,
      liberacion: p.liberacion ?? 0.2,
      transferibles,
      avisos: revisarCobertura(preset, p.zonas),
    };
  }
}
