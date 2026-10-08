// ==============================================================================
// 2. LOGIQUE DE TRAITEMENT MIDI
// ==============================================================================

import {
  CHORD_FRETS,
  DEFAULT_INSTRUMENT,
  GATE_RATIO,
  GUITAR_HIGH,
  GUITAR_LOW,
  INSTRUMENTS,
  KEY_PROFILES,
  MAX_STRUMS,
  OPEN_STRINGS,
  chordOf,
  harmonyMap,
  mod,
  parseChord,
  transposedChordName,
  type ChordRef,
  type Key,
  type Mode,
  type Quality,
} from "./guitar";
import { MIDICSV_EXTENSIONS, readMidicsv } from "./midicsv";
import { DEFAULT_TEMPO, parseMidi, playbackMessages, writeMidi, type RawMessage } from "./midifile";
import { chordNoteAt, stepAt, strokeStrings, styleStep, type StrumStyle } from "./styles";

/** Note du fichier d'entrée : hauteur MIDI, début et durée en secondes, vélocité. */
export interface Note {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  /** Piste et canal d'où vient la note (0 = premier). */
  track: number;
  channel: number;
  /** Accord entendu dans le fichier quand la note commence (voir `harmonize`) ; absent : accord de la note. */
  chord?: ChordRef;
  /** Début de la note dans le fichier, en ticks ; absent pour une note qui ne vient pas d'un fichier. */
  tick?: number;
}

/**
 * Accord écrit dans le fichier (ligne Text_t d'un MIDICSV, texte d'un fichier MIDI) ou choisi sur
 * la frise : il vaut pour les notes qui commencent à cet instant ou après, jusqu'à l'accord écrit
 * suivant. `chord` null : retour aux accords calculés.
 */
export interface ChordMark {
  tick: number;
  seconds: number;
  chord: ChordRef | null;
}

/** Ce qui est lu dans un fichier : ses notes (aucune si le fichier n'en contient pas) et le nom de ses pistes. */
export interface MidiInput {
  notes: Note[];
  trackNames: Map<number, string>;
  /** Instant (s) de chaque temps (noire) du morceau, changements de tempo compris. */
  beats: number[];
  /** Noires par mesure, d'après le premier chiffrage de mesure (4 s'il n'y en a pas). */
  beatsPerBar: number;
  /** Tempo au début de la première note, en noires par minute. */
  bpm: number;
  /** Accords écrits dans le fichier, dans l'ordre du temps. */
  chords: ChordMark[];
}

/** Les notes et les noms de piste suffisent à décrire les parties d'un morceau. */
type Tracks = Pick<MidiInput, "notes" | "trackNames">;

/** Grille régulière : un temps toutes les 60 / `bpm` secondes, jusqu'à la fin du morceau. */
export function uniformBeats(bpm: number, end: number): number[] {
  const interval = 60 / bpm;
  const beats: number[] = [];
  for (let i = 0; i * interval <= end + interval; i++) beats.push(i * interval);
  return beats;
}

/** Partie d'un morceau : les notes d'un canal d'une piste. */
export interface Part {
  track: number;
  channel: number;
  name: string;
  count: number;
}

/** Corde à jouer : corde (0 = Mi grave ... 5 = Mi aigu), case, hauteur MIDI. */
export type StringHit = readonly [string: number, fret: number, pitch: number];

/**
 * Extrait toutes les notes (hauteur, début et durée en secondes, vélocité) d'un fichier MIDI,
 * ou MIDICSV si son extension est .csv ou .txt.
 */
