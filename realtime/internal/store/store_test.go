package store

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestStoreRoundTrip exercises Migrate/SaveChatMessage/RecentChatMessages
// against a real Postgres. It needs one reachable at DATABASE_URL_TEST (or
// DATABASE_URL as a fallback so `DATABASE_URL=... go test ./...` also works)
// and skips cleanly otherwise — see infra/docker-compose.yml to run one
// locally, and .github/workflows/realtime.yml for the CI service container.
func TestStoreRoundTrip(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL_TEST")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL_TEST (or DATABASE_URL) not set — skipping, needs a real Postgres")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	s, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// Unique per test run so repeated runs against a shared/persistent
	// database don't see each other's leftover rows.
	room := "test-room-" + time.Now().Format("20060102150405.000000000")

	for _, m := range []struct{ userID, name, body string }{
		{"u1", "Alice", "hello"},
		{"u2", "Bob", "hi Alice"},
		{"u1", "Alice", "how's it going"},
	} {
		if err := s.SaveChatMessage(ctx, room, m.userID, m.name, m.body); err != nil {
			t.Fatalf("SaveChatMessage(%+v): %v", m, err)
		}
	}

	got, err := s.RecentChatMessages(ctx, room, 10)
	if err != nil {
		t.Fatalf("RecentChatMessages: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len(got) = %d, want 3: %+v", len(got), got)
	}
	// Oldest first.
	wantBodies := []string{"hello", "hi Alice", "how's it going"}
	for i, want := range wantBodies {
		if got[i].Body != want {
			t.Errorf("got[%d].Body = %q, want %q", i, got[i].Body, want)
		}
		if got[i].T != "chat" {
			t.Errorf("got[%d].T = %q, want %q", i, got[i].T, "chat")
		}
	}
	if got[0].ID != "u1" || got[0].Name != "Alice" {
		t.Errorf("got[0] = %+v, want id=u1 name=Alice", got[0])
	}

	// limit is honoured (and still returns the most recent, oldest-first).
	limited, err := s.RecentChatMessages(ctx, room, 2)
	if err != nil {
		t.Fatalf("RecentChatMessages(limit=2): %v", err)
	}
	if len(limited) != 2 || limited[len(limited)-1].Body != "how's it going" {
		t.Fatalf("limited = %+v, want the last 2 messages", limited)
	}

	// A different room sees no cross-contamination.
	other, err := s.RecentChatMessages(ctx, room+"-other", 10)
	if err != nil {
		t.Fatalf("RecentChatMessages(other room): %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("other room = %+v, want empty", other)
	}
}
