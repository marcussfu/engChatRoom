import { useEffect, useRef, useState } from "react";
import { Game } from "./engine/Game";
import type { ConnStatus } from "./net/socket";
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

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [online, setOnline] = useState(1);
  const [firstPerson, setFirstPerson] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new Game(canvas, {
      name: guestName(),
      onStatus: setStatus,
      onOnlineCount: setOnline,
      onFirstPerson: setFirstPerson,
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
        onToggleCam={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV" }));
        }}
      />
    </>
  );
}
