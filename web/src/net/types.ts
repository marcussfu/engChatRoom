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

export type ServerMsg = WelcomeMsg | SnapshotMsg | LeaveMsg;

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
}

export type ClientMsg = JoinMsg | InputMsg;
