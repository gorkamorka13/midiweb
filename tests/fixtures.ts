import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Données de référence produites par tools/make_fixtures.py avec le vrai midi.py

export interface FileFixture {
  name: string;
  error: string | null;
  notes: [pitch: number, start: number, duration: number, velocity: number][];
  key: [number, "Majeur" | "mineur"];
  melody: number[];
  duration: number;
  shifts: Record<string, number>;
  exports: {
    settings: {
      mode: "accord" | "corde";
      scale: string;
      strums: number;
      speed: number;
      delay_ms: number;
      transpose: number;
      melody: boolean;
      program: number;
    };
    chords: string;
    midi: string;
  }[];
}

export interface LiveFixture {
  file: string;
  scenario: string;
  initial: Record<string, string | number | boolean>;
  actions: [time: number, kind: string, value: string | number | boolean][];
  stopAt: number | null;
  clockStart: number;
  tick: number;
  ticks: number;
  events: (["on", number, number, number] | ["off", number, number] | ["prog", number, number])[];
  displays: [number, null | [string, string, (number | null)[], boolean, number, number]][];
  positions: [number, number][];
  finalPosition: number;
  finalClock: number;
  finished: boolean;
}

export interface Fixtures {
  dir: string;
  files: FileFixture[];
  live: LiveFixture[];
  tables?: Record<string, any>;
}

function load(dir: string): Fixtures | null {
  const path = join(dir, "expected.json");
  if (!existsSync(path)) return null;
  return { dir, ...JSON.parse(readFileSync(path, "utf-8")) };
}

const root = join(__dirname, "fixtures");

export const synthetic = load(root)!;
/** Fichiers MIDI réels, présents seulement sur la machine de développement. */
export const local = load(join(root, "local"));
export const allFixtures = [synthetic, ...(local ? [local] : [])];

export function fileBytes(fixtures: Fixtures, name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixtures.dir, "files", name)));
}
