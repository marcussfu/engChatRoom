import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type LocalTrackPublication,
} from "livekit-client";

export type MediaStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable" // realtime server has no LiveKit credentials configured
  | "error";

export type VideoSource = "camera" | "screen_share";

export interface MediaHandlers {
  onStatus?: (s: MediaStatus) => void;
  onMicError?: (message: string) => void;
  onCameraError?: (message: string) => void;
  onScreenShareError?: (message: string) => void;
  /** Fires when screen share stops from outside our own toggle — e.g. the
   * user clicks the browser's native "Stop sharing" bar. */
  onScreenShareStopped?: () => void;
  /** A remote participant's camera or screen-share video became available.
   * `el` is a detached <video> element (not in the DOM) meant to feed a
   * texture — see engine/remotePlayers.ts's video billboard. */
  onVideoTrack?: (identity: string, el: HTMLVideoElement, source: VideoSource) => void;
  onVideoTrackRemoved?: (identity: string, source: VideoSource) => void;
}

// Proximity audio (Phase 1 stand-in for real selective-subscribe zones —
// see docs/PLAN.md §二 "Proximity / zone → 媒體訂閱"): everyone auto-subscribes
// to everyone's audio (small rooms, ≤ ~15 people per PLAN), and we fake the
// "only hear who's near" effect by driving each remote <audio> element's
// volume from avatar distance instead of actually subscribing/unsubscribing.
const NEAR_R = 3; // full volume within this distance (metres)
const FAR_R = 10; // silent beyond this distance

/**
 * Wraps a LiveKit Room: connects, publishes the local microphone/camera/
 * screen share on demand, and plays each remote participant's audio/video
 * through hidden <audio>/<video> elements. Participant identity is expected
 * to equal the realtime WebSocket's player id (see net/tokenClient.ts), so
 * updateProximity can look up each speaker's avatar position.
 */
export class Media {
  private room: Room | null = null;
  private readonly audioEls = new Map<string, HTMLAudioElement>();
  private readonly videoEls = new Map<string, HTMLVideoElement>(); // key: `${identity}:${source}`
  private micEnabled = false;
  private cameraEnabled = false;
  private screenShareEnabled = false;
  private headphonesMode = false;
  private disposed = false;

  constructor(private readonly h: MediaHandlers = {}) {}

