import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { harmonyMap } from "../src/guitar";
import { generateProcessedMidi, readMidiInput, styleEvents, uniformBeats, type Note } from "../src/logic";
import { parseMidi } from "../src/midifile";
import { LivePlayer, type LiveParams, type MidiOut } from "../src/player";
import { STYLES, firstStepFrom, stepAt, styleStep } from "../src/styles";

// Styles de strumming : absents de midi.py, ces tests décrivent leur comportement dans la version web.

const TICK = 0.01;
const START = 10.0; // heure du moteur au début de la lecture
const SCALE = "Do Majeur (Do)";

// « Au clair de la lune » à 100 noires par minute : une noire dure 0,6 s, une croche 0,3 s
const song = readMidiInput("au_clair_de_la_lune.mid", new Uint8Array(readFileSync("examples/au_clair_de_la_lune.mid")));
const DO = [43, 48, 52, 55, 60, 64]; // accord de Do, du grave à l'aigu
const REM = [45, 50, 57, 62, 65]; // accord de Rém

function setup(notes: Note[], changes: Partial<LiveParams> = {}) {
  const params: LiveParams = {
    mode: "accord", scale: SCALE, speed: 1.0, delayMs: 0, strums: 2, melody: true,
    transpose: 0, keyShift: 0, program: 25, mono: false, chromatic: false, loop: null,
    style: STYLES.feu, beats: song.beats, beatsPerBar: 4, ...changes,
  };
  const ons: [time: number, pitch: number, velocity: number][] = [];
  const sounding = new Set<number>();
  const out: MidiOut = {
    noteOn: (pitch, velocity, time) => {
      ons.push([time - START, pitch, velocity]);
      sounding.add(pitch);
    },
    noteOff: (pitch) => void sounding.delete(pitch),
    setInstrument: () => {},
  };
  let now = START;
  const player = new LivePlayer(notes, () => params, out, now);
  /** Fait tourner le moteur pendant `seconds`. */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK); i++) {
      now += TICK;
      player.tick(now);
    }
  };
  /** Coups joués : [heure, hauteurs dans l'ordre, vélocité], les cordes d'un coup partant ensemble (balayage nul). */
  const strokes = () => {
    const grouped: [time: number, pitches: number[], velocity: number][] = [];
    for (const [time, pitch, velocity] of ons) {
      const last = grouped[grouped.length - 1];
      if (last && Math.abs(last[0] - time) < 1e-6) last[1].push(pitch);
      else grouped.push([time, [pitch], velocity]);
    }
    return grouped;
  };
  player.tick(now);
  return { player, params, ons, sounding, run, strokes };
}

const times = (strokes: [number, number[], number][]) => strokes.map(([time]) => Math.round(time * 1000) / 1000);

describe("grille des temps", () => {
  it("lit le tempo et la mesure du fichier", () => {
    expect(song.bpm).toBeCloseTo(100, 6);
    expect(song.beatsPerBar).toBe(4);
    expect(song.beats.slice(0, 3).map((t) => +t.toFixed(6))).toEqual([0, 0.6, 1.2]);
    const end = Math.max(...song.notes.map((n) => n.start + n.duration));
    expect(song.beats[song.beats.length - 1]).toBeGreaterThan(end);
  });

  it("suit les changements de tempo et le chiffrage de mesure d'un fichier MIDICSV", () => {
    const csv = [
      "0, 0, Header, 1, 1, 480",
      "1, 0, Time_signature, 3, 2, 24, 8",
      "1, 0, Tempo, 500000",
      "1, 960, Tempo, 250000",
      "1, 0, Note_on_c, 0, 60, 90",
      "1, 2400, Note_off_c, 0, 60, 0",
    ].join("\n");
    const input = readMidiInput("tempo.csv", new TextEncoder().encode(csv));
    expect(input.beatsPerBar).toBe(3);
    expect(input.bpm).toBeCloseTo(120, 6);
    expect(input.beats.slice(0, 6)).toEqual([0, 0.5, 1.0, 1.25, 1.5, 1.75]);
  });

  it("garde 4 temps par mesure et 120 à la noire quand le fichier ne dit rien", () => {
    const csv = ["0, 0, Header, 0, 1, 480", "1, 0, Note_on_c, 0, 60, 90", "1, 480, Note_off_c, 0, 60, 0"].join("\n");
    const input = readMidiInput("plain.csv", new TextEncoder().encode(csv));
    expect([input.beatsPerBar, input.bpm, input.beats[1]]).toEqual([4, 120, 0.5]);
  });

  it("construit une grille régulière pour un tempo saisi à la main", () => {
    const beats = uniformBeats(90, 2.0);
    expect(beats[3]).toBeCloseTo(2.0, 9);
    expect(beats[beats.length - 1]).toBeGreaterThan(2.0);
  });
});

