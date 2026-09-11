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
	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

// avatarColors are handed out round-robin so players are visually distinct.
var avatarColors = []string{
	"#e5484d", "#0090ff", "#30a46c", "#f76b15",
	"#8e4ec6", "#ffb224", "#00a2c7", "#e93d82",
}

// Room is the single hard-coded space for Phase 0. It owns all player state and
// fans an authoritative snapshot out to every client on a fixed tick.
type Room struct {
	tickRate int

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
	}
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
		}
	}
}

func (r *Room) broadcastSnapshot() {
	r.mu.Lock()
	if !r.dirty || len(r.clients) == 0 {
		r.mu.Unlock()
		return
	}
	players := make([]protocol.PlayerState, 0, len(r.clients))
	targets := make([]chan []byte, 0, len(r.clients))
	for c := range r.clients {
		players = append(players, c.state)
		targets = append(targets, c.send)
	}
	r.dirty = false
	r.mu.Unlock()

	buf, err := json.Marshal(protocol.ServerMsg{T: "snapshot", Players: players})
	if err != nil {
		log.Printf("snapshot marshal: %v", err)
		return
	}
	for _, send := range targets {
		select {
		case send <- buf:
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

// broadcastChat fans a room chat message out to every client immediately
// (like broadcastCtl, it bypasses the tick — chat shouldn't wait for the next
// snapshot). Messages are not persisted; Phase 1 wires this to Postgres.
func (r *Room) broadcastChat(id, name, body string) {
	r.broadcastCtl(protocol.ServerMsg{
		T:    "chat",
		ID:   id,
		Name: name,
		Body: body,
		Ts:   time.Now().UnixMilli(),
	})
}

// broadcastCtl sends a small control message (e.g. "leave") to every client.
func (r *Room) broadcastCtl(msg protocol.ServerMsg) {
	buf, err := json.Marshal(msg)
	if err != nil {
		return
	}
	r.mu.RLock()
	targets := make([]chan []byte, 0, len(r.clients))
	for c := range r.clients {
		targets = append(targets, c.send)
	}
	r.mu.RUnlock()
	for _, send := range targets {
		select {
		case send <- buf:
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

	// Queue the welcome, start the writer, and only THEN join the room — so the
	// welcome is guaranteed to reach the client before any tick snapshot.
	if buf, err := json.Marshal(protocol.ServerMsg{T: "welcome", ID: id, TickRate: r.tickRate, Color: client.state.Color}); err == nil {
		client.send <- buf
	}
	go client.writePump(ctx)

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
