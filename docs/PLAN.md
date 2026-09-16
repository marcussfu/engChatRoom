# 打造類 SpotVirtual 虛擬空間 —— 技術分析與實作計畫（3D 版）

> **這是一份「活文件」（living document）。** 每完成一個里程碑或方向調整，
> 就回來更新對應段落與 §三 Roadmap 的勾選狀態，讓這份計畫始終反映目前實際進度與決策。
>
> **進度紀錄**
> - 2026-09-09：完成初版計畫（3D / Babylon.js、Go realtime、LiveKit Cloud、CI/CD、AI Host + 召喚夥伴 + 規則 NPC）。
> - 2026-09-09：**Phase 0 開工，骨架大致完成（待瀏覽器實測）**。詳見下方「Phase 0 現況」。
> - 2026-09-10：initial commit（`03c192f`，35 檔）、`.gitattributes`（LF 正規化）、
>   根 `README.md`（本機啟動步驟）、`.github/workflows/` 兩條 CI pipeline（web / realtime）。
>   首次瀏覽器實測：其他驗收項都過，但「兩個 avatar 互相看得到」失敗（只顯示一個）。
>   已定位並修正（commit `fb4c29a`）：client 連線後未上報 spawn 座標 → server 對閒置玩家
>   記成世界原點 → 別的分頁把人畫在原點疊在一起。詳見下方「Phase 0 現況」。
>   commit：`03c192f` → `b798dd5`（CI/README）→ `fb4c29a`（spawn 同步修正）。
>   **明天第一件事**：重啟 server + 兩分頁 F12 重測，確認 `[net] snapshot` 印出 2 筆不同座標、
>   看得到另一顆膠囊；過了就收掉 Phase 0，開 Phase 1（LiveKit）。部署（Vercel / Fly.io）待帳號 secrets。
> - 2026-09-11：**Phase 0 驗收通過** ✅ —— 兩分頁互相看得到、各自移動平順。
>   **Phase 0 收尾（骨架部分）完成**，開始 **Phase 1**（LiveKit proximity 媒體 + 坐下 + 房間聊天）。
>   部署（Vercel / Fly.io）仍待帳號 secrets，先不擋 Phase 1 開工。
>   同日接續：Phase 1 先做**不需要外部帳號**的切片並完成 —— 對話區偵測（zone）、點椅子坐下
>   （anchor/rotator 座位、佔位擋重複坐）、房間文字聊天（記憶體版）。全綠（web 4 項 + realtime
>   gofmt/vet/build/test 共 6 個測試）。**LiveKit Cloud 帳號 + Postgres** 仍是 Phase 1 剩餘項的前提。
>   詳見下方「Phase 1 現況」。
> - 2026-09-14：`3bf6c85` push 上 GitHub 後，`realtime` CI **第一次真的在雲端跑**（之前的
>   commit 從沒觸發過），`golangci-lint` 的 errcheck 抓到 `integration_test.go` 7 處
>   `defer x.CloseNow()` 沒檢查回傳值（2 處是 Phase 0 舊 code、5 處是新測試）。
>   修正並 push（`b502713`）：改成 `defer func() { _ = x.CloseNow() }()`。
>   `gh run watch` 確認 **realtime CI 全綠**（gofmt/vet/golangci-lint/test -race/build）；
>   web CI 維持上次的綠燈（這次 commit 沒動到 `web/**`，不會觸發）。
>   使用者實測回報：點椅子會**瞬移**過去，體驗不對。改成跟點地板一樣**走過去**，抵達才吸附坐下
>   （`LocalPlayer.walkToSeat()` + `finishSit()`；該桌 keep-out 半徑走位時暫時解除，
>   否則永遠碰不到座位點）。
>   **使用者提供 LiveKit Cloud 帳號**（websocket URL + API Key/Secret），Phase 1 剩餘項解鎖。
>   `realtime` 新增 `internal/livekit`：`POST /token` 簽發房間 join token。**特意不用**
>   `github.com/livekit/protocol`——那個套件是完整 server SDK（webrtc/redis/nats/prometheus/grpc
>   等 40+ 個間接依賴），還把 go.mod 逼到需要 go1.26（本機是 1.21.4，`go mod tidy` 直接失敗）；
>   改成自己用輕量的 `golang-jwt/jwt/v5` 簽 LiveKit 文件記載的 JWT 格式，零多餘依賴。
>   `.env`（gitignore）放 `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`，`godotenv` 載入、
>   沒設就跳過（`/token` 停用但伺服器仍正常跑）。6 個新測試（mint/handler）全過。
>   前端 LiveKit 連線（加入房間、發布麥克風、proximity 訂閱、視訊貼圖）還沒做——下次接續
>   （**已完成，見下一則**：加入房間、發布麥克風、proximity 音量。視訊貼圖/螢幕分享仍沒做）。
>   CI 這次抓到一個**跟 LiveKit 無關的既有 bug**：`go test -race` 在 `internal/game` 出現
>   data race（`Room.remove()` 關 `c.send` channel，跟 `broadcastSnapshot`/`broadcastCtl` 在鎖外
>   對同一個 channel送資料互撞——本機沒 cgo 一直沒機會用 `-race` 測到，這是它第一次真的抓到）。
>   修法：兩個 broadcast 函式的send迴圈搬進鎖裡（都是非阻塞 send，成本可忽略），讓「關閉」跟
>   「送」互斥。本機驗證非 race 版全過，`-race` 交給 CI 驗證。
>   同日接續：**前端接上 LiveKit**——`media/livekit.ts`（`Media` 類別包 `livekit-client` 的
>   `Room`）+ `net/tokenClient.ts`（呼叫 `/token`）。收到 `welcome`（拿到自己 id）後就去要
>   token、連 LiveKit room；identity 直接沿用 WS 的 player id，讓 LiveKit participant 跟
>   avatar 對得起來。麥克風**預設關**（點 HUD 🎤 按鈕才開，避免一進頁面就跳權限請求）；
>   proximity「音量隨距離」先用簡化版——所有人音訊都 auto-subscribe（房間本來就小），
>   每幀依 avatar 距離調整各自 `<audio>` 元素的 `volume`（3m 內全音量、10m 外靜音），
>   不是真的 LiveKit 選擇性 subscribe（那個要另外設 `autoSubscribe:false` + 手動
>   `track.setSubscribed()`，複雜度高很多，留到之後真的要省頻寬再做）。
>   HUD 加語音狀態燈 + 🎤/🔇 切換鈕（未連線時停用）。**這塊完全沒機會用瀏覽器實測**
>   （包含 identity 對得上、`/token` CORS 真的過、`RoomEvent` 監聽是否如預期觸發、
>   LiveKit Cloud dashboard 看不看得到 participant）——下次第一件事是使用者實測回報。
>   **本日收工**：`03c192f`→`b7ddbfd` 共 12 個 commit 全部 push，GitHub `main` 兩條 CI 都綠燈。
>   **下次開場請使用者做的事**：重啟 `realtime`（吃到 `.env`）+ 兩分頁重整，F12 開 Console，
>   (1) 確認語音狀態燈變化、(2) 點🎤是否跳瀏覽器權限請求、(3) 兩分頁彼此說話音量會不會隨走位
>   遠近改變、(4) 去 LiveKit Cloud dashboard 看房間 `cafe` 有沒有 2 個 participant、
>   (5) Console 有沒有紅字（尤其 CORS / WebSocket / LiveKit 連線錯誤）。回報結果後再决定修
>   bug 還是往下做視訊 billboard。
> - 2026-09-15：使用者實測，Console 貼出真正的錯誤：`/token` 的 CORS preflight 被擋
>   （`No 'Access-Control-Allow-Origin' header is present`）。**根因**：`main.go` 原本只在
>   `livekit.ConfigFromEnv()` ok 時才把 `/token` 註冊到 mux；沒設好（或設了沒重啟 server）時，
>   `/token` 走 Go 內建 404，那個 404 完全沒有 CORS header——瀏覽器連 OPTIONS preflight 都過不去，
>   JS 端連狀態碼都看不到，只會看到一句語意不明的 CORS 錯誤（不會走到我設計好的
>   「404→unavailable」判斷）。
>   **修法**：`/token` 改成**永遠註冊**，`TokenHandler` 多一個 `enabled bool`；沒設定時回
>   **503**（含 CORS header）而不是讓路由整個消失。前端 `tokenClient.ts` 判斷條件從
>   `404` 改成 `503`。新增回歸測試 `TestTokenHandlerDisabledStillSendsCORS`
>   （驗證 disabled 時 OPTIONS 跟 POST 都還是有 `Access-Control-Allow-Origin`）。
>   同時也在 `media/livekit.ts` / `tokenClient.ts` 補上 `console.error` 印真正的錯誤內容，
>   這次能這麼快定位就是靠這個。
>   **這修法解決了 CORS 這一層，但還沒證實使用者的 `realtime/.env` 本身設對了**——如果
>   `.env` 沒建好或沒重啟 server，現在應該會很乾脆地在 HUD 顯示「語音未設定」而不是「連線失敗」，
>   下次重測要先看是不是變成這樣、還是換一種錯誤（那就是 token/LiveKit 本身的問題）。
> - 2026-09-16：`realtime/.env` 一開始根本沒建立（`Glob` 一查只有 `.env.example`），
>   建好+重啟後 `/token` 回 503 變乾脆的成功 200，`main.go` 也印出
>   `LiveKit token endpoint enabled at /token`——CORS/設定那層確認修好。
>   接著換一種錯誤：Console 出現 `[media] room.connect failed: ConnectionError:
>   could not establish signal connection: invalid token`，LiveKit Cloud 端 WebSocket
>   401。**這代表 token 有簽出來、有送到，但 LiveKit 判定簽名/內容無效**——不是我們程式碼的
>   claim 結構問題（結構照文件寫，跟官方 SDK 產出的格式一致），八成是 `.env` 裡的
>   `LIVEKIT_API_SECRET` 複製貼上出錯（打字、漏字、多空白/換行都會讓簽名對不上）。
>   **使用者直接在 LiveKit Cloud 建一組新的 API key 重貼，問題排除**——證實就是舊那組
>   key/secret 有問題（不確定是複製出錯還是那組 key 本身已失效），不是程式碼 bug。
>   收工前使用者要離開，**還沒跑完整驗收清單**（HUD 顯示已連線、dashboard 看到 2 個
>   participant、麥克風權限、音量隨距離），git 沒有新東西要 push（`74c66cf` 已是最新，
>   working tree 乾淨）。**下次回來先跑這個驗收清單**確認 Phase 1 語音真的全通，再決定
>   往下做視訊 billboard/螢幕分享，還是先補 Postgres 聊天持久化。

