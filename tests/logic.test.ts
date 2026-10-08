import { describe, expect, it } from "vitest";
import {
  CHORD_FRETS,
  CHORD_VOICINGS,
  SCALES,
  SCALE_HARMONY,
  noteName,
  scaleLabel,
  shiftToKey,
  transposedChordName,
  transposedKeyName,
  type Notation,
} from "../src/guitar";
import {
  analyzeInputMidi,
  detectKey,
  generateProcessedMidi,
  keepHighestNotes,
  strumLayout,
  sweepDelay,
  toGuitarRange,
} from "../src/logic";
import { parseMidi, playbackMessages } from "../src/midifile";
import { allFixtures, fileBytes, synthetic } from "./fixtures";

const tables = synthetic.tables!;

describe("tables de la guitare", () => {
  it("tonalités et doigtés", () => {
    // La version web a plus de tonalités et d'accords : ceux de midi.py y sont, inchangés
    expect(SCALES).toEqual(expect.arrayContaining(tables.scales));
    expect(CHORD_FRETS).toMatchObject(tables.chordFrets);
    expect(CHORD_VOICINGS).toMatchObject(tables.chordVoicings);
  });

  it.each(["fr", "en"] as Notation[])("noms en notation %s", (notation) => {
    expect(tables.scales.map((s: string) => scaleLabel(s, notation))).toEqual(tables.scaleLabels[notation]);
    for (const [pitch, name] of tables.noteNames[notation]) expect(noteName(pitch, notation)).toBe(name);
    for (const [chord, t, name] of tables.chordNames[notation]) {
      expect(transposedChordName(chord, t, notation)).toBe(name);
    }
    for (const [scale, t, name] of tables.keyNames[notation]) {
      expect(transposedKeyName(scale, t, notation)).toBe(name);
    }
  });

  it("décalage vers la tonalité choisie", () => {
    for (const [root, quality, scale, shift] of tables.shifts) {
      expect(shiftToKey([root, quality], scale)).toBe(shift);
    }
  });

  it("doigtés de chaque note", () => {
    for (const [mode, scale, transpose, keyShift, pitch, chord, layout] of tables.layouts) {
      expect(strumLayout({ pitch }, mode, SCALE_HARMONY[scale], transpose, keyShift)).toEqual([chord, layout]);
    }
  });

  it("balayage et tessiture", () => {
    for (const [ms, n, slot, delay] of tables.sweepDelays) expect(sweepDelay(ms, n, slot)).toBe(delay);
    for (const [pitch, inRange] of tables.guitarRange) expect(toGuitarRange(pitch)).toBe(inRange);
  });
});

for (const fixtures of allFixtures) {
  describe(`fichiers de ${fixtures === synthetic ? "test" : "la machine"}`, () => {
    for (const expected of fixtures.files) {
      const read = () => analyzeInputMidi(expected.name, fileBytes(fixtures, expected.name));

      if (expected.error !== null) {
        it(`${expected.name} : refusé`, () => {
          // Les messages de mido (en anglais) ne sont pas repris tels quels, ceux de midi.py si
          expect(read).toThrow(expected.error!.startsWith("ligne") ? expected.error! : undefined);
        });
        continue;
      }

      it(`${expected.name} : notes, tonalité et mélodie`, () => {
        const notes = read();
        expect(notes.map((n) => [n.pitch, n.start, n.duration, n.velocity])).toEqual(expected.notes);
        expect(detectKey(notes)).toEqual(expected.key);
        expect(keepHighestNotes(notes).map((n) => notes.indexOf(n))).toEqual(expected.melody);
        expect(Math.max(...notes.map((n) => n.start + n.duration))).toBe(expected.duration);
        for (const scale of tables.scales) expect(shiftToKey(detectKey(notes), scale)).toBe(expected.shifts[scale]);
      });

      it.each(expected.exports.map((e, i) => [i, e] as const))(`${expected.name} : export %i`, (_i, e) => {
        const notes = read();
        const s = e.settings;
        const { midi, chords } = generateProcessedMidi(s.melody ? keepHighestNotes(notes) : notes, {
          mode: s.mode,
          scaleKey: s.scale,
          strumsCount: s.strums,
          speedFactor: s.speed,
          strumDelayMs: s.delay_ms,
          transpose: s.transpose,
          keyShift: shiftToKey(detectKey(notes), s.scale),
          program: s.program,
        });
        expect(chords).toBe(e.chords);
        expect(Buffer.from(midi).toString("base64")).toBe(e.midi);
        // Le fichier exporté se relit
        expect(playbackMessages(parseMidi(midi)).length).toBeGreaterThan(2);
      });
    }
  });
}

describe("fichiers non pris en charge", () => {
  it("division SMPTE", () => {
    const smpte = fileBytes(synthetic, "melody.mid");
    smpte[12] = 0xe7; // -25 images par seconde
    smpte[13] = 40;
    expect(() => analyzeInputMidi("smpte.mid", smpte)).toThrow("SMPTE");
  });
});
