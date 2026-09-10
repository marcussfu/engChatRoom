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

/** Inner walkable rectangle of the Cafe, in world units (centred on origin). */
export const ROOM_HALF_X = 11;
export const ROOM_HALF_Z = 8;

export interface TableMarker {
  n: number;
  x: number;
  z: number;
  radius: number;
}

export interface Environment {
  shadows: ShadowGenerator;
  /** Table centres for cheap avatar keep-out; also where seat anchors land later. */
  tables: TableMarker[];
}

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
  const cols = 4;
  const rows = 4;
  const gapX = (ROOM_HALF_X * 2 - 4) / (cols - 1);
  const gapZ = (ROOM_HALF_Z * 2 - 4) / (rows - 1);
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = -ROOM_HALF_X + 2 + col * gapX;
      const z = -ROOM_HALF_Z + 2 + r * gapZ;

      const top = MeshBuilder.CreateCylinder(
        `table${n}`,
        { diameter: 1.2, height: 0.75, tessellation: 16 },
        scene,
      );
      top.material = tableMat;
      top.position.set(x, 0.38, z);
      top.receiveShadows = true;
      shadows.addShadowCaster(top);

      // one "anchor" (white) and one "rotator" (black) seat per table, ±Z
      for (const [dz, mat] of [
        [-0.95, chairMat],
        [0.95, tableMat],
      ] as const) {
        const seat = MeshBuilder.CreateBox(
          `seat${n}_${dz < 0 ? "w" : "b"}`,
          { width: 0.5, height: 0.5, depth: 0.5 },
          scene,
        );
        seat.material = mat;
        seat.position.set(x, 0.25, z + dz);
        seat.receiveShadows = true;
        shadows.addShadowCaster(seat);
      }

      tables.push({ n, x, z, radius: 0.95 });
      n++;
    }
  }

  return { shadows, tables };
}