## Context（為什麼做這個）

`d:\engChatRoom` 目前是空目錄，要從零打造一個類似 **SpotVirtual** 的虛擬空間，用途是
**「英語口說練習咖啡廳」**：使用者操控 avatar 在 3D 場景走動，走進「對話區（conversation zone）」
或靠近他人就自動開啟語音／視訊，模擬真實咖啡廳的多人分組口說練習。

網址結構 `spotvirtual.com/@english-speaking-cafe/@party-ZMP/@cafe` 對應階層：
**組織 space / 子空間 / 房間 room**。截圖顯示至少有 `Reception` 與 `Cafe` 兩個房間。

### 關鍵結論：這是 3D，不是 2D
截圖佐證：有第一人稱視角、場景可自由旋轉／縮放／平移、透視感（近大遠小、牆面遮擋）、
low-poly 3D 模型（椅子、桌子、雪人、樹、房間結構有體積與陰影）、3D 角色可坐下並播放動作、
視訊以貼圖平面呈現在世界中（地上那張人像 = 某人的鏡頭／分享畫面）。

### SpotVirtual 實際用的技術（已查證）
- **UI：React**
- **3D 引擎：Babylon.js**（非 Three.js）。官方部落格理由：原生 TypeScript、對燈光/陰影的
  細緻控制（`ShadowGenerator` 可綁定個別物件，而非 Three.js 的 scene 級 singleton）、
  **render-on-demand**（場景很少變動時不維持固定 render loop，降低 CPU）、內建導航網格
  (navmesh) 與進階攝影機、Inspector 除錯工具、Blender addon、微軟資源支援、WebGPU 進度較前。
- React 只管 UI overlay；Babylon 用物件導向方式自行管理（**不用** react-babylonjs），
  因為每幀邏輯與系統耦合度高。
- 選擇 web 原生框架而非 Unity WASM，換取快速載入。

### 使用者已確認的方向
- 規模：先做小的 **Learning MVP**，完成後逐步擴增（本計畫分階段，MVP 就把擴增接縫留好）。
- 媒體基礎設施：用 **managed 服務**（LiveKit Cloud），不自架 SFU / TURN。
- 技術棧：**前端 TypeScript**，**realtime／遊戲伺服器用 Go**。
- 世界渲染：用遊戲引擎 → 本計畫採 **Babylon.js**（對齊 SpotVirtual）。

---

