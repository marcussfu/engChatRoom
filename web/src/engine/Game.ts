import {
  Engine,
  PointerEventTypes,
  Scene,
  Vector3,
  type PointerInfo,
} from "@babylonjs/core";
import "@babylonjs/core/Culling/ray"; // enables scene.pick for click-to-move

import { Media, type MediaStatus } from "../media/livekit";
import { Net, resolveRealtimeUrl, type ConnStatus } from "../net/socket";
import { fetchLiveKitToken } from "../net/tokenClient";
import type { Anim, ChatMsg, EmoteKind, PlayerStatus, SessionState } from "../net/types";
import { CameraRig } from "./cameraRig";
import { buildEnvironment, type SeatMarker, type ZoneMarker } from "./environment";
import { LocalPlayer } from "./localPlayer";
import { RemotePlayers } from "./remotePlayers";
import { rotationTarget } from "./rotation";

const MOVE_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);
const SEND_INTERVAL_MS = 50;
const ACTIVITY_WINDOW_MS = 400;
const HEAD_Y = 1.4;

/** What the UI needs to announce a new round. */
export interface RoundChangeInfo {
  round: number;
  rounds: number;
  topic: string;
  /** Set when *this* player is in a black chair: the table they could move to
   * for a new partner. A suggestion only — the player decides whether to go. */
  rotateToTable: number | null;
}

export interface HostStartConfig {
  rounds: number;
  roundSeconds: number;
  topics: string[];
}

export interface GameOptions {
  name: string;
  url?: string;
  onStatus?: (s: ConnStatus) => void;
  onOnlineCount?: (n: number) => void;
  onFirstPerson?: (on: boolean) => void;
  /** Fires when the local player enters (zone id) or leaves (null) a conversation zone. */
  onZone?: (zoneId: string | null) => void;
  onChat?: (msg: ChatMsg) => void;
  /** Fires once, when the server assigns our connection id. */
  onSelfId?: (id: string) => void;
  onMediaStatus?: (s: MediaStatus) => void;
  onMicEnabled?: (on: boolean) => void;
  onCameraEnabled?: (on: boolean) => void;
  onScreenShareEnabled?: (on: boolean) => void;
  onHeadphonesMode?: (on: boolean) => void;
  /** Every session update from the server. `clockOffsetMs` is (server now −
   * client now) at receipt, for counting down against the server's clock. */
  onSession?: (state: SessionState, clockOffsetMs: number) => void;
  /** The round advanced (timer ran out or host skipped). */
  onRoundChange?: (info: RoundChangeInfo) => void;
  /** Answer to a host command we sent. */
  onHostResult?: (ok: boolean, error?: string) => void;
}

