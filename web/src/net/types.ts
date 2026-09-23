// Wire messages shared with the Go realtime server.
// Keep in sync with realtime/internal/protocol/protocol.go.

export type Anim = "idle" | "walk";

/** "present" (the default) is never sent over the wire — a missing `status`
 * on PlayerState means present. */
export type PlayerStatus = "present" | "meeting" | "lunch" | "focus";

/** A transient action, not part of PlayerState — see EmoteMsg. */
export type EmoteKind = "wave" | "clap" | "heart" | "laugh";

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  anim: Anim;
  color: string;
  zoneId?: string;
  seatId?: string;
  status?: PlayerStatus;
  raisedHand?: boolean;
}

export interface WelcomeMsg {
  t: "welcome";
  id: string;
  tickRate: number;
  color: string;
}

export interface SnapshotMsg {
  t: "snapshot";
  players: PlayerState[];
}

export interface LeaveMsg {
  t: "leave";
  id: string;
}

export interface ChatMsg {
  t: "chat";
  id: string;
  name: string;
  body: string;
  ts: number;
}

/** The language-exchange session as every client sees it — mirrors
 * protocol.SessionState in realtime/internal/protocol/protocol.go. */
export interface SessionState {
  active: boolean;
  finished: boolean;
  /** 1-based; `rounds` is the total for this session. */
  round: number;
  rounds: number;
  /** Unix ms on the SERVER's clock — correct for skew with SessionMsg.now. */
  roundEndsAt: number;
  /** Nominal round length; a host extension moves roundEndsAt but not this. */
  roundMs: number;
  topic: string;
}

export interface SessionMsg {
  t: "session";
  session: SessionState;
  /** Server unix ms when this message was built. */
  now: number;
}

/** Answer to a host command; only the sender receives it. `ok` is omitted by
 * the server when false, so treat "no ok" as failure and read `error`. */
export interface HostResultMsg {
  t: "hostResult";
  ok?: boolean;
  error?: string;
}

/** A one-shot action from `id` — unlike status/raisedHand, this isn't state
 * that persists; it fires once and every client shows a transient reaction. */
export interface EmoteMsg {
  t: "emote";
  id: string;
  emote: EmoteKind;
  ts: number;
}

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | LeaveMsg
  | ChatMsg
  | SessionMsg
  | HostResultMsg
  | EmoteMsg;

export interface JoinMsg {
  t: "join";
  name: string;
}

export interface InputMsg {
  t: "input";
  x: number;
  z: number;
  yaw: number;
  anim: Anim;
  zoneId?: string;
  seatId?: string;
  status?: PlayerStatus;
  raisedHand?: boolean;
}

export interface SendChatMsg {
  t: "chat";
  body: string;
}

export interface SendEmoteMsg {
  t: "emote";
  emote: EmoteKind;
}

/** A host-console command. Every one carries the shared secret (HOST_KEY on the
 * server). */
export type HostMsg =
  | {
      t: "host";
      action: "start";
      key: string;
      rounds: number;
      roundSeconds: number;
      topics: string[];
    }
  | { t: "host"; action: "next" | "end"; key: string }
  | { t: "host"; action: "extend"; key: string; seconds: number };

export type ClientMsg = JoinMsg | InputMsg | SendChatMsg | SendEmoteMsg | HostMsg;
