import { describe, expect, it } from "vitest";
import { detectKey, analyzeInputMidi } from "../src/logic";
import { shiftToKey } from "../src/guitar";
import { LivePlayer, type LiveParams, type MidiOut } from "../src/player";
import { allFixtures, fileBytes, synthetic, type LiveFixture } from "./fixtures";

// Rejoue chaque scénario de tools/make_fixtures.py sous la même horloge simulée que le
// LivePlayer de midi.py, et compare les messages envoyés à la sortie, pas à pas.

type Value = string | number | boolean;

function toParams(raw: Record<string, Value>): LiveParams {
  return {
    mode: raw.mode as LiveParams["mode"],
    scale: raw.scale as string,
    speed: raw.speed as number,
    delayMs: raw.delay_ms as number,
    strums: raw.strums as number,
    melody: raw.melody as boolean,
    transpose: raw.transpose as number,
    keyShift: raw.key_shift as number,
    program: raw.program as number,
  };
}

function replay(run: LiveFixture, bytes: Uint8Array) {
  const notes = analyzeInputMidi(run.file, bytes);
  const key = detectKey(notes);
  const raw: Record<string, Value> = { ...run.initial, key_shift: shiftToKey(key, run.initial.scale as string) };
  const pending = [...run.actions].sort((a, b) => a[0] - b[0]);
  const events: unknown[] = [];
  const displays: unknown[] = [];
  const positions: unknown[] = [];
  let now = run.clockStart;

  // Les messages sont datés du pas qui les envoie, comme dans le moteur de midi.py
  const out: MidiOut = {
    noteOn: (pitch, velocity) => events.push(["on", player.now, pitch, velocity]),
    noteOff: (pitch) => events.push(["off", player.now, pitch]),
    setInstrument: (program) => events.push(["prog", player.now, program]),
  };
  const player = new LivePlayer(notes, () => toParams(raw), out, now);

  const applyActions = () => {
    while (pending.length && run.clockStart + pending[0][0] <= now) {
      const [, kind, value] = pending.shift()!;
      if (kind === "seek") player.seek(value as number);
      else if (kind === "seek_to") player.seekTo(value as number);
      else {
        raw[kind] = value;
        if (kind === "scale") raw.key_shift = shiftToKey(key, value as string);
      }
    }
  };

  const stopAt = run.stopAt === null ? null : run.clockStart + run.stopAt;
  let ticks = 0;
  let shown: unknown = null;
  applyActions();
  for (;;) {
    if (stopAt !== null && now >= stopAt) {
      player.stop(now);
      break;
    }
    if (!player.tick(now)) break;
    const d = player.display;
    if (d !== shown) {
      shown = d;
      displays.push([now, d && [d.mode, d.chord, d.frets, d.up, d.transpose, d.pitch]]);
    }
    if (ticks % 100 === 0) positions.push([now, player.position]);
    ticks++;
    now += run.tick;
    applyActions();
  }
  return { events, displays, positions, ticks, finalPosition: player.position, finalClock: now };
}

for (const fixtures of allFixtures) {
  describe(`moteur de lecture, fichiers de ${fixtures === synthetic ? "test" : "la machine"}`, () => {
    it.each(fixtures.live.map((run) => [run.file, run.scenario, run] as const))("%s : %s", (_f, _s, run) => {
      const actual = replay(run, fileBytes(fixtures, run.file));
      expect(actual.ticks).toBe(run.ticks);
      expect(actual.finalClock).toBe(run.finalClock);
      expect(actual.finalPosition).toBe(run.finalPosition);
      expect(actual.positions).toEqual(run.positions);
      expect(actual.displays).toEqual(run.displays);
      expect(actual.events.length).toBe(run.events.length);
      expect(actual.events).toEqual(run.events);
    });
  });
}