## 一、從截圖盤點要建的「場景」與「功能」

### A. 場景（3D assets）
| 區域 | 內容 |
|---|---|
| 戶外 | 雪地地面、low-poly 樹、雪人、禮物盒、天空盒；作為 spaces 之間的中庭 |
| Reception（接待室） | 小房間、門通往 Cafe、歡迎看板（地面文字貼圖）、紅/黃雪人立在門口 |
| Cafe（主廳） | 長方形房間；**編號 1–16 的雙人桌椅**（語言交換配對用）；牆上多張 `spot` 螢幕（嵌入內容）、國旗與人物海報、`TIMER` 看板顯示輪次（9:00–9:20 / 9:20–9:40 / 9:40–10:00）、白板、紅色沙發、向日葵裝飾、`規則：不能講中文，只能講英文` 標語、`TOPIC 1/2/3`、`Random Topics` 話題看板 |

建置方式：用 **glTF/glb** 低多邊形模型組場景。
- 家具/場景：Quaternius、Kenney（CC0 免費）或 Synty POLYGON（付費便宜）。
- 角色 avatar：Ready Player Me（免費 glb，含標準骨架）或自製低多邊形。
- 動作：Mixamo（idle / walk / sit / wave / clap / raise-hand）retarget 到 avatar 骨架。
- 匯出用 Babylon 的 Blender addon；glb 壓縮用 Draco / meshopt，貼圖用 KTX2/Basis。
- 每個 room 存成一份「scene 定義」：glb URL + spawn points + **seats**（每張椅子的
  position/rotation 錨點）+ **zones**（對話區的 box/polygon）+ **embed anchors**（牆上螢幕位置）。

### B. 功能清單（依截圖）
1. **移動與攝影機**：方向鍵移動 + 點地板 click-to-move（navmesh 尋路）；第一人稱／第三人稱切換；
   orbit 旋轉、滾輪縮放、平移；攝影機遇牆淡出或碰撞回收。
2. **坐下**：點椅子 → avatar 吸附到 seat 錨點、播放 sit 動作；再按鍵起身。
3. **對話區 / proximity**：進入 zone 時提示「You entered a conversation zone」；同 zone 或
   半徑內的人才互相看得到視訊、聽得到聲音；音量隨距離衰減。
4. **語音／視訊**：麥克風/鏡頭開關、裝置選擇；視訊以 billboard 貼圖平面顯示在 avatar 附近；
   螢幕分享貼到牆上 `spot` 螢幕 mesh。
5. **牆面嵌入（top toolbar 圖示）**：螢幕分享、圖片、網頁、YouTube、白板、計時器 widget、投票。
6. **房間聊天室**：每個 room 一條 chat feed（截圖 "Message Cafe"）。
7. **側邊欄**：Spaces（`輕鬆聊英文咖啡`）、Channels、Guests；房間清單（Reception / Cafe）並顯示人數。
8. **狀態與模式**：Present / In a meeting / Grabbing lunch / Focus time；Headphones Mode（靜音全部）。
9. **Avatar 自訂**：Change your avatar。
10. **Emote / 舉手**：bottom toolbar 表情、舉手。
11. **訪客邀請**：邀請連結 → `Continue` / `No thanks` 落地頁 → 以 guest 身分進入。
12. **語言交換活動模式（此用途專屬）**：輪次計時器（TIMER 看板）、到點提示換桌換夥伴、
    TOPIC 話題卡輪播、主持人開始/下一輪控制、依編號桌配對。

---

## 二、系統架構

```
┌─────────────── 瀏覽器（前端，TypeScript）───────────────┐
│  React（UI overlay：側欄/聊天/工具列/視訊格）           │
│  Babylon.js（3D 場景、攝影機、角色控制、navmesh、        │
│              render-on-demand、視訊貼圖、PositionalAudio）│
│  livekit-client（媒體）  ·  WebSocket client（狀態同步） │
└───────────────┬──────────────────────┬──────────────────┘
                │ WebSocket            │ WebRTC (SFU)
                ▼                      ▼
   ┌────────────────────────┐   ┌──────────────────────┐
   │ Realtime Server (Go)   │   │  LiveKit Cloud       │
   │ - 房間 manager / tick  │   │  (SFU + TURN + 擴縮) │
   │ - 權威 transform 廣播  │   └──────────────────────┘
   │ - zone 判定 / 配對     │
   │ - LiveKit token 簽發   │
   │ - REST API             │
   └───────┬────────────────┘
           │
     ┌─────▼─────┐   ┌──────────────┐   ┌───────────────┐
     │ Postgres  │   │ Redis(之後)  │   │ 物件儲存 glb  │
     └───────────┘   └──────────────┘   └───────────────┘
```

### 各層技術選型
| 層 | MVP 選擇 | 替代 | 理由 |
|---|---|---|---|
| UI | React + Vite + TS | Next.js | App 不需 SSR，Vite 快 |
| 3D 引擎 | **Babylon.js**（imperative，不用 react-babylonjs） | Three.js + react-three-fiber、PlayCanvas | 對齊 SpotVirtual；內建 navmesh、Inspector、render-on-demand、TS 原生 |
| 尋路/導航 | Babylon `RecastJSPlugin`（navmesh） | 自刻 A* grid | 引擎內建 |
| 碰撞 | ellipsoid + `checkCollisions`（或限制在 navmesh 內） | 完整物理引擎 | MVP 不需物理 |
| 空間音訊 | Babylon `Sound` spatial（Web Audio PannerNode）或手動 gain | LiveKit spatial-audio 範例 | 與 3D 座標整合 |
| 媒體 SFU | **LiveKit Cloud** | Daily / Agora / 100ms；自架 LiveKit | managed TURN + 擴縮，有 Go server SDK |
| 即時傳輸 | WebSocket（Go, `coder/websocket`） | Colyseus(TS)、WebTransport | 符合 Go 偏好、併發模型合適 |
| 同步模式 | 權威伺服器，10–15 Hz transform snapshot，客戶端 interpolation | client-authoritative | 一致性、之後好加防作弊 |
| Auth | Clerk 或 Supabase Auth（含 guest/匿名） | Auth0、自刻 JWT | 快、內建訪客 |
| 資料庫 | Postgres（`pgx` + `sqlc`） | — | 關聯資料 |
| Cache / fan-out（之後） | Redis 或 NATS | — | 多實例 |
| 部署 | Vercel/Netlify（web）+ Fly.io/Railway（Go）+ Neon（PG）+ LiveKit Cloud + R2/S3（glb） | k8s / 雲廠商 | 低維運 |

