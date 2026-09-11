import { TransformNode, Vector3, type Scene, type ShadowGenerator } from "@babylonjs/core";
import type { PlayerState } from "../net/types";
import { createAvatar } from "./avatar";
import { dampFactor, shortestAngle } from "./mathUtils";

const SMOOTH_K = 14; // exponential catch-up rate
const SETTLE_EPS = 0.0008;

interface Remote {
  node: TransformNode;
  tx: number;
  tz: number;
  tyaw: number;
  dyaw: number;
  seatId?: string;
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
        r.node.dispose();
        this.map.delete(id);
      }
    }
  }

  remove(id: string): void {
    const r = this.map.get(id);
    if (r) {
      r.node.dispose();
      this.map.delete(id);
    }
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
    for (const r of this.map.values()) r.node.dispose();
    this.map.clear();
  }
}