describe("pas du motif", () => {
  const beats = [0, 0.6, 1.2];

  it("place les croches sur la grille, et au-delà de sa fin", () => {
    expect(stepAt(beats, 3, 0).time).toBeCloseTo(0.9, 9);
    expect(stepAt(beats, 3, 0).length).toBeCloseTo(0.3, 9);
    expect(stepAt(beats, 9, 0).time).toBeCloseTo(2.7, 9); // la grille s'arrête à 1,2 s
  });

  it("retarde les contretemps avec le swing, pas les temps", () => {
    expect(stepAt(beats, 2, 1 / 3).time).toBeCloseTo(0.6, 9);
    expect(stepAt(beats, 3, 1 / 3).time).toBeCloseTo(1.0, 9); // aux deux tiers du temps
  });

  it("trouve le premier pas à partir d'un instant", () => {
    expect(firstStepFrom(beats, 0, 0)).toBe(0);
    expect(firstStepFrom(beats, 0.3, 0)).toBe(1);
    expect(firstStepFrom(beats, 0.31, 0)).toBe(2);
    expect(firstStepFrom(beats, 2.75, 0)).toBe(10);
    expect(firstStepFrom(beats, 0.95, 1 / 3)).toBe(3);
  });

  it("recommence le motif à chaque mesure, y compris à trois temps", () => {
    expect(styleStep(STYLES.feu, 4, 8)).toBe(STYLES.feu.steps[0]);
    expect(styleStep(STYLES.feu, 4, 11)).toBe(STYLES.feu.steps[3]);
    expect(styleStep(STYLES.feu, 3, 6)).toBe(STYLES.feu.steps[0]);
  });
});

describe("lecture avec un style", () => {
  it("joue le motif feu de camp sur les temps, avec l'accord de la note en cours", () => {
    const { run, strokes } = setup(song.notes);
    run(2.3);
    // Bas . Bas Haut . Haut Bas Haut ; la mélodie est Do Do Do Ré, une note par temps
    expect(times(strokes())).toEqual([0, 0.6, 0.9, 1.5, 1.8, 2.1]);
    expect(strokes().map(([, pitches]) => pitches)).toEqual([
      DO, DO, [...DO.slice(-4)].reverse(), [...DO.slice(-4)].reverse(), REM, [...REM.slice(-4)].reverse(),
    ]);
    expect(strokes()[0][2]).toBeGreaterThan(strokes()[1][2]); // premier temps accentué
  });

  it("joue le va-et-vient en croches, six cordes vers le bas puis vers le haut", () => {
    const { run, strokes } = setup(song.notes, { style: STYLES.allerRetour });
    run(1.0);
    expect(times(strokes())).toEqual([0, 0.3, 0.6, 0.9]);
    expect(strokes().map(([, pitches]) => pitches)).toEqual([DO, [...DO].reverse(), DO, [...DO].reverse()]);
    expect(strokes()[0][2]).toBeGreaterThan(strokes()[2][2]); // premier temps accentué
  });

  it("ne fait sonner qu'un accord à la fois", () => {
    const { player, sounding, run } = setup(song.notes);
    for (let i = 0; i < 200; i++) {
      run(0.05);
      const chord = player.display?.chord === "Rém" ? REM : player.display?.chord === "Do" ? DO : null;
      if (chord) expect([...sounding].every((pitch) => chord.includes(pitch))).toBe(true);
    }
  });

  it("joue le reggae à contretemps sur trois cordes, le rock en croches sur les cordes graves", () => {
    const reggae = setup(song.notes, { style: STYLES.reggae });
    reggae.run(2.3);
    expect(times(reggae.strokes())).toEqual([0.3, 0.9, 1.5, 2.1]);
    expect(reggae.strokes()[0][1]).toEqual([64, 60, 55]);

    const rock = setup(song.notes, { style: STYLES.rock });
    rock.run(1.0);
    expect(times(rock.strokes())).toEqual([0, 0.3, 0.6, 0.9]);
    expect(rock.strokes()[0][1]).toEqual([43, 48, 52]);
  });

  it("retarde la levée du jazz", () => {
    const { run, strokes } = setup(song.notes, { style: STYLES.jazz });
    run(2.4);
    expect(times(strokes())).toEqual([0, 0.6, 1.2, 1.8, 2.2]); // 2,2 = aux deux tiers du quatrième temps
  });

  it("suit la vitesse : le motif reste calé sur le morceau", () => {
    const { run, strokes } = setup(song.notes, { speed: 2.0 });
    run(1.2);
    expect(times(strokes())).toEqual([0, 0.3, 0.45, 0.75, 0.9, 1.05]);
  });

  it("se tait avant la première note, garde l'accord pendant un silence, s'arrête après la dernière", () => {
    const note = (pitch: number, start: number, duration: number): Note => ({
      pitch, start, duration, velocity: 90, track: 0, channel: 0,
    });
    // Do de 1,2 à 1,8 s, silence, Ré de 3,6 à 4,2 s
    const { player, run, strokes } = setup([note(60, 1.2, 0.6), note(62, 3.6, 0.6)], { style: STYLES.rock });
    run(5.0);
    const played = strokes();
    expect(times(played)[0]).toBe(1.2);
    expect(times(played)[played.length - 1]).toBe(3.9);
    expect(played.filter(([time]) => time < 3.55).every(([, pitches]) => pitches[0] === 43)).toBe(true); // Do
    expect(played.filter(([time]) => time > 3.55).every(([, pitches]) => pitches[0] === 45)).toBe(true); // Rém
    expect(player.finished).toBe(true);
  });

  it("reprend au pas suivant après un déplacement", () => {
    const { player, run, strokes } = setup(song.notes);
    run(0.2);
    player.seekTo(1.7);
    run(0.5);
    expect(times(strokes()).slice(1)).toEqual([0.31, 0.61]); // les pas de 1,8 s et 2,1 s du morceau (déplacement pris au pas 0,21)
    expect(player.display?.chord).toBe("Rém");
  });

  it("revient au découpage par note quand le style est retiré, et inversement", () => {
    const { params, run, strokes } = setup(song.notes, { style: STYLES.reggae });
    run(0.5);
    expect(times(strokes())).toEqual([0.3]);
    params.style = null;
    run(0.35); // la note en cours est rejouée tout de suite : second strum, vers le haut
    expect(strokes().length).toBeGreaterThan(1);
    expect(strokes()[1][1]).toEqual([...DO].reverse());
    params.style = STYLES.reggae;
    const before = strokes().length;
    run(0.5); // jusqu'à 1,35 s : le contretemps de 0,9 s
    expect(strokes().length).toBe(before + 1);
    expect(strokes()[before][1]).toEqual([64, 60, 55]);
  });

  it("ne s'applique pas au mode Simple Corde", () => {
    const { run, ons } = setup(song.notes, { mode: "corde", strums: 1 });
    run(1.0);
    expect(ons.map(([, pitch]) => pitch)).toEqual([60, 60]); // la mélodie, une corde à la fois
  });
});

