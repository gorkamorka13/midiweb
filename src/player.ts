import { DEFAULT_SCALE, GATE_RATIO, MAX_STRUMS, OPEN_STRINGS, SCALE_HARMONY, type Mode } from "./guitar";
import { keepHighestNotes, strumLayout, sweepDelay, type Note } from "./logic";

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
}

/** Sortie sonore. `time` est l'heure exacte de l'événement, sur l'horloge donnée à `tick`. */
export interface MidiOut {
  noteOn(pitch: number, velocity: number, time: number): void;
  noteOff(pitch: number, time: number): void;
  setInstrument(program: number): void;
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
 */
export class LivePlayer {
  static readonly LATE_MAX = 0.05; // retard maximal rattrapé pour placer un strum à son heure exacte (s)

  readonly allNotes: Note[];
  readonly melodyNotes: Note[];
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

  constructor(
    notes: Note[],
    private readonly getParams: () => LiveParams,
    private readonly out: MidiOut,
    startTime: number,
  ) {
    this.allNotes = [...notes].sort((a, b) => a.start - b.start);
    this.melodyNotes = keepHighestNotes(this.allNotes);
    this.duration = Math.max(...this.allNotes.map((n) => n.start + n.duration));
    this.last = this.now = startTime;
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
    this.nextNote = bisectRight(this.starts, this.srcTime);
    for (let i = 0; i < this.nextNote; i++) {
      const n = this.notes[i];
      if (n.start + n.duration > this.srcTime) this.active.set(n, { last: null, soundKey: null });
    }
  }

  /** Un pas du moteur à l'heure `now` (s). Renvoie false quand la lecture est terminée. */
  tick(now: number): boolean {
    if (this.finished) return false;
    this.now = now;
    const p = this.getParams();
    const speed = p.speed;
    if (!this.paused) this.srcTime += (now - this.last) * speed;
    this.last = now;
    if (p.program !== this.program) {
      this.program = p.program;
      this.out.setInstrument(p.program);
    }

    // Déplacements demandés par l'interface, et changement du jeu de notes (mélodie seule)
    let resync = false;
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

    const harmonyMap = SCALE_HARMONY[p.scale] ?? SCALE_HARMONY[DEFAULT_SCALE];
    const strums = Math.max(1, Math.min(MAX_STRUMS, p.strums));
    for (const [note, state] of [...this.active]) {
      const pos = srcTime - note.start;
      if (pos >= note.duration) {
        this.active.delete(note);
        continue;
      }

      const slot = note.duration / strums;
      const index = Math.min(Math.trunc(pos / slot), strums - 1);
      const boundary = index * slot;
      const [chord, layout] = strumLayout(note, p.mode, harmonyMap, p.transpose, p.keyShift);
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

      // Nouvelle frappe : coupe ce que cette note faisait encore sonner
      this.silence(now, note);
      const generation = (this.generation.get(note) ?? 0) + 1;
      this.generation.set(note, generation);
      const delay = sweepDelay(p.delayMs, layout.length, slot / speed);
      // Alternance coup vers le bas (Down) / coup vers le haut (Up)
      const up = index % 2 === 1;
      const ordered = up ? [...layout].reverse() : layout;
      const velocity = up ? 80 : 95;
      ordered.forEach(([string, , pitch], i) => {
        const on = tOn + i * delay;
        const off = Math.max(on + 0.03, tOff + i * delay);
        const noteId = this.counter;
        this.heap.push({ time: on, order: noteId, on: true, pitch, velocity, noteId, owner: note, generation, string });
        this.heap.push({
          time: off, order: noteId + 1, on: false, pitch, velocity: 0, noteId, owner: note, generation, string,
        });
        this.counter += 2;
      });

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