const DEFAULT_STATUS: PlayerStatus = "present";

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
  private readonly media: Media;
  private readonly wsUrl: string;
  private readonly opts: GameOptions;
  private readonly zones: ZoneMarker[];
  private readonly seatByMesh = new Map<string, SeatMarker>();
  private readonly seatById = new Map<string, SeatMarker>();
  private readonly tableCount: number;
  private session: SessionState | null = null;

  private activityUntil = 0;
  private lastSendAt = 0;
  private lastSentAnim: Anim = "idle";
  private zoneId: string | undefined;
  private status: PlayerStatus = DEFAULT_STATUS;
  private raisedHand = false;
  private selfId = "";
  private forceSend = false;
  private mediaReady = false;
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
    this.zones = env.zones;
    this.tableCount = env.tables.length;
    for (const seat of env.seats) {
      this.seatByMesh.set(`seat${seat.id}`, seat);
      this.seatById.set(seat.id, seat);
    }

    this.wsUrl = resolveRealtimeUrl(opts.url);
    this.media = new Media({
      onStatus: (s) => {
        this.mediaReady = s === "connected";
        this.opts.onMediaStatus?.(s);
      },
      onMicError: (msg) => {
        if (import.meta.env.DEV) console.warn("[media] mic error:", msg);
      },
      onCameraError: (msg) => {
        if (import.meta.env.DEV) console.warn("[media] camera error:", msg);
      },
      onScreenShareError: (msg) => {
        if (import.meta.env.DEV) console.warn("[media] screen share error:", msg);
      },
      onScreenShareStopped: () => this.opts.onScreenShareEnabled?.(false),
      onVideoTrack: (identity, el, source) => this.remotes.attachVideo(identity, el, source),
      onVideoTrackRemoved: (identity, source) => this.remotes.detachVideo(identity, source),
    });

    this.net = new Net(
      {
        onStatus: opts.onStatus,
        onWelcome: (id, _tick, color) => {
          this.selfId = id;
          this.remotes.setSelfId(id);
          this.local.recolor(color);
          this.opts.onSelfId?.(id);
          // Tell the server where we spawned right away — otherwise our
          // authoritative state stays at the world origin until we first move,
          // and every other client draws us stacked at (0,0,0).
          this.sendInput();
          this.lastSendAt = performance.now();
          if (import.meta.env.DEV) console.info("[net] welcome", { id, color });
          this.bump();
          void this.connectMedia(id);
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
        onChat: (msg) => this.opts.onChat?.(msg),
        onSession: (m) => {
          const prev = this.session;
          this.session = m.session;
          this.opts.onSession?.(m.session, m.now - Date.now());
          // Only a round *advancing within a running session* rotates people. A
          // state that merely arrives (we just joined, or reconnected to the same
          // round) must not shove anyone around.
          if (prev?.active && m.session.active && m.session.round > prev.round) {
            this.onRoundAdvanced(m.session, m.session.round - prev.round);
          }
          this.bump();
        },
        onHostResult: (m) => this.opts.onHostResult?.(m.ok === true, m.error),
        onEmote: (m) => {
          // Our own emotes never round-trip back to us as a *visual* here —
          // sendEmote() already spawns the local burst optimistically (no
          // reason to wait a network round trip to see your own wave) — so
          // this only needs to handle everyone else's.
          if (m.id !== this.selfId) this.remotes.spawnEmote(m.id, m.emote);
          this.bump();
        },
      },
      this.wsUrl,
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

    const zoneId = this.zoneAt(this.local.x, this.local.z);
    const zoneChanged = zoneId !== this.zoneId;
    if (zoneChanged) {
      this.zoneId = zoneId;
      this.opts.onZone?.(zoneId ?? null);
    }
    const mustSend = zoneChanged || this.forceSend;
    this.forceSend = false;

    if (moved || mustSend) {
      this.bump();
      const animChanged = this.local.animation !== this.lastSentAnim;
      if (mustSend || animChanged || now - this.lastSendAt > SEND_INTERVAL_MS) {
        this.sendInput();
        this.lastSendAt = now;
      }
    } else if (this.lastSentAnim === "walk") {
      this.sendInput(); // one final frame so others see us stop promptly
    }

    if (interp) this.bump();

    // Audio volume needs to track avatar movement even while the 3D scene
    // itself is between render-on-demand windows, so this runs unconditionally.
    this.media.updateProximity(this.local.x, this.local.z, this.remotes.positions());

    if (now < this.activityUntil || interp) {
      this.scene.render();
    }
  };

  private async connectMedia(identity: string): Promise<void> {
    const result = await fetchLiveKitToken(this.wsUrl, identity, this.opts.name);
    if (this.disposed) return;
    if (!result.ok) {
      this.opts.onMediaStatus?.(result.reason);
      if (import.meta.env.DEV) console.info("[media] token unavailable:", result.reason);
      return;
    }
    await this.media.connect(result.url, result.token);
  }

  /** Flip the mic; no-op until LiveKit is actually connected. */
  toggleMic(): void {
    if (!this.mediaReady) return;
    void this.setMic(!this.media.isMicEnabled);
  }

  private async setMic(enabled: boolean): Promise<void> {
    await this.media.setMicEnabled(enabled);
    this.opts.onMicEnabled?.(this.media.isMicEnabled);
  }

  /** Flip the camera; no-op until LiveKit is actually connected. */
  toggleCamera(): void {
    if (!this.mediaReady) return;
    void this.setCamera(!this.media.isCameraEnabled);
  }

  private async setCamera(enabled: boolean): Promise<void> {
    await this.media.setCameraEnabled(enabled);
    this.opts.onCameraEnabled?.(this.media.isCameraEnabled);
  }

  /** Flip screen share; no-op until LiveKit is actually connected. Starting
   * a share prompts the browser's own picker. */
  toggleScreenShare(): void {
    if (!this.mediaReady) return;
    void this.setScreenShare(!this.media.isScreenShareEnabled);
  }

  private async setScreenShare(enabled: boolean): Promise<void> {
    await this.media.setScreenShareEnabled(enabled);
    this.opts.onScreenShareEnabled?.(this.media.isScreenShareEnabled);
  }

  /** Mute everyone regardless of distance — doesn't require a live LiveKit
   * connection, it's a pure playback flag applied whenever audio elements exist. */
  toggleHeadphones(): void {
    this.media.setHeadphonesMode(!this.media.isHeadphonesMode);
    this.opts.onHeadphonesMode?.(this.media.isHeadphonesMode);
  }

  listAudioInputs(): Promise<MediaDeviceInfo[]> {
    return this.media.listInputDevices("audioinput");
  }

  listVideoInputs(): Promise<MediaDeviceInfo[]> {
    return this.media.listInputDevices("videoinput");
  }

  setAudioInputDevice(deviceId: string): void {
    void this.media.setAudioInputDevice(deviceId);
  }

  setVideoInputDevice(deviceId: string): void {
    void this.media.setVideoInputDevice(deviceId);
  }

  private sendInput(): void {
    this.lastSentAnim = this.local.animation;
    this.net.sendInput({
      x: round(this.local.x),
      z: round(this.local.z),
      yaw: round(this.local.heading),
      anim: this.local.animation,
      zoneId: this.zoneId,
      seatId: this.local.seatId,
      status: this.status,
      raisedHand: this.raisedHand,
    });
  }

  sendChat(body: string): void {
    this.net.sendChat(body);
  }

  // --- Status / emote / raised hand ---------------------------------------

  setStatus(status: PlayerStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.forceSend = true;
    this.bump();
  }

  toggleRaisedHand(): boolean {
    this.raisedHand = !this.raisedHand;
    this.forceSend = true;
    this.bump();
    return this.raisedHand;
  }

  /** Emotes are transient, not part of our continuous state — sent as their
   * own message (see sendInput for status/raisedHand instead). Spawns our own
   * burst immediately rather than waiting for it to round-trip back from the
   * server. */
  sendEmote(emote: EmoteKind): void {
    this.net.sendEmote(emote);
    this.remotes.spawnEmoteAt(new Vector3(this.local.x, 0, this.local.z), emote);
    this.bump();
  }

  // --- Language-exchange session ------------------------------------------

  /** A new round began. This only ever *suggests* a move — a black-chair
   * (rotator) player currently seated gets told which table to try next for a
   * new partner, but nobody is walked there automatically; moving is always
   * their own click. The server doesn't know about seats — the suggestion is
   * derived purely from the round number. */
  private onRoundAdvanced(s: SessionState, steps: number): void {
    const targetId = rotationTarget(this.local.seatId, this.tableCount, steps);
    const target = targetId ? this.seatById.get(targetId) : undefined;
    this.opts.onRoundChange?.({
      round: s.round,
      rounds: s.rounds,
      topic: s.topic,
      rotateToTable: target ? target.table : null,
    });
  }

  hostStart(key: string, cfg: HostStartConfig): void {
    this.net.sendHost({ t: "host", action: "start", key, ...cfg });
  }

  hostNext(key: string): void {
    this.net.sendHost({ t: "host", action: "next", key });
  }

  hostExtend(key: string, seconds: number): void {
    this.net.sendHost({ t: "host", action: "extend", key, seconds });
  }

  hostEnd(key: string): void {
    this.net.sendHost({ t: "host", action: "end", key });
  }

  private zoneAt(x: number, z: number): string | undefined {
    for (const zone of this.zones) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      if (dx * dx + dz * dz <= zone.radius * zone.radius) return zone.id;
    }
    return undefined;
  }

  /** Stand up if already sitting at `seat`; otherwise walk over to it like any
   * other click-to-move destination (LocalPlayer snaps into the seat pose on
   * arrival). No-op if someone else is already sitting there. */
  private trySit(seat: SeatMarker): void {
    if (this.local.seatId === seat.id) {
      this.local.standUp();
      this.forceSend = true;
      return;
    }
    if (this.remotes.occupiedSeats().has(seat.id)) return;
    this.local.walkToSeat(seat);
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
      const mesh = pick?.hit ? pick.pickedMesh : null;
      const seat = mesh ? this.seatByMesh.get(mesh.name) : undefined;
      if (seat) {
        this.trySit(seat);
        this.bump();
      } else if (mesh?.name === "floor" && pick?.pickedPoint) {
        if (this.local.seatId) {
          this.local.standUp();
          this.forceSend = true;
        } else {
          this.local.setMoveTarget(pick.pickedPoint);
        }
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
    this.media.disconnect();
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
