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
import { BrickProceduralTexture } from "@babylonjs/procedural-textures";

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
  /** The broadcast zone (docs/PLAN.md 2026-10-01/02 feedback, item 6): an
   * axis-aligned rectangle; anyone standing inside is heard at full volume by
   * the whole room regardless of distance — see Media.updateProximity. */
  broadcastZone: { minX: number; maxX: number; minZ: number; maxZ: number };
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
const TABLE_ORIGIN_X = -7; // column 0's centre
const TABLE_GAP_X = 4;
const TABLE_ORIGIN_Z = -2; // row 0's centre
const TABLE_GAP_Z = 3;

// Group-chat sofas (docs/PLAN.md 2026-10-01 feedback, item 5; moved to wallW
// 2026-10-02 per the user's request). Mounted against the same wall as the
// TOPIC/TIMER boards (sessionBoards.ts), set further into the room than the
// board plane since a sofa has real depth — no conflict with the boards
// either way, since those are mounted high up (Y=2.15) while a sofa sits on
// the floor. The first sofa starts right at the TIMER board's Z position
// (sessionBoards.ts's boardZ(3, 4) = 6.75 — not imported from there to avoid
// coupling scene furniture to UI board layout, but keep the two in sync if
// either changes), the second continues back along the wall toward the other
// boards. No special zone/audio handling is needed for "sitting together
// chats together": proximity voice is already purely distance-based
// (README), and seats 0.8m apart on the same sofa are well within the 3m
// full-volume radius.
const SOFA_X = -13; // depth from wallW, shared by every sofa
const SOFA_Z = [6.75, 3.55, -8]; // each sofa's centre along the wall, starting at the TIMER board
const SOFA_SEAT_SPACING = 0.8;
const SOFA_SEATS_PER_SOFA = 3;
const SOFA_WIDTH = SOFA_SEAT_SPACING * SOFA_SEATS_PER_SOFA + 0.4;

