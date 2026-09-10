package game

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

// TestTwoClientsSeeEachOther is the Phase 0 acceptance check in miniature:
// two connections join, move, and each must observe the other in a snapshot.
func TestTwoClientsSeeEachOther(t *testing.T) {
	room := NewRoom(30)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	a := dial(t, ctx, url)
	defer a.CloseNow()
	b := dial(t, ctx, url)
	defer b.CloseNow()

	if got := readMsg(t, ctx, a).T; got != "welcome" {
		t.Fatalf("client a: first message = %q, want welcome", got)
	}
	if got := readMsg(t, ctx, b).T; got != "welcome" {
		t.Fatalf("client b: first message = %q, want welcome", got)
	}

	writeMsg(t, ctx, a, protocol.ClientMsg{T: "join", Name: "alice"})
	writeMsg(t, ctx, b, protocol.ClientMsg{T: "join", Name: "bob"})
	writeMsg(t, ctx, a, protocol.ClientMsg{T: "input", X: 1, Z: 2, Anim: protocol.AnimWalk})
	writeMsg(t, ctx, b, protocol.ClientMsg{T: "input", X: -3, Z: 4, Anim: protocol.AnimIdle})

	assertSeesBoth(t, ctx, a, "bob")
	assertSeesBoth(t, ctx, b, "alice")
}

func TestLeaveIsBroadcast(t *testing.T) {
	room := NewRoom(30)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	a := dial(t, ctx, url)
	defer a.CloseNow()
	b := dial(t, ctx, url)

	readMsg(t, ctx, a) // welcome
	bWelcome := readMsg(t, ctx, b)
	writeMsg(t, ctx, a, protocol.ClientMsg{T: "input", X: 1, Anim: protocol.AnimWalk})
	assertSeesBoth(t, ctx, a, "guest")

	_ = b.Close(websocket.StatusNormalClosure, "bye")

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m := readMsg(t, ctx, a)
		if m.T == "leave" && m.ID == bWelcome.ID {
			return
		}
	}
	t.Fatalf("client a never received leave for %s", bWelcome.ID)
}

func dial(t *testing.T, ctx context.Context, url string) *websocket.Conn {
	t.Helper()
	dctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(dctx, url, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", url, err)
	}
	return c
}

func readMsg(t *testing.T, ctx context.Context, c *websocket.Conn) protocol.ServerMsg {
	t.Helper()
	rctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, data, err := c.Read(rctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var m protocol.ServerMsg
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal %s: %v", data, err)
	}
	return m
}

func writeMsg(t *testing.T, ctx context.Context, c *websocket.Conn, m protocol.ClientMsg) {
	t.Helper()
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	wctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := c.Write(wctx, websocket.MessageText, data); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func assertSeesBoth(t *testing.T, ctx context.Context, c *websocket.Conn, wantName string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m := readMsg(t, ctx, c)
		if m.T != "snapshot" || len(m.Players) < 2 {
			continue
		}
		for _, p := range m.Players {
			if p.Name == wantName {
				return
			}
		}
	}
	t.Fatalf("did not see a snapshot containing %q with 2 players", wantName)
}