export function readMidiInput(fileName: string, bytes: Uint8Array): MidiInput {
  const isCsv = MIDICSV_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
  const mid = isCsv ? readMidicsv(new TextDecoder("utf-8").decode(bytes)) : parseMidi(bytes);
  const notes: Note[] = [];
  type Begun = { pitch: number; start: number; velocity: number; track: number; channel: number; tick: number };
  const active = new Map<string, Begun>(); // canal:note -> début
  const chords: ChordMark[] = [];
  let now = 0.0;
  // Tempos successifs (microsecondes par noire), chacun avec sa position en ticks et en secondes
  const tempos = [{ tick: 0, seconds: 0.0, tempo: DEFAULT_TEMPO }];
  let beatsPerBar: number | null = null;

  // La lecture fusionne les pistes et gère les changements de tempo
  for (const { seconds, event, track, tick } of playbackMessages(mid)) {
    now += seconds;
    if (event.kind === "tempo" && event.tempo > 0) tempos.push({ tick, seconds: now, tempo: event.tempo });
    if (event.kind === "timeSignature" && event.numerator > 0) {
      beatsPerBar ??= (event.numerator * 4) / event.denominator;
    }
    if (event.kind === "text") {
      const chord = parseChord(event.text);
      if (chord !== undefined) {
        if (chords[chords.length - 1]?.tick === tick) chords.pop(); // au même instant, le dernier écrit l'emporte
        chords.push({ tick, seconds: now, chord });
      }
    }
    if (event.kind !== "noteOn" && event.kind !== "noteOff") continue;
    if (event.channel === 9) continue; // canal 10 = percussions : pas des hauteurs de note
    const key = `${event.channel}:${event.note}`;
    if (event.kind === "noteOn" && event.velocity > 0) {
      if (!active.has(key)) {
        active.set(key, { pitch: event.note, start: now, velocity: event.velocity, track, channel: event.channel, tick });
      }
    } else {
      const begun = active.get(key);
      if (begun) {
        active.delete(key);
        notes.push({ ...begun, duration: Math.max(0.2, now - begun.start) });
      }
    }
  }

  // Notes jamais terminées : durée par défaut
  for (const begun of active.values()) notes.push({ ...begun, duration: 0.5 });

  notes.sort((a, b) => a.start - b.start);

  const trackNames = new Map<number, string>();
  mid.tracks.forEach((events, track) => {
    const named = events.find((event) => event.kind === "trackName");
    if (named?.kind === "trackName" && named.name.trim()) trackNames.set(track, named.name.trim());
  });

  // Un temps tous les `ticksPerBeat` ticks, daté avec le tempo en vigueur à cet endroit
  const end = notes.reduce((latest, n) => Math.max(latest, n.start + n.duration), 0);
  const secondsAt = (tick: number, from: number) =>
    tempos[from].seconds + (tick - tempos[from].tick) * ((tempos[from].tempo * 1e-6) / mid.ticksPerBeat);
  const beats: number[] = [];
  let current = 0;
  for (let beat = 0; beat < 200_000; beat++) {
    const tick = beat * mid.ticksPerBeat;
    while (current + 1 < tempos.length && tempos[current + 1].tick <= tick) current++;
    const seconds = secondsAt(tick, current);
    beats.push(seconds);
    if (seconds > end || mid.ticksPerBeat <= 0) break;
  }
  // Tempo de la première note : celui de la dernière valeur lue avant elle
  const first = notes.length ? notes[0].start : 0;
  const tempo = tempos.filter((t) => t.seconds <= first + 1e-9).pop()!.tempo;
  return { notes, trackNames, beats, beatsPerBar: beatsPerBar ?? 4, bpm: 60e6 / tempo, chords };
}

/**
 * Notes d'un fichier comme les lit l'application de bureau : un fichier sans note est remplacé
 * par une note de secours.
 */
export function analyzeInputMidi(fileName: string, bytes: Uint8Array): Note[] {
  const { notes } = readMidiInput(fileName, bytes);
  if (!notes.length) return [{ pitch: 60, start: 0.0, duration: 2.0, velocity: 90, track: 0, channel: 0 }];
  return notes;
}

/** Parties du morceau (une par canal de chaque piste qui a des notes), dans l'ordre des pistes. */
export function listParts({ notes, trackNames }: Tracks): Part[] {
  const parts = new Map<string, Part>();
  for (const { track, channel } of notes) {
    const id = `${track}:${channel}`;
    const part = parts.get(id) ?? { track, channel, name: trackNames.get(track) ?? "", count: 0 };
    part.count++;
    parts.set(id, part);
  }
  return [...parts.values()].sort((a, b) => a.track - b.track || a.channel - b.channel);
}

