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

// Noms des notes par notation : française (Do Ré Mi) ou anglo-saxonne (C D E)
export const NOTE_NAMES: Record<Notation, string[]> = {
  fr: ["Do", "Do#", "Ré", "Mib", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "Sib", "Si"],
  en: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"],
};

// Accords : [doigté, fondamentale, suffixe]. Le doigté donne une case par corde du Mi grave
// au Mi aigu ('x' = corde non jouée) ; la fondamentale est une classe de hauteur (0 = Do).
// Un accord majeur, un mineur et un diminué par note : les positions ouvertes quand elles
// existent, des barrés sinon.
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

  "Do#": ["x46664", 1, ""],
  "Mib": ["x68886", 3, ""],
  "Fa#": ["244322", 6, ""],
  "Sol#": ["466544", 8, ""],
  "Sib": ["x13331", 10, ""],
  "Si": ["x24442", 11, ""],

  "Dom": ["x35543", 0, "m"],
  "Do#m": ["x46654", 1, "m"],
  "Mibm": ["x68876", 3, "m"],
  "Fam": ["133111", 5, "m"],
  "Fa#m": ["244222", 6, "m"],
  "Solm": ["355333", 7, "m"],
  "Sol#m": ["466444", 8, "m"],
  "Sibm": ["x13321", 10, "m"],

  "Dodim": ["x3454x", 0, "dim"],
  "Do#dim": ["x4565x", 1, "dim"],
  "Rédim": ["xx0131", 2, "dim"],
  "Mibdim": ["xx1242", 3, "dim"],
  "Midim": ["x7898x", 4, "dim"],
  "Fadim": ["xx3101", 5, "dim"],
  "Soldim": ["xx5323", 7, "dim"],
  "Sol#dim": ["xx6434", 8, "dim"],
  "Ladim": ["xx7545", 9, "dim"],
  "Sibdim": ["xx8656", 10, "dim"],
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

/** Nom (français) de l'accord d'une fondamentale et d'un suffixe : clé de CHORDS. */
function chordOf(root: number, suffix: string): string {
  return NOTE_NAMES.fr[mod(root, 12)] + suffix;
}

// Degrés d'une gamme (demi-tons depuis la tonique) et accord porté par chacun
const DEGREES: Record<Quality, [step: number, suffix: string][]> = {
  Majeur: [[0, ""], [2, "m"], [4, "m"], [5, ""], [7, ""], [9, "m"], [11, "dim"]],
  mineur: [[0, "m"], [2, "dim"], [3, ""], [5, "m"], [7, "m"], [8, ""], [10, ""]],
};

// Notes étrangères à la gamme, en demi-tons depuis la tonique de la gamme majeure, et accord
// majeur qui les contient (fondamentale en demi-tons depuis cette même tonique) : la dominante
// du degré voisin quand la note en est la sensible, un accord emprunté au mineur sinon.
// En Do Majeur : Do# -> La, Mib -> Mib, Fa# -> Ré, Sol# -> Mi, Sib -> Sib.
const CHROMATIC_CHORDS: [step: number, root: number][] = [[1, 9], [3, 3], [6, 2], [8, 4], [10, 10]];

// Les 24 tonalités, dans l'ordre de la liste déroulante : le cycle des quintes, chaque tonalité
// majeure suivie de sa relative mineure
const KEYS: Key[] = Array.from({ length: 12 }, (_, i): Key[] => [
  [mod(7 * i, 12), "Majeur"],
  [mod(7 * i + 9, 12), "mineur"],
]).flat();

function scaleId([root, quality]: Key): string {
  return `${NOTE_NAMES.fr[root]} ${quality} (${chordOf(root, DEGREES[quality][0][1])})`;
}

// Tonique et mode de chaque tonalité, pour nommer la tonalité obtenue après transposition
export const SCALE_ROOTS: Record<string, Key> = Object.fromEntries(KEYS.map((key) => [scaleId(key), key]));

/** Tonalités dans l'ordre de la liste déroulante. */
export const SCALES = Object.keys(SCALE_ROOTS);

// Grilles diatoniques par tonalité : [hauteur % 12 -> nom de l'accord]. Les notes étrangères à
// la gamme n'y figurent pas.
export const SCALE_HARMONY: Record<string, Record<number, string>> = Object.fromEntries(
  KEYS.map(([root, quality]) => [
    scaleId([root, quality]),
    Object.fromEntries(DEGREES[quality].map(([step, suffix]) => [mod(root + step, 12), chordOf(root + step, suffix)])),
  ]),
);

// Grilles complètes : les sept notes de la gamme, plus un accord pour chacune des cinq autres
export const FULL_HARMONY: Record<string, Record<number, string>> = Object.fromEntries(
  KEYS.map(([root, quality]) => {
    const major = quality === "Majeur" ? root : root + 3; // tonique de la gamme majeure (relative)
    const id = scaleId([root, quality]);
    const chromatic = CHROMATIC_CHORDS.map(([step, chordRoot]) => [mod(major + step, 12), chordOf(major + chordRoot, "")]);
    return [id, { ...Object.fromEntries(chromatic), ...SCALE_HARMONY[id] }];
  }),
);

/**
 * Grille d'une tonalité. `chromatic` : avec un accord pour les notes étrangères à la gamme ;
 * sinon elles reçoivent l'accord de repli (Lam), comme dans l'application de bureau.
 */
export function harmonyMap(scaleKey: string, chromatic: boolean): Record<number, string> {
  const maps = chromatic ? FULL_HARMONY : SCALE_HARMONY;
  return maps[scaleKey] ?? maps[DEFAULT_SCALE];
}

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
