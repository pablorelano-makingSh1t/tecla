# Licencias de las muestras grabadas de Tecla

Todo lo que hay en `assets/instrumentos/` sale de dos bancos libres. Lo genera
`herramientas/muestras/preparar.py`, que fija las URL, los commits y el SHA de blob de Git de cada
archivo descargado (comprobado al descargar y otra vez al construir). Lo medido en cada archivo final
está en `herramientas/muestras/medidas.json`.

Las licencias se leyeron en origen el 2026-11-05, en los enlaces que se citan.

---

## Piano clásico: Salamander Grand Piano

| | |
|---|---|
| Obra | Salamander Grand Piano (Yamaha C5, grabado a 48 kHz y 24 bits, muestreado cada tercera menor desde el La más grave) |
| Autor | **Alexander Holm** (axeldenstore (at) gmail (dot) com) |
| Licencia | **Creative Commons Attribution 3.0 (CC BY 3.0)**: <https://creativecommons.org/licenses/by/3.0/> |
| Dónde se leyó la licencia | El README que acompaña a la copia descargada: <https://github.com/Tonejs/audio/blob/869b6f8d9cddb47d966238c012041480b1ce517a/salamander/README> («Licence: CC-by http://creativecommons.org/licenses/by/3.0/ — Author: Alexander Holm»). Lo confirma la página de FreePats, que distribuye el original: <https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html> («Author: Alexander Holm … Creative Commons Attribution 3.0 license», versión V3+2020-06-02). |
| Copia descargada | Repositorio `Tonejs/audio` (los audios de los ejemplos de Tone.js), carpeta `salamander/`, commit `869b6f8d9cddb47d966238c012041480b1ce517a`. Los 30 archivos `.ogg`, de A0 a C8, uno por tercera menor (Ogg Vorbis, 44,1 kHz, estéreo, ~160 kbps, de 3,9 a 25 s), en `https://raw.githubusercontent.com/Tonejs/audio/869b6f8d9cddb47d966238c012041480b1ce517a/salamander/<nota>.ogg` |
| Versión | La copia no dice qué capa de velocidad usa. Su README se titula «Salamander Grand Piano V2», pero su registro de cambios llega hasta V3 («Retuned version by Markus Fiedler»). Se eligió esta copia de unos 7 MB en lugar de los paquetes originales de FreePats, que van de 296 MB a 1,18 GB. |

**Qué se modificó:** se decodificó a 48 kHz (soxr), se recortó el silencio inicial (con 2 ms de margen y un fundido de entrada) y se limitó la duración a 5,5 s (o menos, si la nota cae 60 dB antes), con un fundido final de 0,25 s. Se normalizó el pico de cada archivo a 0,7 y la sonoridad entre zonas (RMS con ponderación K de la ITU-R BS.1770, medida en los primeros 0,5 s) se iguala con el campo `ganancia` del manifiesto. Se recodificó a Ogg Opus estéreo a 128 kbps. La afinación no se tocó: la medida queda en `medidas.json`.

**Texto de atribución (CC BY 3.0, lo tiene que mostrar la app, por ejemplo en los créditos):**

