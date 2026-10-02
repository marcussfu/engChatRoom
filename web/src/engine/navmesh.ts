import { init, NavMeshQuery } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";

// Click-to-move pathfinding (docs/PLAN.md §一.B "navmesh 尋路") replacing the
// old straight-line-plus-push-out movement. Uses recast-navigation (WASM
// Recast/Detour bindings) rather than Babylon's own RecastJSPlugin wrapper --
// the latter expects a global `Recast()` loaded via a separate script tag,
// which doesn't fit Vite's ESM bundling; recast-navigation is a plain async
// `init()` + npm import instead.
//
// The floor mesh fed to Recast is built synthetically from known game data
// (room bounds + each table's keep-out circle from environment.ts) rather
// than extracted from the rendered Babylon meshes: a hand-rolled grid with
// table cells omitted guarantees, by construction, that no walkable triangle
// exists under a table, with no dependence on Recast's height/slope-based
// obstacle filtering (whose exact behaviour we have no way to visually
// verify in this environment -- see docs/PLAN.md's navmesh entry).

// Synthetic floor grid resolution, world metres. A cell is excluded (hole)
// based on its CENTRE point only, so the approximated hole boundary can
// wobble by up to half a cell width off the true circle — at the old 0.5m
// this was wide enough to fully close an already-tight gap between two
// tables on top of Recast's own walkableRadius erosion below, forcing
// click-to-move to route around rows it should have been able to cut
// straight through (reported 2026-10-02). 0.2m keeps that wobble to ~0.1m.
const CELL_SIZE = 0.2;
const RECAST_CS = 0.2; // Recast voxel xz cell size, world units
const RECAST_CH = 0.2; // Recast voxel cell height, world units

// Mirrors avatar.ts's AVATAR_RADIUS/AVATAR_HEIGHT -- kept as local constants
// rather than importing avatar.ts, so this module (and its tests) stay free
// of any Babylon dependency.
const AGENT_RADIUS = 0.32;
const AGENT_HEIGHT = 1.7;
const AGENT_MAX_CLIMB = 0.2; // metres -- comfortably under any table's height

export interface FloorBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

/**
 * Builds a flat (y=0) floor mesh over `bounds` as a regular grid, omitting
 * any cell whose centre falls inside an obstacle's circle -- punching an
 * actual hole in the geometry. Exported for unit testing; `buildNavMesh`
 * feeds its output straight to Recast.
 */
export function buildFloorGeometry(
  bounds: FloorBounds,
  obstacles: Obstacle[],
): { positions: number[]; indices: number[] } {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / CELL_SIZE));
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / CELL_SIZE));
  const stepX = (bounds.maxX - bounds.minX) / cols;
  const stepZ = (bounds.maxZ - bounds.minZ) / rows;

  const positions: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      positions.push(bounds.minX + c * stepX, 0, bounds.minZ + r * stepZ);
    }
  }
  const vertexIndex = (c: number, r: number) => r * (cols + 1) + c;

  const blocked = (x: number, z: number): boolean =>
    obstacles.some((o) => {
      const dx = x - o.x;
      const dz = z - o.z;
      return dx * dx + dz * dz <= o.radius * o.radius;
    });

  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = bounds.minX + (c + 0.5) * stepX;
      const cz = bounds.minZ + (r + 0.5) * stepZ;
      if (blocked(cx, cz)) continue;

      const a = vertexIndex(c, r);
      const b = vertexIndex(c + 1, r);
      const cc = vertexIndex(c + 1, r + 1);
      const d = vertexIndex(c, r + 1);
      // Counter-clockwise when viewed from +Y, per recast-navigation's
      // expected winding (see docs/PLAN.md -- this is the one thing that,
      // if backwards, should make generateSoloNavMesh fail loudly rather
      // than silently misbehave, since the floor's normals would then all
      // point down and fail the walkable-slope check).
      indices.push(a, cc, b, a, d, cc);
    }
  }

  return { positions, indices };
}

export interface NavMesh2D {
  /** A path of waypoints from `from` to `to`, snapped onto the mesh, or
   * null if no path exists (e.g. either point is off the baked floor). */
  findPath(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] | null;
  dispose(): void;
}

let initPromise: Promise<void> | null = null;

/** Bakes a navmesh from the room's floor bounds and obstacle list. Call once
 * per scene and await before use; the synchronous click-to-move path still
 * falls back to a direct walk if this hasn't resolved yet (see LocalPlayer). */
export async function buildNavMesh(bounds: FloorBounds, obstacles: Obstacle[]): Promise<NavMesh2D | null> {
  initPromise ??= init();
  await initPromise;

  const { positions, indices } = buildFloorGeometry(bounds, obstacles);
  const { success, navMesh } = generateSoloNavMesh(positions, indices, {
    cs: RECAST_CS,
    ch: RECAST_CH,
    walkableRadius: Math.ceil(AGENT_RADIUS / RECAST_CS),
    walkableHeight: Math.ceil(AGENT_HEIGHT / RECAST_CH),
    walkableClimb: Math.round(AGENT_MAX_CLIMB / RECAST_CH),
  });
  if (!success || !navMesh) return null;

  const query = new NavMeshQuery(navMesh);
  return {
    findPath(from, to) {
      const result = query.computePath({ x: from.x, y: 0, z: from.z }, { x: to.x, y: 0, z: to.z });
      if (!result.success || result.path.length === 0) return null;
      return result.path.map((p) => ({ x: p.x, z: p.z }));
    },
    dispose() {
      query.destroy();
      navMesh.destroy();
    },
  };
}
