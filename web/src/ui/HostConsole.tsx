import { useState } from "react";
import type { Game } from "../engine/Game";
import type { SessionState } from "../net/types";

const KEY_STORAGE = "engchatroom.hostKey";

function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

interface HostConsoleProps {
  game: Game | null;
  session: SessionState | null;
  /** The server's answer to the most recent command. */
  result: { ok: boolean; error?: string } | null;
}

/** Host controls for a language-exchange session. Whoever knows the server's
 * HOST_KEY can run one — there are no accounts to hang a host role on yet. */
export function HostConsole({ game, session, result }: HostConsoleProps) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(loadKey);
  const [rounds, setRounds] = useState(4);
  const [minutes, setMinutes] = useState(15);
  const [topicsText, setTopicsText] = useState("");

  const running = session?.active === true;

  const rememberKey = (k: string) => {
    setKey(k);
    try {
      localStorage.setItem(KEY_STORAGE, k);
    } catch {
      /* private mode etc. — the key just isn't remembered */
    }
  };

  const start = () => {
    const topics = topicsText
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    game?.hostStart(key, { rounds, roundSeconds: Math.round(minutes * 60), topics });
  };

  return (
    <div className="host">
      <button className="hud__btn" onClick={() => setOpen((o) => !o)}>
        🎓 主持
      </button>
      {open && (
        <div className="host__panel">
          <label className="host__row">
            <span>主持金鑰</span>
            <input
              type="password"
              value={key}
              placeholder="伺服器的 HOST_KEY"
              onChange={(e) => rememberKey(e.target.value)}
            />
          </label>

          {running ? (
            <div className="host__actions">
              <button className="hud__btn" onClick={() => game?.hostNext(key)}>
                ⏭ 下一輪
              </button>
              <button className="hud__btn" onClick={() => game?.hostExtend(key, 60)}>
                ＋1 分鐘
              </button>
              <button className="hud__btn" onClick={() => game?.hostExtend(key, 300)}>
                ＋5 分鐘
              </button>
              <button className="hud__btn" onClick={() => game?.hostEnd(key)}>
                ⏹ 結束活動
              </button>
            </div>
          ) : (
            <>
              <div className="host__pair">
                <label className="host__row">
                  <span>輪數</span>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={rounds}
                    onChange={(e) => setRounds(Number(e.target.value))}
                  />
                </label>
                <label className="host__row">
                  <span>每輪（分鐘）</span>
                  <input
                    type="number"
                    min={0.5}
                    max={60}
                    step={0.5}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="host__row">
                <span>話題（每行一個，留空用內建話題）</span>
                <textarea
                  rows={4}
                  value={topicsText}
                  placeholder={"What's your favorite food?\nDescribe your perfect weekend."}
                  onChange={(e) => setTopicsText(e.target.value)}
                />
              </label>
              <button className="hud__btn" onClick={start}>
                ▶ 開始活動
              </button>
            </>
          )}

          {result && (
            <div className={`host__result${result.ok ? "" : " host__result--error"}`}>
              {result.ok ? "✅ 已送出" : `❌ ${result.error ?? "失敗"}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
