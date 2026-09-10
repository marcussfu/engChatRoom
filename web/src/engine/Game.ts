import {
  Engine,
  PointerEventTypes,
  Scene,
  Vector3,
  type PointerInfo,
} from "@babylonjs/core";
import "@babylonjs/core/Culling/ray"; // enables scene.pick for click-to-move

import { Net, type ConnStatus } from "../net/socket";
import type { Anim } from "../net/types";
import { CameraRig } from "./cameraRig";
import { buildEnvironment } from "./environment";
import { LocalPlayer } from "./localPlayer";
import { RemotePlayers } from "./remotePlayers";

const MOVE_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);
const SEND_INTERVAL_MS = 50;
const ACTIVITY_WINDOW_MS = 400;
const HEAD_Y = 1.4;

export interface GameOptions {
  name: string;
  url?: string;
  onStatus?: (s: ConnStatus) => void;
  onOnlineCount?: (n: number) => void;
  onFirstPerson?: (on: boolean) => void;
}

/**
 * Phase 0 game shell: Babylon scene + camera rig + local/remote avatars, wired
 * to the realtime server. Renders on demand — the scene is only drawn while
 * something is moving (local input, camera drag, or a remote still interpolating).
 */
export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly rig: CameraRig;
  private readonly local: LocalPlayer;
  private readonly remotes: RemotePlayers;
  private readonly net: Net;
  private readonly opts: GameOptions;

  private activityUntil = 0;
  private lastSendAt = 0;
  private lastSentAnim: Anim = "idle";
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: GameOptions) {
    this.opts = opts;
    this.engine = new Engine(canvas, true, {
      antialias: true,
      stencil: true,
      adaptToDeviceRatio: true,
      powerPreference: "high-performance",
    });
    this.scene = new Scene(this.engine);

    const env = buildEnvironment(this.scene);
    this.rig = new CameraRig(this.scene, canvas);
    this.local = new LocalPlayer(this.scene, env.tables, "#c8c8c8", env.shadows);
    this.remotes = new RemotePlayers(this.scene, env.shadows);

    this.net = new Net(
      {
        onStatus: opts.onStatus,
        onWelcome: (id, _tick, color) => {
          this.remotes.setSelfId(id);
          this.local.recolor(color);
          // Tell the server where we spawned right away — otherwise our
          // authoritative state stays at the world origin until we first move,
          // and every other client draws us stacked at (0,0,0).
          this.sendInput();
          this.lastSendAt = performance.now();
          if (import.meta.env.DEV) console.info("[net] welcome", { id, color });
          this.bump();
        },
        onSnapshot: (m) => {
          this.remotes.applySnapshot(m.players);
          this.opts.onOnlineCount?.(m.players.length);
          if (import.meta.env.DEV) {
            console.info(
              "[net] snapshot",
              m.players.map((p) => `${p.id}@(${p.x.toFixed(1)},${p.z.toFixed(1)})`),
            );
          }
          this.bump();
        },
        onLeave: (id) => {
          this.remotes.remove(id);
          this.opts.onOnlineCount?.(this.remotes.count + 1);
          if (import.meta.env.DEV) console.info("[net] leave", id);
          this.bump();
        },
      },
      opts.url,
    );

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize);
    this.scene.onPointerObservable.add(this.onPointer);

    this.bump();
    this.engine.runRenderLoop(this.frame);
    this.net.connect(opts.name);
  }

  private readonly frame = (): void => {
    if (this.disposed) return;
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    const now = performance.now();

    const moved = this.local.update(
      dt,
      this.rig.forwardXZ(),
      this.rig.firstPerson,
      this.rig.yaw(),
    );
    const interp = this.remotes.update(dt);
    this.rig.update(
      this.local.eyePosition(),
      new Vector3(this.local.x, HEAD_Y, this.local.z),
      dt,
    );

    if (moved) {
      this.bump();
      const animChanged = this.local.animation !== this.lastSentAnim;
      if (now - this.lastSendAt > SEND_INTERVAL_MS || animChanged) {
        this.sendInput();
        this.lastSendAt = now;
      }
    } else if (this.lastSentAnim === "walk") {
      this.sendInput(); // one final frame so others see us stop promptly
    }

    if (interp) this.bump();

    if (now < this.activityUntil || interp) {
      this.scene.render();
    }
  };

  private sendInput(): void {
    this.lastSentAnim = this.local.animation;
    this.net.sendInput({
      x: round(this.local.x),
      z: round(this.local.z),
      yaw: round(this.local.heading),
      anim: this.local.animation,
    });
  }

  private bump(): void {
    this.activityUntil = performance.now() + ACTIVITY_WINDOW_MS;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (e.code === "KeyV") {
      const on = !this.rig.firstPerson;
      this.rig.setFirstPerson(on);
      this.local.setBodyVisible(!on);
      this.opts.onFirstPerson?.(on);
      this.bump();
      return;
    }
    if (MOVE_KEYS.has(e.code)) {
      this.local.setKey(e.code, true);
      this.bump();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (MOVE_KEYS.has(e.code)) this.local.setKey(e.code, false);
  };

  private readonly onBlur = (): void => this.local.clearKeys();

  private readonly onResize = (): void => {
    this.engine.resize();
    this.bump();
  };

  private readonly onPointer = (info: PointerInfo): void => {
    if (
      info.type === PointerEventTypes.POINTERDOWN ||
      info.type === PointerEventTypes.POINTERWHEEL
    ) {
      this.bump();
    }
    if (info.type === PointerEventTypes.POINTERPICK && !this.rig.firstPerson) {
      const pick = info.pickInfo;
      if (pick?.hit && pick.pickedMesh?.name === "floor" && pick.pickedPoint) {
        this.local.setMoveTarget(pick.pickedPoint);
        this.bump();
      }
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
    this.net.close();
    this.engine.stopRenderLoop();
    this.remotes.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}
