// ==============================================================================
// 2. LOGIQUE DE TRAITEMENT MIDI
// ==============================================================================

import {
  CHORD_FRETS,
  DEFAULT_INSTRUMENT,
  DEFAULT_SCALE,
  GATE_RATIO,
  GUITAR_HIGH,
  GUITAR_LOW,
  INSTRUMENTS,
  KEY_PROFILES,
  MAX_STRUMS,
  OPEN_STRINGS,
  SCALE_HARMONY,
  mod,
  transposedChordName,
  type Key,
  type Mode,
  type Quality,
} from "./guitar";
import { MIDICSV_EXTENSIONS, readMidicsv } from "./midicsv";
import { parseMidi, playbackMessages, writeMidi, type RawMessage } from "./midifile";

/** Note du fichier d'entrée : hauteur MIDI, début et durée en secondes, vélocité. */
export interface Note {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

/** Corde à jouer : corde (0 = Mi grave ... 5 = Mi aigu), case, hauteur MIDI. */
export type StringHit = readonly [string: number, fret: number, pitch: number];

/**
 * Extrait toutes les notes (hauteur, début et durée en secondes, vélocité) d'un fichier MIDI,
 * ou MIDICSV si son extension est .csv ou .txt.
 */
export function analyzeInputMidi(fileName: string, bytes: Uint8Array): Note[] {
  const isCsv = MIDICSV_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
  const mid = isCsv ? readMidicsv(new TextDecoder("utf-8").decode(bytes)) : parseMidi(bytes);
  const notes: Note[] = [];
  const active = new Map<string, { pitch: number; start: number; velocity: number }>(); // canal:note -> début
  let now = 0.0;

  // La lecture fusionne les pistes et gère les changements de tempo
  for (const { seconds, event } of playbackMessages(mid)) {
    now += seconds;
    if (event.kind !== "noteOn" && event.kind !== "noteOff") continue;
    if (event.channel === 9) continue; // canal 10 = percussions : pas des hauteurs de note
    const key = `${event.channel}:${event.note}`;
    if (event.kind === "noteOn" && event.velocity > 0) {
      if (!active.has(key)) active.set(key, { pitch: event.note, start: now, velocity: event.velocity });
    } else {
      const begun = active.get(key);
      if (begun) {
        active.delete(key);
        notes.push({
          pitch: begun.pitch,
          start: begun.start,
          duration: Math.max(0.2, now - begun.start),
          velocity: begun.velocity,
        });
      }
    }
  }

  // Notes jamais terminées : durée par défaut
  for (const { pitch, start, velocity } of active.values()) {
    notes.push({ pitch, start, duration: 0.5, velocity });
  }

  notes.sort((a, b) => a.start - b.start);

  if (!notes.length) {
    // Valeur de secours si le fichier est vide
    return [{ pitch: 60, start: 0.0, duration: 2.0, velocity: 90 }];
  }
  return notes;
}

/** Somme compensée (Neumaier), celle de sum() en Python : les deux versions classent ainsi les
 * tonalités sur des corrélations identiques au bit près. */
function sum(values: number[]): number {
  let total = 0.0;
  let c = 0.0;
  for (const x of values) {
    const t = total + x;
    c += Math.abs(total) >= Math.abs(x) ? total - t + x : x - t + total;
    total = t;
  }
  return c && Number.isFinite(c) ? total + c : total;
}

function correlation(xs: number[], ys: number[]): number {
  const mx = sum(xs) / 12;
  const my = sum(ys) / 12;
  const den = (sum(xs.map((x) => (x - mx) ** 2)) * sum(ys.map((y) => (y - my) ** 2))) ** 0.5;
  return den ? sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / den : 0.0;
}

/**
 * Tonalité la plus probable du morceau : [tonique, « Majeur » ou « mineur »].
 *
 * Le temps passé sur chaque classe de hauteur est comparé au profil de chacune des 24 tonalités.
 */
export function detectKey(notes: Note[]): Key {
  const weights = new Array<number>(12).fill(0.0);
  for (const n of notes) weights[mod(n.pitch, 12)] += n.duration;

  let best: Key = [0, "Majeur"];
  let bestScore = -Infinity;
  for (const quality of Object.keys(KEY_PROFILES) as Quality[]) {
    for (let root = 0; root < 12; root++) {
      const score = correlation([...weights.slice(root), ...weights.slice(0, root)], KEY_PROFILES[quality]);
      if (score > bestScore) {
        best = [root, quality];
        bestScore = score;
      }
    }
  }
  return best;
}

/** Pour les notes simultanées (à `tolerance` secondes près), ne garde que la plus aiguë. */
export function keepHighestNotes(notes: Note[], tolerance = 0.03): Note[] {
  const kept: Note[] = [];
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const last = kept[kept.length - 1];
    if (last && note.start - last.start <= tolerance) {
      if (note.pitch > last.pitch) kept[kept.length - 1] = note;
    } else {
      kept.push(note);
    }
  }
  return kept;
}

