import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "./engine/Game";
import type { MediaStatus } from "./media/livekit";
import type { ConnStatus } from "./net/socket";
import type { SessionState } from "./net/types";
import { Chat, type ChatEntry } from "./ui/Chat";
import { DeviceMenu } from "./ui/DeviceMenu";
import { HostConsole } from "./ui/HostConsole";
import { Hud } from "./ui/Hud";
import { RoundNotice, type Notice } from "./ui/RoundNotice";
import { SessionPanel } from "./ui/SessionPanel";
import { StatusBar } from "./ui/StatusBar";

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
const NOTICE_MS = 8000;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const selfIdRef = useRef("");
  const sessionActiveRef = useRef(false);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [online, setOnline] = useState(1);
  const [firstPerson, setFirstPerson] = useState(false);
  const [zone, setZone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>("idle");
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [headphonesMode, setHeadphonesMode] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hostResult, setHostResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const showNotice = useCallback((n: Notice) => {
    setNotice(n);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

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
      onCameraEnabled: setCameraEnabled,
      onScreenShareEnabled: setScreenShareEnabled,
      onHeadphonesMode: setHeadphonesMode,
      onSession: (s, offset) => {
        setSession(s);
        setClockOffset(offset);
        // Announce a session *starting* — but not to someone who joins partway
        // through (round > 1), who'd just see a stale "started" banner.
        if (s.active && !sessionActiveRef.current && s.round === 1) {
          showNotice({ title: "活動開始！", body: `第 1 / ${s.rounds} 輪 · 話題：${s.topic}` });
        }
        sessionActiveRef.current = s.active;
      },
      onRoundChange: (info) => {
        showNotice({
          title: `第 ${info.round} / ${info.rounds} 輪開始`,
          body:
            info.rotateToTable !== null
              ? `想認識新夥伴？可以移到桌 ${info.rotateToTable}（自行決定）· 話題：${info.topic}`
              : `話題：${info.topic}`,
        });
      },
      onHostResult: (ok, error) => setHostResult({ ok, error }),
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
      window.clearTimeout(noticeTimerRef.current);
      game.dispose();
      gameRef.current = null;
    };
  }, [showNotice]);

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
        cameraEnabled={cameraEnabled}
        screenShareEnabled={screenShareEnabled}
        headphonesMode={headphonesMode}
        onToggleCam={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV" }));
        }}
        onToggleMic={() => gameRef.current?.toggleMic()}
        onToggleCamera={() => gameRef.current?.toggleCamera()}
        onToggleScreenShare={() => gameRef.current?.toggleScreenShare()}
        onToggleHeadphones={() => gameRef.current?.toggleHeadphones()}
      />
      <DeviceMenu game={gameRef.current} enabled={mediaStatus === "connected"} />
      <SessionPanel session={session} clockOffsetMs={clockOffset} />
      <RoundNotice notice={notice} />
      <HostConsole game={gameRef.current} session={session} result={hostResult} />
      <StatusBar game={gameRef.current} />
      <Chat messages={messages} onSend={(body) => gameRef.current?.sendChat(body)} />
    </>
  );
}
