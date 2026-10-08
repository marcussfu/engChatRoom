# engChatRoom

*[繁體中文](README.zh-TW.md)*

A 3D virtual cafe for English-speaking practice, in the style of **SpotVirtual**. Users control
an avatar walking around a 3D cafe; walking into a "conversation zone" or near another avatar
automatically opens voice/video, simulating real language-exchange practice.

- **Frontend** `web/` — Vite + React + TypeScript + Babylon.js 8
- **Realtime server** `realtime/` — Go (`coder/websocket`), authoritative transform broadcast
- **Media** — LiveKit Cloud (since Phase 1)
- Full design notes and progress log: [`docs/PLAN.md`](docs/PLAN.md) (a living document, in Chinese).

Current status: **Phase 0 and Phase 1 are complete; Phase 2 (productization + language-exchange
session mode + early-stage AI) is well underway** — see the Roadmap below and `docs/PLAN.md` for
details.

---

## Requirements

| Tool | Version |
|---|---|
| Node.js | ≥ 20 (22 used for development) |
| pnpm | 9.12.3 (`corepack enable` is enough) |
| Go | ≥ 1.21 |

## First-time setup

```bash
pnpm install
```

Go dependencies download automatically on the first `go run` / `go test`.

## Running locally

Open two terminals:

```bash
# Terminal 1 — realtime server (default :8787)
cd realtime
go run ./cmd/server
```

```bash
# Terminal 2 — frontend dev server (default :5173, picks another port automatically if taken)
pnpm dev
```

Open `http://localhost:5173` in a browser. **Open two tabs** to see each other's avatars.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ADDR` | `:8787` | realtime server listen address |
| `TICK_RATE` | `15` | snapshot broadcasts per second |
| `VITE_REALTIME_URL` | `ws://localhost:8787/ws` | WebSocket URL the frontend connects to (put it in `web/.env.local`) |

### LiveKit (voice/video, Phase 1)

1. Create a project at [cloud.livekit.io](https://cloud.livekit.io) and get the Websocket URL + API
   Key + API Secret.
2. `cp realtime/.env.example realtime/.env` and fill in those three values (`.env` is gitignored,
   never committed).
3. If the realtime server prints `LiveKit token endpoint enabled at /token`, it's wired up; without
   those env vars the server still runs fine, just with `/token` disabled (the startup message
   explains this).

### Language-exchange session mode (host)

The cafe's core activity: a host starts a session split into N rounds, each with a timer and a
topic. **At the end of each round, people sitting in black chairs are prompted that they can move
to the next table** (wrapping from the last table back to table 1; the table count follows
whatever the scene is actually configured with, it isn't hardcoded) to meet someone new — but
it's **only a prompt, never a forced move**; whether and when to move is entirely up to each
participant (they walk over and click a chair themselves). People in white chairs are unaffected.

1. Add a line to `realtime/.env`: `HOST_KEY=some string only you know` (without it, nobody can
   become host), then restart the server.
2. In the browser, bottom-right **🎓 Host** → enter that same key → set the round count, minutes
   per round, and topics (one per line; leave blank to use the built-in topics; if there are fewer
   topics than rounds they repeat) → **▶ Start session**. The key is only ever stored in your own
   browser's localStorage.
   Each topic line supports three formats:
   - Type a sentence that **exactly matches** a built-in topic (case-insensitive) → its built-in
     article and 4 follow-up questions are pulled in automatically.
   - Type anything else → used as a custom title with no article/questions.
   - Build a line yourself with `|` → `title | article | link (optional) | question | question…`
     (up to 5 questions), fully custom content; a segment starting with `http://` or `https://` is
     treated as an embeddable link (e.g. a YouTube video) and doesn't count as a question — the
     lightbox embeds it via iframe, though most non-YouTube sites refuse to be embedded for
     security reasons, so display isn't guaranteed.
3. During a session, the top of the screen shows "Round N / M · countdown · topic"; whenever a
   round advances, people sitting in black chairs see a "you can move to table N" notice (entirely
   their own call). The host can **⏭ next round / +1, +5 minutes / ⏹ end session**, and can also
   use **Feature on big screen** to pick one of the TOPIC cards to show on the big screen on the
   north wall (see point 5 below); "Clear" cancels it.
4. Anyone who joins mid-session sees the current progress too (the countdown is driven by server
   time, unaffected by each person's own clock).
5. Besides the HUD at the top, the cafe has a few physical boards: four on the west wall (the short
   wall) — **blackboards 1/2/3** are thumbnails of the host's first three topics (they don't change
   with the round), **blackboard 4** is a pure countdown timer (shows `00:00` when no session is
   running); the north wall has a **big screen** in the middle, where the host can put the content
   of any of blackboards 1/2/3 as the room's current focal topic. If that topic has an embedded
   link (a YouTube video or an embeddable page), it plays/displays directly on the big screen;
   most non-YouTube sites refuse to be embedded, in which case only the "🔍 Content" text view is
   available. All four small boards and the big screen **are clickable**, opening an enlarged
   lightbox.

Until there's an account system, being "host" just means "knowing the `HOST_KEY`"; the same
connection gets locked out after 5 wrong guesses and has to refresh to try again.

### Status / Emotes / Raise hand

A small toolbar at the bottom-center of the screen, needing no LiveKit or setup at all:

- **Status dropdown**: 🟢 Free to chat / 📅 In a meeting / 🍔 Eating / 🎯 Focused — others see the
  matching icon above your head ("Free to chat" is the default and isn't shown specially, so the
  room isn't cluttered with icons over everyone's head).
- **👋👏❤️😂 emotes**: click one and your avatar pops the matching icon above its head, which
  floats up and fades out (~2 seconds), visible to everyone.
- **✋ Raise hand**: a toggle, stays shown above your head until you turn it off yourself.

Avatars are still placeholder capsules with no skeleton, so status/emotes are drawn as a small
icon above the head rather than an actual animation.

### Sofas / broadcast zone

- There are a few 3-seat sofas along the west wall (the board wall); click to sit down the same way
  as with table chairs (click again to stand up). There's no special grouping mechanism — voice
  volume is already distance-based, so sitting on the same sofa naturally keeps everyone within
  full-volume range, which amounts to being able to chat together.
- There's a purple floor area (a rectangle) in the open space along the west wall — the
  **broadcast zone**: stepping into it makes your voice heard by everyone in the room **regardless
  of distance or anyone's headphones mode** (handy for a host making an announcement); leaving it
  restores normal distance-based volume. While standing in it, the screen shows a "📢 Broadcasting
  to everyone" indicator.
- The exact position/count of tables, chairs, sofas and the broadcast zone is still being tuned;
  the current constants in `web/src/engine/environment.ts` are the source of truth.

### Chat history persistence (Postgres, optional)

Works fine without it — chat still works live, it just loses history on restart, and anyone
joining later won't see earlier messages.

1. `docker compose -f infra/docker-compose.yml up -d`
2. Add a line to `realtime/.env`:
   ```
   DATABASE_URL=postgres://engchatroom:engchatroom@localhost:5432/engchatroom?sslmode=disable
   ```
3. If the realtime server prints `chat persistence enabled (Postgres)`, it's wired up; the server
   creates its own tables on startup (`Store.Migrate`), no separate migration step needed.

## Controls

WASD / arrow keys to move · click the floor to walk there (automatically routes around tables via
navmesh pathfinding) · click a chair to sit (click again to stand) · drag to orbit the camera ·
scroll to zoom · `V` to toggle first/third person.

Top-right HUD (clickable once LiveKit is connected, except headphones mode):
- 🎤 microphone toggle
- 📷 camera toggle — once on, others see a video plane above your avatar (a billboard that always
  faces the camera)
- 🖥️ screen share — opens the browser's share picker; also shown above your avatar (sharing the
  same billboard as the camera feed; if both are on, screen share takes priority); stopping via
  the browser's native "stop sharing" bar also updates the button state
- 🎧 headphones mode — once on, you can't hear anyone regardless of distance (can be toggled even
  without LiveKit connected)
