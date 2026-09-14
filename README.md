# engChatRoom

類 **SpotVirtual** 的 3D 英語口說練習虛擬咖啡廳。使用者操控 avatar 在 3D 咖啡廳走動，
走進「對話區」或靠近他人就自動開啟語音／視訊，模擬真實的語言交換練習。

- **前端** `web/` — Vite + React + TypeScript + Babylon.js 8
- **realtime 伺服器** `realtime/` — Go（`coder/websocket`），權威 transform 廣播
- **媒體** — LiveKit Cloud（Phase 1 起）
- 完整設計與進度見 [`docs/PLAN.md`](docs/PLAN.md)（活文件）。

目前進度：**Phase 0（3D 骨架）**— 能走、能看到別人。

---

## 需求

| 工具 | 版本 |
|---|---|
| Node.js | ≥ 20（開發用 22） |
| pnpm | 9.12.3（`corepack enable` 即可） |
| Go | ≥ 1.21 |

## 首次設定

```bash
pnpm install
```

Go 依賴在第一次 `go run` / `go test` 時自動下載。

## 本機啟動

開兩個終端機：

```bash
# 終端 1 — realtime 伺服器（預設 :8787）
cd realtime
go run ./cmd/server
```

```bash
# 終端 2 — 前端 dev server（預設 :5173，被佔用會自動換埠）
pnpm dev
```

瀏覽器開 `http://localhost:5173`。**開兩個分頁**即可看到彼此的 avatar。

### 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `ADDR` | `:8787` | realtime 伺服器監聽位址 |
| `TICK_RATE` | `15` | 每秒 snapshot 廣播次數 |
| `VITE_REALTIME_URL` | `ws://localhost:8787/ws` | 前端連線的 WebSocket 位址（放 `web/.env.local`） |

### LiveKit（語音／視訊，Phase 1）

1. 到 [cloud.livekit.io](https://cloud.livekit.io) 建立專案，拿 Websocket URL + API Key + API Secret。
2. `cp realtime/.env.example realtime/.env`，填入這三個值（`.env` 已 gitignore，不會進版控）。
3. 啟動 realtime 伺服器時如果印出 `LiveKit token endpoint enabled at /token` 代表接上了；
   沒設環境變數也能正常跑，只是 `/token` 會停用（訊息裡會說明）。

## 操作

WASD／方向鍵移動 · 點地板走過去 · 點椅子坐下（再點一次站起）· 拖曳旋轉鏡頭 · 滾輪縮放 ·
`V` 切換第一／第三人稱 · HUD 右上角 🎤 開關麥克風（LiveKit 連上後才能點）。

語音走 LiveKit：進房自動連線（不會自動開麥，避免一進頁面就跳權限請求），同房間所有人的
聲音現在都會依 avatar 距離調整音量（3m 內全音量、10m 外靜音）。沒設 `realtime/.env` 時
HUD 會顯示「語音未設定」，其餘功能不受影響。

---

## 開發指令

### web（在 repo 根目錄）

```bash
pnpm dev          # dev server
pnpm build        # tsc -b + vite build
pnpm typecheck    # tsc -b --noEmit
pnpm lint         # eslint
pnpm --filter web test   # vitest run
```

### realtime

```bash
cd realtime
go run ./cmd/server
go test ./...
go vet ./...
gofmt -l .        # 應無輸出
```

---

## 專案結構

```
engChatRoom/
  web/
    src/engine/   # Babylon 場景、攝影機、角色控制、插值、render-on-demand
    src/net/      # WebSocket client + 對齊 protocol 的型別
    src/ui/       # React overlay（HUD）
  realtime/
    cmd/server/           # main：路由 + tick loop 啟動
    internal/game/        # room manager、client、tick、配色
    internal/protocol/    # wire 訊息定義（與 web/src/net/types.ts 同步）
  docs/PLAN.md    # 技術分析與分階段 Roadmap（活文件）
```

## Roadmap（摘要）

- **Phase 0** — 3D 骨架：能走、能看到別人 ← 現在
- **Phase 1** — Proximity 媒體（LiveKit）+ 坐下 + 房間文字聊天
- **Phase 2** — 產品化 + 語言交換活動模式 + 初階 AI（AI Host / 規則 NPC / 召喚夥伴）
- **Phase 3** — 擴增（interest management、多實例）+ 進階 AI（語音）+ 打磨

細節見 [`docs/PLAN.md`](docs/PLAN.md)。
