// ==============================================================================
// 1. BASE DE DONNÉES GUITARE (Voicings 6 cordes & Harmonisation)
// ==============================================================================

export type Notation = "fr" | "en";
export type Quality = "Majeur" | "mineur";
export type Mode = "accord" | "corde";
/** Tonalité détectée ou choisie : [tonique (classe de hauteur, 0 = Do), mode]. */
export type Key = readonly [root: number, quality: Quality];

/** Modulo toujours positif, comme l'opérateur % de Python. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// Accordage, du Mi grave au Mi aigu : E2(40), A2(45), D3(50), G3(55), B3(59), E4(64)
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];

// Accords : [doigté, fondamentale, suffixe]. Le doigté donne une case par corde du Mi grave
// au Mi aigu ('x' = corde non jouée) ; la fondamentale est une classe de hauteur (0 = Do).
export const CHORDS: Record<string, readonly [frets: string, root: number, suffix: string]> = {
  "Lam": ["002210", 9, "m"],
  "Do": ["332010", 0, ""], // Do avec basse Sol
  "Rém": ["x00231", 2, "m"],
  "Mim": ["022000", 4, "m"],
  "Fa": ["133211", 5, ""], // Barré
  "Sol": ["320003", 7, ""],
  "Mi": ["022100", 4, ""],
  "La": ["002220", 9, ""],
  "Ré": ["x00232", 2, ""],
  "Sim": ["224432", 11, "m"],
  "Sidim": ["x2343x", 11, "dim"],
  "Fa#dim": ["xx4212", 6, "dim"],
};

// Case de chaque corde (null = non jouée), et notes MIDI correspondantes du grave à l'aigu
export const CHORD_FRETS: Record<string, (number | null)[]> = Object.fromEntries(
  Object.entries(CHORDS).map(([name, [frets]]) => [name, [...frets].map((c) => (c === "x" ? null : Number(c)))]),
);
export const CHORD_VOICINGS: Record<string, number[]> = Object.fromEntries(
  Object.entries(CHORD_FRETS).map(([name, frets]) => [
    name,
    frets.flatMap((f, s) => (f === null ? [] : [OPEN_STRINGS[s] + f])),
  ]),
);

// Tessiture utilisée en mode simple corde : Mi grave à vide -> 12e case de la chanterelle
export const GUITAR_LOW = 40;
export const GUITAR_HIGH = 76;
export const MAX_STRUMS = 16;
export const MAX_TRANSPOSE = 12; // transposition maximale, en demi-tons, dans chaque sens
export const GATE_RATIO = 0.85; // part du strum pendant laquelle les cordes sonnent
export const SEEK_STEP = 5.0; // saut des boutons retour / avance (secondes du fichier source)

// Sons proposés : nom affiché -> programme General MIDI
export const INSTRUMENTS: Record<string, number> = { "Guitare nylon": 24, "Guitare acier": 25, "Piano": 0 };
export const DEFAULT_INSTRUMENT = "Guitare acier";

export const DEFAULT_SCALE = "La mineur (Lam)";

// Grilles diatoniques par tonalité : [hauteur % 12 -> nom de l'accord]
export const SCALE_HARMONY: Record<string, Record<number, string>> = {
  "La mineur (Lam)": {
    9: "Lam", // La
    11: "Sidim", // Si (Sim contient un Fa#, hors tonalité)
    0: "Do", // Do
    2: "Rém", // Ré
    4: "Mim", // Mi
    5: "Fa", // Fa
    7: "Sol", // Sol
  },
  "Do Majeur (Do)": {
    0: "Do", // Do
    2: "Rém", // Ré
    4: "Mim", // Mi
    5: "Fa", // Fa
    7: "Sol", // Sol
    9: "Lam", // La
    11: "Sidim", // Si
  },
  "Mi mineur (Mim)": {
    4: "Mim",
    6: "Fa#dim",
    7: "Sol",
    9: "Lam",
    11: "Sim",
    0: "Do",
    2: "Ré",
  },
  "Sol Majeur (Sol)": {
    7: "Sol",
    9: "Lam",
    11: "Sim",
    0: "Do",
    2: "Ré",
    4: "Mim",
    6: "Fa#dim",
  },
};

/** Tonalités dans l'ordre de la liste déroulante. */
export const SCALES = Object.keys(SCALE_HARMONY);

// Noms des notes par notation : française (Do Ré Mi) ou anglo-saxonne (C D E)
export const NOTE_NAMES: Record<Notation, string[]> = {
  fr: ["Do", "Do#", "Ré", "Mib", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "Sib", "Si"],
  en: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"],
};

// Tonique et mode de chaque tonalité, pour nommer la tonalité obtenue après transposition
export const SCALE_ROOTS: Record<string, Key> = {
  "La mineur (Lam)": [9, "mineur"],
  "Do Majeur (Do)": [0, "Majeur"],
  "Mi mineur (Mim)": [4, "mineur"],
  "Sol Majeur (Sol)": [7, "Majeur"],
};

// Profils de Krumhansl-Kessler : poids de chaque degré (en demi-tons depuis la tonique) dans une
// tonalité majeure ou mineure, pour reconnaître la tonalité d'un morceau
export const KEY_PROFILES: Record<Quality, number[]> = {
  Majeur: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  mineur: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

export function noteName(pitch: number, notation: Notation = "fr"): string {
  return NOTE_NAMES[notation][mod(pitch, 12)];
}

/** Nom de l'accord réellement entendu une fois transposé (Lam +2 -> Sim, ou Am +2 -> Bm). */
export function transposedChordName(chordName: string, transpose: number, notation: Notation = "fr"): string {
  const [, root, suffix] = CHORDS[chordName];
  return noteName(root + transpose, notation) + suffix;
}

export function keyName(root: number, quality: Quality, notation: Notation = "fr"): string {
  return `${noteName(root, notation)} ${quality}`;
}

export function transposedKeyName(scaleKey: string, transpose: number, notation: Notation = "fr"): string {
  const [root, quality] = SCALE_ROOTS[scaleKey];
  return keyName(root + transpose, quality, notation);
}

/** Libellé d'une tonalité dans la liste déroulante : « La mineur (Lam) » ou « A mineur (Am) ». */
export function scaleLabel(scaleKey: string, notation: Notation = "fr"): string {
  const tonicChord = SCALE_HARMONY[scaleKey][SCALE_ROOTS[scaleKey][0]];
  return `${transposedKeyName(scaleKey, 0, notation)} (${transposedChordName(tonicChord, 0, notation)})`;
}

/**
 * Demi-tons à ajouter aux notes du fichier pour amener sa gamme sur celle de la tonalité choisie.
 *
 * Si l'une est majeure et l'autre mineure, on vise la tonalité relative (mêmes notes) : un morceau
 * en Ré Majeur joué en La mineur est amené en Do Majeur. Le décalage est le plus court (-5 à +6).
 */
export function shiftToKey(fileKey: Key, scaleKey: string): number {
  const [fileRoot, fileQuality] = fileKey;
  let [root] = SCALE_ROOTS[scaleKey];
  const quality = SCALE_ROOTS[scaleKey][1];
  if (fileQuality !== quality) root += quality === "mineur" ? 3 : -3;
  const shift = mod(root - fileRoot, 12);
  return shift > 6 ? shift - 12 : shift;
}
