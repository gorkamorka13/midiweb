import { describe, expect, it } from "vitest";
import type { Note } from "../src/logic";
import { LivePlayer, type LiveParams, type MidiOut } from "../src/player";

// La pause n'existe pas dans midi.py : ces tests décrivent son comportement dans la version web.

const TICK = 0.01;
const NOTES: Note[] = [
  { pitch: 69, start: 0.0, duration: 1.0, velocity: 90, track: 0, channel: 0 }, // La
  { pitch: 72, start: 1.0, duration: 1.0, velocity: 90, track: 0, channel: 0 }, // Do
  { pitch: 76, start: 2.0, duration: 1.0, velocity: 90, track: 0, channel: 0 }, // Mi
];

function setup(changes: Partial<LiveParams> = {}) {
  const params: LiveParams = {
    mode: "accord", scale: "La mineur (Lam)", speed: 1.0, delayMs: 15, strums: 2, melody: false,
    transpose: 0, keyShift: 0, program: 25, mono: false, chromatic: false, loop: null, ...changes,
  };
  const events: [kind: "on" | "off", pitch: number, time: number][] = [];
  const sounding = new Set<number>();
  const out: MidiOut = {
    noteOn: (pitch, _velocity, time) => {
      events.push(["on", pitch, time]);
      sounding.add(pitch);
    },
    noteOff: (pitch, time) => {
      events.push(["off", pitch, time]);
      sounding.delete(pitch);
    },
    setInstrument: () => {},
  };
  let now = 10.0;
  const player = new LivePlayer(NOTES, () => params, out, now);
  /** Fait tourner le moteur pendant `seconds`. */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK); i++) {
      now += TICK;
      player.tick(now);
    }
  };
  player.tick(now);
  return { player, params, events, sounding, run, time: () => now };
}

describe("pause", () => {
  it("coupe tout, fige la position et ne frappe plus rien", () => {
    const { player, events, sounding, run, time } = setup();
    run(0.3);
    expect(sounding.size).toBeGreaterThan(0);

    player.pause(time());
    expect(player.paused).toBe(true);
    expect(sounding.size).toBe(0);
    const position = player.position;
    expect(position).toBeCloseTo(0.3, 6);

    const sent = events.length;
    run(2.0);
    expect(events.length).toBe(sent);
    expect(player.position).toBe(position);
    expect(player.finished).toBe(false);
  });

  it("reprend là où elle s'est arrêtée en rejouant la note en cours", () => {
    const { player, events, run, time } = setup();
    run(0.3);
    player.pause(time());
    run(5.0);

    const sent = events.length;
    player.resume(time());
    run(0.1);
    const resumed = events.slice(sent).filter(([kind]) => kind === "on");
    expect(resumed.map(([, pitch]) => pitch)).toEqual([40, 45, 52, 57, 60, 64]); // accord de Lam
    expect(player.position).toBeCloseTo(0.4, 6);

    run(3.0);
    expect(player.finished).toBe(true);
  });

  it("recule la position quand le moteur a de l'avance sur ce qu'on entend", () => {
    const { player, events, sounding, run, time } = setup({ speed: 2.0 });
    run(0.3);
    const ahead = 0.08;
    player.pause(time() - ahead);
    expect(player.position).toBeCloseTo((0.3 - ahead) * 2.0, 6);
    expect(sounding.size).toBe(0);
    // Les notes coupées le sont à l'heure de la pause, pas à celle du moteur
    expect(events[events.length - 1][2]).toBeCloseTo(time() - ahead, 9);
    expect(player.stringHits.every((hit) => hit <= time() - ahead)).toBe(true);
  });

  it("accepte un déplacement, joué à la reprise", () => {
    const { player, events, run, time } = setup();
    run(0.3);
    player.pause(time());
    player.seekTo(2.5);
    run(0.05);
    expect(player.position).toBe(2.5);
    expect(player.display).toBeNull();

    const sent = events.length;
    player.resume(time());
    run(0.2); // le temps du balayage des six cordes
    const resumed = events.slice(sent).filter(([kind]) => kind === "on");
    expect(resumed.map(([, pitch]) => pitch)).toEqual([64, 59, 55, 52, 47, 40]); // Mim, coup vers le haut
    expect(player.display?.chord).toBe("Mim");
  });

  it("ne termine pas le morceau tant qu'elle dure", () => {
    const { player, run, time } = setup();
    run(0.3);
    player.pause(time());
    player.seekTo(1000);
    run(1.0);
    expect(player.finished).toBe(false);
    player.resume(time());
    run(0.05);
    expect(player.finished).toBe(true);
  });
});