- ⚙️ devices — choose a microphone/camera source (device names only show up after you've granted
  permission once, a browser privacy restriction)

Voice runs over LiveKit: it connects automatically on joining the room (it won't auto-enable your
mic/camera, to avoid a permission prompt the moment the page loads); everyone's volume in the same
room is adjusted by avatar distance (full volume within 3m, silent beyond 10m; headphones mode
mutes everyone regardless of distance).
If `realtime/.env` isn't configured, the HUD shows "Voice not configured"; everything else still
works.

---

## Development commands

### web (from the repo root)

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
go test ./...     # internal/store's Postgres tests auto-skip if DATABASE_URL_TEST isn't set
go vet ./...
gofmt -l .        # should print nothing
```

---

## Project structure

```
engChatRoom/
  web/
    src/engine/   # Babylon scene, camera, character control, interpolation, render-on-demand, video billboards
    src/media/    # livekit-client wrapper: connecting, mic/camera/screen-share, proximity volume
    src/net/      # WebSocket client + LiveKit token fetch + types matching the protocol
    src/ui/       # React overlay (HUD, chat, device picker)
  realtime/
    cmd/server/           # main: routing + tick loop startup
    internal/game/        # room manager, client, tick, colors, chat broadcast + persistence
    internal/event/       # language-exchange session round state machine (pure functions, caller passes time in, easy to test)
    internal/livekit/     # LiveKit join token issuing (POST /token)
    internal/store/       # Postgres: chat history persistence
    internal/protocol/    # wire message definitions (kept in sync with web/src/net/types.ts)
  infra/docker-compose.yml  # local Postgres
  docs/PLAN.md    # technical analysis and phased roadmap (a living document, in Chinese)
```

## Roadmap (summary)

- **Phase 0** — 3D skeleton: walking around, seeing others ← done
- **Phase 1** — Proximity media (LiveKit) + sitting down + room text chat ← done
- **Phase 2** — Productization + language-exchange session mode + early-stage AI (AI host / rules
  NPC / summonable AI partner) ← in progress
- **Phase 3** — Scaling (interest management, multiple instances) + advanced AI (voice) + polish

See [`docs/PLAN.md`](docs/PLAN.md) for details (Chinese only — it's the project's working log).
