import { useState } from "react";
import type { Game } from "../engine/Game";
import type { EmoteKind, PlayerStatus } from "../net/types";

const STATUS_LABEL: Record<PlayerStatus, string> = {
  present: "🟢 有空聊天",
  meeting: "📅 開會中",
  lunch: "🍔 用餐中",
  focus: "🎯 專注中",
};

const EMOTES: { kind: EmoteKind; icon: string }[] = [
  { kind: "wave", icon: "👋" },
  { kind: "clap", icon: "👏" },
  { kind: "heart", icon: "❤️" },
  { kind: "laugh", icon: "😂" },
];

interface StatusBarProps {
  game: Game | null;
}

/** Bottom-center toolbar: status picker, one-shot emotes, and a raise-hand
 * toggle (docs/PLAN.md §一.B.8/§一.B.10). None of this needs LiveKit — it
 * rides the same WebSocket as movement. */
export function StatusBar({ game }: StatusBarProps) {
  const [status, setStatus] = useState<PlayerStatus>("present");
  const [raised, setRaised] = useState(false);

  const changeStatus = (s: PlayerStatus) => {
    setStatus(s);
    game?.setStatus(s);
  };

  return (
    <div className="statusbar">
      <select
        className="statusbar__select"
        value={status}
        onChange={(e) => changeStatus(e.target.value as PlayerStatus)}
      >
        {(Object.keys(STATUS_LABEL) as PlayerStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      {EMOTES.map(({ kind, icon }) => (
        <button key={kind} className="statusbar__emote" onClick={() => game?.sendEmote(kind)}>
          {icon}
        </button>
      ))}

      <button
        className={`statusbar__emote${raised ? " statusbar__emote--active" : ""}`}
        onClick={() => setRaised(game?.toggleRaisedHand() ?? false)}
      >
        ✋
      </button>
    </div>
  );
}
