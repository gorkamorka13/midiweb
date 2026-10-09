import { GATE_RATIO, MAX_STRUMS, OPEN_STRINGS, harmonyMap, type Mode } from "./guitar";
import { keepHighestNotes, strumLayout, sweepDelay, type Note, type StringHit } from "./logic";
import { chordNoteAt, firstStepFrom, stepAt, strokeStrings, styleStep, type StrumStyle } from "./styles";

/** Réglages lus par le moteur à chaque pas. */
export interface LiveParams {
  mode: Mode;
  scale: string;
  speed: number;
  delayMs: number;
  strums: number;
  melody: boolean;
  transpose: number;
  keyShift: number;
  program: number;
  /** Une note à la fois : une nouvelle note arrête la précédente. */
  mono: boolean;
  /** Les notes étrangères à la gamme reçoivent leur propre accord au lieu de l'accord de repli. */
  chromatic: boolean;
  /** Boucle [début, fin] en secondes du fichier source : arrivée à la fin, la lecture repart du début. */
  loop: readonly [start: number, end: number] | null;
  /**
   * Style de strumming du mode accord, joué sur la grille `beats` ; absent : N strums par note,
   * comme l'application de bureau.
   */
  style?: StrumStyle | null;
  /** Instant (s du fichier source) de chaque temps du morceau. */
  beats?: readonly number[];
  /** Noires par mesure (4 par défaut). */
  beatsPerBar?: number;
  /** Un clic sur chaque temps du morceau (le premier de chaque mesure est accentué). */
  metronome?: boolean;
}

/** Sortie sonore. `time` est l'heure exacte de l'événement, sur l'horloge donnée à `tick`. */
export interface MidiOut {
  noteOn(pitch: number, velocity: number, time: number): void;
  noteOff(pitch: number, time: number): void;
  setInstrument(program: number): void;
  /** Clic de métronome ; `accent` : premier temps de la mesure. */
  click?(accent: boolean, time: number): void;
}

/** Dernière frappe, pour l'affichage. */
export interface Display {
  mode: Mode;
  chord: string;
  frets: (number | null)[];
  up: boolean;
  transpose: number;
  pitch: number;
}

interface Scheduled {
  time: number;
  order: number;
  on: boolean;
  pitch: number;
  velocity: number;
  noteId: number;
  owner: Note;
  generation: number;
  string: number;
}

/** File d'événements triée par heure, puis par ordre de création. */
class EventHeap {
  private items: Scheduled[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): Scheduled | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items = [];
  }

  private before(a: Scheduled, b: Scheduled): boolean {
    return a.time < b.time || (a.time === b.time && a.order < b.order);
  }

  push(item: Scheduled): void {
    const items = this.items;
    let i = items.length;
    items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(item, items[parent])) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = item;
  }

  pop(): Scheduled {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && this.before(items[child + 1], items[child])) child++;
        if (!this.before(items[child], last)) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}

