/** Smallest signed rotation taking `from` to `to`, in (-PI, PI]. */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Framerate-independent exponential smoothing factor for a given rate `k`. */
export function dampFactor(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}
