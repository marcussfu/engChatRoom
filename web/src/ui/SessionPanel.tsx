import { useEffect, useState } from "react";
import { formatClock, remainingMs } from "../engine/rotation";
import type { SessionState } from "../net/types";

interface SessionPanelProps {
  session: SessionState | null;
  /** (server now − client now) when `session` arrived — see Game's onSession. */
  clockOffsetMs: number;
}

/** The language-exchange scoreboard: round counter, countdown, and the
 * current TOPIC card. Renders nothing while no session is running or wrapping up. */
export function SessionPanel({ session, clockOffsetMs }: SessionPanelProps) {
  const active = session?.active === true;

  // Repaint 4x a second while a round is running so the seconds tick smoothly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);

  if (!session) return null;

  if (session.finished) {
    return (
      <div className="session session--finished">
        🎉 本場活動結束，謝謝參加！（共 {session.rounds} 輪）
      </div>
    );
  }
  if (!session.active) return null;

  const left = remainingMs(session, clockOffsetMs, now);
  const urgent = left <= 30_000;

  return (
    <div className="session">
      <div className="session__row">
        <span>
          第 {session.round} / {session.rounds} 輪
        </span>
        <span className={`session__clock${urgent ? " session__clock--urgent" : ""}`}>
          🕒 {formatClock(left)}
        </span>
      </div>
      <div className="session__topic">💬 {session.topic}</div>
    </div>
  );
}