### 同步的資料（每個 player）
`{ id, roomId, x, y, z, yaw, animState(idle|walk|sit|wave…), seatId?, zoneId?, status, mic, cam }`
— 伺服器權威保存，tick 廣播差異；客戶端對遠端 avatar 做位置/朝向插值並依 animState 播動作。

### Proximity / zone → 媒體訂閱
- 每個 room 對應一個 LiveKit room。
- 進入某 zone 或落在半徑 `R` 內 → 前端 **subscribe** 對方 audio(+video) track；離開 → unsubscribe。
- 音量 = 距離衰減曲線（inverse / 線性 clamp），邊界加 hysteresis（進 0.9R、出 1.1R）。
- zone 內採「群組全連」；zone 外純距離。Headphones Mode = 全部 gain 0。

### 資料模型（Postgres 草稿）
- `users(id, email, display_name, avatar_url, is_guest)`
- `spaces(id, slug, name, owner_id)`
- `rooms(id, space_id, slug, name, scene_id)`
- `scenes(id, glb_url, spawn_points jsonb, seats jsonb, zones jsonb, embeds jsonb)`
  — `seats[]` 每項含 `{id, table, role: anchor|rotator, position, rotation}`（rotator = 黑椅）
- `embeds(room_id, anchor_id, type, url)` — 牆面螢幕內容
- `chat_messages(id, room_id, user_id, body, created_at)`
- `sessions(id, room_id, start_at, end_at, round_count, round_minutes, host_mode)` — 語言交換場次
- `session_rounds(session_id, idx, topic_title, topic_prompt, starts_at, ends_at, source)`
- `rules(id, scope_id, kind, ord, title, body, lang, active)` — 規則講解員 NPC 的知識，管理者可增減
- `npcs(id, room_id, kind: fixed|companion, persona jsonb, seat_id?, owner_user_id?, expires_at?)`
- 即時 transform：MVP 放記憶體；多實例時移到 Redis。

---

## 三、分階段 Roadmap

### Phase 0 — 3D 骨架：能走、能看到別人（約 2–3 週）
- `web/`：Vite + React + Babylon.js。載入一份 Cafe glb；平行光 + 環境光 + `ShadowGenerator`。
- 角色控制：方向鍵移動 + 點地板 click-to-move（先用簡單 raycast，navmesh 可延後）；碰撞用 ellipsoid。
- 攝影機：`ArcRotateCamera`（第三人稱 orbit/zoom）+ 切第一人稱（`UniversalCamera`）。
- `realtime/`（Go）：WebSocket server，一個寫死的 room；收 `move`、以 tick 廣播所有人 transform。
- 遠端 avatar 用膠囊或簡單模型，套插值 + walk 動作。
- render-on-demand：有人移動/動畫時跑 render loop，全體靜止時凍結。
- 部署：web → Vercel，Go → Fly.io。← 未做（待帳號 secrets）
- **CI/CD 同步建立**：lint + typecheck + test + build ← ✅ 已建（`.github/workflows/{web,realtime}.yml`）；
  自動部署待 Vercel / Fly.io 帳號。
- **驗收**：兩個瀏覽器視窗看到彼此 3D avatar 平順走動；可旋轉/縮放場景、切第一/三人稱。✅ **通過（2026-09-11）**

#### Phase 0 現況 —— ✅ 完成（骨架部分，2026-09-11）

**已完成並通過檢查（伺服器端 + 建置全綠）**
- Monorepo 腳手架：`pnpm` workspace、根 `package.json`、`.gitignore`、`git init`（main branch）。
- `realtime/`（Go + `coder/websocket`）：一個寫死的 room；15 Hz 權威 snapshot 廣播、
  idle 不廣播（dirty flag）；join/leave；welcome 帶 `id`+`color`+`tickRate`；round-robin 配色。
  檔案：`cmd/server/main.go`、`internal/protocol/protocol.go`、`internal/game/{client,room}.go`。
- Go 測試：`room_test.go`（併發鎖紀律、配色循環）、`integration_test.go`（兩 client 互相看到、
  leave 廣播）。`go test ./...` 綠、`go vet` 綠、`gofmt` 乾淨、`go build` 綠。
  （`-race` 本機缺 cgo 跑不了，交給 CI ubuntu。）
- 實機 smoke：server binary 起得來、`/healthz` ok、Node WebSocket smoke（兩 client 互看）PASS。
- `web/`（Vite + React + TS + **Babylon.js 8**）：
  `engine/`＝`environment.ts`（地板、2 光源+陰影、4 面牆、16 張編號桌 + anchor/rotator 座椅、
  房間邊界）、`avatar.ts`（膠囊+朝向 nose 佔位、可 recolor）、`localPlayer.ts`（WASD/方向鍵
  + 點地板移動、桌子 keep-out + 邊界、yaw 平滑）、`remotePlayers.ts`（snapshot 驅動、指數插值）、
  `cameraRig.ts`（ArcRotate 第三人稱 + UniversalCamera 第一人稱，V 切換）、`mathUtils.ts`(+vitest)、
  `Game.ts`（組裝、render-on-demand 活動視窗、input 節流 ~20/s + 停止補一幀）。
  `net/`＝`types.ts`（對齊 protocol.go）、`socket.ts`（WS client + 重連 backoff）。
  `ui/`＝`Hud.tsx`（連線狀態、線上人數、視角切換、操作提示）、`App.tsx`、`main.tsx`、`styles.css`。
  `pnpm typecheck / lint / test(5 pass) / build` 全綠。
- 過程中修掉一個 bug：`ServeWS` 的 welcome/snapshot 順序競態（welcome 現在在加入 room 前先入佇列）。

**瀏覽器實測驗收 —— ✅ 通過（2026-09-11）**：兩分頁互相看得到、各自移動平順、旋轉/縮放/切視角都正常。
- 2026-09-10 首次實測踩到一個 bug：「兩個 avatar 互相看得到」失敗，只顯示一個。
  **原因**：本地 avatar spawn 在 `(0,0,6)`，但 client 只在「移動時」才送座標，
  所以 server 對閒置玩家一律記成 `(0,0,0)`，別的分頁就把你畫在世界原點、疊在一起。
  **已修**（`fb4c29a`）：(a) client 收到 `welcome` 後立刻送一次 `input` 把 spawn 座標上報；
  (b) server `newClient` 預設 `Z=spawnZ(6)` 對齊 client；(c) DEV 下 `welcome/snapshot/leave`
  印 console 方便回報。2026-09-11 重測確認修好。

