import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chordOf, parseChord } from "../src/guitar";
import { applyChords, harmonize, listParts, readMidiInput, setChord, smoothChords, type ChordMark, type Note } from "../src/logic";
import { writeMidicsvChords } from "../src/midicsv";
import { writeMidi } from "../src/midifile";

const read = (csv: string) => readMidiInput("song.csv", new TextEncoder().encode(csv));
const name = ([root, suffix]: readonly [number, string]) => chordOf(root, suffix);
const marksOf = (csv: string) => read(csv).chords.map((m) => [m.tick, m.chord]);

// Quatre noires à 120 puis 240 à la noire, des accords écrits sur la première et la troisième
const SONG = [
  "0, 0, Header, 1, 2, 480",
  "1, 0, Start_track",
  "1, 0, Tempo, 500000",
  '1, 0, Marker_t, "Sol"',
  "1, 960, Tempo, 250000",
  "1, 1920, End_track",
  "2, 0, Start_track",
  '2, 0, Text_t, "Lam"',
  "2, 0, Note_on_c, 0, 60, 90",
  "2, 480, Note_off_c, 0, 60, 0",
  '2, 480, Text_t, "couplet"',
  "2, 480, Note_on_c, 0, 62, 90",
  "2, 960, Note_off_c, 0, 62, 0",
  '2, 960, Text_t, "F"',
  "2, 960, Note_on_c, 0, 64, 90",
  "2, 1440, Note_off_c, 0, 64, 0",
  "2, 1440, Note_on_c, 0, 65, 90",
  "2, 1920, Note_off_c, 0, 65, 0",
  "2, 1920, End_track",
  "0, 0, End_of_file",
  "",
].join("\n");

