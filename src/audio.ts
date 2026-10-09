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

// Les échantillons sont servis avec le site (dossier public/soundfonts), en ogg ou, pour les
// navigateurs qui ne le lisent pas, en mp3
function instrumentUrl(name: string): string {
  const ogg = document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"');
  return `${import.meta.env.BASE_URL}soundfonts/MusyngKite/${name}-${ogg ? "ogg" : "mp3"}.js`;
}

// Hauteurs que l'application peut jouer : tessiture de la guitare, transposition comprise
const PLAYABLE_NOTES = Array.from(
  { length: GUITAR_HIGH - GUITAR_LOW + 2 * MAX_TRANSPOSE + 1 },
  (_, i) => GUITAR_LOW - MAX_TRANSPOSE + i,
);

// Durée (s) de l'extinction d'une note coupée. La bibliothèque prévoit 0,3 s : à plusieurs strums
// par seconde, l'accord précédent s'entendait encore sous les deux suivants.
const RELEASE = 0.1;

type Instrument = ReturnType<typeof Soundfont>;

/**
 * Sortie sonore : remplace le synthétiseur MIDI de Windows par des instruments échantillonnés
 * joués par Web Audio. Le contexte audio est ouvert une seule fois, à la première écoute, puis
 * réutilisé.
 */
export class AudioOutput implements MidiOut {
  readonly context = new AudioContext();
  private readonly master = this.context.createGain(); // volume général
  private instruments = new Map<number, { instrument: Instrument; ready: Promise<void>; loaded: boolean }>();
  private current: Instrument | null = null; // instrument des notes frappées à partir de maintenant
  private wanted: number | null = null;
  private voices = new Map<number, StopFn>(); // hauteur -> arrêt de la note qui sonne
  private lineVoices = new Map<number, StopFn>(); // idem pour la ligne Simple Corde jouée avec les accords
  private nextId = 0;

  /** Sourdine des accords : le métronome reste audible. */
  muted: boolean;

  constructor(volume = 1.0, muted = false) {
    this.muted = muted;
    this.master.gain.value = volume;
    this.master.connect(this.context.destination);
  }