// Noms de piste qui désignent la mélodie
const MELODY_NAMES = /m[ée]lod|lead|vocal|voice|voix|chant/i;

/**
 * Partie qui porte le plus probablement la mélodie, pour ne jouer qu'elle quand le fichier en a
 * plusieurs : jouées ensemble, elles donnent chacune leurs accords et tout se superpose.
 *
 * On préfère une partie qui joue une note à la fois, pendant la plus grande part du morceau, dans
 * le médium ou l'aigu, sans trop de silences ; un nom de piste explicite l'emporte.
 */
export function guessMelodyPart(input: Tracks): Part | null {
  const duration = input.notes.reduce((end, n) => Math.max(end, n.start + n.duration), 0);
  let best: Part | null = null;
  let bestScore = -Infinity;
  for (const part of listParts(input)) {
    const notes = input.notes.filter((n) => n.track === part.track && n.channel === part.channel);
    let together = 0; // notes frappées en même temps que la précédente : la partie joue des accords
    let pitches = 0;
    notes.forEach((n, i) => {
      pitches += n.pitch;
      if (i && n.start - notes[i - 1].start <= 0.03) together++;
    });
    const last = notes[notes.length - 1];
    const span = last.start + last.duration - notes[0].start;
    const coverage = duration ? Math.min(1, span / duration) : 1;
    const single = 1 - together / notes.length;
    // de 0 pour une basse (La grave, 45) à 1 à partir du La# au-dessus du Do central (70)
    const height = Math.max(0.05, Math.min(1, (pitches / notes.length - 45) / 25));
    const busy = Math.min(1, notes.length / Math.max(1, span)); // au moins une note par seconde
    let score = coverage * single * height * busy;
    if (MELODY_NAMES.test(part.name)) score += 1;
    if (score > bestScore) {
      best = part;
      bestScore = score;
    }
  }
  return best;
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

// Accords reconnus : suffixe et notes (demi-tons depuis la fondamentale), les accords diminués en dernier
const TRIADS: [suffix: string, steps: number[]][] = [["", [0, 4, 7]], ["m", [0, 3, 7]], ["dim", [0, 3, 6]]];

/**
 * Accord formé par des hauteurs qui sonnent ensemble, ou null si moins de deux notes d'un même
 * accord sonnent.
 *
 * L'accord retenu est celui qui contient le plus de ces notes et en laisse le moins de côté ; à
 * égalité, celui dont la fondamentale est la note la plus grave, puis celui dont la fondamentale
 * sonne, puis un accord majeur ou mineur plutôt que diminué.
 */
function chordOfPitches(pitches: number[]): ChordRef | null {
  const bass = mod(Math.min(...pitches), 12);
  const classes = new Set(pitches.map((p) => mod(p, 12)));
  let best: ChordRef | null = null;
  let bestRank: number[] = [];
  for (let root = 0; root < 12; root++) {
    TRIADS.forEach(([suffix, steps], order) => {
      const triad = steps.map((step) => mod(root + step, 12));
      if (triad.filter((c) => classes.has(c)).length < 2) return;
      const inside = pitches.filter((p) => triad.includes(mod(p, 12))).length;
      const rank = [2 * inside - pitches.length, Number(root === bass), Number(classes.has(root)), -order];
      const gap = rank.map((r, i) => r - bestRank[i]).find((d) => d !== 0);
      if (best === null || (gap !== undefined && gap > 0)) {
        best = [root, suffix];
        bestRank = rank;
      }
    });
  }
  return best;
}

/**
 * Copie des notes, chacune avec l'accord entendu dans le fichier quand elle commence : celui que
 * forment toutes les notes qui sonnent à cet instant (à `tolerance` secondes près), quelle que soit
 * leur piste. Une note qui sonne seule n'en reçoit pas.
 */
export function harmonize(notes: Note[], tolerance = 0.03): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const chords = new Map<Note, ChordRef | null>();
  let sounding: Note[] = [];
  let next = 0;
  for (const note of sorted) {
    const time = note.start + tolerance;
    while (next < sorted.length && sorted[next].start <= time) sounding.push(sorted[next++]);
    sounding = sounding.filter((n) => n.start + n.duration > time);
    chords.set(note, sounding.length > 1 ? chordOfPitches(sounding.map((n) => n.pitch)) : null);
  }
  return notes.map((note) => {
    const chord = chords.get(note);
    return chord ? { ...note, chord } : { ...note };
  });
}