  async connect(url: string, token: string): Promise<void> {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      this.h.onStatus?.(mapConnectionState(state));
    });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) this.attachAudio(track, participant.identity);
      else if (track.kind === Track.Kind.Video) this.attachVideo(track, pub, participant.identity);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) this.detachAudio(participant.identity);
      else if (track.kind === Track.Kind.Video) this.detachVideo(participant.identity, sourceOf(pub));
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.detachAudio(participant.identity);
      this.detachVideo(participant.identity, "camera");
      this.detachVideo(participant.identity, "screen_share");
    });
    room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      // Catches the browser's native "Stop sharing" bar, not just our own
      // toggle — keep our state (and the HUD) truthful either way.
      if (pub.source === Track.Source.ScreenShare) {
        this.screenShareEnabled = false;
        this.h.onScreenShareStopped?.();
      }
    });

    this.h.onStatus?.("connecting");
    try {
      await room.connect(url, token);
      if (this.disposed) {
        room.disconnect();
        return;
      }
      this.h.onStatus?.("connected");
    } catch (err) {
      // This is the one spot most likely to fail on a first real connection
      // (bad token, wrong URL, CORS/network) and we had no visibility into
      // why — surface the real error instead of just flipping to "error".
      console.error("[media] room.connect failed:", err, { url });
      this.h.onStatus?.("error");
    }
  }

  private attachAudio(track: RemoteTrack, identity: string): void {
    this.detachAudio(identity); // replace any stale element for this identity
    const el = track.attach() as HTMLAudioElement;
    el.volume = this.headphonesMode ? 0 : 1; // corrected properly by updateProximity next frame
    el.style.display = "none";
    document.body.appendChild(el);
    this.audioEls.set(identity, el);
  }

  private detachAudio(identity: string): void {
    const el = this.audioEls.get(identity);
    if (el) {
      el.remove();
      this.audioEls.delete(identity);
    }
  }

  private attachVideo(track: RemoteTrack, pub: RemoteTrackPublication, identity: string): void {
    const source = sourceOf(pub);
    const key = `${identity}:${source}`;
    this.removeVideoEl(key);
    const el = track.attach() as HTMLVideoElement;
    el.muted = true; // audio comes from the separate audio track/element, not this one
    el.style.display = "none";
    document.body.appendChild(el);
    this.videoEls.set(key, el);
    this.h.onVideoTrack?.(identity, el, source);
  }

  private detachVideo(identity: string, source: VideoSource): void {
    this.removeVideoEl(`${identity}:${source}`);
    this.h.onVideoTrackRemoved?.(identity, source);
  }

  private removeVideoEl(key: string): void {
    const el = this.videoEls.get(key);
    if (el) {
      el.remove();
      this.videoEls.delete(key);
    }
  }

  /** Attenuate each remote's audio by distance to the local avatar, unless
   * Headphones Mode is on (mute everyone regardless of distance). `positions`
   * is keyed by participant identity (== realtime player id). */
  updateProximity(localX: number, localZ: number, positions: Map<string, { x: number; z: number }>): void {
    for (const [identity, el] of this.audioEls) {
      if (this.headphonesMode) {
        el.volume = 0;
        continue;
      }
      const p = positions.get(identity);
      if (!p) continue;
      const dist = Math.hypot(localX - p.x, localZ - p.z);
      el.volume = clamp01((FAR_R - dist) / (FAR_R - NEAR_R));
    }
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
      this.micEnabled = enabled;
    } catch (err) {
      this.h.onMicError?.(err instanceof Error ? err.message : String(err));
    }
  }
  get isMicEnabled(): boolean {
    return this.micEnabled;
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setCameraEnabled(enabled);
      this.cameraEnabled = enabled;
    } catch (err) {
      this.h.onCameraError?.(err instanceof Error ? err.message : String(err));
    }
  }
  get isCameraEnabled(): boolean {
    return this.cameraEnabled;
  }

  /** Starting a share prompts the browser's own picker; the user cancelling
   * it rejects the promise, which we treat the same as any other failure. */
  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setScreenShareEnabled(enabled);
      this.screenShareEnabled = enabled;
    } catch (err) {
      this.h.onScreenShareError?.(err instanceof Error ? err.message : String(err));
    }
  }
  get isScreenShareEnabled(): boolean {
    return this.screenShareEnabled;
  }

  setHeadphonesMode(on: boolean): void {
    this.headphonesMode = on;
  }
  get isHeadphonesMode(): boolean {
    return this.headphonesMode;
  }

  /** Device labels are only populated once permission has been granted at
   * least once (browser privacy rule) — an empty label just means "pick by
   * position", not that enumeration failed. */
  async listInputDevices(kind: "audioinput" | "videoinput"): Promise<MediaDeviceInfo[]> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === kind);
    } catch {
      return [];
    }
  }

  async setAudioInputDevice(deviceId: string): Promise<void> {
    await this.room?.switchActiveDevice("audioinput", deviceId);
  }

  async setVideoInputDevice(deviceId: string): Promise<void> {
    await this.room?.switchActiveDevice("videoinput", deviceId);
  }

  disconnect(): void {
    this.disposed = true;
    for (const el of this.audioEls.values()) el.remove();
    this.audioEls.clear();
    for (const el of this.videoEls.values()) el.remove();
    this.videoEls.clear();
    this.room?.disconnect();
    this.room = null;
  }
}

function sourceOf(pub: RemoteTrackPublication): VideoSource {
  return pub.source === Track.Source.ScreenShare ? "screen_share" : "camera";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function mapConnectionState(state: ConnectionState): MediaStatus {
  switch (state) {
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Disconnected:
      return "disconnected";
    case ConnectionState.Connecting:
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return "connecting";
    default:
      return "idle";
  }
}
