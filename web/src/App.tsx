import { useEffect, useRef, useState } from "react";
import { Game } from "./engine/Game";
import type { MediaStatus } from "./media/livekit";
import type { ConnStatus } from "./net/socket";
import { Chat, type ChatEntry } from "./ui/Chat";
import { Hud } from "./ui/Hud";

function guestName(): string {
  const key = "engchatroom.name";
  let n = localStorage.getItem(key);
  if (!n) {
    n = `guest-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(key, n);
  }
  return n;
}

/** "table3" -> "桌 3 對話區" */
function zoneLabel(zoneId: string): string {
  const n = zoneId.replace(/^table/, "");
  return `桌 ${n} 對話區`;
}

const MAX_CHAT_HISTORY = 100;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const selfIdRef = useRef("");
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [online, setOnline] = useState(1);
  const [firstPerson, setFirstPerson] = useState(false);
  const [zone, setZone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>("idle");
  const [micEnabled, setMicEnabled] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new Game(canvas, {
      name: guestName(),
      onStatus: setStatus,
      onOnlineCount: setOnline,
      onFirstPerson: setFirstPerson,
      onSelfId: (id) => {
        selfIdRef.current = id;
      },
      onZone: (zoneId) => setZone(zoneId ? zoneLabel(zoneId) : null),
      onMediaStatus: setMediaStatus,
      onMicEnabled: setMicEnabled,
      onChat: (msg) => {
        setMessages((prev) =>
          [
            ...prev,
            { id: msg.id, name: msg.name, body: msg.body, ts: msg.ts, self: msg.id === selfIdRef.current },
          ].slice(-MAX_CHAT_HISTORY),
        );
      },
    });
    gameRef.current = game;

    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  return (
    <>
      <canvas id="scene" ref={canvasRef} />
      <Hud
        status={status}
        online={online}
        firstPerson={firstPerson}
        zoneLabel={zone}
        mediaStatus={mediaStatus}
        micEnabled={micEnabled}
        onToggleCam={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV" }));
        }}
        onToggleMic={() => gameRef.current?.toggleMic()}
      />
      <Chat messages={messages} onSend={(body) => gameRef.current?.sendChat(body)} />
    </>
  );
}
