import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  VideoTexture,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import type { EmoteKind, PlayerState, PlayerStatus } from "../net/types";
import type { VideoSource } from "../media/livekit";
import { AVATAR_HEIGHT, createAvatar } from "./avatar";
import { dampFactor, shortestAngle } from "./mathUtils";

const SMOOTH_K = 14; // exponential catch-up rate
const SETTLE_EPS = 0.0008;

// Status/emote badges (docs/PLAN.md §一.B.8 "狀態" / "Emote / 舉手"). Placeholder
// avatars have no face or rig to animate, so both are drawn as an emoji on a
// small unlit canvas-textured plane rather than a real gesture — swap for
// actual animation once rigged avatars land (§一.A).
const BADGE_SIZE = 0.32;
const BADGE_Y = AVATAR_HEIGHT + 0.75; // clears the video billboard's top edge
const STATUS_ICON: Partial<Record<PlayerStatus, string>> = {
  meeting: "📅",
  lunch: "🍔",
  focus: "🎯",
  // "present" (the default) shows nothing — the common case shouldn't add clutter.
};

const EMOTE_ICON: Record<EmoteKind, string> = {
  wave: "👋",
  clap: "👏",
  heart: "❤️",
  laugh: "😂",
};
const EMOTE_SIZE = 0.5;
const EMOTE_BASE_Y = AVATAR_HEIGHT + 0.9;
const EMOTE_RISE = 0.5; // metres climbed over its lifetime
const EMOTE_LIFETIME_MS = 2000;

interface EmoteBurst {
  plane: Mesh;
  texture: DynamicTexture;
  ageMs: number;
}

/** Draws `icon` centred on a fresh square DynamicTexture and wires it up as
 * both the emissive and opacity source of an unlit, backface-visible plane —
 * the shared recipe behind both the status badge and the emote burst. */
function paintIcon(scene: Scene, plane: Mesh, icon: string, texturePx: number, fontPx: number): DynamicTexture {
  const texture = new DynamicTexture("icon", { width: texturePx, height: texturePx }, scene, false);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, texturePx, texturePx);
  ctx.font = `${fontPx}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon, texturePx / 2, texturePx / 2 + fontPx * 0.05); // nudge for emoji glyph baseline
  texture.update();

  const mat = plane.material as StandardMaterial;
  mat.emissiveTexture = texture;
  mat.opacityTexture = texture;
  return texture;
}

function makeIconPlane(scene: Scene, size: number): Mesh {
  const plane = MeshBuilder.CreatePlane("icon", { size }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const mat = new StandardMaterial("iconMat", scene);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.diffuseColor = Color3.Black();
  plane.material = mat;
  return plane;
}

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
  status?: PlayerStatus;
  raisedHand?: boolean;
  badgePlane?: Mesh;
  badgeTexture?: DynamicTexture;
}

/** Other players: created/destroyed from snapshots, smoothed toward the latest
 * server position each frame (framerate-independent exponential interpolation). */
export class RemotePlayers {
  private selfId = "";
  private readonly map = new Map<string, Remote>();
  private readonly bursts: EmoteBurst[] = [];

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

  /** Rebuild `r`'s status badge — a raised hand takes priority over a status
   * icon (it's the more time-sensitive of the two); "present" and no raised
   * hand show nothing. */
  private refreshBadge(r: Remote): void {
    const icon = r.raisedHand ? "✋" : r.status ? STATUS_ICON[r.status] : undefined;

    r.badgeTexture?.dispose();
    r.badgeTexture = undefined;

    if (!icon) {
      r.badgePlane?.dispose();
      r.badgePlane = undefined;
      return;
    }

    if (!r.badgePlane) {
      const plane = makeIconPlane(this.scene, BADGE_SIZE);
      plane.parent = r.node;
      plane.position.set(0, BADGE_Y, 0);
      r.badgePlane = plane;
    }
    r.badgeTexture = paintIcon(this.scene, r.badgePlane, icon, 64, 48);
  }

  /** Show a transient emote above `id`'s avatar. No-op for an unknown id (e.g.
   * it arriving just after they left). */
  spawnEmote(id: string, emote: EmoteKind): void {
    const r = this.map.get(id);
    if (r) this.spawnEmoteAt(r.node.position, emote);
  }

  /** Same as spawnEmote, but at a world position rather than a tracked remote —
   * for the local player's own emotes, which this class doesn't otherwise know
   * about. The burst doesn't track a moving target afterward; over its ~2s
   * lifetime that's not worth the extra bookkeeping. */
  spawnEmoteAt(position: Vector3, emote: EmoteKind): void {
    const plane = makeIconPlane(this.scene, EMOTE_SIZE);
    plane.position.copyFrom(position);
    plane.position.y = EMOTE_BASE_Y;
    const texture = paintIcon(this.scene, plane, EMOTE_ICON[emote], 128, 96);
    this.bursts.push({ plane, texture, ageMs: 0 });
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
        r = {
          node, tx: p.x, tz: p.z, tyaw: p.yaw, dyaw: p.yaw, seatId: p.seatId,
          status: p.status, raisedHand: p.raisedHand,
        };
        this.map.set(p.id, r);
        this.refreshBadge(r);
      } else {
        r.tx = p.x;
        r.tz = p.z;
        r.tyaw = p.yaw;
        r.seatId = p.seatId;
        const badgeChanged = r.status !== p.status || !!r.raisedHand !== !!p.raisedHand;
        r.status = p.status;
        r.raisedHand = p.raisedHand;
        if (badgeChanged) this.refreshBadge(r);
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
    r.badgeTexture?.dispose();
    r.badgePlane?.dispose();
    r.node.dispose();
  }

  /** Returns true while at least one avatar is still visibly catching up, or
   * an emote burst is still animating — either way the caller (render-on-demand)
   * needs to keep drawing frames. */
  update(dt: number): boolean {
    let moving = false;
    const a = dampFactor(SMOOTH_K, dt);

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

    if (this.bursts.length > 0) {
      moving = true;
      const dtMs = dt * 1000;
      for (const b of this.bursts) {
        b.ageMs += dtMs;
        const t = Math.min(1, b.ageMs / EMOTE_LIFETIME_MS);
        b.plane.position.y = EMOTE_BASE_Y + EMOTE_RISE * t;
        b.plane.visibility = 1 - t;
      }
      for (let i = this.bursts.length - 1; i >= 0; i--) {
        if (this.bursts[i].ageMs >= EMOTE_LIFETIME_MS) {
          const [done] = this.bursts.splice(i, 1);
          done.texture.dispose();
          done.plane.dispose();
        }
      }
    }

    return moving;
  }

  dispose(): void {
    for (const r of this.map.values()) this.disposeRemote(r);
    this.map.clear();
    for (const b of this.bursts) {
      b.texture.dispose();
      b.plane.dispose();
    }
    this.bursts.length = 0;
  }
}