describe("accords écrits", () => {
  it("reconnaît les noms français et anglais, et rien d'autre", () => {
    expect(parseChord("Lam")).toEqual([9, "m"]);
    expect(parseChord(" Am ")).toEqual([9, "m"]);
    expect(parseChord("Do")).toEqual([0, ""]);
    expect(parseChord("C")).toEqual([0, ""]);
    expect(parseChord("Sib")).toEqual([10, ""]);
    expect(parseChord("Bb")).toEqual([10, ""]);
    expect(parseChord("Rém")).toEqual([2, "m"]);
    expect(parseChord("Réb")).toEqual([1, ""]);
    expect(parseChord("fa#dim")).toEqual([6, "dim"]);
    expect(parseChord("G#m")).toEqual([8, "m"]);
    expect(parseChord("Dom")).toEqual([0, "m"]);
    expect(parseChord("Auto")).toBeNull();
    for (const text of ["", "Sol7", "couplet", "Kyrie", "H", "Lam7", "La m"]) expect(parseChord(text)).toBeUndefined();
  });

  it("lit les accords d'un fichier MIDICSV avec leur instant, changements de tempo compris", () => {
    const input = read(SONG);
    expect(input.chords).toEqual([
      { tick: 0, seconds: 0, chord: [9, "m"] },
      { tick: 960, seconds: 1, chord: [5, ""] },
    ]);
    expect(input.notes.map((n) => n.tick)).toEqual([0, 480, 960, 1440]);
  });

  it("lit les accords écrits dans les textes d'un fichier MIDI", () => {
    const text = (delta: number, value: string) => {
      const bytes = [...new TextEncoder().encode(value)];
      return { delta, bytes: [0xff, 0x01, bytes.length, ...bytes] };
    };
    const midi = writeMidi(1, 480, [
      [text(0, "Rém"), { delta: 0, bytes: [0x90, 62, 90] }, { delta: 480, bytes: [0x80, 62, 0] }, text(0, "paroles")],
    ]);
    expect(readMidiInput("song.mid", midi).chords).toEqual([{ tick: 0, seconds: 0, chord: [2, "m"] }]);
  });

  it("donne aux notes l'accord écrit à leur début ou avant, à la place de l'accord calculé", () => {
    const note = (pitch: number, start: number): Note => ({
      pitch, start, duration: 1, velocity: 90, track: 0, channel: 0,
    });
    // Do et Mi ensemble : l'accord calculé est Do
    const notes = harmonize([note(60, 0), note(64, 0), note(60, 1), note(64, 1), note(60, 2), note(64, 2), note(67, 3)]);
    const marks: ChordMark[] = [
      { tick: 480, seconds: 1, chord: [9, "m"] },
      { tick: 960, seconds: 2, chord: null },
    ];
    expect(applyChords(notes, marks).map((n) => n.chord)).toEqual([
      [0, ""], [0, ""], [9, "m"], [9, "m"], [0, ""], [0, ""], undefined,
    ]);
    expect(applyChords(notes, [marks[0]]).map((n) => n.chord).slice(4)).toEqual([[9, "m"], [9, "m"], [9, "m"]]);
  });

  it("lit le nom des pistes (Title_t) et les repères (Marker_t) d'un MIDICSV", () => {
    const input = read([
      "0, 0, Header, 1, 2, 480",
      "1, 0, Start_track",
      '1, 0, Title_t, "Messe"',
      "1, 0, Tempo, 500000",
      '1, 0, Marker_t, "Kyrie"',
      '1, 960, Marker_t, "Gloria"',
      "1, 1920, End_track",
      "2, 0, Start_track",
      '2, 0, Title_t, "Soprano"',
      "2, 0, Note_on_c, 0, 60, 90",
      "2, 1920, Note_off_c, 0, 60, 0",
      "2, 1920, End_track",
    ].join("\n"));
    expect(listParts(input)).toEqual([{ track: 1, channel: 0, name: "Soprano", count: 1 }]);
    expect(input.markers).toEqual([{ seconds: 0, name: "Kyrie" }, { seconds: 1, name: "Gloria" }]);
  });

  it("lisse les accords de passage : encadrés par le même accord, ou entre deux temps", () => {
    const at = (start: number, chord: [number, string] | undefined): Note => ({
      pitch: 60, start, duration: 1, velocity: 90, track: 0, channel: 0, chord,
    });
    const DO: [number, string] = [0, ""];
    const SOL: [number, string] = [7, "m"];
    const FA: [number, string] = [5, "m"];
    const SIB: [number, string] = [10, ""];
    const chords = (notes: Note[]) => notes.map((n) => n.chord);
    const beats = [0, 1, 2, 3, 4, 5, 6, 7];
    const smooth = (notes: Note[]) => chords(smoothChords(notes, beats, 0.75));

    // Un Sol mineur d'une demi-seconde sur un temps, entre deux Do : il rejoint Do
    expect(smooth([at(0, DO), at(2, DO), at(3, SOL), at(3.5, DO), at(5, DO)])).toEqual([DO, DO, DO, DO, DO]);
    // Un Fa mineur bref entre deux temps, suivi d'un autre accord : le précédent continue
    expect(smooth([at(0, DO), at(1.5, FA), at(2, SIB), at(4, SIB)])).toEqual([DO, DO, SIB, SIB]);
    // Un accord bref sur un temps (Sol mineur) reste, comme une note sans accord et le dernier accord
    expect(smooth([at(0, DO), at(1, SOL), at(1.5, FA), at(3, undefined), at(4, SIB)])).toEqual([DO, SOL, FA, undefined, SIB]);
  });

  it("change l'accord d'un passage sans toucher au suivant", () => {
    const at = (tick: number) => ({ tick, seconds: tick / 960 });
    const summary = (marks: ChordMark[]) => marks.map((m) => [m.tick, m.chord]);

    // Aucun accord écrit : le passage reçoit le sien, la suite revient aux accords calculés
    const first = setChord([], at(480), at(960), [5, ""]);
    expect(summary(first)).toEqual([[480, [5, ""]], [960, null]]);
    // Jusqu'à la fin du morceau
    expect(summary(setChord([], at(480), null, [5, ""]))).toEqual([[480, [5, ""]]]);
    // Le passage suivant garde l'accord écrit qui valait pour lui
    const held: ChordMark[] = [{ ...at(0), chord: [9, "m"] }];
    expect(summary(setChord(held, at(480), at(960), [5, ""]))).toEqual([[0, [9, "m"]], [480, [5, ""]], [960, [9, "m"]]]);
    // « Automatique » sur le seul passage écrit : il ne reste rien
    expect(setChord(first, at(480), at(960), null)).toEqual([]);
    // Les accords écrits dans le passage sont remplacés, celui qui le suit est gardé
    const many: ChordMark[] = [{ ...at(0), chord: [0, ""] }, { ...at(480), chord: [7, ""] }, { ...at(960), chord: [5, ""] }];
    expect(summary(setChord(many, at(0), at(960), [9, "m"]))).toEqual([[0, [9, "m"]], [960, [5, ""]]]);
    // Le même accord que le passage précédent : un seul repère suffit
    expect(summary(setChord(many, at(480), at(960), [0, ""]))).toEqual([[0, [0, ""]], [960, [5, ""]]]);
  });

  it("récrit les accords dans le texte MIDICSV sans toucher au reste", () => {
    const input = read(SONG);
    // Sans changement, le texte est rendu tel quel, au nom des accords près (« F » devient « Fa »)
    expect(writeMidicsvChords(SONG, input.chords, name)).toBe(SONG.replace('"F"', '"Fa"'));

    const marks = setChord(input.chords, { tick: 480, seconds: 0.5 }, { tick: 960, seconds: 1 }, [0, ""]);
    const written = writeMidicsvChords(SONG, marks, name);
    expect(marksOf(written)).toEqual([[0, [9, "m"]], [480, [0, ""]], [960, [5, ""]]]);
    const lines = written.split("\n");
    expect(lines.filter((l) => l.includes("Text_t"))).toEqual([
      '2, 0, Text_t, "Lam"', '2, 480, Text_t, "couplet"', '2, 480, Text_t, "Do"', '2, 960, Text_t, "Fa"',
    ]);
    expect(lines.filter((l) => !/Text_t, "(Lam|Do|Fa)"/.test(l))).toEqual(SONG.split("\n").filter((l) => !/"(Lam|F)"/.test(l)));

    // Tout retirer : il ne reste que le texte qui n'est pas un accord
    expect(writeMidicsvChords(SONG, [], name)).toBe(SONG.replace('2, 0, Text_t, "Lam"\n', "").replace('2, 960, Text_t, "F"\n', ""));
    // Un accord placé après la dernière note n'est pas écrit
    expect(writeMidicsvChords(SONG, [{ tick: 1900, chord: [0, ""] }], name)).toBe(writeMidicsvChords(SONG, [], name));
    // « auto », et un accord entre deux notes : avant la première ligne plus tardive
    const between = writeMidicsvChords(SONG, [{ tick: 100, chord: [7, ""] }, { tick: 700, chord: null }], name);
    expect(marksOf(between)).toEqual([[100, [7, ""]], [700, null]]);
    expect(between).toContain('2, 0, Note_on_c, 0, 60, 90\n2, 100, Text_t, "Sol"\n2, 480, Note_off_c, 0, 60, 0\n');
  });

  it("garde les fins de ligne et la dernière ligne non terminée d'un fichier", () => {
    const csv = "0, 0, Header, 0, 1, 480\r\n1, 0, Note_on_c, 0, 60, 90\r\n1, 480, Note_off_c, 0, 60, 0";
    const written = writeMidicsvChords(csv, [{ tick: 0, chord: [9, "m"] }], name);
    expect(written).toBe(
      '0, 0, Header, 0, 1, 480\r\n1, 0, Text_t, "Lam"\r\n1, 0, Note_on_c, 0, 60, 90\r\n1, 480, Note_off_c, 0, 60, 0\r\n',
    );
  });

  it("récrit un vrai fichier à l'identique quand rien n'y est écrit", () => {
    const csv = readFileSync("examples/test.csv", "utf-8");
    const input = read(csv);
    expect(input.chords).toEqual([]); // les Marker_t (« Kyrie », « Sanctus ») ne sont pas des accords
    const eol = csv.endsWith("\n") ? "" : /\r\n/.test(csv) ? "\r\n" : "\n";
    expect(writeMidicsvChords(csv, [], name)).toBe(csv + eol);

    const first = input.notes[0];
    const written = writeMidicsvChords(csv, [{ tick: first.tick!, chord: [0, "m"] }], name);
    expect(marksOf(written)).toEqual([[first.tick, [0, "m"]]]);
    expect(written.split(/\r?\n/).filter((l) => !l.includes("Text_t"))).toEqual((csv + eol).split(/\r?\n/));
    expect(read(written).notes).toEqual(input.notes);
  });
});
