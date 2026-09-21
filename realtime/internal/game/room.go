package game

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/marcussfu/engchatroom/realtime/internal/event"
	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

// avatarColors are handed out round-robin so players are visually distinct.
var avatarColors = []string{
	"#e5484d", "#0090ff", "#30a46c", "#f76b15",
	"#8e4ec6", "#ffb224", "#00a2c7", "#e93d82",
}

// RoomID names the single hard-coded room for chat persistence, mirroring
// internal/livekit.RoomName (both "cafe" — one logical room until Phase 2's
// multi-room support; keep them in sync until then).
const RoomID = "cafe"

// chatHistoryLimit is how many past messages a newly joined client gets
// replayed.
const chatHistoryLimit = 50

// ChatStore persists and retrieves room chat history. Room works fine with a
// nil store (chat still broadcasts live, just isn't durable across restarts)
// — see internal/store.Store for the Postgres-backed implementation.
type ChatStore interface {
	SaveChatMessage(ctx context.Context, roomID, userID, name, body string) error
	RecentChatMessages(ctx context.Context, roomID string, limit int) ([]protocol.ServerMsg, error)
}

// Room is the single hard-coded space for Phase 0. It owns all player state and
// fans an authoritative snapshot out to every client on a fixed tick.
type Room struct {
	tickRate int
	store    ChatStore // nil disables chat persistence

	// The language-exchange session (its own lock — never held while taking mu)
	// and the shared secret hosts must present; empty disables host commands.
	session *event.Session
	hostKey string

	mu       sync.RWMutex
	clients  map[*Client]struct{}
	colorSeq int
	dirty    bool // state changed since the last broadcast
}

func NewRoom(tickRate int) *Room {
	if tickRate <= 0 {
		tickRate = 15
	}
	return &Room{
		tickRate: tickRate,
		clients:  make(map[*Client]struct{}),
		session:  &event.Session{},
	}
}

// SetChatStore wires up chat persistence. Call once before serving traffic;
// not safe to change concurrently with broadcastChat/ServeWS.
func (r *Room) SetChatStore(s ChatStore) {
	r.store = s
}

// SetHostKey sets the shared secret that authorises host commands (see
// host.go). Empty — the default — disables them entirely. Call once before
// serving traffic.
func (r *Room) SetHostKey(key string) {
	r.hostKey = key
}

// Run broadcasts a snapshot every tick until ctx is cancelled. Idle ticks (no
// state change) are skipped so a still room costs no bandwidth — this pairs with
// the client's render-on-demand loop.
func (r *Room) Run(ctx context.Context) {
	interval := time.Second / time.Duration(r.tickRate)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.broadcastSnapshot()
			// The same tick drives the language-exchange session's clock, so a
			// round boundary reaches clients within one tick of the deadline.
			if st, changed := r.session.Tick(time.Now()); changed {
				r.broadcastSession(st)
			}
		}
	}
}

// broadcastSession tells every client the session's current state. Now rides
// along so clients can correct for clock skew when counting down to RoundEndsAt.
func (r *Room) broadcastSession(st protocol.SessionState) {
	r.broadcastCtl(protocol.ServerMsg{T: "session", Session: &st, Now: time.Now().UnixMilli()})
}

func (r *Room) broadcastSnapshot() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.dirty || len(r.clients) == 0 {
		return
	}
	players := make([]protocol.PlayerState, 0, len(r.clients))
	for c := range r.clients {
		players = append(players, c.state)
	}
	r.dirty = false

	buf, err := json.Marshal(protocol.ServerMsg{T: "snapshot", Players: players})
	if err != nil {
		log.Printf("snapshot marshal: %v", err)
		return
	}
	// The send loop stays under the lock, same as broadcastCtl: remove()
	// closes a client's send channel under this same lock, and sending on a
	// channel concurrently with closing it is a race (and can panic) —
	// holding the lock here makes the two mutually exclusive. Each send is
	// non-blocking (buffered chan + default case), so this costs nothing
	// beyond the room's current size.
	for c := range r.clients {
		select {
		case c.send <- buf:
		default: // slow client: drop this frame, the next snapshot supersedes it
		}
	}
}

func (r *Room) add(c *Client) {
	r.mu.Lock()
	r.clients[c] = struct{}{}
	r.dirty = true
	r.mu.Unlock()
}

