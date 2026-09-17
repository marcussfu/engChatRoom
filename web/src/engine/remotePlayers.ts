import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  VideoTexture,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import type { PlayerState } from "../net/types";
import type { VideoSource } from "../media/livekit";
import { AVATAR_HEIGHT, createAvatar } from "./avatar";
import { dampFactor, shortestAngle } from "./mathUtils";

const SMOOTH_K = 14; // exponential catch-up rate
const SETTLE_EPS = 0.0008;

// Video billboard (docs/PLAN.md §一.B.4 "視訊以 billboard 貼圖平面顯示在 avatar 上方").
// Screen share reuses the same billboard as camera (whichever is active; screen
// share wins if both are) rather than a dedicated wall screen mesh — there's no
// wall-mounted screen geometry yet (Phase 0's Cafe is still placeholder boxes),
// so a real "stick it on the wall" anchor is Phase 2 work once real scene
// assets exist.
const VIDEO_PLANE_WIDTH = 0.9;
const VIDEO_PLANE_HEIGHT = 0.68; // ~4:3, a reasonable webcam/screen default
const VIDEO_PLANE_Y = AVATAR_HEIGHT + 0.35;

interface Remote {
  node: TransformNode;
  tx: number;
  tz: number;
  tyaw: number;
  dyaw: number;
  seatId?: string;
  cameraEl?: HTMLVideoElement;
  screenEl?: HTMLVideoElement;
  videoPlane?: Mesh;
  videoTexture?: VideoTexture;
}

/** Other players: created/destroyed from snapshots, smoothed toward the latest
 * server position each frame (framerate-independent exponential interpolation). */
export class RemotePlayers {
  private selfId = "";
  private readonly map = new Map<string, Remote>();

  constructor(
    private readonly scene: Scene,
    private readonly shadows?: ShadowGenerator,
  ) {}

  setSelfId(id: string): void {
    this.selfId = id;
  }

  get count(): number {
    return this.map.size;
  }

  /** Seat ids currently taken by other players — for the local click-to-sit
   * occupancy check. */
  occupiedSeats(): Set<string> {
    const taken = new Set<string>();
    for (const r of this.map.values()) {
      if (r.seatId) taken.add(r.seatId);
    }
    return taken;
  }

  /** Current ground position of every remote, keyed by player id — for
   * distance-based proximity audio (see media/livekit.ts). */
  positions(): Map<string, { x: number; z: number }> {
    const out = new Map<string, { x: number; z: number }>();
    for (const [id, r] of this.map) {
      out.set(id, { x: r.node.position.x, z: r.node.position.z });
    }
    return out;
  }

  /** Show `id`'s camera or screen-share video on a billboard above their
   * avatar. No-op if `id` isn't a known remote (e.g. a track arriving just
   * after they left). */
  attachVideo(id: string, el: HTMLVideoElement, source: VideoSource): void {
    const r = this.map.get(id);
    if (!r) return;
    if (source === "camera") r.cameraEl = el;
    else r.screenEl = el;
    this.refreshVideo(r);
  }

  detachVideo(id: string, source: VideoSource): void {
    const r = this.map.get(id);
    if (!r) return;
    if (source === "camera") r.cameraEl = undefined;
    else r.screenEl = undefined;
    this.refreshVideo(r);
  }

  /** Rebuild the billboard for whichever video (screen share, else camera,
   * else none) `r` currently has. Babylon's VideoTexture is bound to its
   * source element at construction, so "switching" means dispose + recreate
   * rather than mutating in place. */
  private refreshVideo(r: Remote): void {
    const el = r.screenEl ?? r.cameraEl;

    r.videoTexture?.dispose();
    r.videoTexture = undefined;

    if (!el) {
      r.videoPlane?.dispose();
      r.videoPlane = undefined;
      return;
    }

    if (!r.videoPlane) {
      const plane = MeshBuilder.CreatePlane(
        "video",
        { width: VIDEO_PLANE_WIDTH, height: VIDEO_PLANE_HEIGHT },
        this.scene,
      );
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL; // always faces the viewer
      plane.parent = r.node;
      plane.position.set(0, VIDEO_PLANE_Y, 0);
      const mat = new StandardMaterial("videoMat", this.scene);
      mat.backFaceCulling = false;
      mat.disableLighting = true; // unlit: full brightness regardless of scene lighting
      mat.diffuseColor = Color3.Black();
      plane.material = mat;
      r.videoPlane = plane;
    }

    const texture = new VideoTexture("videoTex", el, this.scene, true, true);
    const mat = r.videoPlane.material as StandardMaterial;
    mat.emissiveTexture = texture;
    r.videoTexture = texture;
  }

  applySnapshot(players: PlayerState[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.selfId) continue;
      seen.add(p.id);

      let r = this.map.get(p.id);
      if (!r) {
        const node = createAvatar(this.scene, p.color, this.shadows);
        node.position.set(p.x, 0, p.z);
        node.rotation.y = p.yaw;
        r = { node, tx: p.x, tz: p.z, tyaw: p.yaw, dyaw: p.yaw, seatId: p.seatId };
        this.map.set(p.id, r);
      } else {
        r.tx = p.x;
        r.tz = p.z;
        r.tyaw = p.yaw;
        r.seatId = p.seatId;
      }
    }

    for (const [id, r] of this.map) {
      if (!seen.has(id)) {
        this.disposeRemote(r);
        this.map.delete(id);
      }
    }
  }

  remove(id: string): void {
    const r = this.map.get(id);
    if (r) {
      this.disposeRemote(r);
      this.map.delete(id);
    }
  }

  private disposeRemote(r: Remote): void {
    r.videoTexture?.dispose();
    r.videoPlane?.dispose();
    r.node.dispose();
  }

  /** Returns true while at least one avatar is still visibly catching up. */
  update(dt: number): boolean {
    if (this.map.size === 0) return false;
    const a = dampFactor(SMOOTH_K, dt);
    let moving = false;

    for (const r of this.map.values()) {
      const p = r.node.position;
      const nx = p.x + (r.tx - p.x) * a;
      const nz = p.z + (r.tz - p.z) * a;
      if (Vector3.DistanceSquared(p, new Vector3(nx, 0, nz)) > SETTLE_EPS) moving = true;
      p.x = nx;
      p.z = nz;

      const delta = shortestAngle(r.dyaw, r.tyaw);
      if (Math.abs(delta) > 1e-3) {
        r.dyaw += delta * a;
        r.node.rotation.y = r.dyaw;
        moving = true;
      }
    }
    return moving;
  }

  dispose(): void {
    for (const r of this.map.values()) this.disposeRemote(r);
    this.map.clear();
  }
}
