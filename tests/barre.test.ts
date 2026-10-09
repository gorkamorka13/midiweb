import { describe, expect, it } from "vitest";
import { CHORD_FRETS, findBarre } from "../src/guitar";

// Barrés des accords de CHORDS : [case, première corde, dernière corde], absents des accords ouverts
const BARRES: Record<string, [number, number, number]> = {
  Fa: [1, 0, 5], Fam: [1, 0, 5], Sim: [2, 0, 5], "Fa#": [2, 0, 5], "Fa#m": [2, 0, 5],
  "Do#": [4, 1, 5], "Do#m": [4, 1, 5], Mib: [6, 1, 5], Mibm: [6, 1, 5],
  "Sol#": [4, 0, 5], "Sol#m": [4, 0, 5], Sib: [1, 1, 5], Sibm: [1, 1, 5],
  Si: [2, 1, 5], Dom: [3, 1, 5], Solm: [3, 0, 5],
};

describe("findBarre", () => {
  for (const [name, frets] of Object.entries(CHORD_FRETS)) {
    const expected = BARRES[name];
    it(`${name} : ${expected ? "barré" : "sans barré"}`, () => {
      const barre = findBarre(frets);
      if (expected) expect(barre).toEqual({ fret: expected[0], from: expected[1], to: expected[2] });
      else expect(barre).toBeNull();
    });
  }

  it("une note seule n'est jamais barrée", () => {
    expect(findBarre([null, null, null, 5, null, null])).toBeNull();
  });
});
