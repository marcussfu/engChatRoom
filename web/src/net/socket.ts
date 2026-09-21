import type { ClientMsg, HostMsg, InputMsg, ServerMsg } from "./types";

export type ConnStatus = "connecting" | "open" | "closed";

export interface NetHandlers {
  onStatus?: (s: ConnStatus) => void;
  onWelcome?: (id: string, tickRate: number, color: string) => void;
  onSnapshot?: (msg: Extract<ServerMsg, { t: "snapshot" }>) => void;
  onLeave?: (id: string) => void;
  onChat?: (msg: Extract<ServerMsg, { t: "chat" }>) => void;
  onSession?: (msg: Extract<ServerMsg, { t: "session" }>) => void;
  onHostResult?: (msg: Extract<ServerMsg, { t: "hostResult" }>) => void;
}

const DEFAULT_URL = "ws://localhost:8787/ws";

/** Resolve the realtime server's WebSocket URL the same way everywhere:
 * an explicit override, else VITE_REALTIME_URL, else the local dev default.
 * Exported so other callers (e.g. the LiveKit token fetch, which needs the
 * realtime server's HTTP origin) derive from the same value Net actually uses. */
export function resolveRealtimeUrl(explicit?: string): string {
  return explicit ?? import.meta.env.VITE_REALTIME_URL ?? DEFAULT_URL;
}

/**
 * Net owns a single WebSocket to the realtime server, reconnecting with a
 * capped backoff. Outbound input is rate-limited by the caller (Game loop);
 * this class just serializes and ships.
 */
export class Net {
  private ws?: WebSocket;
  private readonly url: string;
  private readonly h: NetHandlers;
  private name = "guest";
  private closedByUs = false;
  private backoffMs = 1000;

  constructor(handlers: NetHandlers, url?: string) {
    this.h = handlers;
    this.url = resolveRealtimeUrl(url);
  }

  connect(name: string): void {
    this.name = name;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    this.h.onStatus?.("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = 1000;
      this.h.onStatus?.("open");
      this.send({ t: "join", name: this.name });
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          this.h.onWelcome?.(msg.id, msg.tickRate, msg.color);
          break;
        case "snapshot":
          this.h.onSnapshot?.(msg);
          break;
        case "leave":
          this.h.onLeave?.(msg.id);
          break;
        case "chat":
          this.h.onChat?.(msg);
          break;
        case "session":
          this.h.onSession?.(msg);
          break;
        case "hostResult":
          this.h.onHostResult?.(msg);
          break;
      }
    };

    ws.onclose = () => {
      this.h.onStatus?.("closed");
      if (this.closedByUs) return;
      window.setTimeout(() => this.open(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 1.6, 5000);
    };

    ws.onerror = () => ws.close();
  }

  sendInput(i: Omit<InputMsg, "t">): void {
    this.send({ t: "input", ...i });
  }

  sendChat(body: string): void {
    const trimmed = body.trim();
    if (!trimmed) return;
    this.send({ t: "chat", body: trimmed });
  }

  sendHost(msg: HostMsg): void {
    this.send(msg);
  }

  private send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }
}
