package game

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/coder/websocket"
	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

const (
	readLimitBytes = 1 << 15 // 32 KiB, plenty for a small JSON input message
	sendQueue      = 16      // dropped-frame tolerant: snapshots are idempotent
	writeTimeout   = 5 * time.Second

	// spawnZ mirrors the web client's spawn (web/src/engine/localPlayer.ts:
	// z = ROOM_HALF_Z - 2). The client also sends its real position on connect,
	// so this only covers the one tick between join and that first input — and
	// any future non-web client. Replace with server-assigned spawn points when
	// scene definitions land (docs/PLAN.md §一.A "spawn points").
	spawnZ = 8
)

// Client is one connected browser. Its state is owned by the Room; the Room's
// mutex guards every field touched from more than one goroutine.
type Client struct {
	conn *websocket.Conn
	room *Room
	send chan []byte

	// Guarded by room.mu.
	state protocol.PlayerState
}

func newClient(conn *websocket.Conn, room *Room, id, color string) *Client {
	return &Client{
		conn: conn,
		room: room,
		send: make(chan []byte, sendQueue),
		state: protocol.PlayerState{
			ID:    id,
			Name:  "guest",
			Anim:  protocol.AnimIdle,
			Color: color,
			Z:     spawnZ,
		},
	}
}

// readPump parses inbound messages and updates this client's state. It returns
// when the connection closes or errors.
func (c *Client) readPump(ctx context.Context) {
	c.conn.SetReadLimit(readLimitBytes)
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) && websocket.CloseStatus(err) == -1 {
				log.Printf("client %s read: %v", c.state.ID, err)
			}
			return
		}

		var msg protocol.ClientMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("client %s bad json: %v", c.state.ID, err)
			continue
		}

		switch msg.T {
		case "join":
			c.room.mu.Lock()
			if msg.Name != "" {
				c.state.Name = clampName(msg.Name)
			}
			c.room.dirty = true
			c.room.mu.Unlock()
		case "input":
			c.room.mu.Lock()
			c.state.X = msg.X
			c.state.Z = msg.Z
			c.state.Yaw = msg.Yaw
			if msg.Anim == protocol.AnimWalk {
				c.state.Anim = protocol.AnimWalk
			} else {
				c.state.Anim = protocol.AnimIdle
			}
			c.state.ZoneID = msg.ZoneID
			c.state.SeatID = msg.SeatID
			c.room.dirty = true
			c.room.mu.Unlock()
		case "chat":
			body := clampBody(msg.Body)
			if body == "" {
				continue
			}
			c.room.mu.RLock()
			name := c.state.Name
			c.room.mu.RUnlock()
			c.room.broadcastChat(c.state.ID, name, body)
		default:
			// ignore unknown message types for forward-compat
		}
	}
}

// writePump drains the send channel to the socket. It is the only goroutine
// that writes to c.conn.
func (c *Client) writePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case buf, ok := <-c.send:
			if !ok {
				return
			}
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.conn.Write(wctx, websocket.MessageText, buf)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func clampName(s string) string {
	const max = 24
	r := []rune(s)
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}

func clampBody(s string) string {
	const max = 500
	r := []rune(s)
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}
