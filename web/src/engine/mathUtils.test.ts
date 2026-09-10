import { describe, expect, it } from "vitest";
import { clamp, dampFactor, shortestAngle } from "./mathUtils";

describe("shortestAngle", () => {
  it("returns 0 for equal angles", () => {
    expect(shortestAngle(1.2, 1.2)).toBe(0);
  });

  it("takes the short way around the wrap point", () => {
    const d = shortestAngle(-Math.PI + 0.1, Math.PI - 0.1);
    expect(d).toBeCloseTo(-0.2, 5);
  });

  it("stays within (-PI, PI]", () => {
    for (let a = -10; a < 10; a += 0.7) {
      for (let b = -10; b < 10; b += 0.9) {
        const d = shortestAngle(a, b);
        expect(d).toBeGreaterThan(-Math.PI - 1e-9);
        expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });
});

describe("clamp", () => {
  it("bounds below and above", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });
});

describe("dampFactor", () => {
  it("is in (0,1) and grows with dt", () => {
    const a = dampFactor(10, 1 / 60);
    const b = dampFactor(10, 1 / 30);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(b).toBeGreaterThan(a);
  });
});
