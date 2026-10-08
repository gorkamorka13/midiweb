import { describe, expect, it } from "vitest";
import { guessMelodyPart, type Note } from "../src/logic";
import { LivePlayer, type LiveParams, type MidiOut } from "../src/player";

// Boucle, une note à la fois, accords hors tonalité, choix des pistes : absents de midi.py,
// ces tests décrivent leur comportement dans la version web.

const TICK = 0.01;
const note = (pitch: number, start: number, duration: number, track = 0): Note => ({
  pitch, start, duration, velocity: 90, track, channel: 0,
});
const SONG = [note(69, 0.0, 1.0), note(72, 1.0, 1.0), note(76, 2.0, 1.0)]; // La, Do, Mi

function setup(notes: Note[], changes: Partial<LiveParams> = {}) {
  const params: LiveParams = {
    mode: "accord", scale: "La mineur (Lam)", speed: 1.0, delayMs: 15, strums: 2, melody: false,
    transpose: 0, keyShift: 0, program: 25, mono: false, chromatic: false, loop: null, ...changes,
  };
  const ons: number[] = [];
  const sounding = new Set<number>();
  const out: MidiOut = {
    noteOn: (pitch) => {
      ons.push(pitch);
      sounding.add(pitch);
    },
    noteOff: (pitch) => void sounding.delete(pitch),
    setInstrument: () => {},
  };
  let now = 10.0;
  const player = new LivePlayer(notes, () => params, out, now);
  /** Fait tourner le moteur pendant `seconds`. */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK); i++) {
      now += TICK;
      player.tick(now);
    }
  };
  player.tick(now);
  return { player, params, ons, sounding, run };
}

describe("boucle", () => {
  it("repart du début de la boucle quand sa fin est franchie, sans jamais finir", () => {
    const { player, params, run } = setup(SONG, { loop: [1.0, 2.0] });
    run(1.5);
    expect(player.position).toBeCloseTo(1.5, 6);
    expect(player.display?.chord).toBe("Do");
    for (let i = 0; i < 40; i++) {
      run(0.25);
      expect(player.position).toBeGreaterThanOrEqual(1.0);
      expect(player.position).toBeLessThan(2.0);
      expect(player.display?.chord).toBe("Do");
    }
    expect(player.finished).toBe(false);

    // Boucle effacée : la lecture va jusqu'au bout
    params.loop = null;
    run(2.5);
    expect(player.finished).toBe(true);
  });

  it("rejoue la note du début de la boucle à chaque tour", () => {
    const { ons, run } = setup(SONG, { loop: [1.0, 2.0], strums: 1 });
    run(1.5);
    const first = ons.filter((pitch) => pitch === 48).length; // Do grave : seulement dans l'accord de Do
    run(3.0);
    expect(ons.filter((pitch) => pitch === 48).length).toBe(first + 3);
  });

  it("laisse la lecture continuer quand la position est après la boucle", () => {
    const { player, run } = setup(SONG, { loop: [0.2, 0.8] });
    player.seekTo(2.5);
    run(1.0);
    expect(player.finished).toBe(true);
  });
});

describe("une note à la fois", () => {
  // Un La tenu, rejoint par un Do une seconde plus tard
  const overlap = [note(69, 0.0, 2.0), note(72, 1.0, 1.0)];
  const onlyInAm = [45, 57]; // cordes de l'accord de Lam absentes de l'accord de Do

  it("sans l'option, les accords des notes qui se chevauchent sonnent ensemble", () => {
    const { sounding, run } = setup(overlap);
    run(1.3);
    expect(sounding.has(48)).toBe(true);
    expect(onlyInAm.some((pitch) => sounding.has(pitch))).toBe(true);
  });

  it("avec l'option, le nouvel accord coupe le précédent", () => {
    const { player, sounding, ons, run } = setup(overlap, { mono: true });
    run(0.5);
    expect(player.display?.chord).toBe("Lam");
    run(0.8);
    expect(player.display?.chord).toBe("Do");
    expect(sounding.has(48)).toBe(true);
    expect(onlyInAm.some((pitch) => sounding.has(pitch))).toBe(false);

    // Le La coupé ne revient pas, même si sa durée n'est pas écoulée
    const sent = ons.length;
    run(0.5);
    expect(ons.slice(sent).some((pitch) => onlyInAm.includes(pitch))).toBe(false);
  });
});

