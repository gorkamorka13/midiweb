import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE, harmonyMap } from "../src/guitar";
import { tabNotes, type Note } from "../src/logic";

const note = (pitch: number, start: number, duration = 0.5): Note => ({
  pitch, start, duration, velocity: 80, track: 0, channel: 0,
});

describe("tabNotes", () => {
  const harmony = harmonyMap(DEFAULT_SCALE, false);

  it("place chaque note sur la corde et la case du mode Simple Corde", () => {
    // Mi grave (40) : corde 0 à vide ; Sol (55) : corde 3 à vide ; Do (60) : corde 4 case 1
    const tab = tabNotes([note(40, 0), note(55, 1), note(60, 2)], harmony);
    expect(tab.map((t) => [t.string, t.fret])).toEqual([[0, 0], [3, 0], [4, 1]]);
    expect(tab[1]).toMatchObject({ start: 1, duration: 0.5 });
  });

  it("ne garde que la note la plus aiguë de notes simultanées", () => {
    const tab = tabNotes([note(48, 0), note(64, 0.01), note(55, 1)], harmony);
    expect(tab).toHaveLength(2);
    expect(tab[0]).toMatchObject({ string: 5, fret: 0 });
  });

  it("tient compte du décalage de tonalité", () => {
    const tab = tabNotes([note(40, 0)], harmony, 2); // Mi + 2 demi-tons = Fa# : corde 0, case 2
    expect(tab[0]).toMatchObject({ string: 0, fret: 2 });
  });
});