**仍未完成（不擋 Phase 1 開工，找空檔補）**
1. 部署（Vercel / Fly.io）未做——需帳號與 secrets。
2. 已知：前端 bundle 6.1 MB / gz 1.35 MB（Babylon barrel import）→ 之後改 deep import 或
   `manualChunks`（§七 bundle budget，Phase 2–3）。CI 目前只「報告」大小不擋。

**已完成（2026-09-10 補）**
- initial commit `03c192f`（35 檔，build artifact 已 gitignore）。
- `.gitattributes`：`* text=auto eol=lf` + 常見二進位副檔名，消除 Windows CRLF 警告、CI 一致。
- 根 `README.md`：需求版本、`pnpm install` → 兩終端啟動、環境變數表（`ADDR` / `TICK_RATE`
  / `VITE_REALTIME_URL`）、開發指令、結構、Roadmap 摘要。
- `.github/workflows/web.yml`：PR + main，`web/**` 與 lockfile 觸發；pnpm/action-setup +
  setup-node 20（pnpm cache）→ `pnpm install --frozen-lockfile` → typecheck → lint → test →
  build → bundle size **報告**（寫入 step summary，尚非硬 budget）。
- `.github/workflows/realtime.yml`：PR + main，`realtime/**` 觸發；setup-go 1.21（go.sum cache）
  → gofmt 檢查 → `go vet` → golangci-lint → `go test -race` → `go build`。
  Postgres/migrate、docker→GHCR、fly deploy 以註解留待 Phase 1+。

### Phase 1 — Proximity 媒體 + 互動 MVP（約 3–4 週）
- 接 LiveKit Cloud；Go 新增 `POST /token`（依 user + roomId 簽 token）。← ✅ 已完成
- 進 room 自動加入 LiveKit room、發佈麥克風/鏡頭。← ✅ 加入房間+麥克風已完成（見下）；鏡頭未做
- **對話區**：場景放 box 觸發體；進入顯示提示；同 zone/半徑內才 subscribe，音量隨距離。
  ← ✅ zone 偵測完成；音量隨距離用**簡化版**完成（全員 auto-subscribe + 依距離調
  `<audio>` volume，非真正選擇性 subscribe，見下）。
- 視訊以 billboard 貼圖平面顯示在 avatar 上方；螢幕分享貼牆上螢幕 mesh。← 未做
- 點椅子坐下：吸附 seat 錨點 + sit 動作。← ✅ 吸附+朝向已完成；sit **動作**待有骨架 avatar 才有意義。
- 房間文字聊天（走同一條 WS，寫入 Postgres）。← ✅ WS 聊天已完成；**Postgres 持久化未做**（先記憶體）。
- 麥克風/鏡頭開關、裝置選擇、Headphones Mode。← 麥克風開關 ✅ 已完成（HUD 按鈕，預設關）；
  裝置選擇 / Headphones Mode 未做
- **驗收**：兩人進同一對話區 → 出現視訊、音量隨距離；走出 zone → 斷開；坐下有動作；
  LiveKit dashboard 看得到 participant/track。← **完全沒機會用瀏覽器實測，下次第一件事**。

#### Phase 1 現況（2026-09-11）—— 不需帳號的切片先做完

**已完成並通過檢查**
- 協定擴充（`protocol.go` / `web/src/net/types.ts` 同步）：`ClientMsg`/`PlayerState` 加
  `zoneId`、`seatId`；新增 `chat`（client→server）與 `chat`（server→client，含 `name`/`body`/`ts`）。
- **對話區偵測**：`environment.ts` 每張桌子產生一個 `ZoneMarker`（半徑 1.8m，桌距夠開不重疊）；
  `Game.frame()` 每幀算所在 zone，變化時透過 `onZone` 通知 UI（HUD 顯示「🗨️ 桌 N 對話區」徽章）
  並強制立即送一次 `input`（不等節流）。zoneId 現在只用來顯示 + 之後接 LiveKit 的訂閱分組依據。
- **坐下**：`environment.ts` 每桌回傳兩個 `SeatMarker`（白椅 anchor / 黑椅 rotator，各自朝向桌心的
  yaw）。點椅子 mesh → `LocalPlayer.walkToSeat()` 走過去（跟點地板一樣的 click-to-move，而非瞬移）、
  抵達後 `finishSit()` 才吸附位置+朝向、鎖死移動輸入；再點同一張椅子或點地板 → `standUp()`。
  走位時該桌自己的 keep-out 半徑會暫時解除（座位本來就在 keep-out 範圍內，否則永遠走不到）。
  `RemotePlayers.occupiedSeats()` 擋掉「坐已被佔的椅子」。座位沒有動畫（Phase 0/1 用膠囊佔位；
  sit 動作要等 Ready Player Me/Mixamo 骨架進來才有意義，見 PLAN §一.A）。
- **房間文字聊天**：`realtime` 新增 `chat` 訊息類型，走既有 WS、繞過 tick 立即廣播（跟 `leave` 一樣）；
  純記憶體、無持久化（`clampBody` 限 500 字元）。前端 `ui/Chat.tsx`（訊息列表 + 輸入框，自己的
  訊息靠右標色）掛在 `App.tsx`，`isTypingTarget` 守門避免打字誤觸 WASD。
- Go 新增測試：`TestChatIsBroadcastToAll`、`TestInputRelaysZoneAndSeat`（連同既有 4 個，共 6 個全過）。
- 全綠：web `typecheck`/`lint`/`vitest(5)`/`build`；realtime `gofmt`/`vet`/`build`/`test`（6 個）。

#### Phase 1 現況（2026-09-14 補）—— LiveKit token 端點

