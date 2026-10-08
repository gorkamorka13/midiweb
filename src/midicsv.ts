import type { MidiData, MidiEvent } from "./midifile";

export const MIDICSV_EXTENSIONS = [".csv", ".txt"];

/**
 * Lignes d'un texte CSV : [numéro de la dernière ligne lue, champs]. Les espaces qui suivent une
 * virgule sont ignorés et un champ peut être entre guillemets (guillemet doublé = guillemet).
 */
function csvRows(text: string): [line: number, fields: string[]][] {
  const rows: [number, string[]][] = [];
  let line = 1;
  let i = 0;
  const n = text.length;
  while (i < n) {
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
    rows.push([line, empty ? [] : fields]);
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
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
 * tempos et les notes sont repris ; les lignes vides et les commentaires (# ou ;) sont ignorés.
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
