import { describe, expect, it } from "vitest";
import { buildFloorGeometry, buildNavMesh } from "./navmesh";

// Mirrors the Cafe's actual layout (environment.ts) as plain literals rather
// than importing environment.ts, since that module pulls in Babylon just to
// build a 3D scene this test doesn't need.
const BOUNDS = { minX: -13.5, maxX: 13.5, minZ: -9.5, maxZ: 9.5 };
const TABLE_RADIUS = 0.95;
const tables = (() => {
  const out: { x: number; z: number; radius: number }[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out.push({ x: -1 + col * 4, z: -6 + row * 4, radius: TABLE_RADIUS });
    }
  }
  return out;
})();

describe("buildFloorGeometry", () => {
  it("produces well-formed triangle data", () => {
    const { positions, indices } = buildFloorGeometry(BOUNDS, tables);
    expect(positions.length % 3).toBe(0);
    expect(indices.length % 3).toBe(0);
    expect(indices.length).toBeGreaterThan(0);
    const vertexCount = positions.length / 3;
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(vertexCount);
    }
  });

  it("omits every cell whose centre falls inside a table", () => {
    const { positions, indices } = buildFloorGeometry(BOUNDS, tables);
    for (let t = 0; t < indices.length; t += 3) {
      const cx = (positions[indices[t] * 3] + positions[indices[t + 1] * 3] + positions[indices[t + 2] * 3]) / 3;
      const cz =
        (positions[indices[t] * 3 + 2] + positions[indices[t + 1] * 3 + 2] + positions[indices[t + 2] * 3 + 2]) / 3;
      for (const table of tables) {
        const dx = cx - table.x;
        const dz = cz - table.z;
        // Triangle centroids can land just outside a blocked cell's own
        // centre-point test, so allow a bit of slack rather than asserting
        // the exact radius.
        expect(dx * dx + dz * dz).toBeGreaterThan(table.radius * table.radius * 0.3);
      }
    }
  });
});

// These exercise the real recast-navigation WASM bake + query, not a mock --
// the main thing this project can't verify any other way without a browser
// (docs/PLAN.md flagged this as the first feature needing that). A backwards
// triangle winding order would most likely show up here as generateSoloNavMesh
// failing outright (floor normals pointing down, failing the walkable-slope
// check), which is exactly the kind of "fails loudly" bug this test is for.
describe("buildNavMesh (real recast-navigation bake)", () => {
  it("bakes successfully and finds a direct path across open floor", async () => {
    const nav = await buildNavMesh(BOUNDS, tables);
    expect(nav).not.toBeNull();
    const path = nav?.findPath({ x: -12, z: -9 }, { x: -12, z: -7 });
    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThanOrEqual(2);
    nav?.dispose();
  });

  it("routes around a table instead of cutting through it", async () => {
    const nav = await buildNavMesh(BOUNDS, tables);
    expect(nav).not.toBeNull();
    // Table 1 sits at (-1, -6); a straight line from (-3, -6) to (1, -6)
    // passes straight through its keep-out circle.
    const path = nav?.findPath({ x: -3, z: -6 }, { x: 1, z: -6 });
    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThan(2);
    nav?.dispose();
  });
});