  /** Volume général, de 0 (muet) à 1 (niveau des échantillons). */
  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }

  private entry(program: number) {
    let entry = this.instruments.get(program);
    if (!entry) {
      const name = SOUNDFONT_INSTRUMENTS[program];
      if (!name) throw new Error(`instrument ${program} inconnu`);
      const instrument = Soundfont(this.context, {
        instrumentUrl: instrumentUrl(name),
        destination: this.master,
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
    this.start(this.voices, pitch, velocity, time, this.muted);
  }

  noteOff(pitch: number, time: number): void {
    this.stop(this.voices, pitch, time);
  }

  /**
   * Voie de la ligne Simple Corde, jouée en plus des accords : ses notes ne coupent pas celles des
   * accords (même hauteur) et la sourdine des accords ne la touche pas. Elle garde l'instrument
   * choisi par le moteur principal.
   */
  readonly line: MidiOut = {
    noteOn: (pitch, velocity, time) => this.start(this.lineVoices, pitch, velocity, time, false),
    noteOff: (pitch, time) => this.stop(this.lineVoices, pitch, time),
    setInstrument: () => {},
  };

  private start(voices: Map<number, StopFn>, pitch: number, velocity: number, time: number, muted: boolean): void {
    voices.get(pitch)?.(time);
    if (!this.current || muted) return;
    voices.set(pitch, this.current.start({ note: pitch, velocity, time, ampRelease: RELEASE, stopId: `n${this.nextId++}` }));
  }

  private stop(voices: Map<number, StopFn>, pitch: number, time: number): void {
    voices.get(pitch)?.(time);
    voices.delete(pitch);
  }

  /** Clic de métronome à l'heure `time` : un bip bref, plus aigu et plus fort sur le premier temps. */
  click(accent: boolean, time: number): void {
    const start = Math.max(time, this.context.currentTime);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.04);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + 0.05);
  }

  /** Joue tout de suite une note de la ligne Simple Corde, sans la sourdine des accords. */
  pluckLine(pitch: number, velocity: number, hold: number): void {
    const start = this.context.currentTime + 0.02;
    this.line.noteOn(pitch, velocity, start);
    this.line.noteOff(pitch, start + hold);
  }

  /**
   * Joue tout de suite un accord ou une note (aperçu à l'arrêt) : les cordes se suivent à `delay`
   * secondes d'intervalle et se taisent `hold` secondes après la première.
   */
  strum(pitches: readonly number[], velocity: number, delay: number, hold: number): void {
    const start = this.context.currentTime + 0.02;
    pitches.forEach((pitch, i) => {
      this.noteOn(pitch, velocity, start + i * delay);
      this.noteOff(pitch, start + hold + i * delay);
    });
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
  // Ligne Simple Corde jouée avec les accords : un second moteur sur la même horloge, qui ne
  // tourne que si `wantLine` le demande
  private readonly line: LivePlayer;
  private lineOn = false;
  private readonly worker = tickWorker();
  private history: { time: number; position: number; display: Display | null }[] = [];
  private endTime: number | null = null;

  /**
   * @param position position de départ dans le morceau (s)
   * @param duration durée du morceau, indépendante des pistes choisies
   */
  constructor(
    notes: Note[],
    private readonly getParams: () => LiveParams,
    private readonly audio: AudioOutput,
    private readonly position: number,
    duration: number,
    /** La ligne Simple Corde doit-elle sonner en plus des accords ? */
    private readonly wantLine: () => boolean = () => false,
  ) {
    const start = this.engineTime();
    this.player = new LivePlayer(notes, getParams, audio, start, duration);
    this.line = new LivePlayer(
      notes,
      () => ({ ...getParams(), mode: "corde", melody: true, mono: true, style: null, metronome: false }),
      audio.line,
      start,
      duration,
    );
    this.line.pause(start);
    if (position > 0) this.player.seekTo(position);
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
    this.stepLine(now);
    this.history.push({ time: now, position: this.player.position, display: this.player.display });
    if (!alive) {
      this.line.stop(now);
      this.endTime = now;
      this.worker.terminate();
    }
  }

  /**
   * La ligne Simple Corde suit le moteur principal : elle ne joue que si on la demande, en mode
   * accord et hors pause ; à chaque reprise elle repart de la position du moteur principal.
   */
  private stepLine(now: number): void {
    const wanted = this.wantLine() && this.getParams().mode === "accord" && !this.player.paused;
    if (wanted !== this.lineOn) {
      this.lineOn = wanted;
      if (wanted) {
        this.line.seekTo(this.player.position);
        this.line.resume(now);
      } else {
        this.line.pause(now);
      }
    }
    if (this.lineOn) this.line.tick(now);
  }

  seek(delta: number): void {
    this.player.seek(delta);
    if (this.lineOn) this.line.seek(delta);
  }

  seekTo(position: number): void {
    this.player.seekTo(position);
    if (this.lineOn) this.line.seekTo(position);
  }

  /** Change les notes jouées (choix des pistes) sans interrompre la lecture. */
  setNotes(notes: Note[]): void {
    this.player.setNotes(notes);
    this.line.setNotes(notes);
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
    this.line.pause(now);
    this.lineOn = false;
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
    const now = this.audio.context.currentTime;
    this.player.stop(now);
    this.line.stop(now);
  }

  view(): PlaybackView {
    const now = this.audio.context.currentTime;
    const history = this.history;
    while (history.length > 1 && history[1].time <= now) history.shift();
    const heard = history.length && history[0].time <= now ? history[0] : null;
    const hits = [this.player.stringHits, this.player.previousStringHits, this.line.stringHits, this.line.previousStringHits];
    return {
      position: heard ? heard.position : this.position,
      display: heard ? heard.display : null,
      lit: OPEN_STRINGS.map((_, s) => hits.some((h) => now >= h[s] && now - h[s] < HIT_GLOW)),
      finished: this.endTime !== null && now >= this.endTime,
    };
  }
}
