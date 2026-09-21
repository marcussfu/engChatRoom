package game

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

const testHostKey = "s3cret"

// hostRig is a room with a host key, an HTTP server, and a URL to dial.
type hostRig struct {
	ctx context.Context
	url string
}

func newHostRig(t *testing.T, key string) hostRig {
	t.Helper()
	room := NewRoom(30)
	room.SetHostKey(key)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	t.Cleanup(srv.Close)
	return hostRig{ctx: ctx, url: "ws" + strings.TrimPrefix(srv.URL, "http")}
}

// join dials, and consumes the welcome plus the session message every client
// gets on join, returning the (idle) initial session state.
func (h hostRig) join(t *testing.T) (*websocket.Conn, protocol.ServerMsg) {
	t.Helper()
	c := dial(t, h.ctx, h.url)
	t.Cleanup(func() { _ = c.CloseNow() })
	if m := readMsg(t, h.ctx, c); m.T != "welcome" {
		t.Fatalf("first message = %q, want welcome", m.T)
	}
	return c, findMsg(t, h.ctx, c, "session")
}

// findMsg reads until a message of type typ arrives (snapshots and other
// traffic interleave freely), failing after a few seconds.
func findMsg(t *testing.T, ctx context.Context, c *websocket.Conn, typ string) protocol.ServerMsg {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if m := readMsg(t, ctx, c); m.T == typ {
			return m
		}
	}
	t.Fatalf("never saw a %q message", typ)
	return protocol.ServerMsg{}
}

func host(t *testing.T, h hostRig, c *websocket.Conn, m protocol.ClientMsg) protocol.ServerMsg {
	t.Helper()
	m.T = "host"
	writeMsg(t, h.ctx, c, m)
	return findMsg(t, h.ctx, c, "hostResult")
}

func TestJoinReceivesIdleSessionState(t *testing.T) {
	h := newHostRig(t, testHostKey)
	_, m := h.join(t)
	if m.Session == nil || m.Session.Active || m.Session.Finished {
		t.Fatalf("join session = %+v, want idle", m.Session)
	}
	if m.Now == 0 {
		t.Error("session message carried no server Now for clock-skew correction")
	}
}

func TestHostStartBroadcastsToEveryone(t *testing.T) {
	h := newHostRig(t, testHostKey)
	hostConn, _ := h.join(t)
	guest, _ := h.join(t)

	res := host(t, h, hostConn, protocol.ClientMsg{
		Action: "start", Key: testHostKey, Rounds: 3, RoundSeconds: 60, Topics: []string{"Food", "Travel"},
	})
	if !res.OK || res.Error != "" {
		t.Fatalf("start result = %+v, want ok", res)
	}

	for name, c := range map[string]*websocket.Conn{"host": hostConn, "guest": guest} {
		m := findMsg(t, h.ctx, c, "session")
		st := m.Session
		if st == nil || !st.Active || st.Round != 1 || st.Rounds != 3 || st.Topic != "Food" {
			t.Fatalf("%s saw session %+v, want active round 1/3 topic Food", name, st)
		}
	}
}

func TestHostNextExtendEnd(t *testing.T) {
	h := newHostRig(t, testHostKey)
	c, _ := h.join(t)
	send := func(m protocol.ClientMsg) protocol.ServerMsg {
		m.Key = testHostKey
		return host(t, h, c, m)
	}

	if r := send(protocol.ClientMsg{Action: "start", Rounds: 2, RoundSeconds: 60, Topics: []string{"A", "B"}}); !r.OK {
		t.Fatalf("start: %+v", r)
	}
	if r := send(protocol.ClientMsg{Action: "extend", Seconds: 30}); !r.OK {
		t.Fatalf("extend: %+v", r)
	}
	if r := send(protocol.ClientMsg{Action: "next"}); !r.OK {
		t.Fatalf("next: %+v", r)
	}
	if st := findSession(t, h, c, func(s *protocol.SessionState) bool { return s.Round == 2 }); st.Topic != "B" {
		t.Fatalf("after next: topic = %q, want B", st.Topic)
	}
	if r := send(protocol.ClientMsg{Action: "end"}); !r.OK {
		t.Fatalf("end: %+v", r)
	}
	findSession(t, h, c, func(s *protocol.SessionState) bool { return s.Finished })
}

