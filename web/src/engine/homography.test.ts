import { describe, expect, it } from "vitest";
import { applyHomography, homographyToCssMatrix3d, solveHomography, type Point } from "./homography";

const REF: Point[] = [
  { x: 0, y: 360 }, // bottom-left
  { x: 640, y: 360 }, // bottom-right
  { x: 640, y: 0 }, // top-right
  { x: 0, y: 0 }, // top-left
];

describe("solveHomography", () => {
  it("reproduces a pure scale+translate (no perspective) exactly", () => {
    // Destination is REF scaled by 0.5 and shifted by (100, 50) -- a plain
    // affine map, so the perspective terms (g, h) should come out ~0.
    const dst: Point[] = REF.map((p) => ({ x: p.x * 0.5 + 100, y: p.y * 0.5 + 50 }));
    const params = solveHomography(REF, dst);
    expect(params[6]).toBeCloseTo(0, 6); // g
    expect(params[7]).toBeCloseTo(0, 6); // h
    for (let i = 0; i < 4; i++) {
      const got = applyHomography(params, REF[i]);
      expect(got.x).toBeCloseTo(dst[i].x, 6);
      expect(got.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it("reproduces a genuinely skewed quad (the case this exists for)", () => {
    // A trapezoid, as if the screen were viewed from an angle: the right
    // edge is compressed relative to the left, simulating foreshortening.
    const dst: Point[] = [
      { x: 50, y: 400 },
      { x: 700, y: 450 },
      { x: 650, y: 100 },
      { x: 100, y: 60 },
    ];
    const params = solveHomography(REF, dst);
    for (let i = 0; i < 4; i++) {
      const got = applyHomography(params, REF[i]);
      expect(got.x).toBeCloseTo(dst[i].x, 4);
      expect(got.y).toBeCloseTo(dst[i].y, 4);
    }
  });

  it("maps the rectangle's centre to roughly the quad's centroid for a mild skew", () => {
    const dst: Point[] = [
      { x: 100, y: 400 },
      { x: 700, y: 400 },
      { x: 680, y: 50 },
      { x: 120, y: 50 },
    ];
    const params = solveHomography(REF, dst);
    const centre = applyHomography(params, { x: 320, y: 180 });
    const centroidX = dst.reduce((s, p) => s + p.x, 0) / 4;
    const centroidY = dst.reduce((s, p) => s + p.y, 0) / 4;
    // A homography's centre mapping isn't exactly the centroid for a
    // non-affine (perspective) quad, but for this mild a skew it should be
    // close -- a loose bound just to catch a badly wrong solve.
    expect(Math.abs(centre.x - centroidX)).toBeLessThan(40);
    expect(Math.abs(centre.y - centroidY)).toBeLessThan(40);
  });
});

describe("homographyToCssMatrix3d", () => {
  it("produces a matrix3d(...) string with 16 comma-separated numbers", () => {
    const params = solveHomography(REF, REF); // identity
    const css = homographyToCssMatrix3d(params);
    expect(css.startsWith("matrix3d(")).toBe(true);
    const nums = css.slice("matrix3d(".length, -1).split(",");
    expect(nums).toHaveLength(16);
    for (const n of nums) expect(Number.isFinite(Number(n))).toBe(true);
  });
});
