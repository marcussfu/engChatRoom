import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  type Scene,
} from "@babylonjs/core";

/** Inner walkable rectangle of the Cafe, in world units (centred on origin).
 * The server's spawn point mirrors ROOM_HALF_Z - 2 (realtime/internal/game/client.go
 * spawnZ) — change both together. */
export const ROOM_HALF_X = 14;
export const ROOM_HALF_Z = 10;

export interface TableMarker {
  n: number;
  x: number;
  z: number;
  radius: number;
}

/** One sittable seat: `anchor` = white chair (fixed), `rotator` = black chair
 * (moves between tables each round in the language-exchange mode, Phase 2). */
export interface SeatMarker {
  id: string;
  table: number;
  role: "anchor" | "rotator";
  x: number;
  z: number;
  /** Yaw the avatar should face once seated (toward the table). */
  yaw: number;
}

/** A conversation zone: everyone inside subscribes to everyone else's media
 * (docs/PLAN.md §二 "Proximity / zone → 媒體訂閱"). Phase 0 placeholder is one
 * circular zone per table; real scenes will author arbitrary zone polygons. */
export interface ZoneMarker {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface Environment {
  shadows: ShadowGenerator;
  /** Table centres for cheap avatar keep-out; also where seat anchors land later. */
  tables: TableMarker[];
  seats: SeatMarker[];
  zones: ZoneMarker[];
}

/** Zone radius in metres — bigger than a table's seats, smaller than half the
 * gap between tables so neighbouring zones don't overlap (TABLE_GAP_X/Z below
 * are both 4 m, so half the gap is 2 m — 1.8 stays safe with a small margin). */
const ZONE_RADIUS = 1.8;

// The 4x4 table grid deliberately doesn't fill the room (docs/PLAN.md
// 2026-10-01 feedback): it's compacted and pushed toward the east wall and
// the room's Z-centre, leaving the whole west strip (by the TOPIC/TIMER
// boards on wallW) open for future room features. TABLE_ORIGIN_Z is centred
// so the gap to wallN and wallS comes out equal regardless of which one
// "the front wall" turns out to mean.
const TABLE_ORIGIN_X = -1; // column 0's centre
const TABLE_GAP_X = 4;
const TABLE_ORIGIN_Z = -6; // row 0's centre
const TABLE_GAP_Z = 4;

/**
 * Phase 0 placeholder "Cafe": floor, two lights with shadows, four walls and a
 * grid of numbered tables. A real low-poly glb replaces this in a later phase
 * (docs/PLAN.md §一.A) — keep the return shape stable so the swap is local.
 */
export function buildEnvironment(scene: Scene): Environment {
  scene.clearColor = new Color4(0.62, 0.73, 0.83, 1);

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.3, 0.3, 0.35);

  const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, -0.4), scene);
  sun.position = new Vector3(18, 24, 14);
  sun.intensity = 1.1;

  const shadows = new ShadowGenerator(1024, sun);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 16;

  // Floor
  const floorMat = new StandardMaterial("floor", scene);
  floorMat.diffuseColor = new Color3(0.82, 0.78, 0.72);
  floorMat.specularColor = new Color3(0.05, 0.05, 0.05);
  const floor = MeshBuilder.CreateGround(
    "floor",
    { width: ROOM_HALF_X * 2 + 4, height: ROOM_HALF_Z * 2 + 4 },
    scene,
  );
  floor.material = floorMat;
  floor.receiveShadows = true;

  // Walls
  const wallMat = new StandardMaterial("wall", scene);
  wallMat.diffuseColor = new Color3(0.45, 0.36, 0.3);
  const wallH = 3.2;
  const wallT = 0.3;
  const mkWall = (name: string, w: number, d: number, x: number, z: number) => {
    const m = MeshBuilder.CreateBox(name, { width: w, height: wallH, depth: d }, scene);
    m.material = wallMat;
    m.position.set(x, wallH / 2, z);
    m.receiveShadows = true;
    return m;
  };
  const spanX = ROOM_HALF_X * 2 + wallT;
  const spanZ = ROOM_HALF_Z * 2 + wallT;
  mkWall("wallN", spanX, wallT, 0, -ROOM_HALF_Z);
  mkWall("wallS", spanX, wallT, 0, ROOM_HALF_Z);
  mkWall("wallW", wallT, spanZ, -ROOM_HALF_X, 0);
  mkWall("wallE", wallT, spanZ, ROOM_HALF_X, 0);

  // Numbered tables: 4 rows x 4 columns
  const tableMat = new StandardMaterial("table", scene);
  tableMat.diffuseColor = new Color3(0.25, 0.22, 0.2);
  const chairMat = new StandardMaterial("chair", scene);
  chairMat.diffuseColor = new Color3(0.9, 0.87, 0.8);

  const tables: TableMarker[] = [];
  const seats: SeatMarker[] = [];
  const zones: ZoneMarker[] = [];
  const cols = 4;
  const rows = 4;
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = TABLE_ORIGIN_X + col * TABLE_GAP_X;
      const z = TABLE_ORIGIN_Z + r * TABLE_GAP_Z;

      const top = MeshBuilder.CreateCylinder(
        `table${n}`,
        { diameter: 1.2, height: 0.75, tessellation: 16 },
        scene,
      );
      top.material = tableMat;
      top.position.set(x, 0.38, z);
      top.receiveShadows = true;
      shadows.addShadowCaster(top);

      // one "anchor" (white) and one "rotator" (black) seat per table, ±X
      // (face to face across the table), each facing the table centre.
      for (const [dx, mat, role] of [
        [0.95, chairMat, "anchor"],
        [-0.95, tableMat, "rotator"],
      ] as const) {
        const id = `${n}${role === "anchor" ? "w" : "b"}`;
        const seat = MeshBuilder.CreateBox(
          `seat${id}`,
          { width: 0.5, height: 0.5, depth: 0.5 },
          scene,
        );
        seat.material = mat;
        seat.position.set(x + dx, 0.25, z);
        seat.receiveShadows = true;
        shadows.addShadowCaster(seat);

        seats.push({ id, table: n, role, x: x + dx, z, yaw: dx < 0 ? Math.PI / 2 : -Math.PI / 2 });
      }

      tables.push({ n, x, z, radius: 0.95 });
      zones.push({ id: `table${n}`, x, z, radius: ZONE_RADIUS });
      n++;
    }
  }

  return { shadows, tables, seats, zones };
}
