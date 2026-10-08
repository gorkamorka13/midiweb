import { AUTO_CHORD, parseChord, type ChordRef } from "./guitar";
import type { MidiData, MidiEvent } from "./midifile";

export const MIDICSV_EXTENSIONS = [".csv", ".txt"];

/**
 * Lignes d'un texte CSV : [numéro de la dernière ligne lue, champs, début et fin de la ligne dans
 * le texte, fin de ligne comprise]. Les espaces qui suivent une virgule sont ignorés et un champ
 * peut être entre guillemets (guillemet doublé = guillemet).
 */
function csvRows(text: string): [line: number, fields: string[], start: number, end: number][] {
  const rows: [number, string[], number, number][] = [];
  let line = 1;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const start = i;
    const fields: string[] = [];
    let empty = true; // ligne sans aucun caractère : aucun champ
    for (;;) {
      while (i < n && text[i] === " ") i++;
      let field = "";
      if (text[i] === '"') {
        empty = false;
        i++;
        for (;;) {
          if (i >= n) break;
          const c = text[i++];
          if (c === '"') {
            if (text[i] !== '"') break;
            field += '"';
            i++;
          } else {
            if (c === "\n" || (c === "\r" && text[i] !== "\n")) line++;
            field += c;
          }
        }
      }
      while (i < n && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
        empty = false;
        field += text[i++];
      }
      fields.push(field);
      if (text[i] !== ",") break;
      empty = false;
      i++;
    }
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    rows.push([line, empty ? [] : fields, start, i]);
    line++;
  }
  return rows;
}

/** Entier écrit comme Python l'accepte dans int() : signe et espaces autour permis. */
function int(text: string | undefined): number {
  if (text === undefined || !/^\s*[+-]?\d+(_\d+)*\s*$/.test(text)) throw new RangeError();
  return Number(text.replace(/_/g, ""));
}

function inRange(value: number, low: number, high: number): number {
  if (value < low || value > high) throw new RangeError();
  return value;
}

/**
 * Reconstruit un fichier MIDI à partir d'un texte MIDICSV (le texte produit par l'outil midicsv).
 *
 * Chaque ligne donne : piste, temps absolu en ticks, type, paramètres. Seuls l'en-tête, les
 * tempos, les chiffrages de mesure, les textes (Text_t, où sont écrits les accords) et les notes
 * sont repris ; les lignes vides et les commentaires (# ou ;) sont ignorés.
 */
export function readMidicsv(text: string): MidiData {
  let fileType: number | null = null;
  let division: number | null = null;
  const events = new Map<number, [tick: number, event: MidiEvent][]>(); // piste -> [(tick, message)]
  const add = (track: number, tick: number, event: MidiEvent) => {
    if (!events.has(track)) events.set(track, []);
    events.get(track)!.push([tick, event]);
  };

  for (const [line, row] of csvRows(text)) {
    if (!row.some((field) => field.trim()) || /^[#;]/.test(row[0].trimStart())) continue;
    try {
      const track = int(row[0]);
      const tick = int(row[1]);
      if (row[2] === undefined) throw new RangeError();
      const kind = row[2].trim().toLowerCase();
      if (tick < 0) throw new RangeError();
      if (kind === "header") {
        const [type, , div] = [int(row[3]), int(row[4]), int(row[5])];
        fileType = type;
        division = div;
      } else if (kind === "tempo") {
        add(track, tick, { delta: 0, kind: "tempo", tempo: inRange(int(row[3]), 0, 0xffffff) });
      } else if (kind === "time_signature") {
        // le dénominateur est écrit en puissance de 2, comme dans le fichier MIDI
        const [numerator, power] = [inRange(int(row[3]), 1, 255), inRange(int(row[4]), 0, 7)];
        add(track, tick, { delta: 0, kind: "timeSignature", numerator, denominator: 2 ** power });
      } else if (kind === "text_t") {
        add(track, tick, { delta: 0, kind: "text", text: row[3] ?? "" });
      } else if (kind === "note_on_c" || kind === "note_off_c") {
        add(track, tick, {
          delta: 0,
          kind: kind === "note_on_c" ? "noteOn" : "noteOff",
          channel: inRange(int(row[3]), 0, 15),
          note: inRange(int(row[4]), 0, 127),
          velocity: inRange(int(row[5]), 0, 127),
        });
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      throw new Error(`ligne ${line} invalide`);
    }
  }

  if (division === null || fileType === null) {
    throw new Error("ligne Header absente, ce n'est pas un fichier MIDICSV");
  }
  if (![0, 1, 2].includes(fileType) || division <= 0) throw new Error("ligne Header invalide");

  const mid: MidiData = { type: fileType, ticksPerBeat: division, tracks: [] };
  for (const track of [...events.keys()].sort((a, b) => a - b)) {
    const midiTrack: MidiEvent[] = [];
    let lastTick = 0;
    // Tri stable : à temps égal, l'ordre du fichier est conservé (note_off avant note_on)
    for (const [tick, event] of events.get(track)!.sort((a, b) => a[0] - b[0])) {
      midiTrack.push({ ...event, delta: tick - lastTick });
      lastTick = tick;
    }
    mid.tracks.push(midiTrack);
  }
  return mid;
}

/**
 * Texte MIDICSV où les accords écrits sont remplacés par `marks` : une ligne Text_t par accord
 * (ou « auto »), le reste du texte recopié tel quel.
 *
 * Chaque accord est écrit dans la première piste qui a une note à cet instant ou après, juste
 * avant la note qui commence à cet instant, sinon avant la première ligne plus tardive : les
 * pistes restent dans l'ordre du temps, Start_track en tête. Un accord placé après la dernière
 * note ne change rien et n'est pas écrit.
 *
 * @param name nom sous lequel écrire un accord
 */
export function writeMidicsvChords(
  text: string,
  marks: readonly { tick: number; chord: ChordRef | null }[],
  name: (chord: ChordRef) => string,
): string {
  const eol = /\r\n|\r|\n/.exec(text)?.[0] ?? "\n";
  const rows: { raw: string; track: number; tick: number; kind: string }[] = [];
  for (const [, fields, start, end] of csvRows(text)) {
    let [track, tick, kind] = [NaN, NaN, ""];
    try {
      [track, tick, kind] = [int(fields[0]), int(fields[1]), (fields[2] ?? "").trim().toLowerCase()];
    } catch (e) {
      if (!(e instanceof RangeError)) throw e; // ligne vide, commentaire ou ligne illisible : recopiée
    }
    if (kind === "text_t" && parseChord(fields[3] ?? "") !== undefined) continue;
    const raw = text.slice(start, end);
    // La dernière ligne du texte peut ne pas être terminée : une ligne écrite avant elle doit l'être
    rows.push({ raw: /[\r\n]$/.test(raw) ? raw : raw + eol, track, tick, kind });
  }

  const added = new Map<number, string[]>(); // rang d'une ligne -> lignes à écrire juste avant
  for (const { tick, chord } of [...marks].sort((a, b) => a.tick - b.tick)) {
    const note = rows.find((row) => row.kind === "note_on_c" && row.tick >= tick);
    if (!note) continue;
    const at = rows.findIndex(
      (row) => row.track === note.track && (row.tick > tick || (row.tick === tick && row.kind === "note_on_c")),
    );
    const line = `${note.track}, ${tick}, Text_t, "${chord ? name(chord) : AUTO_CHORD}"${eol}`;
    added.set(at, [...(added.get(at) ?? []), line]);
  }
  return rows.map((row, i) => (added.get(i) ?? []).join("") + row.raw).join("");
}
