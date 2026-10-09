import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE, MAX_CAPO, autoCapo, shiftToKey } from "../src/guitar";

describe("capo auto", () => {
  it("Si mineur joué en La mineur : capo case 2", () => {
    expect(autoCapo(shiftToKey([11, "mineur"], DEFAULT_SCALE))).toBe(2);
  });

  it("morceau déjà dans la tonalité de jeu : pas de capo", () => {
    expect(autoCapo(shiftToKey([9, "mineur"], DEFAULT_SCALE))).toBe(0);
  });

  it("jusqu'à la case MAX_CAPO, au-delà null", () => {
    expect(autoCapo(-MAX_CAPO)).toBe(MAX_CAPO);
    expect(autoCapo(-(MAX_CAPO + 1))).toBeNull();
    expect(autoCapo(3)).toBeNull(); // il faudrait la case 9
    expect(autoCapo(6)).toBe(6);
  });
});