/**
 * Les notes avec les accords écrits : chaque note prend l'accord du dernier repère posé à son début
 * ou avant, à la place de l'accord calculé. Sans repère, ou après un retour aux accords calculés,
 * la note est rendue telle quelle.
 *
 * @param marks repères dans l'ordre du temps
 */
export function applyChords(notes: Note[], marks: readonly ChordMark[]): Note[] {
  return notes.map((note) => {
    let low = 0;
    let high = marks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (note.start + 1e-9 < marks[mid].seconds) high = mid;
      else low = mid + 1;
    }
    const chord = low ? marks[low - 1].chord : null;
    return chord ? { ...note, chord } : note;
  });
}

/**
 * Repères après le choix de `chord` (null : accords calculés) de `from` jusqu'à `to`, ou jusqu'à
 * la fin du morceau si `to` est null. Ce qui valait à partir de `to` continue de valoir ; un
 * repère qui répète l'accord déjà en vigueur est retiré.
 *
 * @param marks repères dans l'ordre du temps
 */
export function setChord(
  marks: readonly ChordMark[],
  from: Pick<ChordMark, "tick" | "seconds">,
  to: Pick<ChordMark, "tick" | "seconds"> | null,
  chord: ChordRef | null,
): ChordMark[] {
  const next = marks.filter((m) => m.tick < from.tick || (to !== null && m.tick >= to.tick));
  next.push({ tick: from.tick, seconds: from.seconds, chord });
  if (to !== null && !next.some((m) => m.tick === to.tick)) {
    const before = marks.filter((m) => m.tick < to.tick).pop();
    next.push({ tick: to.tick, seconds: to.seconds, chord: before?.chord ?? null });
  }
  next.sort((a, b) => a.tick - b.tick);
  let current: ChordRef | null = null;
  return next.filter((m) => {
    const same = m.chord?.[0] === current?.[0] && m.chord?.[1] === current?.[1];
    current = m.chord;
    return !same;
  });
}

/**
 * Nom de l'accord d'une note, `keyShift` demi-tons plus haut : l'accord entendu dans le fichier
 * s'il a été reconnu, sinon celui que la grille `harmonyMap` donne à la note.
 */
export function chordNameOf(
  note: Pick<Note, "pitch" | "chord">,
  harmonyMap: Record<number, string>,
  keyShift = 0,
): string {
  if (note.chord) return chordOf(note.chord[0] + keyShift, note.chord[1]);
  return harmonyMap[mod(note.pitch + keyShift, 12)] ?? "Lam";
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
  note: Pick<Note, "pitch" | "chord">,
  mode: Mode,
  harmonyMap: Record<number, string>,
  transpose = 0,
  keyShift = 0,
): [chordName: string, layout: StringHit[]] {
  let pitch = note.pitch + keyShift;
  const chordName = chordNameOf(note, harmonyMap, keyShift);
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
  /** Une note à la fois : une note s'arrête quand la suivante commence. */
  mono?: boolean;
  /** Les notes étrangères à la gamme reçoivent leur propre accord au lieu de l'accord de repli. */
  chromatic?: boolean;
  /** Style de strumming du mode accord, joué sur la grille `beats` ; absent : N strums par note. */
  style?: StrumStyle | null;
  /** Instant (s du fichier source) de chaque temps du morceau. */
  beats?: readonly number[];
  beatsPerBar?: number;
}