// findSession reads session messages until one satisfies pred.
func findSession(t *testing.T, h hostRig, c *websocket.Conn, pred func(*protocol.SessionState) bool) *protocol.SessionState {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m := findMsg(t, h.ctx, c, "session")
		if m.Session != nil && pred(m.Session) {
			return m.Session
		}
	}
	t.Fatal("never saw the expected session state")
	return nil
}

func TestHostRejectsWrongKey(t *testing.T) {
	h := newHostRig(t, testHostKey)
	c, _ := h.join(t)
	res := host(t, h, c, protocol.ClientMsg{Action: "start", Key: "nope", Rounds: 2, RoundSeconds: 60})
	if res.OK || res.Error == "" {
		t.Fatalf("result = %+v, want a wrong-key error", res)
	}
}

func TestHostDisabledWithoutKey(t *testing.T) {
	h := newHostRig(t, "")
	c, _ := h.join(t)
	// An empty key must NOT match an empty configured key.
	res := host(t, h, c, protocol.ClientMsg{Action: "start", Key: "", Rounds: 2, RoundSeconds: 60})
	if res.OK || res.Error == "" {
		t.Fatalf("result = %+v, want host controls disabled", res)
	}
}

func TestHostKeyGuessesAreCapped(t *testing.T) {
	h := newHostRig(t, testHostKey)
	c, _ := h.join(t)

	for i := 0; i < maxHostKeyFailures; i++ {
		if res := host(t, h, c, protocol.ClientMsg{Action: "start", Key: "wrong"}); res.OK {
			t.Fatalf("guess %d unexpectedly succeeded", i)
		}
	}
	// Locked out now — even the RIGHT key is refused on this connection.
	res := host(t, h, c, protocol.ClientMsg{Action: "start", Key: testHostKey, Rounds: 2, RoundSeconds: 60})
	if res.OK {
		t.Fatalf("correct key accepted after %d wrong guesses, want lockout", maxHostKeyFailures)
	}
	if !strings.Contains(res.Error, "too many") {
		t.Errorf("error = %q, want a too-many-attempts message", res.Error)
	}
}

func TestHostCommandErrorsAreReported(t *testing.T) {
	h := newHostRig(t, testHostKey)
	c, _ := h.join(t)

	// Nothing running yet.
	if res := host(t, h, c, protocol.ClientMsg{Action: "next", Key: testHostKey}); res.OK {
		t.Fatalf("next with no session: %+v, want error", res)
	}
	// Invalid config.
	if res := host(t, h, c, protocol.ClientMsg{Action: "start", Key: testHostKey, Rounds: 0, RoundSeconds: 60}); res.OK {
		t.Fatalf("start with 0 rounds: %+v, want error", res)
	}
	// Unknown action.
	if res := host(t, h, c, protocol.ClientMsg{Action: "explode", Key: testHostKey}); res.OK {
		t.Fatalf("unknown action: %+v, want error", res)
	}
	// Double start.
	start := protocol.ClientMsg{Action: "start", Key: testHostKey, Rounds: 2, RoundSeconds: 60}
	if res := host(t, h, c, start); !res.OK {
		t.Fatalf("first start: %+v", res)
	}
	if res := host(t, h, c, start); res.OK {
		t.Fatalf("second start while running: %+v, want error", res)
	}
}

func TestLateJoinerSeesRunningSession(t *testing.T) {
	h := newHostRig(t, testHostKey)
	hostConn, _ := h.join(t)
	if res := host(t, h, hostConn, protocol.ClientMsg{
		Action: "start", Key: testHostKey, Rounds: 4, RoundSeconds: 900, Topics: []string{"Food"},
	}); !res.OK {
		t.Fatalf("start: %+v", res)
	}

	_, m := h.join(t) // joins after the session began
	if m.Session == nil || !m.Session.Active || m.Session.Round != 1 || m.Session.Rounds != 4 {
		t.Fatalf("late joiner saw %+v, want the running session 1/4", m.Session)
	}
	if m.Session.RoundEndsAt <= m.Now {
		t.Errorf("RoundEndsAt %d is not after Now %d", m.Session.RoundEndsAt, m.Now)
	}
}