describe("accords hors tonalité", () => {
  const sharp = [note(61, 0.0, 1.0)]; // Do#, étranger à Do Majeur

  it("sans l'option, la note reçoit l'accord de repli", () => {
    const { player, run } = setup(sharp, { scale: "Do Majeur (Do)" });
    run(0.2);
    expect(player.display?.chord).toBe("Lam");
  });

  it("avec l'option, elle reçoit un accord qui la contient, y compris en cours de note", () => {
    const { player, params, run } = setup(sharp, { scale: "Do Majeur (Do)" });
    run(0.2);
    params.chromatic = true;
    run(0.1);
    expect(player.display?.chord).toBe("La");
  });
});

describe("choix des pistes", () => {
  it("change les notes jouées sans déplacer la lecture", () => {
    const lead = [note(69, 0.0, 1.0, 1), note(76, 2.0, 1.0, 1)];
    const bass = [note(72, 0.0, 3.0, 2)];
    const { player, sounding, run } = setup([...lead, ...bass]);
    run(0.5);
    expect(sounding.has(48)).toBe(true); // l'accord de Do de la basse

    player.setNotes(lead);
    run(0.6);
    expect(player.position).toBeCloseTo(1.1, 6);
    expect(sounding.size).toBe(0); // entre les deux notes de la piste gardée : silence

    run(1.1);
    expect(player.display?.chord).toBe("Mim");
    expect(sounding.has(48)).toBe(false);

    // Plus aucune piste : la lecture continue en silence jusqu'à la fin du morceau
    player.setNotes([]);
    run(0.1);
    expect(sounding.size).toBe(0);
    expect(player.finished).toBe(false);
    run(1.0);
    expect(player.finished).toBe(true);
  });
});

describe("mélodie probable", () => {
  /** Une note par temps (0,5 s) pendant 8 s, sur la piste donnée. */
  const line = (track: number, pitch: number) => Array.from({ length: 16 }, (_, i) => note(pitch + (i % 5), i * 0.5, 0.5, track));
  const chords = (track: number, pitch: number) =>
    Array.from({ length: 8 }, (_, i) => [0, 4, 7].map((step) => note(pitch + step, i, 1.0, track))).flat();
  const input = (notes: Note[], names: [number, string][] = []) => ({ notes, trackNames: new Map(names) });

  it("préfère la partie aiguë qui joue une note à la fois", () => {
    const guess = guessMelodyPart(input([...line(1, 36), ...chords(2, 72), ...line(3, 72)]));
    expect(guess?.track).toBe(3);
  });

  it("écarte une partie qui ne joue qu'un court passage", () => {
    const fill = [note(84, 6.0, 0.25, 1), note(86, 6.25, 0.25, 1), note(88, 6.5, 0.25, 1)];
    expect(guessMelodyPart(input([...fill, ...line(2, 67)]))?.track).toBe(2);
  });

  it("suit le nom de la piste quand il désigne la mélodie", () => {
    const notes = [...line(1, 72), ...line(2, 55)];
    expect(guessMelodyPart(input(notes, [[1, "Flute"], [2, "Mélodie"]]))?.track).toBe(2);
    expect(guessMelodyPart(input(notes, [[1, "Flute"], [2, "Lead Gtr"]]))?.track).toBe(2);
  });

  it("rend l'unique partie d'un fichier à une piste, et rien pour un fichier sans note", () => {
    expect(guessMelodyPart(input(line(0, 40)))?.track).toBe(0);
    expect(guessMelodyPart(input([]))).toBeNull();
  });
});