// The broadcast zone (item 6; moved + reshaped 2026-10-02 per the user's
// screenshot — a rectangle filling the open west strip by wallW, no longer
// tied to the south-wall featured board's position). Assumes the table
// grid's west edge stays left of maxX — re-check this if TABLE_ORIGIN_X moves
// further west than its current -7.
const BROADCAST_ZONE = { minX: -7.5, maxX: 4.5, minZ: -10, maxZ: -5 };

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
  // Leave diffuseColor at the StandardMaterial default (white) — it
  // multiplies with diffuseTexture, so tinting it would darken the brick
  // texture's own colours instead of letting them show through as-is.
  const brickTexture = new BrickProceduralTexture("brickTex", 512, scene);
  brickTexture.numberOfBricksWidth = 24;
  brickTexture.numberOfBricksHeight = 6;
  brickTexture.brickColor = new Color3(0.55, 0.32, 0.24);
  brickTexture.jointColor = new Color3(0.8, 0.76, 0.68);
  wallMat.diffuseTexture = brickTexture;
  wallMat.specularColor = new Color3(0.05, 0.05, 0.05);
  const wallH = 6; // tall enough to mount a big screen on wallN later
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
  // tableTopMat is the cylinder's own colour; tableMat stays dark separately
  // because it's also reused for the rotator (black) chair below — changing
  // one must not change the other.
  const tableTopMat = new StandardMaterial("tableTop", scene);
  tableTopMat.diffuseColor = new Color3(1, 1, 1);
  // Low specular (matches floorMat's approach) — StandardMaterial's default
  // specular is bright enough that a white diffuse can still read as grey
  // under the scene's cool hemispheric ground light + directional "sun".
  tableTopMat.specularColor = new Color3(0.05, 0.05, 0.05);
  const tableMat = new StandardMaterial("table", scene);
  tableMat.diffuseColor = new Color3(0.25, 0.22, 0.2);
  const chairMat = new StandardMaterial("chair", scene);
  chairMat.diffuseColor = new Color3(0.9, 0.87, 0.8);

  const tables: TableMarker[] = [];
  const seats: SeatMarker[] = [];
  const zones: ZoneMarker[] = [];
  const sofas: Environment["sofas"] = [];
  const cols = 5;
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
      top.material = tableTopMat;
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

  // Group-chat sofas (see SOFA_* constants above). Mounted against wallW, so
  // the box dimensions that were {width, depth} = {along the wall, into the
  // room} on wallN are swapped here — no rotation needed, since an
  // axis-aligned box just needs the right dimension on the right parameter.
  const sofaMat = new StandardMaterial("sofa", scene);
  sofaMat.diffuseColor = new Color3(0.72, 0.18, 0.18);
  for (let s = 0; s < SOFA_Z.length; s++) {
    const sofaZ = SOFA_Z[s];
    const pad = MeshBuilder.CreateBox(
      `sofaPad${s}`,
      { width: 0.8, height: 0.4, depth: SOFA_WIDTH },
      scene,
    );
    pad.material = sofaMat;
    pad.position.set(SOFA_X, 0.2, sofaZ);
    pad.receiveShadows = true;
    shadows.addShadowCaster(pad);

    const back = MeshBuilder.CreateBox(
      `sofaBack${s}`,
      { width: 0.15, height: 0.6, depth: SOFA_WIDTH },
      scene,
    );
    back.material = sofaMat;
    // Backrest on the wallW side (more negative X), matching "behind the
    // person, against the wall" — mirrors the pad-to-backrest offset used on
    // wallN, just on the other axis.
    back.position.set(SOFA_X - 0.4 - 0.075, 0.5, sofaZ);
    back.receiveShadows = true;
    shadows.addShadowCaster(back);

    for (let i = 0; i < SOFA_SEATS_PER_SOFA; i++) {
      const seatZ = sofaZ + (i - (SOFA_SEATS_PER_SOFA - 1) / 2) * SOFA_SEAT_SPACING;
      const id = `sofa${s + 1}-${i}`;
      const marker = MeshBuilder.CreateBox(
        `seat${id}`,
        { width: 0.7, height: 0.1, depth: SOFA_SEAT_SPACING - 0.1 },
        scene,
      );
      marker.material = sofaMat;
      marker.position.set(SOFA_X, 0.41, seatZ);
      marker.receiveShadows = true;
      // Same colour as the sofa pad so this click target blends in rather
      // than reading as a separate object — Babylon's picking skips
      // invisible meshes, so it can't just be hidden.
      // yaw = π/2 faces +X (into the room, away from wallW) — see the
      // forward-vector convention noted on createChair below.
      seats.push({ id, table: 0, role: "sofa", x: SOFA_X, z: seatZ, yaw: Math.PI / 2 });
    }

    sofas.push({ x: SOFA_X, z: sofaZ, radius: SOFA_WIDTH / 2 + 0.3 });
  }

  // Broadcast zone floor patch — a rectangle, not a circle, so CreateGround
  // (already a flat XZ-plane) needs no rotation the way CreateDisc did.
  const broadcastMat = new StandardMaterial("broadcastZone", scene);
  broadcastMat.diffuseColor = new Color3(0.55, 0.25, 0.75);
  broadcastMat.alpha = 0.6;
  const broadcastDecal = MeshBuilder.CreateGround(
    "broadcastZone",
    { width: BROADCAST_ZONE.maxX - BROADCAST_ZONE.minX, height: BROADCAST_ZONE.maxZ - BROADCAST_ZONE.minZ },
    scene,
  );
  broadcastDecal.material = broadcastMat;
  broadcastDecal.position.set(
    (BROADCAST_ZONE.minX + BROADCAST_ZONE.maxX) / 2,
    0.02, // just above the floor, avoid z-fighting
    (BROADCAST_ZONE.minZ + BROADCAST_ZONE.maxZ) / 2,
  );
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