/** Ramène une hauteur dans la tessiture de la guitare par sauts d'octave (la note reste la même). */
export function toGuitarRange(pitch: number): number {
  while (pitch < GUITAR_LOW) pitch += 12;
  while (pitch > GUITAR_HIGH) pitch -= 12;
  return pitch;
}

/**
 * [nom de l'accord, [(corde, case, hauteur MIDI)] du grave à l'aigu] pour une note d'entrée.
 *
 * corde : 0 = Mi grave ... 5 = Mi aigu. `keyShift` amène d'abord la note du fichier dans la
 * tonalité choisie ; la transposition décale ensuite les hauteurs sans changer le doigté,
 * comme un capo.
 */
export function strumLayout(
  note: Pick<Note, "pitch">,
  mode: Mode,
  harmonyMap: Record<number, string>,
  transpose = 0,
  keyShift = 0,
): [chordName: string, layout: StringHit[]] {
  let pitch = note.pitch + keyShift;
  const chordName = harmonyMap[mod(pitch, 12)] ?? "Lam";
  if (mode === "accord") {
    const frets = CHORD_FRETS[chordName] ?? CHORD_FRETS["Lam"];
    return [chordName, frets.flatMap((f, s) => (f === null ? [] : [[s, f, OPEN_STRINGS[s] + f + transpose] as const]))];
  }
  pitch = toGuitarRange(pitch);
  let string = 0;
  OPEN_STRINGS.forEach((openPitch, s) => {
    if (openPitch <= pitch) string = s;
  });
  return [chordName, [[string, pitch - OPEN_STRINGS[string], pitch + transpose]]];
}

/**
 * Délai entre deux cordes (s). Le balayage doit tenir dans la moitié du strum,
 * sinon les strums se chevauchent.
 */
export function sweepDelay(strumDelayMs: number, stringsCount: number, strumSlotDuration: number): number {
  if (stringsCount < 2) return 0.0;
  return Math.min(strumDelayMs / 1000.0, (strumSlotDuration * 0.5) / (stringsCount - 1));
}

/**
 * Notes jouées pour une note d'entrée : [nom de l'accord, [(début_sec, fin_sec, hauteur, vélocité)]].
 *
 * Les temps sont relatifs au début de la note, déjà divisés par la vitesse.
 */