describe("export avec un style", () => {
  const settings = { speed: 1.25, delayMs: 15, transpose: 2, keyShift: 0 };

  it("donne les mêmes frappes que la lecture", () => {
    for (const style of Object.values(STYLES)) {
      const { player, run, ons } = setup(song.notes, { style, ...settings });
      for (let i = 0; i < 100 && !player.finished; i++) run(1.0);
      expect(player.finished).toBe(true);

      const exported = styleEvents(
        song.notes, style, song.beats, 4, harmonyMap(SCALE, false), settings.speed, settings.delayMs, settings.transpose,
      ).flatMap(([, played]) => played);
      expect(ons.length).toBe(exported.length);
      ons.forEach(([time, pitch, velocity], i) => {
        expect(time).toBeCloseTo(exported[i][0], 6);
        expect([pitch, velocity]).toEqual([exported[i][2], exported[i][3]]);
      });
    }
  });

  it("écrit ces frappes dans le fichier MIDI, chacune coupée par la suivante", () => {
    const strokes = styleEvents(song.notes, STYLES.feu, song.beats, 4, harmonyMap(SCALE, false), 1.0, 15);
    for (let i = 0; i + 1 < strokes.length; i++) {
      const next = strokes[i + 1][1][0][0];
      expect(strokes[i][1].every(([, off]) => off <= next + 1e-9)).toBe(true);
    }
    const { midi, chords } = generateProcessedMidi(song.notes, {
      mode: "accord", scaleKey: SCALE, strumsCount: 2, speedFactor: 1.0, strumDelayMs: 15,
      style: STYLES.feu, beats: song.beats, beatsPerBar: 4,
    });
    const noteOns = parseMidi(midi).tracks[0].filter((event) => event.kind === "noteOn" && event.velocity > 0);
    expect(noteOns.length).toBe(strokes.reduce((count, [, played]) => count + played.length, 0));
    expect(chords.split(" ")).toContain("Do");
  });

  it("garde le découpage par note en Simple Corde ou sans style", () => {
    const base = { scaleKey: SCALE, strumsCount: 2, speedFactor: 1.0, strumDelayMs: 15 };
    const plain = generateProcessedMidi(song.notes, { ...base, mode: "corde" });
    const styled = generateProcessedMidi(song.notes, { ...base, mode: "corde", style: STYLES.rock, beats: song.beats });
    expect(styled.midi).toEqual(plain.midi);
  });
});
