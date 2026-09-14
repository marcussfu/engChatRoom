package livekit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestMintTokenRoundTrips(t *testing.T) {
	cfg := Config{URL: "wss://example.livekit.cloud", APIKey: "key1", APISecret: "secret1"}
	tok, err := cfg.MintToken("player-42", "Marcus", RoomName)
	if err != nil {
		t.Fatalf("MintToken: %v", err)
	}

	var cl claims
	parsed, err := jwt.ParseWithClaims(tok, &cl, func(*jwt.Token) (interface{}, error) {
		return []byte(cfg.APISecret), nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("parse: valid=%v err=%v", parsed.Valid, err)
	}
	if cl.Issuer != cfg.APIKey {
		t.Errorf("iss = %q, want %q", cl.Issuer, cfg.APIKey)
	}
	if cl.Subject != "player-42" {
		t.Errorf("sub = %q, want player-42", cl.Subject)
	}
	if !cl.Video.RoomJoin || cl.Video.Room != RoomName {
		t.Errorf("video grant = %+v, want roomJoin=true room=%q", cl.Video, RoomName)
	}
	if cl.Name != "Marcus" {
		t.Errorf("name = %q, want Marcus", cl.Name)
	}
}

func TestMintTokenRequiresIdentity(t *testing.T) {
	cfg := Config{URL: "wss://x", APIKey: "k", APISecret: "s"}
	if _, err := cfg.MintToken("", "x", RoomName); err == nil {
		t.Fatal("expected error for empty identity")
	}
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "")
	t.Setenv("LIVEKIT_API_KEY", "")
	t.Setenv("LIVEKIT_API_SECRET", "")
	if _, ok := ConfigFromEnv(); ok {
		t.Fatal("ok = true with no env vars set")
	}

	t.Setenv("LIVEKIT_URL", "wss://example.livekit.cloud")
	t.Setenv("LIVEKIT_API_KEY", "key1")
	t.Setenv("LIVEKIT_API_SECRET", "secret1")
	cfg, ok := ConfigFromEnv()
	if !ok {
		t.Fatal("ok = false with all env vars set")
	}
	if cfg.URL != "wss://example.livekit.cloud" || cfg.APIKey != "key1" || cfg.APISecret != "secret1" {
		t.Errorf("cfg = %+v", cfg)
	}
}

func TestTokenHandler(t *testing.T) {
	cfg := Config{URL: "wss://example.livekit.cloud", APIKey: "key1", APISecret: "secret1"}
	srv := httptest.NewServer(TokenHandler(cfg))
	defer srv.Close()

	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(`{"identity":"abc123","name":"guest-1"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var out tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Token == "" || out.URL != cfg.URL || out.Room != RoomName {
		t.Fatalf("response = %+v", out)
	}
}

func TestTokenHandlerRejectsMissingIdentity(t *testing.T) {
	cfg := Config{URL: "wss://example.livekit.cloud", APIKey: "key1", APISecret: "secret1"}
	srv := httptest.NewServer(TokenHandler(cfg))
	defer srv.Close()

	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestTokenHandlerRejectsGet(t *testing.T) {
	cfg := Config{URL: "wss://example.livekit.cloud", APIKey: "key1", APISecret: "secret1"}
	srv := httptest.NewServer(TokenHandler(cfg))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", resp.StatusCode)
	}
}
