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
  harmonize,
  keepHighestNotes,
  strumLayout,
  sweepDelay,
  toGuitarRange,
  type Note,
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

describe("accords lus dans toutes les voix", () => {
  const note = (pitch: number, start = 0, duration = 1, track = 0): Note => ({
    pitch, start, duration, velocity: 90, track, channel: track,
  });
  const scale = "La mineur (Lam)";

  it("l'accord est celui des notes qui sonnent ensemble, amené dans la tonalité choisie", () => {
    // Sol, Mib, Do, Do : Do mineur, alors que la note aiguë seule (Sol) donnerait Sol mineur
    const notes = harmonize([note(67, 0, 1, 0), note(63, 0, 1, 1), note(60, 0, 1, 2), note(48, 0, 1, 3)]);
    expect(notes.map((n) => n.chord)).toEqual([[0, "m"], [0, "m"], [0, "m"], [0, "m"]]);
    const [soprano] = keepHighestNotes(notes);
    expect(strumLayout(soprano, "accord", SCALE_HARMONY["Do mineur (Dom)"])[0]).toBe("Dom");
    const shift = shiftToKey([0, "mineur"], scale);
    expect(strumLayout(soprano, "accord", SCALE_HARMONY[scale], 0, shift)[0]).toBe("Lam");
  });

  it("à égalité, la fondamentale est la note la plus grave", () => {
    // Fa, Lab, Do, Mib : Fa mineur ou Lab Majeur
    expect(harmonize([note(41), note(56), note(60), note(63)])[0].chord).toEqual([5, "m"]);
    expect(harmonize([note(44), note(53), note(60), note(63)])[0].chord).toEqual([8, ""]);
  });

  it("une note tenue compte dans l'accord des notes qui commencent pendant qu'elle sonne", () => {
    const notes = harmonize([note(48, 0, 4), note(64, 0, 1), note(67, 1, 1), note(69, 2, 1)]);
    expect(notes.map((n) => n.chord)).toEqual([[0, ""], [0, ""], [0, ""], [9, "m"]]);
  });

  it("une note seule, ou hors de tout accord, garde l'accord de la grille", () => {
    // la deuxième note commence quand la première est finie ; Do et Ré ne forment pas d'accord
    const notes = harmonize([note(64, 0, 1), note(67, 1, 1), note(60, 3, 1), note(62, 3, 1)]);
    expect(notes.map((n) => n.chord)).toEqual([undefined, undefined, undefined, undefined]);
    expect(strumLayout(notes[0], "accord", SCALE_HARMONY[scale])).toEqual(
      strumLayout({ pitch: 64 }, "accord", SCALE_HARMONY[scale]),
    );
  });
});

describe("fichiers non pris en charge", () => {
  it("division SMPTE", () => {
    const smpte = fileBytes(synthetic, "melody.mid");
    smpte[12] = 0xe7; // -25 images par seconde
    smpte[13] = 40;
    expect(() => analyzeInputMidi("smpte.mid", smpte)).toThrow("SMPTE");
  });
});
