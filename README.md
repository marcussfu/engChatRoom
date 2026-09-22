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

### 語言交換活動模式（主持人）

咖啡廳的核心玩法：主持人開一場活動，分成 N 輪，每輪有計時和一個話題，**每輪結束會提示坐黑椅的人
可以換到下一桌**（桌 16 → 桌 1 環繞）認識新夥伴——但**只是提示，不會強制移動**，換不換、什麼時候換
由參加者自己決定（自己點椅子走過去）；白椅的人不受影響。

1. `realtime/.env` 加一行 `HOST_KEY=隨便取一個只有你知道的字串`（沒設就沒人能當主持人），重啟 server。
2. 瀏覽器右下角 **🎓 主持** → 填入同一個金鑰 → 設定輪數、每輪幾分鐘、話題（每行一個，留空用內建話題；
   話題比輪數少會循環使用）→ **▶ 開始活動**。金鑰只存在你自己瀏覽器的 localStorage。
3. 活動中畫面上方會顯示「第 N / M 輪 · 倒數 · 話題」；每輪換輪時，坐黑椅的人會看到「可以移到桌 N」的
   通知（自行決定要不要移動）。主持人可以 **⏭ 下一輪 / ＋1、＋5 分鐘 / ⏹ 結束活動**。
4. 中途才進來的人也會看到目前進度（倒數以 server 時間為準，不受各人電腦時鐘影響）。

沒有帳號系統前，「主持人」就是「知道 `HOST_KEY` 的人」；同一條連線猜錯 5 次金鑰會被擋，重新整理才能再試。

### 聊天記錄持久化（Postgres，選用）

沒設定也完全能跑，聊天照樣即時互通，只是重啟後歷史會消失、新加入的人看不到之前的對話。

1. `docker compose -f infra/docker-compose.yml up -d`
2. `realtime/.env` 加一行：
   ```
   DATABASE_URL=postgres://engchatroom:engchatroom@localhost:5432/engchatroom?sslmode=disable
   ```
3. 啟動 realtime 伺服器時印出 `chat persistence enabled (Postgres)` 代表接上了；資料表
   由伺服器自己在啟動時建立（`Store.Migrate`），不用額外跑 migration。

## 操作

WASD／方向鍵移動 · 點地板走過去 · 點椅子坐下（再點一次站起）· 拖曳旋轉鏡頭 · 滾輪縮放 ·
`V` 切換第一／第三人稱。

HUD 右上角（LiveKit 連上後才能點，耳機模式除外）：
- 🎤 麥克風開關
- 📷 鏡頭開關 — 開啟後對方會在你的 avatar 上方看到一塊視訊畫面（billboard，永遠面向鏡頭）
- 🖥️ 螢幕分享 — 跳瀏覽器的分享畫面選擇視窗；一樣顯示在你的 avatar 上方（跟鏡頭共用同一塊
  billboard，同時開兩個的話畫面優先顯示螢幕分享）；用瀏覽器原生的「停止共用」列結束也會同步
  更新按鈕狀態
- 🎧 耳機模式 — 開啟後不管距離都聽不到任何人（不需要 LiveKit 已連線就能切）
- ⚙️ 裝置 — 選麥克風／鏡頭來源（裝置名稱要先允許過一次權限才看得到，瀏覽器隱私限制）

語音走 LiveKit：進房自動連線（不會自動開麥/開鏡頭，避免一進頁面就跳權限請求），同房間所有人的
聲音會依 avatar 距離調整音量（3m 內全音量、10m 外靜音，耳機模式時無視距離全部靜音）。
沒設 `realtime/.env` 時 HUD 會顯示「語音未設定」，其餘功能不受影響。

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
go test ./...     # internal/store 的 Postgres 測試沒設 DATABASE_URL_TEST 會自動跳過
go vet ./...
gofmt -l .        # 應無輸出
```

---

## 專案結構

```
engChatRoom/
  web/
    src/engine/   # Babylon 場景、攝影機、角色控制、插值、render-on-demand、視訊 billboard
    src/media/    # livekit-client 封裝：連線、麥克風/鏡頭/螢幕分享、proximity 音量
    src/net/      # WebSocket client + LiveKit token fetch + 對齊 protocol 的型別
    src/ui/       # React overlay（HUD、聊天、裝置選單）
  realtime/
    cmd/server/           # main：路由 + tick loop 啟動
    internal/game/        # room manager、client、tick、配色、聊天廣播+持久化
    internal/event/       # 語言交換活動的輪次狀態機（純函式式，時間由呼叫者傳入，好測試）
    internal/livekit/     # LiveKit join token 簽發（POST /token）
    internal/store/       # Postgres：聊天記錄持久化
    internal/protocol/    # wire 訊息定義（與 web/src/net/types.ts 同步）
  infra/docker-compose.yml  # 本機 Postgres
  docs/PLAN.md    # 技術分析與分階段 Roadmap（活文件）
```

## Roadmap（摘要）

- **Phase 0** — 3D 骨架：能走、能看到別人 ← 現在
- **Phase 1** — Proximity 媒體（LiveKit）+ 坐下 + 房間文字聊天
- **Phase 2** — 產品化 + 語言交換活動模式 + 初階 AI（AI Host / 規則 NPC / 召喚夥伴）
- **Phase 3** — 擴增（interest management、多實例）+ 進階 AI（語音）+ 打磨

細節見 [`docs/PLAN.md`](docs/PLAN.md)。