**已完成**
- `realtime/internal/livekit`：
  - `Config`/`ConfigFromEnv()` 讀 `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
    （`main.go` 用 `godotenv` 先載入 `realtime/.env`，真環境變數優先；三個沒設齊就跳過，
    伺服器仍正常起、只是 `/token` 不註冊）。
  - `MintToken()`：自己組 LiveKit 文件記載的 JWT（`iss`/`sub`/`nbf`/`exp` + `video: {roomJoin, room}`
    + `name`），用 `golang-jwt/jwt/v5` HS256 簽。**特意不依賴 `github.com/livekit/protocol`**——
    那是完整 server SDK，會多拉 40+ 個間接依賴（pion/webrtc、redis、nats、prometheus、grpc…）
    且把 go.mod 逼到 `go 1.26`（本機工具鏈 1.21.4，`go mod tidy` 直接失敗，只好整個 revert 重來）。
    只簽一個 join token不需要這些。
  - `TokenHandler`：`POST /token`，body `{identity, name}` → 回 `{token, url, room}`；
    `room` 目前寫死 `"cafe"`（跟 WS 那個寫死房間對應）；dev 開放 CORS（跟 WS 的
    `InsecureSkipVerify` 一樣是 Phase 0/1 暫時作法，部署前要收緊）。
  - `realtime/.env.example`（committed，範本）；`realtime/.env`（gitignore，使用者本機自己填）。
  - 6 個新測試（mint token 往返解碼驗證 claims、`ConfigFromEnv` 開關、handler 200/400/405）全過。

**尚未完成（2026-09-14 當時）**
1. 前端 LiveKit 整合。← ✅ 完成，見下一則「Phase 1 現況（前端 LiveKit）」
2. **Postgres**：聊天記錄持久化目前只在記憶體，重啟就消失；需要 docker-compose 起 Postgres +
   `chat_messages` table + 一支 migration，之後把 `broadcastChat` 順手寫 DB。
3. 部署（Vercel / Fly.io）——同 Phase 0，待帳號；**LiveKit 的 secrets 之後要放 Fly secrets**，
   不能跟著 `.env` 進版控（本來就沒進，這裡再提醒一次）。

#### Phase 1 現況（2026-09-14 補二）—— 前端 LiveKit

**已完成**
- `web/src/media/livekit.ts`：`Media` 類別包 `livekit-client` 的 `Room`。
  - 連線：`connect(url, token)`；監聽 `ConnectionStateChanged` 回報 `MediaStatus`
    （`idle|connecting|connected|disconnected|unavailable|error`）。
  - 播放：`TrackSubscribed`（audio）→ `track.attach()` 建一個隱藏 `<audio>` 塞進
    `document.body`；`TrackUnsubscribed`/`ParticipantDisconnected` → 移除。
  - **proximity 音量（簡化版）**：不做 LiveKit 真正的選擇性 subscribe（那需要
    `autoSubscribe:false` + 手動 `track.setSubscribed()`，複雜度高很多）——房間本來就小
    （≤15 人），乾脆全員 auto-subscribe，`updateProximity()` 每幀依每個 remote 的
    avatar 距離（`RemotePlayers.positions()` 新增）線性調整該 participant `<audio>`
    的 `volume`（3m 內全音量、10m 外靜音）。之後真的要省頻寬再換成真選擇性 subscribe。
  - 麥克風：`setMicEnabled()`；**預設關**，避免一進頁面就跳瀏覽器權限請求，
    使用者按 HUD 🎤 按鈕才觸發（`Game.toggleMic()`，未連線時是 no-op）。
- `web/src/net/tokenClient.ts`：`fetchLiveKitToken()` 把 WS url 換算成 realtime 伺服器的
  http origin、POST `/token`；把「伺服器沒設 LiveKit（404）」和「其他錯誤」分開回報
  （`unavailable` vs `error`），不用 throw。
- `Game.ts`：收到 `welcome`（=已知道自己的 WS player id）後立刻 `connectMedia(id)`——
  **LiveKit identity 直接沿用 WS player id**，這樣 LiveKit participant 才能對得回 avatar。
  `frame()` 內每幀呼叫 `media.updateProximity()`。
- `Hud.tsx`：語音狀態燈（沿用連線燈樣式）+ 🎤/🔇 切換鈕（`mediaStatus !== "connected"` 時停用）。
- 依賴：`pnpm add livekit-client`（2.22.3）。
- 全綠：web `typecheck`/`lint`/`vitest(5)`/`build`。

**尚未完成 / 已知限制**
1. **完全沒機會用瀏覽器實測**——`/token` 的 CORS、identity 對應、`RoomEvent` 是否如預期觸發、
   LiveKit Cloud dashboard 看不看得到 participant，都要下次使用者實測才知道。
2. proximity 音量是簡化版（見上），不是真的選擇性 subscribe，頻寬會隨人數变多而變高——
   ≤15 人的 Phase 1 MVP 先接受，多人再優化（PLAN §五「頻寬 O(N²)」難點）。
3. 視訊 billboard、螢幕分享、裝置選擇、Headphones Mode 都還沒做。
4. Postgres、部署——同上一則。

### Phase 2 — 產品化 + 語言交換模式 + 初階 AI
- Auth（Clerk/Supabase）含 guest；邀請連結落地頁。
- Avatar 自訂（Ready Player Me 整合）。
- 多房間 + Reception/中庭 + 側邊欄（Spaces/Channels/Guests、房間人數）、org/space/room 路由。
- navmesh 尋路（`RecastJSPlugin`）取代簡易移動；攝影機遇牆淡出。
- 牆面嵌入：圖片 / 網頁 / YouTube / 白板（tldraw 或 Excalidraw）/ 計時器 widget。
- 狀態（In a meeting / Focus time…）、emote / 舉手。
- **語言交換活動模式**：座位 anchor/rotator（白/黑）角色、輪次計時器 + 到點換桌提示、TOPIC 卡輪播、
  Host 控制台（開始 / 下一輪 / 加時 / 結束）。
- **AI（見 §八）**：AI Host（hybrid：字幕/聊天室台詞 + 換位提示）、固定規則講解員 NPC（文字）、
  使用者召喚的文字 AI 對話夥伴（含上限規則與離場邏輯）、AI 話題卡生成、對話後回饋報告。

### Phase 3 — 擴增 + 進階 AI + 打磨
- Interest management（grid / octree，只送附近實體）；Redis/NATS pub/sub、多實例、依 room sharding。
- 效能：instancing / LOD / 貼圖 atlas；同時播放的視訊平面上限、離畫面暫停；glb 壓縮調校。
- 多區 LiveKit、simulcast 調校、TURN fallback 驗證。
- in-app 場景編輯器（擺家具、定義 zone / seat / embed 錨點）。
- 行動版（PWA 或 React Native）。
- 觀測性：Prometheus、Sentry、Go headless bot 負載測試（模擬 N 個 avatar）。
- **AI 升語音（LiveKit Agents）**：AI Host TTS 全房廣播、召喚夥伴語音對話、固定 NPC 語音；
  即時字幕/翻譯、程度分級配對；之後發音評分、課後單字卡、「只講英文」助理。

---

## 四、專案結構（建議）

```
engChatRoom/
  web/                     # Vite + React + TS + Babylon.js
    src/engine/            # Babylon 場景、攝影機、角色控制、navmesh、視訊貼圖
    src/net/               # WebSocket client、狀態 store（Zustand）
    src/media/             # livekit-client 封裝、proximity 訂閱邏輯
    src/ui/                # React overlay：側欄、聊天、工具列、視訊格
  realtime/                # Go
    cmd/server/
    internal/room/         # 每 room 一個 manager、tick、transform 廣播、zone 判定
    internal/livekit/      # token 簽發（LiveKit Go SDK）
    internal/event/        # 語言交換輪次配對
    internal/ai/           # Anthropic SDK：話題卡、配對、回饋報告、單字卡（非即時）
    internal/store/        # Postgres（sqlc 產生）
  ai-agent/                # Python 或 Node：LiveKit Agents worker（語音 AI 夥伴、即時字幕）
  assets/                  # Blender 原始檔、匯出的 glb、Mixamo 動作
  scenes/                  # 各 room 的 scene 定義 json（seats/zones/embeds）
  infra/                   # docker-compose（Postgres/Redis）、部署設定
  .github/workflows/       # CI/CD pipeline（web / realtime / ai-agent / assets）
  docs/                    # 本計畫（PLAN.md）等文件
