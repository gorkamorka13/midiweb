// ==============================================================================
// STYLES DE STRUMMING : motifs rythmiques joués sur la grille des temps du morceau
// ==============================================================================
//
// En mode « Classique », chaque note est découpée en N strums : le rythme est celui de la mélodie.
// Un style joue au contraire un motif d'une mesure, croche par croche, sur les temps du morceau ;
// l'accord de chaque coup est celui de la note de mélodie qui sonne à cet instant.

import type { Note, StringHit } from "./logic";

/** Cordes frappées par un coup, parmi celles de l'accord (du grave à l'aigu). */
export type StringSet = "all" | "bass" | "low4" | "high4" | "treble";

/** Un coup du motif. */
export interface StyleStep {
  /** Coup vers le haut (de l'aigu au grave) ; sinon vers le bas. */
  up: boolean;
  strings: StringSet;
  velocity: number;
  /** Durée pendant laquelle les cordes sonnent, en pas (1 = une croche). */
  hold: number;
}

export interface StrumStyle {
  label: string;
  /** Un pas par croche, sur une mesure à 4 temps ; null = silence. */
  steps: (StyleStep | null)[];
  /** Retard des croches à contretemps, en fraction de pas (0 = binaire, 1/3 = ternaire). */
  swing: number;
}

export const STEPS_PER_BEAT = 2;
/** Avance (s) tolérée pour une note qui commence juste après un coup : c'est déjà son accord. */
const CHORD_EARLY = 0.05;
/** Durée (s) d'un blanc de la mélodie au-delà de laquelle le style se tait au lieu de prolonger l'accord. */
const CHORD_GAP_MAX = 1;
/** Nombre de notes précédentes examinées pour savoir si l'une d'elles sonne encore. */
const CHORD_LOOKBACK = 32;

const ACCENT = 112;
const NORMAL = 92;
const SOFT = 74;

const down = (velocity: number, hold: number, strings: StringSet = "all"): StyleStep => ({
  up: false, strings, velocity, hold,
});
const up = (velocity: number, hold: number, strings: StringSet = "high4"): StyleStep => ({
  up: true, strings, velocity, hold,
});

/** Styles proposés, dans l'ordre de la liste déroulante. */
export const STYLES: Record<string, StrumStyle> = {
  // Bas . Bas Haut . Haut Bas Haut : le motif de l'accompagnement à la guitare folk
  feu: {
    label: "Feu de camp",
    steps: [down(ACCENT, 1.8), null, down(NORMAL, 0.9), up(SOFT, 1.8), null, up(SOFT, 0.9), down(NORMAL, 0.9), up(SOFT, 0.9)],
    swing: 0,
  },
  // Bas Haut en croches continues, sur les six cordes dans les deux sens : un va-et-vient régulier
  allerRetour: {
    label: "Va-et-vient",
    steps: [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      i % 2 ? up(SOFT, 0.95, "all") : down(i === 0 ? ACCENT : NORMAL, 0.95),
    ),
    swing: 0,
  },
  // Croches vers le bas sur les cordes graves, notes courtes, accents sur les temps 2 et 4
  rock: {
    label: "Rock",
    steps: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => down(i % 4 === 2 ? ACCENT : NORMAL, 0.7, "bass")),
    swing: 0,
  },
  // Un coup sec par temps sur quatre cordes, accents sur 2 et 4, et une levée ternaire avant la mesure
  jazz: {
    label: "Jazz",
    steps: [
      down(NORMAL, 0.8, "low4"), null, down(ACCENT, 0.8, "low4"), null,
      down(NORMAL, 0.8, "low4"), null, down(ACCENT, 0.8, "low4"), up(SOFT, 0.5, "treble"),
    ],
    swing: 1 / 3,
  },
  // Contretemps seulement : un coup très court sur les cordes aiguës
  reggae: {
    label: "Reggae",
    steps: [null, up(NORMAL, 0.45, "treble"), null, up(ACCENT, 0.45, "treble"), null, up(NORMAL, 0.45, "treble"), null, up(ACCENT, 0.45, "treble")],
    swing: 0,
  },
};

/** Instant (s) du temps numéro `index` : lu dans la grille, prolongée au-delà de sa fin. */
function beatTime(beats: readonly number[], index: number): number {
  const n = beats.length;
  if (index < n) return beats[index];
  const interval = n > 1 && beats[n - 1] > beats[n - 2] ? beats[n - 1] - beats[n - 2] : 0.5;
  return (n ? beats[n - 1] : 0) + (index - Math.max(0, n - 1)) * interval;
}

/** Instant (s du fichier source) et longueur du pas numéro `index` (croches depuis le début). */
export function stepAt(beats: readonly number[], index: number, swing: number): { time: number; length: number } {
  const beat = Math.floor(index / STEPS_PER_BEAT);
  const start = beatTime(beats, beat);
  const length = (beatTime(beats, beat + 1) - start) / STEPS_PER_BEAT;
  return { time: index % STEPS_PER_BEAT ? start + length * (1 + swing) : start, length };
}

/** Numéro du premier pas qui tombe à l'instant `time` ou après. */
export function firstStepFrom(beats: readonly number[], time: number, swing: number): number {
  // Dernier temps commencé (recherche par dichotomie dans la grille, puis au-delà de sa fin)
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (time < beats[mid]) high = mid;
    else low = mid + 1;
  }
  let beat = Math.max(0, low - 1);
  while (beatTime(beats, beat + 1) <= time) beat++;
  let index = beat * STEPS_PER_BEAT;
  while (stepAt(beats, index, swing).time < time - 1e-9) index++;
  return index;
}

/** Pas du motif joué au pas numéro `index` du morceau, pour des mesures de `beatsPerBar` noires. */
export function styleStep(style: StrumStyle, beatsPerBar: number, index: number): StyleStep | null {
  const stepsPerBar = Math.max(1, Math.round(beatsPerBar * STEPS_PER_BEAT));
  return style.steps[(index % stepsPerBar) % style.steps.length];
}

/** Cordes frappées par un coup, dans l'ordre où elles sonnent. */
export function strokeStrings(layout: StringHit[], step: StyleStep): StringHit[] {
  const picked =
    step.strings === "bass" ? layout.slice(0, 3)
    : step.strings === "low4" ? layout.slice(0, 4)
    : step.strings === "high4" ? layout.slice(-4)
    : step.strings === "treble" ? layout.slice(-3)
    : layout;
  return step.up ? [...picked].reverse() : picked;
}

/**
 * Note qui donne l'accord d'un coup joué à l'instant `time` : la dernière commencée. Pendant un
 * court silence de la mélodie, c'est donc l'accord précédent qui continue ; rien avant la
 * première note, ni après la fin de la dernière (`end`), ni quand plus aucune note ne sonne
 * depuis plus de `CHORD_GAP_MAX`.
 *
 * @param notes notes triées par début
 * @param starts leurs débuts
 */
export function chordNoteAt(notes: Note[], starts: number[], end: number, time: number): Note | null {
  if (time >= end) return null;
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (time + CHORD_EARLY < starts[mid]) high = mid;
    else low = mid + 1;
  }
  if (!low) return null;
  for (let i = low - 1; i >= Math.max(0, low - CHORD_LOOKBACK); i--) {
    if (notes[i].start + notes[i].duration + CHORD_GAP_MAX >= time) return notes[low - 1];
  }
  return null;
}