export function noteEvents(
  note: Note,
  mode: Mode,
  harmonyMap: Record<number, string>,
  strumsCount: number,
  speedFactor: number,
  strumDelayMs: number,
  transpose = 0,
  keyShift = 0,
): [chordName: string, played: [on: number, off: number, pitch: number, velocity: number][]] {
  const baseDuration = note.duration / speedFactor;
  const [chordName, layout] = strumLayout(note, mode, harmonyMap, transpose, keyShift);
  const notesToPlay = layout.map(([, , pitch]) => pitch);

  // Découpage de la durée par le nombre de strums
  strumsCount = Math.max(1, Math.min(MAX_STRUMS, strumsCount));
  const strumSlotDuration = baseDuration / strumsCount;
  const gateDuration = strumSlotDuration * GATE_RATIO; // articulation légère
  const delaySec = sweepDelay(strumDelayMs, notesToPlay.length, strumSlotDuration);

  const played: [number, number, number, number][] = [];
  for (let s = 0; s < strumsCount; s++) {
    // Alternance coup vers le bas (Down) / coup vers le haut (Up)
    const pitches = s % 2 === 0 ? notesToPlay : [...notesToPlay].reverse();
    const vel = s % 2 === 0 ? 95 : 80;
    const slotStart = s * strumSlotDuration;
    pitches.forEach((p, i) => {
      const on = slotStart + i * delaySec;
      played.push([on, on + gateDuration, p, vel]);
    });
  }
  return [chordName, played];
}

/** Arrondi au plus proche, les demis vers l'entier pair : celui de round() en Python. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest < 0.5) return floor;
  if (rest > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export interface ExportSettings {
  mode: Mode;
  scaleKey: string;
  strumsCount: number;
  speedFactor: number;
  strumDelayMs: number;
  transpose?: number;
  keyShift?: number;
  program?: number;
}

/** Génère un fichier MIDI avec découpage rythmique et accord guitare pour chaque note. */
export function generateProcessedMidi(
  inputNotes: Note[],
  {
    mode,
    scaleKey,
    strumsCount,
    speedFactor,
    strumDelayMs,
    transpose = 0,
    keyShift = 0,
    program = INSTRUMENTS[DEFAULT_INSTRUMENT],
  }: ExportSettings,
): { midi: Uint8Array; chords: string } {
  const ticksPerBeat = 480;
  const bpm = Math.trunc(120 * speedFactor);
  const tempo = roundHalfEven((((60 * 1e6) / bpm) * 4) / 4);
  const track: RawMessage[] = [
    { delta: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] },
    { delta: 0, bytes: [0xc0, program] },
  ];

  const harmonyMap = SCALE_HARMONY[scaleKey] ?? SCALE_HARMONY[DEFAULT_SCALE];
  const played: [on: number, off: number, pitch: number, velocity: number][] = []; // secondes absolues
  const chordsUsed: string[] = [];

  for (const note of inputNotes) {
    const [chordName, evs] = noteEvents(
      note, mode, harmonyMap, strumsCount, speedFactor, strumDelayMs, transpose, keyShift);
    chordsUsed.push(transposedChordName(chordName, transpose));
    const baseStart = note.start / speedFactor;
    for (const [on, off, p, vel] of evs) played.push([baseStart + on, baseStart + off, p, vel]);
  }

  // Une corde rejouée avant la fin de sa note précédente : on coupe l'ancienne à cet instant,
  // sinon son note_off éteindrait la nouvelle note.
  played.sort((a, b) => a[0] - b[0]);
  const lastOnPitch = new Map<number, [number, number, number, number]>();
  for (const n of played) {
    const prev = lastOnPitch.get(n[2]);
    if (prev && prev[1] > n[0]) prev[1] = n[0];
    lastOnPitch.set(n[2], n);
  }

  const events: [time: number, order: number, bytes: number[]][] = []; // (temps, 0=off avant 1=on, message)
  for (const [on, off, p, vel] of played) {
    events.push([on, 1, [0x90, p, vel]]);
    events.push([off, 0, [0x80, p, 0]]);
  }

  // Tri chronologique des événements et conversion en delta ticks
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let lastTick = 0;
  for (const [seconds, , bytes] of events) {
    const targetTick = roundHalfEven(seconds / ((tempo * 1e-6) / ticksPerBeat));
    track.push({ delta: Math.max(0, targetTick - lastTick), bytes });
    lastTick = Math.max(lastTick, targetTick);
  }

  return { midi: writeMidi(1, ticksPerBeat, [track]), chords: [...new Set(chordsUsed)].join(" ") };
}