function bisectRight(values: number[], x: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (x < values[mid]) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Lecture temps réel, pilotée par une horloge « source » (position dans le fichier) qui avance
 * à la vitesse courante. Chaque strum est décidé au moment où il est joué, à partir des réglages
 * lus via `getParams` : tous les réglages agissent donc pendant la lecture.
 *
 * - vitesse : en continu ; nombre de strums et balayage : dès le strum suivant ;
 * - mode, tonalité (si elle change ce qui sonne), transposition, mélodie seule : immédiatement
 *   (la note en cours est rejouée).
 *
 * Le moteur n'a pas d'horloge propre : l'appelant lui donne l'heure à chaque pas (`tick`), ce qui
 * permet de le faire tourner en avance sur l'horloge audio, ou sur une horloge simulée.
 *
 * Pour l'affichage, `display` décrit la dernière frappe et `stringHits` donne l'heure à laquelle
 * chaque corde a sonné pour la dernière fois (`previousStringHits` : la fois d'avant).
 *
 * En pause, les pas continuent : la position ne bouge plus que par déplacement et rien n'est
 * frappé. À la reprise, la note qui se trouve sous la position est rejouée.
 *
 * Avec un style de strumming, les coups ne suivent plus les notes mais le motif du style, posé
 * sur les temps du morceau : chaque coup joue l'accord de la note qui sonne à cet instant, et
 * coupe le coup précédent. Un réglage modifié s'entend au coup suivant.
 */
export class LivePlayer {
  static readonly LATE_MAX = 0.05; // retard maximal rattrapé pour placer un strum à son heure exacte (s)
  static readonly STALE = 0.25; // retard (s) au-delà duquel un coup de style n'est plus joué

  private allNotes: Note[] = [];
  private melodyNotes: Note[] = [];
  readonly duration: number;
  currentChord = "";
  position = 0.0; // position dans le fichier source (s), lue par l'interface
  display: Display | null = null;
  stringHits: number[] = OPEN_STRINGS.map(() => -Infinity);
  previousStringHits: number[] = OPEN_STRINGS.map(() => -Infinity);
  finished = false;
  paused = false;
  /** Heure du dernier pas. */
  now = 0.0;

  private seeks: ["rel" | "abs", number][] = []; // demandes de déplacement
  private sounding = new Map<number, { noteId: number; owner: Note }>(); // hauteur -> note qui sonne
  private heap = new EventHeap();
  // propriétaire -> numéro de sa dernière frappe (annule les 'on' des frappes remplacées)
  private generation = new Map<Note, number>();
  // note d'entrée -> début du dernier strum joué, (mode, accord) joué
  private active = new Map<Note, { last: number | null; soundKey: string | null }>();
  private counter = 0;
  private notes: Note[] = [];
  private starts: number[] = [];
  private melody: boolean | null = null;
  private program: number | null = null;
  private nextNote = 0;
  private srcTime = 0.0;
  private last: number;
  // Styles de strumming : style et grille en cours, prochain pas du motif (null = à recalculer),
  // fin de la dernière note, et propriétaire fictif des coups (un coup coupe le précédent)
  private style: StrumStyle | null = null;
  private beats: readonly number[] | undefined;
  private step: number | null = null;
  private notesEnd = 0.0;
  private readonly styleOwner: Note = { pitch: 0, start: 0, duration: 0, velocity: 0, track: -1, channel: -1 };

  constructor(
    notes: Note[],
    private readonly getParams: () => LiveParams,
    private readonly out: MidiOut,
    startTime: number,
    /** Durée du morceau ; par défaut, la fin de la dernière note. */
    duration?: number,
  ) {
    this.setNotes(notes);
    this.duration = duration ?? Math.max(0, ...this.allNotes.map((n) => n.start + n.duration));
    this.last = this.now = startTime;
  }

  /** Change les notes jouées (choix des pistes) ; la lecture continue à la même position. */
  setNotes(notes: Note[]): void {
    this.allNotes = [...notes].sort((a, b) => a.start - b.start);
    this.melodyNotes = keepHighestNotes(this.allNotes);
    this.melody = null; // le prochain pas reprend le nouveau jeu de notes
  }

  /** Avance (delta > 0) ou recule (delta < 0) dans le fichier source. */
  seek(delta: number): void {
    this.seeks.push(["rel", delta]);
  }

  seekTo(position: number): void {
    this.seeks.push(["abs", position]);
  }

  /**
   * Suspend la lecture à l'heure `now` : tout est coupé et la position est celle de cet instant.
   * `now` peut précéder le dernier pas (moteur en avance sur ce qu'on entend) : la position
   * recule d'autant, et les frappes programmées après `now` sont oubliées.
   */
  pause(now: number): void {
    if (this.finished || this.paused) return;
    this.srcTime = Math.max(0.0, this.srcTime + (now - this.last) * this.getParams().speed);
    this.last = this.now = now;
    this.paused = true;
    this.resync(now);
    this.position = this.srcTime;
    for (const hits of [this.stringHits, this.previousStringHits]) {
      hits.forEach((time, string) => {
        if (time > now) hits[string] = -Infinity;
      });
    }
  }

  /** Reprend la lecture à l'heure `now`, là où elle a été suspendue. */
  resume(now: number): void {
    if (!this.paused) return;
    this.paused = false;
    this.last = now;
  }

  /** Arrête la lecture et coupe les notes en cours. */
  stop(now: number): void {
    if (this.finished) return;
    this.now = now;
    this.silence(now);
    this.finished = true;
  }

  private silence(now: number, owner?: Note): void {
    for (const [pitch, sounding] of [...this.sounding]) {
      if (owner === undefined || sounding.owner === owner) {
        this.out.noteOff(pitch, now);
        this.sounding.delete(pitch);
      }
    }
  }

  /** Repart de la position courante : tout est coupé, les notes en cours seront rejouées. */
  private resync(now: number): void {
    this.silence(now);
    this.heap.clear();
    this.generation.clear();
    this.active.clear();
    this.step = null;
    this.nextNote = bisectRight(this.starts, this.srcTime);
    for (let i = 0; i < this.nextNote; i++) {
      const n = this.notes[i];
      if (n.start + n.duration > this.srcTime) this.active.set(n, { last: null, soundKey: null });
    }
  }

  /**
   * Programme une frappe : les cordes de `strings` sonnent l'une après l'autre, à `delay` secondes
   * d'intervalle, de `tOn` à `tOff`. Elle coupe ce que `owner` faisait encore sonner.
   */
  private strike(
    owner: Note, strings: StringHit[], tOn: number, tOff: number, delay: number, velocity: number, now: number,
  ): void {
    this.silence(now, owner);
    const generation = (this.generation.get(owner) ?? 0) + 1;
    this.generation.set(owner, generation);
    strings.forEach(([string, , pitch], i) => {
      const on = tOn + i * delay;
      const off = Math.max(on + 0.03, tOff + i * delay);
      const noteId = this.counter;
      this.heap.push({ time: on, order: noteId, on: true, pitch, velocity, noteId, owner, generation, string });
      this.heap.push({ time: off, order: noteId + 1, on: false, pitch, velocity: 0, noteId, owner, generation, string });
      this.counter += 2;
    });
  }

  /** Joue les coups du style échus depuis le dernier pas du moteur. */
  private strumStyle(style: StrumStyle, p: LiveParams, now: number): void {
    const beats = p.beats!;
    this.step ??= firstStepFrom(beats, this.srcTime, style.swing);
    const harmony = harmonyMap(p.scale, p.chromatic);
    for (;;) {
      const { time, length } = stepAt(beats, this.step, style.swing);
      if (time > this.srcTime || length <= 0) break;
      const step = styleStep(style, p.beatsPerBar ?? 4, this.step);
      this.step++;
      const late = (this.srcTime - time) / p.speed;
      const note = step && late <= LivePlayer.STALE ? chordNoteAt(this.notes, this.starts, this.notesEnd, time) : null;
      if (!step || !note) continue;

      const [chord, layout] = strumLayout(note, "accord", harmony, p.transpose, p.keyShift);
      const strings = strokeStrings(layout, step);
      const slot = length / p.speed; // durée réelle d'une croche
      const tOn = late <= LivePlayer.LATE_MAX ? now - late : now;
      const delay = sweepDelay(p.delayMs, strings.length, slot);
      this.strike(this.styleOwner, strings, tOn, now - late + step.hold * slot, delay, step.velocity, now);

      this.currentChord = chord;
      const frets: (number | null)[] = OPEN_STRINGS.map(() => null);
      for (const [string, fret] of layout) frets[string] = fret;
      this.display = { mode: "accord", chord, frets, up: step.up, transpose: p.transpose, pitch: layout[0][2] };
    }
  }

  /** Un pas du moteur à l'heure `now` (s). Renvoie false quand la lecture est terminée. */
  tick(now: number): boolean {
    if (this.finished) return false;
    this.now = now;
    const p = this.getParams();
    const speed = p.speed;
    const before = this.srcTime;
    if (!this.paused) this.srcTime += (now - this.last) * speed;
    this.last = now;
    if (p.program !== this.program) {
      this.program = p.program;
      this.out.setInstrument(p.program);
    }

    // Boucle : la fin vient d'être franchie, on repart du début
    let resync = false;
    if (p.loop && before < p.loop[1] && this.srcTime >= p.loop[1]) {
      this.srcTime = Math.max(0.0, p.loop[0]);
      resync = true;
    }

    // Déplacements demandés par l'interface, et changement du jeu de notes (mélodie seule)
    const seeks = this.seeks;
    this.seeks = [];
    for (const [kind, value] of seeks) {
      this.srcTime = Math.min(this.duration, Math.max(0.0, kind === "abs" ? value : this.srcTime + value));
      resync = true;
    }
    if (p.melody !== this.melody) {
      this.melody = p.melody;
      this.notes = p.melody ? this.melodyNotes : this.allNotes;
      this.starts = this.notes.map((n) => n.start);
      this.notesEnd = this.notes.reduce((end, n) => Math.max(end, n.start + n.duration), 0);
      resync = true;
    }
    // Passage d'un style à l'autre, ou au découpage par note : on repart de la position courante
    const style = p.mode === "accord" && p.style && p.beats?.length ? p.style : null;
    if (style !== this.style || (style && p.beats !== this.beats)) {
      this.style = style;
      this.beats = p.beats;
      resync = true;
    }
    if (resync) this.resync(now);
    const srcTime = this.srcTime;
    this.position = srcTime;

    while (this.nextNote < this.notes.length && this.starts[this.nextNote] <= srcTime) {
      this.active.set(this.notes[this.nextNote], { last: null, soundKey: null });
      this.nextNote++;
    }
    if (seeks.length && (this.paused || !this.active.size)) {
      // arrivée dans un silence, ou déplacement en pause : la frappe d'avant n'est plus affichée
      this.display = null;
    }
    if (this.paused) return true;

    // Métronome : les temps franchis depuis le dernier pas, à leur heure exacte. Après un
    // déplacement ou un saut de boucle, on ne rattrape rien.
    if (p.metronome && p.beats && !resync) {
      const beats = p.beats as number[];
      for (let i = bisectRight(beats, before); i < beats.length && beats[i] <= srcTime; i++) {
        const late = (srcTime - beats[i]) / speed;
        if (late <= LivePlayer.LATE_MAX) this.out.click?.(i % (p.beatsPerBar ?? 4) === 0, now - late);
      }
    }

    if (style) {
      this.active.clear(); // les coups suivent le motif, pas les notes
      this.strumStyle(style, p, now);
    } else if (p.mono && this.active.size > 1) {
      // Une note à la fois : seule la dernière commencée reste (la plus aiguë, si elles commencent ensemble)
      let kept: Note | null = null;
      for (const n of this.active.keys()) {
        if (!kept || n.start > kept.start || (n.start === kept.start && n.pitch > kept.pitch)) kept = n;
      }
      for (const n of [...this.active.keys()]) {
        if (n === kept) continue;
        this.silence(now, n);
        this.generation.set(n, (this.generation.get(n) ?? 0) + 1); // annule ses frappes en attente
        this.active.delete(n);
      }
    }

    const harmony = harmonyMap(p.scale, p.chromatic);
    const strums = Math.max(1, Math.min(MAX_STRUMS, p.strums));
    for (const [note, state] of style ? [] : [...this.active]) {
      const pos = srcTime - note.start;
      if (pos >= note.duration) {
        this.active.delete(note);
        continue;
      }

      const slot = note.duration / strums;
      const index = Math.min(Math.trunc(pos / slot), strums - 1);
      const boundary = index * slot;
      const [chord, layout] = strumLayout(note, p.mode, harmony, p.transpose, p.keyShift);
      const soundKey = `${p.mode}|${p.mode === "accord" ? chord : p.keyShift}|${p.transpose}`;

      const newStrum = state.last === null || boundary > state.last + 1e-9;
      if (!newStrum && soundKey === state.soundKey) continue; // ce strum est déjà joué avec ces réglages

      // Heure exacte du début du strum (le pas le détecte avec un léger retard).
      // Après un déplacement ou un changement de mode, on frappe tout de suite.
      const late = (pos - boundary) / speed;
      const tOn = newStrum && late <= LivePlayer.LATE_MAX ? now - late : now;
      const tOff = now - late + (slot * GATE_RATIO) / speed;
      state.last = boundary;
      state.soundKey = soundKey;
      this.currentChord = chord;

      const delay = sweepDelay(p.delayMs, layout.length, slot / speed);
      // Alternance coup vers le bas (Down) / coup vers le haut (Up)
      const up = index % 2 === 1;
      this.strike(note, up ? [...layout].reverse() : layout, tOn, tOff, delay, up ? 80 : 95, now);

      const frets: (number | null)[] = OPEN_STRINGS.map(() => null);
      for (const [string, fret] of layout) frets[string] = fret;
      this.display = { mode: p.mode, chord, frets, up, transpose: p.transpose, pitch: layout[0][2] };
    }

    // Envoie les événements échus
    while (this.heap.size && this.heap.peek()!.time <= now) {
      const e = this.heap.pop();
      if (e.on) {
        if (this.generation.get(e.owner) !== e.generation) continue; // frappe remplacée entre-temps
        if (this.sounding.has(e.pitch)) this.out.noteOff(e.pitch, e.time); // corde rejouée : coupe l'ancienne note
        this.out.noteOn(e.pitch, e.velocity, e.time);
        this.sounding.set(e.pitch, { noteId: e.noteId, owner: e.owner });
        this.previousStringHits[e.string] = this.stringHits[e.string];
        this.stringHits[e.string] = e.time;
      } else if (this.sounding.get(e.pitch)?.noteId === e.noteId) {
        // (un note_off périmé, d'une note déjà rejouée, est ignoré)
        this.out.noteOff(e.pitch, e.time);
        this.sounding.delete(e.pitch);
      }
    }

    if (srcTime >= this.duration && !this.heap.size) {
      this.silence(now);
      this.finished = true;
      return false;
    }
    return true;
  }
}