```

---

## 五、需要留意的難點

| 難點 | 對策 |
|---|---|
| 3D 載入時間 | glb 用 Draco/meshopt 壓縮、貼圖 KTX2；場景切塊漸進載入；共用材質 |
| render-on-demand 與動畫衝突 | 有 avatar 在移動/播動作時才跑 render loop，idle 全體時凍結 |
| navmesh / 碰撞 | Babylon `RecastJSPlugin` 產 navmesh；MVP 先用地板 raycast + ellipsoid |
| 攝影機被牆擋住 | 攝影機碰撞回收，或射線命中的牆面材質轉半透明 |
| 視訊貼圖效能 | 同時顯示的 video 平面設上限、離畫面/離太遠暫停解碼；遠處只收音訊 |
| 頻寬 O(N²) | LiveKit 選擇性訂閱 + simulcast + 每 room 人數上限（MVP ~15） |
| WebSocket 多實例擴縮 | MVP 單實例；之後 Redis/NATS + 依 room 一致性雜湊路由、sticky |
| NAT 穿透 / TURN | 用 LiveKit Cloud（已含）；自架才需 coturn |
| 座位 / 對話區錨定 | scene 定義裡預先標好 seat 的 position/rotation、zone 的 box |
| 成本（LiveKit 依分鐘計費） | 房間閒置自動關閉、預設只開麥不開鏡頭、遠處不收 video |

---

## 六、端對端驗證方式

1. `docker compose up`（起 Postgres）。
2. `cd realtime && go run ./cmd/server`。
3. `cd web && pnpm dev`。
4. 開兩個瀏覽器視窗、各自登入（其中一個用訪客連結），操控 avatar：
   - 旋轉/縮放場景、切第一/三人稱正常。
   - 兩人走進同一對話區 → 互相出現視訊、音量隨距離變化；走出 → 斷開。
   - 點椅子能坐下並播 sit 動作。
   - 房間聊天雙向即時，重整後歷史仍在（已入 Postgres）。
   - 螢幕分享出現在牆上螢幕 mesh。
5. LiveKit Cloud dashboard 確認 room / participant / track 狀態。
6. （Phase 2）Host 控制台設定 4 輪 session：計時到點 → TIMER 更新、TOPIC 卡切換、AI Host 台詞
   （字幕 + 聊天室）出現並說「黑椅的人換到下一桌」、結束時致謝；主辦人可按加時/跳下一輪。
7. （Phase 2）走近規則講解員 NPC → 依管理者維護的規則清單回答；管理者後台停用一條規則後不再被提及。
8. （Phase 2）坐下後按「呼叫 AI 夥伴」→ 隨機 persona 的 AI 坐到對面開始文字對話；
   說「bye」或走去別桌後 1–2 分鐘 → AI 消失並釋放座位；場上 AI 數達座位半數時按鈕禁用。
9. （Phase 3）上述 NPC / Host 皆改語音：headless bot 模擬 20–50 個 avatar，觀察 Go CPU 與前端 FPS。

---

## 七、CI/CD 與 DevOps

Monorepo（pnpm workspace + Go module + 一個 Python/Node 的 ai-agent），用 **GitHub Actions**。

### Pipeline
| Pipeline | 觸發 | 步驟 |
|---|---|---|
| **web** | PR + main | pnpm install（cache）→ `tsc --noEmit` → `eslint` → `vitest` → `vite build` + bundle size budget（Babylon + assets 容易肥）→ PR 部署 Vercel preview URL → main 部署 production |
| **realtime (Go)** | PR + main | `go vet` → `golangci-lint` → `go test -race ./...` → 用 service container 起 Postgres 跑 migration（`golang-migrate`/`atlas`）驗證 up/down → `docker build` 推 GHCR → main `flyctl deploy`（staging → promote） |
| **ai-agent** | PR + main | lint + 單元測試（mock LLM/STT/TTS）→ build image → 部署 worker |
| **assets** | 改到 `assets/` | `gltf-transform` 驗證 + Draco/meshopt 壓縮 + KTX2 轉檔 → 以 content hash 命名上傳 R2/S3 |
| **nightly** | 排程 | Go headless bot 對 staging 打 N 個 avatar 負載測試，報 P95 tick 延遲 / 前端 FPS |

### 共用
- Renovate/Dependabot 更新依賴；PR 需綠燈才能 merge。
- Secrets 放 GitHub Actions secrets + Fly secrets：LiveKit key、DB URL、Anthropic API key、Auth key。
- Sentry release + source map 上傳（web 與 Go 都接）。
- 每個 PR 可選 ephemeral 環境（Neon DB branch + 一個 realtime 實例），合併/關閉即銷毀。
- **分階段**：Phase 0 先做 web/realtime 的 lint+test+build+deploy；e2e（Playwright 兩 context 測 proximity）、
  assets pipeline、負載測試、ephemeral env 留到 Phase 2–3。

---

## 八、AI 功能

用 **Anthropic 官方 SDK**（Go 端 `anthropic-sdk-go`，`ai-agent/` 端用 Python/Node SDK）。
模型策略：即時、高頻、範圍窄的任務用 **Claude Haiku 4.5**；一般對話與台詞用 **Claude Sonnet 5**
（`claude-sonnet-5`）；高品質推理（詳細回饋報告）用 **Claude Opus 5**（`claude-opus-5`）；
非即時批次走 Message Batches（半價）。
共用原則：涉及使用者語音/逐字稿的操作（錄音、轉錄、回饋）一律先取得**明確同意**；
prompt 穩定前綴放最前做 caching；房間無人或 NPC 閒置時不跑模型。
NPC 的世界 presence（座位、位置、avatar、動作）由 Go 當 **server-side entity** 管理，
對話腦由 `ai-agent` 管，兩者用 `npcId` 綁定。文字對話先做，語音（STT→LLM→TTS，以 participant
加入 LiveKit room）在 Phase 3 疊加。

### 8.1 AI Host（人設定 + AI 主持）—— Phase 2

**流程**：主辦人在 Host 控制台設定一場 session（例：09:00–10:00，4 輪，每輪 15 分），
每輪填 TOPIC 或按「AI 產生」；也可即時 **暫停 / 跳下一輪 / 加時 / 手動廣播 / 提前結束**。

**資料模型**
- `sessions(id, room_id, start_at, end_at, round_count, round_minutes, host_mode)` — host_mode: `ai`|`human`|`hybrid`
- `session_rounds(session_id, idx, topic_title, topic_prompt, starts_at, ends_at, source)` — source: `manual`|`ai`

**執行**
- Go `realtime/internal/event` = 排程時鐘：到輪次邊界 → 廣播 WS 事件（更新牆上 **TIMER** widget、
  切換 **TOPIC 卡**）+ 送 control message 觸發 AI Host 發話。
- AI Host 台詞由 `ai-agent` 的 host agent 產生（Sonnet 5）：依「目前/下一 TOPIC、剩餘時間、換位指示」
  產一段簡短英文；Phase 2 顯示為**橫幅字幕 + 進聊天室**，Phase 3 加 TTS 發布 audio track 全房廣播。
- 台詞模板：開場歡迎 → 每輪轉場（含「**請坐黑色座位的朋友移到下一桌**」）→ 剩 2 分鐘提醒 → 結束致謝。

**換座位邏輯**
- `scenes.seats` 每個 seat 標 `role`：`anchor`（白椅，不動）/ `rotator`（黑椅，時間到要換）+ `table` 編號。
- 每輪轉場後：`rotator` 從桌 N → 桌 N+1（16→1 環繞）。可設定「只提示」或「提示 + 系統自動把該人座位移過去」。
- 參與者不一定坐白椅（可能只有黑椅有人、對面白椅空）——換位規則只作用在「坐在黑椅上的人」，與對面有沒有人無關。

### 8.2 使用者召喚的 AI 對話夥伴 —— Phase 2 文字 / Phase 3 語音

- **觸發**：bottom toolbar 「呼叫 AI 夥伴」按鈕；**任何座位顏色都能召喚**，不自動生成。
- **生成**：隨機 persona（性別、國籍、興趣、名字）+ 一個 3D avatar，坐到**該參與者對面的座位**
  （對面無座位就坐鄰近空位），面向該參與者。
- **對話**（Sonnet 5，Phase 3 接語音）：system prompt 帶 persona + 依對方估計程度調整
  （CEFR 目標、句子簡短、多問開放式問題、溫和糾錯、只講英文、不長篇獨白、把話語權交還）+ 目前 TOPIC 當上下文。
- **離場條件**：
  - 參與者說結束（bye / see you / gotta go / 「結束了」…，用**意圖判斷**不只比對關鍵字）→ AI 道別後標記待離場。
  - 參與者離開座位或走去別桌 → AI 等 **1–2 分鐘**，期間無人接續對話 → avatar 淡出、釋放座位、
    （語音階段）LiveKit participant 離開。
- **上限規則**：全場 AI 夥伴數 ≤ 座位總數的一半，且 **真人數 ≥ AI 夥伴數**；達上限時「呼叫」按鈕禁用並提示。
- **成本**：文字用 Sonnet 5（很短的回話可 Haiku）；語音階段只有對方在同 zone 且正在說話時才跑 STT/LLM/TTS。

### 8.3 固定不動的 NPC（規則講解員 / 導覽）—— Phase 2

- 場景放 1+ 個固定 NPC（例：Reception 門口的「規則講解員」），走近即觸發對話（文字氣泡；Phase 3 語音）。
- 回答「這裡要做什麼、規則是什麼、流程怎麼跑」。**知識僅來自管理者維護的規則表**，不自由發揮。
- `rules(id, scope_id, kind, ord, title, body, lang, active)` — 管理者後台可**新增 / 編輯 / 停用 / 排序**；
  可多語（給初學者）。NPC system prompt 直接帶入 active 規則清單（量大再改 RAG）。
- 管理者也可設定 NPC 的位置、persona、開場白。
- 模型：Haiku 4.5（範圍窄、要便宜快）。

### 8.4 其他 AI 功能（Phase 2–3+）

| 功能 | 說明 | 技術落點 | 模型 | 階段 |
|---|---|---|---|---|
| AI 話題卡生成 | 依程度/興趣生成 TOPIC 卡 | `realtime/internal/ai` | Haiku 4.5 / Sonnet 5 | P2 |
| 對話後回饋報告 | 文法、用詞、可改進句型的結構化回饋 | 錄音 egress → 逐字稿 → LLM 產 JSON（`output_config.format`） | Opus 5 | P2 |
| 即時字幕 / 翻譯 | avatar 上方英文字幕，初學者可開中譯 | LiveKit transcription / STT stream → 前端疊字幕 | 翻譯 Haiku 4.5 | P3 |
| 程度分級配對 | AI 口說 placement → 估 CEFR → 依等級/興趣配編號桌 | `ai-agent` 短對話 + `internal/event` 配對 | Sonnet 5 | P3 |
| 「只講英文」規則助理 | STT 語言偵測，長時間非英文 → 柔性私訊提醒 | STT language ID + 輕量 LLM | Haiku 4.5 | P3+ |
| 發音評分 | 單句發音準確度 | Azure Pronunciation Assessment 或 Whisper + 音素對齊 | 非 LLM | P3+ |
| 課後單字卡 | 從逐字稿抽學員卡住的字 → 間隔複習牌組 | `internal/ai`（Batch API）→ Postgres | Haiku 4.5 | P3+ |

---

## 參考來源
- [Why We Use Babylon.js Instead Of Three.js in 2022 — Spot 官方部落格](https://www.spotvirtual.com/blog/why-we-use-babylonjs-instead-of-threejs-in-2022)
- [Spot.xyz: 3D Virtual Headquarters — Babylon.js 論壇](https://forum.babylonjs.com/t/spot-xyz-3d-virtual-headquarters/20558)
- [Spot | Virtual workspace for humans and AI agents](https://www.spotvirtual.com/)
- [LiveKit（開源 WebRTC SFU / Cloud）](https://livekit.io/)
- [LiveKit Agents（語音 AI 框架）](https://docs.livekit.io/agents/)
- [Babylon.js 文件](https://doc.babylonjs.com/)
- [Anthropic Claude API 文件](https://docs.claude.com/)
