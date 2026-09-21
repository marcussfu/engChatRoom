// Pure rules for the language-exchange session (docs/PLAN.md §八.1) — kept
// free of Babylon/React so they're trivially unit-testable.
//
// Seat ids look like "5w" / "5b": table number + a colour suffix (see
// engine/environment.ts). White (`w`, "anchor") chairs stay put; black (`b`,
// "rotator") chairs shift to the next table each round.

import type { SessionState } from "../net/types";

/** Table `n` -> the table `steps` ahead of it, wrapping 16 -> 1. */
export function nextTable(table: number, tableCount: number, steps = 1): number {
  const n = tableCount;
  return ((((table - 1 + steps) % n) + n) % n) + 1;
}

/** "5b" -> { table: 5, colour: "b" }; null for anything that isn't a seat id. */
export function parseSeatId(id: string): { table: number; colour: string } | null {
  const m = /^(\d+)([a-z])$/.exec(id);
  if (!m) return null;
  return { table: Number(m[1]), colour: m[2] };
}

/**
 * Where a player should move when the round advances by `steps`: the black
 * seat `steps` tables ahead. Null when they shouldn't move at all — not
 * seated, or in a white (anchor) chair.
 */
export function rotationTarget(
  seatId: string | undefined,
  tableCount: number,
  steps = 1,
): string | null {
  if (!seatId) return null;
  const seat = parseSeatId(seatId);
  if (!seat || seat.colour !== "b") return null;
  return `${nextTable(seat.table, tableCount, steps)}b`;
}

/** Milliseconds left in the current round, on the server's timeline.
 * `clockOffsetMs` is (server now − client now) measured when the state arrived,
 * so `clientNow + offset` estimates the server's clock. Never negative. */
export function remainingMs(
  state: Pick<SessionState, "roundEndsAt">,
  clockOffsetMs: number,
  clientNow: number,
): number {
  return Math.max(0, state.roundEndsAt - (clientNow + clockOffsetMs));
}

/** "mm:ss". Rounds seconds UP so the display only reads 00:00 once time is
 * truly out, rather than a second early. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
