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

          {session?.topics && session.topics.length > 0 && (
            <div className="host__row">
              <span>大看板顯示（哪個話題呈現在牆上的大看板）</span>
              <div className="host__actions">
                {session.topics.map((t, i) => (
                  <button
                    key={t.title}
                    className={`hud__btn${session.featuredTopic === i + 1 ? " host__feature--active" : ""}`}
                    onClick={() => game?.hostFeature(key, i + 1)}
                  >
                    TOPIC {i + 1}
                  </button>
                ))}
                <button className="hud__btn" onClick={() => game?.hostFeature(key, 0)}>
                  清空
                </button>
              </div>
            </div>
          )}

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
                <span>
                  話題（每行一個，留空用內建話題；打一個內建話題的完整句子可以帶出現成的文章和問題；
                  也可以自己用「標題 | 文章 | 連結(可省略) | 問題 | 問題…」半形直線分隔打一整行——
                  其中一段打 http(s):// 開頭的網址會被當成可嵌入的連結，不算進問題）
                </span>
                <textarea
                  rows={4}
                  value={topicsText}
                  placeholder={
                    "What's your favorite food, and why?\nMy Topic | A short article. | https://youtube.com/watch?v=... | Question 1? | Question 2?"
                  }
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