> Piano clásico: muestras de «Salamander Grand Piano», de Alexander Holm, con licencia CC BY 3.0
> (https://creativecommons.org/licenses/by/3.0/). Tomadas de la copia de Tone.js
> (https://github.com/Tonejs/audio) y modificadas para Tecla: recortadas, normalizadas y
> recodificadas a Opus.

---

## Violín y trompeta: VS Chamber Orchestra: Community Edition (VSCO-2 CE)

| | |
|---|---|
| Obra | VS Chamber Orchestra: Community Edition (VSCO 2: CE) |
| Autores | **Versilian Studios (Sam Gossner)** e **Ivy Audio (Simon Dalzell)**. «Recorded by Sam Gossner & Simon Dalzell; Sample Cutting by Elan Hickler/Soundemote». |
| Licencia | **CC0 1.0 Universal (dedicación al dominio público)**: <https://creativecommons.org/publicdomain/zero/1.0/> |
| Dónde se leyó la licencia | El archivo LICENSE del propio repositorio: <https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE> (texto completo de «CC0 1.0 Universal»; GitHub lo detecta como `CC0-1.0`). |
| Condiciones adicionales que se piden (no vinculantes con CC0) | El `Readme.txt` del repositorio (<https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Readme.txt>) dice: «You are permitted to use these samples for ANY purpose. We ask that you do not sell the samples directly, and encourage you to keep any work done on improving the sample set open and public. Please provide credit to Versilian Studios/Sam Gossner, and/or Ivy Audio/Simon Dalzell where applicable, and link to the VSCO: CE homepage». Tecla las cumple: no vende las muestras, el proyecto es público y da crédito con el enlace. |
| Repositorio y versión | `sgossner/VSCO-2-CE`, rama `master`, commit `440300901dfe9275fd84e0b7763af1f8443ae62e` (2020-08-05). Página: <http://vis.versilstudios.net/vsco-community.html> |
| Archivos descargados | **Violín:** `Strings/Solo Violin/Arco Vib/LLVln_ArcoVib_<nota>_f.wav`, la capa fuerte (`f`) de G3, A3, C4, E4, G4, A4, C5, E5, G5, A5, C6, E6, G6, A6 y C7 (15 archivos). **Trompeta:** `Brass/Trumpet/sus/Sum_SHTrumpet_sus_<nota>_v3_rr1.wav`, la capa fuerte (`v3`) de F2, A2, C3, D#3, G3, A#3, D4, F4, A4 y C5 (10 archivos). Todos son WAV PCM de 16 bits a 44,1 kHz en estéreo, en `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e/<ruta>`. |
| Notas raíz | Las del `pitch_keycenter` de `SViolinVib.sfz` y `TrumpetSus.sfz` de la rama `SFZ` del mismo repositorio (commit `6dd651d55dde97fd4028699be9d4481f26917891`). Los nombres de la trompeta van una octava por debajo de la notación científica (F2 es la nota MIDI 53). Se comprobó midiendo el f0. |

**Qué se modificó:** se decodificó a 48 kHz (soxr) y se corrigió la afinación por remuestreo cuando se desviaba más de 4 cents (violín: de −41,6 a +16,6 cents; trompeta: −4,7 y +4,9). Se recortó el silencio inicial (con 2 ms de margen y fundido de entrada). Se aplanó la tendencia lenta de nivel del sostenido (un ajuste lineal en dB) para que el bucle no tenga escalón. Cada nota se limitó al ataque más un bucle de sostenido de 0,6 a 1,4 s, buscado por autocorrelación, con el fundido cruzado cocinado en los 0,15 s previos a `fin`: las ganancias se adaptan a la correlación para mantener la potencia. Después de `fin` hay una cola de 0,25 s que repite lo que sigue a `inicio`, con fundido de salida. Se normalizó el pico de cada archivo a 0,7 y la sonoridad entre zonas (ponderación K, medida en el bucle) se iguala con `ganancia`. Se recodificó a Ogg Opus estéreo a 160 kbps.

**Crédito (CC0 no lo exige; lo piden los autores):**

> Violín y trompeta: muestras de «VS Chamber Orchestra: Community Edition», de Versilian Studios
> (Sam Gossner) e Ivy Audio (Simon Dalzell), dominio público CC0 1.0.
> http://vis.versilstudios.net/vsco-community.html — modificadas para Tecla (recorte, bucle,
> afinación, normalización y codificación Opus).

---

## Fuentes que se consideraron y no se usan

- **nbrosowsky/tonejs-instruments** (<https://github.com/nbrosowsky/tonejs-instruments>): su README declara las muestras como CC BY 3.0 y su `sample-source-info.txt` dice que el violín y la trompeta salen de «VSO2». Son derivados reeditados de VSCO, así que se usó directamente el original en CC0.
- **Paquetes originales de Salamander en FreePats**: misma obra y misma licencia, pero pesan de 296 MB a 1,18 GB.
