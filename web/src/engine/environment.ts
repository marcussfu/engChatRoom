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
 * (moves between tables each round in the language-exchange mode, Phase 2).
 * `sofa` is a plain group-chat seat (see SOFA_SEATS_PER_SOFA below) — never
 * rotates, not tied to any numbered table. */
export interface SeatMarker {
  id: string;
  table: number;
  role: "anchor" | "rotator" | "sofa";
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
  /** Sofa footprints, approximated as circles — fed to the navmesh as
   * obstacles alongside tables (see Game.ts) so routes don't cut through them. */
  sofas: { x: number; z: number; radius: number }[];
  /** The broadcast zone (docs/PLAN.md 2026-10-01 feedback, item 6): anyone
   * standing inside is heard at full volume by the whole room regardless of
   * distance — see Media.updateProximity. */
  broadcastZone: { x: number; z: number; radius: number };
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

// Group-chat sofas (docs/PLAN.md 2026-10-01 feedback, item 5) along wallN —
// that wall is otherwise bare now that the table grid no longer reaches it.
// No special zone/audio handling is needed for "sitting together chats
// together": proximity voice is already purely distance-based (README), and
// seats 0.8m apart on the same sofa are well within the 3m full-volume
// radius.
const SOFA_X = [-7, 7]; // centre of each sofa, along the wall
const SOFA_Z = -9.3; // close to wallN's inner face
const SOFA_SEAT_SPACING = 0.8;
const SOFA_SEATS_PER_SOFA = 3;
const SOFA_WIDTH = SOFA_SEAT_SPACING * SOFA_SEATS_PER_SOFA + 0.4;

// The broadcast zone (item 6) sits on the floor in the south-east corner, in
// front of where sessionBoards.ts mounts the host-featured big board on
// wallS — kept clear of both wallS and the nearest table row (row 3, z=6).
const BROADCAST_ZONE = { x: 9, z: 8.3, radius: ZONE_RADIUS };

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
  const sofas: Environment["sofas"] = [];
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
        const yaw = dx < 0 ? Math.PI / 2 : -Math.PI / 2;
        createChair(scene, shadows, `seat${id}`, x + dx, z, yaw, mat);
        seats.push({ id, table: n, role, x: x + dx, z, yaw });
      }

      tables.push({ n, x, z, radius: 0.95 });
      zones.push({ id: `table${n}`, x, z, radius: ZONE_RADIUS });
      n++;
    }
  }

  // Group-chat sofas (see SOFA_* constants above).
  const sofaMat = new StandardMaterial("sofa", scene);
  sofaMat.diffuseColor = new Color3(0.72, 0.18, 0.18);
  for (let s = 0; s < SOFA_X.length; s++) {
    const sofaX = SOFA_X[s];
    const pad = MeshBuilder.CreateBox(
      `sofaPad${s}`,
      { width: SOFA_WIDTH, height: 0.4, depth: 0.8 },
      scene,
    );
    pad.material = sofaMat;
    pad.position.set(sofaX, 0.2, SOFA_Z);
    pad.receiveShadows = true;
    shadows.addShadowCaster(pad);

    const back = MeshBuilder.CreateBox(
      `sofaBack${s}`,
      { width: SOFA_WIDTH, height: 0.6, depth: 0.15 },
      scene,
    );
    back.material = sofaMat;
    back.position.set(sofaX, 0.5, SOFA_Z - 0.4 - 0.075);
    back.receiveShadows = true;
    shadows.addShadowCaster(back);

    for (let i = 0; i < SOFA_SEATS_PER_SOFA; i++) {
      const seatX = sofaX + (i - (SOFA_SEATS_PER_SOFA - 1) / 2) * SOFA_SEAT_SPACING;
      const id = `sofa${s + 1}-${i}`;
      const marker = MeshBuilder.CreateBox(
        `seat${id}`,
        { width: SOFA_SEAT_SPACING - 0.1, height: 0.1, depth: 0.7 },
        scene,
      );
      marker.material = sofaMat;
      marker.position.set(seatX, 0.41, SOFA_Z);
      marker.receiveShadows = true;
      // Same colour as the sofa pad so this click target blends in rather
      // than reading as a separate object — Babylon's picking skips
      // invisible meshes, so it can't just be hidden.
      seats.push({ id, table: 0, role: "sofa", x: seatX, z: SOFA_Z, yaw: 0 });
    }

    sofas.push({ x: sofaX, z: SOFA_Z, radius: SOFA_WIDTH / 2 + 0.3 });
  }

  // Broadcast zone floor patch.
  const broadcastMat = new StandardMaterial("broadcastZone", scene);
  broadcastMat.diffuseColor = new Color3(0.55, 0.25, 0.75);
  broadcastMat.alpha = 0.6;
  const broadcastDecal = MeshBuilder.CreateDisc(
    "broadcastZone",
    { radius: BROADCAST_ZONE.radius, tessellation: 32 },
    scene,
  );
  broadcastDecal.material = broadcastMat;
  broadcastDecal.rotation.x = Math.PI / 2; // lie flat on the floor
  broadcastDecal.position.set(BROADCAST_ZONE.x, 0.02, BROADCAST_ZONE.z); // just above the floor, avoid z-fighting
  broadcastDecal.isPickable = false;

  return { shadows, tables, seats, zones, sofas, broadcastZone: BROADCAST_ZONE };
}

/** A simple placeholder chair: a seat pad plus a backrest (rather than a
 * single cube), facing `yaw` (docs/PLAN.md 2026-10-01 feedback, item 1 —
 * closer to the reference screenshot's chair silhouette while staying a
 * couple of primitive boxes). Both parts share `name` so either one clicks
 * as the same seat (see Game.ts's seatByMesh lookup). */
function createChair(
  scene: Scene,
  shadows: ShadowGenerator,
  name: string,
  x: number,
  z: number,
  yaw: number,
  mat: StandardMaterial,
): void {
  const pad = MeshBuilder.CreateBox(name, { width: 0.5, height: 0.08, depth: 0.5 }, scene);
  pad.material = mat;
  pad.position.set(x, 0.42, z);
  pad.rotation.y = yaw;
  pad.receiveShadows = true;
  shadows.addShadowCaster(pad);

  // The backrest sits behind the seat pad, opposite the facing direction.
  const back = MeshBuilder.CreateBox(name, { width: 0.5, height: 0.5, depth: 0.08 }, scene);
  back.material = mat;
  back.position.set(x - Math.sin(yaw) * 0.21, 0.71, z - Math.cos(yaw) * 0.21);
  back.rotation.y = yaw;
  back.receiveShadows = true;
  shadows.addShadowCaster(back);
}
