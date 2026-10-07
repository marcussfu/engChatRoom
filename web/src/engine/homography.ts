// Warps a flat DOM element onto a projected quad (Game.ts's big-screen embed
// overlay): rather than re-synthesizing Babylon's camera/projection in CSS
// (the three.js CSS3DRenderer approach), this takes 4 screen-space points
// Game.ts has already computed via Vector3.Project and solves the much
// smaller problem of "warp this rectangle to match those 4 points" -- a
// standard planar homography, packed into a CSS matrix3d. This is what makes
// the overlay look glued to the wall from an angle instead of always facing
// the camera like a billboard.

export interface Point {
  x: number;
  y: number;
}

/** Solves for the 8 parameters of a planar homography mapping each `src[i]`
 * to `dst[i]` (exactly 4 correspondences, matching order):
 * x' = (a*x + b*y + c) / (g*x + h*y + 1), y' = (d*x + e*y + f) / (g*x + h*y + 1).
 * Returns [a,b,c,d,e,f,g,h]. */
export function solveHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  return solveLinear(A, b);
}

/** Gaussian elimination with partial pivoting for a square system A*p = b. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const d = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

/** Applies the homography forward: maps `p` the same way the CSS transform
 * will map the element's local coordinates. Exported mainly so tests can
 * verify solveHomography's output actually reproduces the points it was
 * solved from. */
export function applyHomography(params: number[], p: Point): Point {
  const [a, b, c, d, e, f, g, h] = params;
  const w = g * p.x + h * p.y + 1;
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}

/** Packs the 8 homography parameters from solveHomography into a CSS
 * `matrix3d(...)` string. Folding the perspective terms (g, h) into the
 * matrix's w-row is the standard way to express a 2D homography as a CSS 3D
 * transform -- the browser's own perspective divide then reproduces the
 * x'=.../w, y'=.../w behaviour. */
export function homographyToCssMatrix3d(p: number[]): string {
  const [a, b, c, d, e, f, g, h] = p;
  // prettier-ignore
  const m = [
    a, d, 0, g,
    b, e, 0, h,
    0, 0, 1, 0,
    c, f, 0, 1,
  ];
  return `matrix3d(${m.map((v) => v.toFixed(6)).join(",")})`;
}
