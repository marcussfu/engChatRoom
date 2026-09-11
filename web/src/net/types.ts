// Wire messages shared with the Go realtime server.
// Keep in sync with realtime/internal/protocol/protocol.go.

export type Anim = "idle" | "walk";

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

export type ServerMsg = WelcomeMsg | SnapshotMsg | LeaveMsg | ChatMsg;

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
}

export interface SendChatMsg {
  t: "chat";
  body: string;
}

export type ClientMsg = JoinMsg | InputMsg | SendChatMsg;
