import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";

export type MediaStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable" // realtime server has no LiveKit credentials configured
  | "error";

export interface MediaHandlers {
  onStatus?: (s: MediaStatus) => void;
  onMicError?: (message: string) => void;
}

// Proximity audio (Phase 1 stand-in for real selective-subscribe zones —
// see docs/PLAN.md §二 "Proximity / zone → 媒體訂閱"): everyone auto-subscribes
// to everyone's audio (small rooms, ≤ ~15 people per PLAN), and we fake the
// "only hear who's near" effect by driving each remote <audio> element's
// volume from avatar distance instead of actually subscribing/unsubscribing.
const NEAR_R = 3; // full volume within this distance (metres)
const FAR_R = 10; // silent beyond this distance

/**
 * Wraps a LiveKit Room: connects, publishes the local microphone on demand,
 * and plays each remote participant's audio through a hidden <audio>
 * element. Participant identity is expected to equal the realtime
 * WebSocket's player id (see net/tokenClient.ts), so updateProximity can
 * look up each speaker's avatar position.
 */
export class Media {
  private room: Room | null = null;
  private readonly audioEls = new Map<string, HTMLAudioElement>();
  private micEnabled = false;
  private disposed = false;

  constructor(private readonly h: MediaHandlers = {}) {}

  async connect(url: string, token: string): Promise<void> {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      this.h.onStatus?.(mapConnectionState(state));
    });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) this.attachAudio(track, participant.identity);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) this.detachAudio(participant.identity);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.detachAudio(participant.identity);
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
    const el = track.attach();
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

  /** Attenuate each remote's audio by distance to the local avatar. `positions`
   * is keyed by participant identity (== realtime player id). */
  updateProximity(localX: number, localZ: number, positions: Map<string, { x: number; z: number }>): void {
    for (const [identity, el] of this.audioEls) {
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

  disconnect(): void {
    this.disposed = true;
    for (const el of this.audioEls.values()) el.remove();
    this.audioEls.clear();
    this.room?.disconnect();
    this.room = null;
  }
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
