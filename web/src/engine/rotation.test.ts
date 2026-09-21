import { describe, expect, it } from "vitest";
import { formatClock, nextTable, parseSeatId, remainingMs, rotationTarget } from "./rotation";

describe("nextTable", () => {
  it("advances by one", () => {
    expect(nextTable(1, 16)).toBe(2);
    expect(nextTable(15, 16)).toBe(16);
  });

  it("wraps 16 back to 1", () => {
    expect(nextTable(16, 16)).toBe(1);
  });

  it("handles multi-step jumps (a client that missed rounds) with wraparound", () => {
    expect(nextTable(15, 16, 3)).toBe(2);
    expect(nextTable(1, 16, 16)).toBe(1); // a full lap
    expect(nextTable(1, 16, 17)).toBe(2);
  });
});

describe("parseSeatId", () => {
  it("splits table number and colour", () => {
    expect(parseSeatId("5b")).toEqual({ table: 5, colour: "b" });
    expect(parseSeatId("12w")).toEqual({ table: 12, colour: "w" });
  });

  it("rejects anything that isn't a seat id", () => {
    expect(parseSeatId("")).toBeNull();
    expect(parseSeatId("table5")).toBeNull();
    expect(parseSeatId("5")).toBeNull();
    expect(parseSeatId("b5")).toBeNull();
  });
});

describe("rotationTarget", () => {
  it("moves a black-chair player to the next table's black chair", () => {
    expect(rotationTarget("5b", 16)).toBe("6b");
  });

  it("wraps around at the last table", () => {
    expect(rotationTarget("16b", 16)).toBe("1b");
  });

  it("leaves white-chair (anchor) players where they are", () => {
    expect(rotationTarget("5w", 16)).toBeNull();
  });

  it("does nothing for players who aren't seated", () => {
    expect(rotationTarget(undefined, 16)).toBeNull();
  });

  it("does nothing for an unrecognised seat id", () => {
    expect(rotationTarget("bench", 16)).toBeNull();
  });

  it("rotates several tables when several rounds were missed", () => {
    expect(rotationTarget("15b", 16, 3)).toBe("2b");
  });
});

describe("remainingMs", () => {
  it("counts down on the server's timeline, correcting for clock skew", () => {
    // Server is 5s ahead of this client; the round ends at server-time 100_000.
    const offset = 5_000;
    const clientNow = 90_000; // => server time 95_000
    expect(remainingMs({ roundEndsAt: 100_000 }, offset, clientNow)).toBe(5_000);
  });

  it("never goes negative once time is up", () => {
    expect(remainingMs({ roundEndsAt: 100 }, 0, 5_000)).toBe(0);
  });
});

describe("formatClock", () => {
  it("formats minutes and seconds with padding", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(9_000)).toBe("00:09");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(15 * 60_000)).toBe("15:00");
  });

  it("rounds UP so it only reads 00:00 when time is truly out", () => {
    expect(formatClock(1)).toBe("00:01");
    expect(formatClock(999)).toBe("00:01");
    expect(formatClock(1_001)).toBe("00:02");
  });

  it("clamps negatives to zero", () => {
    expect(formatClock(-5_000)).toBe("00:00");
  });
});
