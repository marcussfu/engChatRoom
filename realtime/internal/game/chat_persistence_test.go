package game

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

// fakeChatStore is an in-memory ChatStore for tests — no real Postgres
// needed to exercise Room's persistence wiring (a real Postgres round trip
// is covered separately in internal/store).
type fakeChatStore struct {
	mu      sync.Mutex
	saved   []protocol.ServerMsg
	history []protocol.ServerMsg
	saveErr error
}

func (f *fakeChatStore) SaveChatMessage(_ context.Context, roomID, userID, name, body string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.saveErr != nil {
		return f.saveErr
	}
	f.saved = append(f.saved, protocol.ServerMsg{ID: userID, Name: name, Body: body})
	_ = roomID
	return nil
}

func (f *fakeChatStore) RecentChatMessages(_ context.Context, _ string, _ int) ([]protocol.ServerMsg, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]protocol.ServerMsg(nil), f.history...), nil
}

func TestChatIsSavedToStore(t *testing.T) {
	room := NewRoom(30)
	store := &fakeChatStore{}
	room.SetChatStore(store)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	c := dial(t, ctx, url)
	defer func() { _ = c.CloseNow() }()
	readMsg(t, ctx, c) // welcome

	writeMsg(t, ctx, c, protocol.ClientMsg{T: "chat", Body: "hi there"})
	if m := findChat(t, ctx, c); m.Body != "hi there" {
		t.Fatalf("broadcast chat = %+v, want body=%q", m, "hi there")
	}

	// The broadcast we just read is only sent after SaveChatMessage returns
	// (see broadcastChat), so it's already safe to inspect the store here.
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.saved) != 1 || store.saved[0].Body != "hi there" {
		t.Fatalf("store.saved = %+v, want one message with body %q", store.saved, "hi there")
	}
}

// TestChatBroadcastSurvivesStoreError makes sure a persistence failure never
// blocks the live broadcast — a DB hiccup shouldn't take down chat.
func TestChatBroadcastSurvivesStoreError(t *testing.T) {
	room := NewRoom(30)
	room.SetChatStore(&fakeChatStore{saveErr: errors.New("boom")})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	c := dial(t, ctx, url)
	defer func() { _ = c.CloseNow() }()
	readMsg(t, ctx, c) // welcome

	writeMsg(t, ctx, c, protocol.ClientMsg{T: "chat", Body: "still works"})
	if m := findChat(t, ctx, c); m.Body != "still works" {
		t.Fatalf("chat = %+v, want body=%q despite store error", m, "still works")
	}
}

// TestChatHistoryReplayedOnJoin covers the other half of persistence: a
// newly joined client should see past chat (from the store) right after
// welcome, before any snapshot.
func TestChatHistoryReplayedOnJoin(t *testing.T) {
	room := NewRoom(30)
	room.SetChatStore(&fakeChatStore{
		history: []protocol.ServerMsg{
			{T: "chat", ID: "old-user", Name: "alice", Body: "hello from before", Ts: 1000},
		},
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	c := dial(t, ctx, url)
	defer func() { _ = c.CloseNow() }()

	if welcome := readMsg(t, ctx, c); welcome.T != "welcome" {
		t.Fatalf("first message = %q, want welcome", welcome.T)
	}
	history := readMsg(t, ctx, c)
	if history.T != "chat" || history.Name != "alice" || history.Body != "hello from before" {
		t.Fatalf("history message = %+v, want the seeded chat", history)
	}
}

// A room with no store configured (the zero value — most existing tests in
// this package) already joins normally and broadcasts chat live; see
// TestTwoClientsSeeEachOther and TestChatIsBroadcastToAll in
// integration_test.go for that coverage without a store at all.
