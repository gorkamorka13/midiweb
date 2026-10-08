import { Soundfont, type StopFn } from "smplr";
import { GUITAR_HIGH, GUITAR_LOW, MAX_TRANSPOSE, OPEN_STRINGS } from "./guitar";
import type { Note } from "./logic";
import { LivePlayer, type Display, type LiveParams, type MidiOut } from "./player";

// Programme General MIDI -> instrument du jeu de sons (échantillons chargés à la première écoute)
const SOUNDFONT_INSTRUMENTS: Record<number, string> = {
  24: "acoustic_guitar_nylon",
  25: "acoustic_guitar_steel",
  0: "acoustic_grand_piano",
};

// Hauteurs que l'application peut jouer : tessiture de la guitare, transposition comprise
const PLAYABLE_NOTES = Array.from(
  { length: GUITAR_HIGH - GUITAR_LOW + 2 * MAX_TRANSPOSE + 1 },
  (_, i) => GUITAR_LOW - MAX_TRANSPOSE + i,
);

type Instrument = ReturnType<typeof Soundfont>;

/**
 * Sortie sonore : remplace le synthétiseur MIDI de Windows par des instruments échantillonnés
 * joués par Web Audio. Le contexte audio est ouvert une seule fois, à la première écoute, puis
 * réutilisé.
 */
export class AudioOutput implements MidiOut {
  readonly context = new AudioContext();
  private instruments = new Map<number, { instrument: Instrument; ready: Promise<void>; loaded: boolean }>();
  private current: Instrument | null = null; // instrument des notes frappées à partir de maintenant
  private wanted: number | null = null;
  private voices = new Map<number, StopFn>(); // hauteur -> arrêt de la note qui sonne
  private nextId = 0;

  private entry(program: number) {
    let entry = this.instruments.get(program);
    if (!entry) {
      const name = SOUNDFONT_INSTRUMENTS[program];
      if (!name) throw new Error(`instrument ${program} inconnu`);
      const instrument = Soundfont(this.context, {
        instrument: name,
        notesToLoad: { notes: PLAYABLE_NOTES, fallback: "nearest" },
      });
      const created = { instrument, loaded: false, ready: Promise.resolve() };
      created.ready = instrument.ready.then(() => {
        created.loaded = true;
      });
      // Un chargement échoué (réseau coupé) sera retenté à la prochaine demande
      created.ready.catch(() => this.instruments.delete(program));
      this.instruments.set(program, (entry = created));
    }
    return entry;
  }

  /** Réveille le contexte audio (à appeler depuis un clic) et attend les échantillons de l'instrument. */
  async prepare(program: number): Promise<void> {
    const resumed = this.context.resume();
    await this.entry(program).ready;
    await resumed;
    this.setInstrument(program);
  }

  setInstrument(program: number): void {
    this.wanted = program;
    const entry = this.entry(program);
    if (entry.loaded) {
      this.current = entry.instrument;
    } else {
      // En attendant ses échantillons, les notes gardent l'instrument précédent
      entry.ready.then(
        () => {
          if (this.wanted === program) this.current = entry.instrument;
        },
        () => {},
      );
    }
  }

  noteOn(pitch: number, velocity: number, time: number): void {
    this.voices.get(pitch)?.(time);
    if (!this.current) return;
    this.voices.set(pitch, this.current.start({ note: pitch, velocity, time, stopId: `n${this.nextId++}` }));
  }

  noteOff(pitch: number, time: number): void {
    this.voices.get(pitch)?.(time);
    this.voices.delete(pitch);
  }
}

/** Avance du moteur sur l'horloge audio (s) : les notes sont programmées à leur heure exacte. */
export const LOOKAHEAD = 0.08;
const TICK_MS = 10;
export const HIT_GLOW = 0.15; // durée (s) pendant laquelle une corde frappée reste allumée

// Le pas vient d'un worker : ses minuteries ne sont pas ralenties quand l'onglet est en arrière-plan
let tickUrl: string | null = null;
function tickWorker(): Worker {
  tickUrl ??= URL.createObjectURL(
    new Blob([`setInterval(() => postMessage(0), ${TICK_MS});`], { type: "text/javascript" }),
  );
  return new Worker(tickUrl);
}

/** Ce que l'interface affiche à un instant donné. */
export interface PlaybackView {
  position: number;
  display: Display | null;
  /** Cordes en train de sonner (frappées depuis moins de HIT_GLOW secondes). */
  lit: boolean[];
  finished: boolean;
}

/**
 * Une lecture : fait tourner le LivePlayer avec LOOKAHEAD secondes d'avance sur l'horloge audio,
 * et rend à l'interface l'état correspondant à ce qu'on entend à l'instant présent.
 */
export class Playback {
  private readonly player: LivePlayer;
  private readonly worker = tickWorker();
  private history: { time: number; position: number; display: Display | null }[] = [];
  private endTime: number | null = null;

  constructor(notes: Note[], getParams: () => LiveParams, private readonly audio: AudioOutput) {
    this.player = new LivePlayer(notes, getParams, audio, this.engineTime());
    this.worker.onmessage = () => this.step();
    this.step();
  }

  private engineTime(): number {
    return this.audio.context.currentTime + LOOKAHEAD;
  }

  private step(): void {
    if (this.player.finished) return;
    const now = this.engineTime();
    const alive = this.player.tick(now);
    this.history.push({ time: now, position: this.player.position, display: this.player.display });
    if (!alive) {
      this.endTime = now;
      this.worker.terminate();
    }
  }

  seek(delta: number): void {
    this.player.seek(delta);
  }

  seekTo(position: number): void {
    this.player.seekTo(position);
  }

  get paused(): boolean {
    return this.player.paused;
  }

  /** Suspend la lecture là où on l'entend, et coupe tout de suite les notes en cours. */
  pause(): void {
    if (this.player.finished || this.player.paused) return;
    const heard = this.view();
    const now = this.audio.context.currentTime;
    this.player.pause(now);
    // Le moteur avait de l'avance : l'écran garde la dernière frappe réellement entendue
    this.player.display = heard.display;
    this.history = [{ time: now, position: this.player.position, display: heard.display }];
  }

  resume(): void {
    this.player.resume(this.engineTime());
  }

  /** Arrête la lecture et coupe tout de suite les notes en cours (et celles déjà programmées). */
  stop(): void {
    this.worker.terminate();
    this.player.stop(this.audio.context.currentTime);
  }

  view(): PlaybackView {
    const now = this.audio.context.currentTime;
    const history = this.history;
    while (history.length > 1 && history[1].time <= now) history.shift();
    const heard = history.length && history[0].time <= now ? history[0] : null;
    const hits = [this.player.stringHits, this.player.previousStringHits];
    return {
      position: heard ? heard.position : 0.0,
      display: heard ? heard.display : null,
      lit: OPEN_STRINGS.map((_, s) => hits.some((h) => now >= h[s] && now - h[s] < HIT_GLOW)),
      finished: this.endTime !== null && now >= this.endTime,
    };
  }
}