func (r *Room) remove(c *Client) {
	r.mu.Lock()
	if _, ok := r.clients[c]; ok {
		delete(r.clients, c)
		close(c.send)
		r.dirty = true
	}
	r.mu.Unlock()
}

func (r *Room) nextColor() string {
	r.mu.Lock()
	color := avatarColors[r.colorSeq%len(avatarColors)]
	r.colorSeq++
	r.mu.Unlock()
	return color
}

// broadcastChat persists (if a store is configured) then fans a room chat
// message out to every client immediately (like broadcastCtl, it bypasses
// the tick — chat shouldn't wait for the next snapshot). A persistence
// failure is logged but never blocks the live broadcast — a DB hiccup
// shouldn't take down chat.
func (r *Room) broadcastChat(id, name, body string) {
	if r.store != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		if err := r.store.SaveChatMessage(ctx, RoomID, id, name, body); err != nil {
			log.Printf("chat persist: %v", err)
		}
		cancel()
	}
	r.broadcastCtl(protocol.ServerMsg{
		T:    "chat",
		ID:   id,
		Name: name,
		Body: body,
		Ts:   time.Now().UnixMilli(),
	})
}

// chatHistory fetches recent chat for replay to a newly joined client. Nil
// store, a query error, or a timeout all just mean "no history this time" —
// none of them should keep a client from joining.
func (r *Room) chatHistory() []protocol.ServerMsg {
	if r.store == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	msgs, err := r.store.RecentChatMessages(ctx, RoomID, chatHistoryLimit)
	if err != nil {
		log.Printf("chat history: %v", err)
		return nil
	}
	return msgs
}

// broadcastCtl sends a small control message (e.g. "leave") to every client.
// Sends happen under the read lock — see broadcastSnapshot for why that
// matters (it's what keeps this from racing with remove()'s close).
func (r *Room) broadcastCtl(msg protocol.ServerMsg) {
	buf, err := json.Marshal(msg)
	if err != nil {
		return
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for c := range r.clients {
		select {
		case c.send <- buf:
		default:
		}
	}
}

// ServeWS upgrades an HTTP request to a WebSocket and runs the client until it
// disconnects.
func (r *Room) ServeWS(w http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(w, req, &websocket.AcceptOptions{
		// Phase 0: dev runs web and server on different ports. Lock this down
		// (or front with a reverse proxy) before any real deployment.
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("ws accept: %v", err)
		return
	}

	id := newID()
	client := newClient(conn, r, id, r.nextColor())

	ctx, cancel := context.WithCancel(req.Context())
	defer cancel()

	// Start the writer FIRST — nothing else can reach client.send until r.add
	// below, so this is still race-free, and it means welcome + chat history
	// drain concurrently instead of filling the buffered channel synchronously
	// (chatHistoryLimit can exceed the channel's buffer size). Queueing before
	// starting the writer would risk ServeWS blocking forever on a full
	// channel with nothing yet reading it.
	go client.writePump(ctx)

	// Welcome, then chat history — both queued before the client joins the
	// room, so they're guaranteed to reach it before any tick snapshot.
	if buf, err := json.Marshal(protocol.ServerMsg{T: "welcome", ID: id, TickRate: r.tickRate, Color: client.state.Color}); err == nil {
		client.send <- buf
	}
	for _, m := range r.chatHistory() {
		if buf, err := json.Marshal(m); err == nil {
			client.send <- buf
		}
	}
	// Always send the session state, even when idle: a reconnecting client
	// may be holding stale "running" state from before it dropped.
	st := r.session.Snapshot()
	if buf, err := json.Marshal(protocol.ServerMsg{T: "session", Session: &st, Now: time.Now().UnixMilli()}); err == nil {
		client.send <- buf
	}

	r.add(client)
	log.Printf("join %s (%d online)", id, r.count())

	client.readPump(ctx) // blocks until the socket closes

	cancel()
	r.remove(client)
	r.broadcastCtl(protocol.ServerMsg{T: "leave", ID: id})
	conn.Close(websocket.StatusNormalClosure, "")
	log.Printf("leave %s (%d online)", id, r.count())
}

func (r *Room) count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.clients)
}

func newID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
