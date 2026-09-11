import { Vector3, type Scene, type ShadowGenerator } from "@babylonjs/core";
import type { Anim } from "../net/types";
import { AVATAR_RADIUS, EYE_HEIGHT, createAvatar, setAvatarColor } from "./avatar";
import { ROOM_HALF_X, ROOM_HALF_Z, type SeatMarker, type TableMarker } from "./environment";
import { clamp, shortestAngle } from "./mathUtils";

const SPEED = 3.4; // m/s
const TURN_RATE = 12; // rad/s (yaw lerp toward heading)
const ARRIVE_EPS = 0.12;
const MOVE_EPS = 0.0004;

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACK_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);

export class LocalPlayer {
  readonly root: ReturnType<typeof createAvatar>;

  private readonly keys = new Set<string>();
  private target: Vector3 | null = null;
  private yaw = 0;
  private anim: Anim = "idle";
  private bodyVisible = true;
  private seat: SeatMarker | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly tables: TableMarker[],
    color: string,
    shadows?: ShadowGenerator,
  ) {
    this.root = createAvatar(scene, color, shadows);
    this.root.position.set(0, 0, ROOM_HALF_Z - 2);
    this.yaw = Math.PI; // face into the room
    this.root.rotation.y = this.yaw;
  }

  get x(): number {
    return this.root.position.x;
  }
  get z(): number {
    return this.root.position.z;
  }
  get heading(): number {
    return this.yaw;
  }
  get animation(): Anim {
    return this.anim;
  }
  get seatId(): string | undefined {
    return this.seat?.id;
  }

  eyePosition(): Vector3 {
    return new Vector3(this.root.position.x, EYE_HEIGHT, this.root.position.z);
  }

  setKey(code: string, down: boolean): void {
    if (down) {
      this.keys.add(code);
      this.target = null; // keyboard cancels click-to-move
    } else {
      this.keys.delete(code);
    }
  }

  clearKeys(): void {
    this.keys.clear();
  }

  setMoveTarget(point: Vector3 | null): void {
    this.target = point ? new Vector3(point.x, 0, point.z) : null;
  }

  /** Snap into a seat: position/yaw lock to the anchor, movement input ignored
   * until `standUp()`. */
  sitAt(seat: SeatMarker): void {
    this.seat = seat;
    this.target = null;
    this.clearKeys();
    this.root.position.set(seat.x, 0, seat.z);
    this.yaw = seat.yaw;
    this.root.rotation.y = this.yaw;
    this.anim = "idle";
  }

  standUp(): void {
    this.seat = null;
  }

  setBodyVisible(visible: boolean): void {
    if (visible === this.bodyVisible) return;
    this.bodyVisible = visible;
    for (const m of this.root.getChildMeshes()) m.isVisible = visible;
  }

  recolor(color: string): void {
    setAvatarColor(this.root, color);
  }

  /**
   * Advance one frame. `forwardXZ` is the active camera's forward projected onto
   * the ground plane (normalised). When `lockYawToCamera` is true (first-person)
   * the body faces `cameraYaw` instead of the movement heading.
   * Returns true if position or yaw changed meaningfully.
   */
  update(
    dt: number,
    forwardXZ: Vector3,
    lockYawToCamera: boolean,
    cameraYaw: number,
  ): boolean {
    if (this.seat) return false; // seated: ignore movement input entirely

    const f =
      (anyOf(this.keys, FORWARD_KEYS) ? 1 : 0) - (anyOf(this.keys, BACK_KEYS) ? 1 : 0);
    const r =
      (anyOf(this.keys, RIGHT_KEYS) ? 1 : 0) - (anyOf(this.keys, LEFT_KEYS) ? 1 : 0);

    const fwd = new Vector3(forwardXZ.x, 0, forwardXZ.z);
    if (fwd.lengthSquared() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const right = new Vector3(fwd.z, 0, -fwd.x);

    let move = fwd.scale(f).add(right.scale(r));
    const usingKeys = move.lengthSquared() > 1e-6;

    if (usingKeys) {
      move.normalize();
    } else if (this.target) {
      const to = this.target.subtract(this.root.position);
      to.y = 0;
      if (to.length() <= ARRIVE_EPS) {
        this.target = null;
        move = Vector3.Zero();
      } else {
        move = to.normalize();
      }
    } else {
      move = Vector3.Zero();
    }

    const moving = move.lengthSquared() > 1e-6;
    const prev = this.root.position.clone();

    if (moving) {
      const next = this.root.position.add(move.scale(SPEED * dt));
      this.resolveCollisions(next);
      this.root.position.copyFrom(next);
    }

    // Yaw
    let yawChanged = false;
    if (lockYawToCamera) {
      if (Math.abs(shortestAngle(this.yaw, cameraYaw)) > 1e-4) {
        this.yaw = cameraYaw;
        yawChanged = true;
      }
    } else if (moving) {
      const desired = Math.atan2(move.x, move.z);
      const delta = shortestAngle(this.yaw, desired);
      const step = Math.sign(delta) * Math.min(Math.abs(delta), TURN_RATE * dt);
      if (Math.abs(step) > 1e-4) {
        this.yaw += step;
        yawChanged = true;
      }
    }
    this.root.rotation.y = this.yaw;

    this.anim = moving ? "walk" : "idle";

    const posChanged = Vector3.DistanceSquared(prev, this.root.position) > MOVE_EPS;
    return posChanged || yawChanged;
  }

  private resolveCollisions(pos: Vector3): void {
    // Room bounds
    const bx = ROOM_HALF_X - AVATAR_RADIUS - 0.15;
    const bz = ROOM_HALF_Z - AVATAR_RADIUS - 0.15;
    pos.x = clamp(pos.x, -bx, bx);
    pos.z = clamp(pos.z, -bz, bz);

    // Table keep-out (push radially out)
    for (const t of this.tables) {
      const dx = pos.x - t.x;
      const dz = pos.z - t.z;
      const minDist = t.radius + AVATAR_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist * minDist && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = t.x + (dx / d) * minDist;
        pos.z = t.z + (dz / d) * minDist;
      }
    }
  }

  dispose(): void {
    this.root.dispose();
    void this.scene;
  }
}

function anyOf(have: Set<string>, want: Set<string>): boolean {
  for (const k of want) if (have.has(k)) return true;
  return false;
}
