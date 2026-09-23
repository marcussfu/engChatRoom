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

func TestClampStatus(t *testing.T) {
	cases := map[string]string{
		protocol.StatusMeeting: protocol.StatusMeeting,
		protocol.StatusLunch:   protocol.StatusLunch,
		protocol.StatusFocus:   protocol.StatusFocus,
		"":                     protocol.StatusPresent,
		"bogus":                protocol.StatusPresent,
	}
	for in, want := range cases {
		if got := clampStatus(in); got != want {
			t.Errorf("clampStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestClampEmote(t *testing.T) {
	cases := map[string]string{
		protocol.EmoteWave:  protocol.EmoteWave,
		protocol.EmoteClap:  protocol.EmoteClap,
		protocol.EmoteHeart: protocol.EmoteHeart,
		protocol.EmoteLaugh: protocol.EmoteLaugh,
		"":                  "",
		"bogus":             "",
	}
	for in, want := range cases {
		if got := clampEmote(in); got != want {
			t.Errorf("clampEmote(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestInputRelaysStatusAndRaisedHand(t *testing.T) {
	room := NewRoom(30)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	a := dial(t, ctx, url)
	defer func() { _ = a.CloseNow() }()
	b := dial(t, ctx, url)
	defer func() { _ = b.CloseNow() }()

	aWelcome := readMsg(t, ctx, a)
	readMsg(t, ctx, b) // welcome
	writeMsg(t, ctx, a, protocol.ClientMsg{T: "input", Status: protocol.StatusMeeting, RaisedHand: true})

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m := readMsg(t, ctx, b)
		if m.T != "snapshot" {
			continue
		}
		for _, p := range m.Players {
			if p.ID == aWelcome.ID {
				if p.Status != protocol.StatusMeeting || !p.RaisedHand {
					t.Fatalf("player state = %+v, want status=meeting raisedHand=true", p)
				}
				return
			}
		}
	}
	t.Fatal("never saw a's status/raisedHand in a snapshot")
}

func TestUnknownStatusDefaultsToPresentOverTheWire(t *testing.T) {
	room := NewRoom(30)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	a := dial(t, ctx, url)
	defer func() { _ = a.CloseNow() }()
	aWelcome := readMsg(t, ctx, a)
	writeMsg(t, ctx, a, protocol.ClientMsg{T: "input", Status: "bogus"})

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m := readMsg(t, ctx, a)
		if m.T != "snapshot" {
			continue
		}
		for _, p := range m.Players {
			if p.ID == aWelcome.ID {
				if p.Status != protocol.StatusPresent {
					t.Fatalf("status = %q, want present (empty)", p.Status)
				}
				return
			}
		}
	}
	t.Fatal("never saw a's own snapshot entry")
}

func TestEmoteIsBroadcastToAll(t *testing.T) {
	room := NewRoom(30)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	a := dial(t, ctx, url)
	defer func() { _ = a.CloseNow() }()
	b := dial(t, ctx, url)
	defer func() { _ = b.CloseNow() }()

	aWelcome := readMsg(t, ctx, a)
	readMsg(t, ctx, b) // welcome
	writeMsg(t, ctx, a, protocol.ClientMsg{T: "emote", Emote: protocol.EmoteWave})

	for name, c := range map[string]*websocket.Conn{"a": a, "b": b} {
		m := findMsg(t, ctx, c, "emote")
		if m.ID != aWelcome.ID || m.Emote != protocol.EmoteWave {
			t.Fatalf("%s saw emote %+v, want id=%s emote=%s", name, m, aWelcome.ID, protocol.EmoteWave)
		}
	}
}

func TestUnknownEmoteIsNotBroadcast(t *testing.T) {
	room := NewRoom(30)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go room.Run(ctx)

	srv := httptest.NewServer(http.HandlerFunc(room.ServeWS))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	a := dial(t, ctx, url)
	defer func() { _ = a.CloseNow() }()
	readMsg(t, ctx, a) // welcome

	writeMsg(t, ctx, a, protocol.ClientMsg{T: "emote", Emote: "bogus"})
	// Nothing to wait for an absence of, so confirm behaviour indirectly: a
	// valid emote sent right after must be the very next "emote" message, not
	// a leftover bogus one that slipped through.
	writeMsg(t, ctx, a, protocol.ClientMsg{T: "emote", Emote: protocol.EmoteClap})
	if m := findMsg(t, ctx, a, "emote"); m.Emote != protocol.EmoteClap {
		t.Fatalf("emote = %+v, want clap (the bogus one should have been dropped)", m)
	}
}