/**
 * Coups d'un style sur tout le morceau : [nom de l'accord, [(début_sec, fin_sec, hauteur, vélocité)]]
 * pour chaque coup, en secondes absolues déjà divisées par la vitesse. Un coup coupe le précédent.
 */
export function styleEvents(
  inputNotes: Note[],
  style: StrumStyle,
  beats: readonly number[],
  beatsPerBar: number,
  harmonyMap: Record<number, string>,
  speedFactor: number,
  strumDelayMs: number,
  transpose = 0,
  keyShift = 0,
): [chordName: string, played: [on: number, off: number, pitch: number, velocity: number][]][] {
  const notes = [...inputNotes].sort((a, b) => a.start - b.start);
  const starts = notes.map((n) => n.start);
  const end = notes.reduce((latest, n) => Math.max(latest, n.start + n.duration), 0);
  const strokes: [string, [number, number, number, number][]][] = [];
  for (let index = 0; ; index++) {
    const { time, length } = stepAt(beats, index, style.swing);
    if (time >= end) break;
    const step = styleStep(style, beatsPerBar, index);
    const note = step && chordNoteAt(notes, starts, end, time);
    if (!step || !note) continue;

    const [chordName, layout] = strumLayout(note, "accord", harmonyMap, transpose, keyShift);
    const strings = strokeStrings(layout, step);
    const slot = length / speedFactor;
    const delaySec = sweepDelay(strumDelayMs, strings.length, slot);
    const on = time / speedFactor;
    for (const previous of strokes[strokes.length - 1]?.[1] ?? []) previous[1] = Math.min(previous[1], on);
    strokes.push([
      chordName,
      strings.map(([, , pitch], i) => [on + i * delaySec, on + step.hold * slot + i * delaySec, pitch, step.velocity]),
    ]);
  }
  return strokes;
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
    mono = false,
    chromatic = false,
    style = null,
    beats,
    beatsPerBar = 4,
  }: ExportSettings,
): { midi: Uint8Array<ArrayBuffer>; chords: string } {
  const ticksPerBeat = 480;
  const bpm = Math.trunc(120 * speedFactor);
  const tempo = roundHalfEven((((60 * 1e6) / bpm) * 4) / 4);
  const track: RawMessage[] = [
    { delta: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] },
    { delta: 0, bytes: [0xc0, program] },
  ];

  const harmony = harmonyMap(scaleKey, chromatic);
  const played: [on: number, off: number, pitch: number, velocity: number][] = []; // secondes absolues
  const chordsUsed: string[] = [];

  // Style de strumming : le motif est joué sur les temps du morceau, pas note par note
  const strokes =
    mode === "accord" && style && beats?.length
      ? styleEvents(inputNotes, style, beats, beatsPerBar, harmony, speedFactor, strumDelayMs, transpose, keyShift)
      : null;
  for (const [chordName, evs] of strokes ?? []) {
    chordsUsed.push(transposedChordName(chordName, transpose));
    played.push(...evs);
  }

  // Une note à la fois : chaque note est coupée au début de la suivante (la plus aiguë de celles
  // qui commencent ensemble est la dernière, donc la seule entendue)
  const notes = mono ? [...inputNotes].sort((a, b) => a.start - b.start || a.pitch - b.pitch) : inputNotes;
  (strokes ? [] : notes).forEach((note, i) => {
    const [chordName, evs] = noteEvents(
      note, mode, harmony, strumsCount, speedFactor, strumDelayMs, transpose, keyShift);
    chordsUsed.push(transposedChordName(chordName, transpose));
    const baseStart = note.start / speedFactor;
    const cut = mono && i + 1 < notes.length ? notes[i + 1].start / speedFactor : Infinity;
    for (const [on, off, p, vel] of evs) {
      if (baseStart + on < cut) played.push([baseStart + on, Math.min(baseStart + off, cut), p, vel]);
    }
  });

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
