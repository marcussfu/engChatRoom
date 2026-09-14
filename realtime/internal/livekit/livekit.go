// Package livekit mints LiveKit Cloud room-join tokens.
//
// This deliberately does NOT depend on github.com/livekit/protocol: that
// module is the full LiveKit server SDK (pion/webrtc, redis, nats,
// prometheus, grpc, cel-go — 40+ transitive packages) and pulls in a "go"
// directive newer than this project targets, just to sign a small JSON
// claim. A join token is a plain JWT with a documented shape
// (https://docs.livekit.io/home/get-started/authentication/), so we sign it
// by hand with golang-jwt/jwt — one small, dependency-free library.
package livekit

import (
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// RoomName is the single hard-coded LiveKit room for Phase 1, mirroring the
// realtime server's single hard-coded WebSocket room (internal/game.Room).
const RoomName = "cafe"

const tokenTTL = 6 * time.Hour

// Config holds LiveKit Cloud connection details.
type Config struct {
	URL       string
	APIKey    string
	APISecret string
}

// ConfigFromEnv reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
// (directly, or via a local .env loaded by main — see realtime/.env.example).
// ok is false if any of the three are missing, so callers can disable the
// /token endpoint cleanly instead of minting broken tokens.
func ConfigFromEnv() (cfg Config, ok bool) {
	cfg = Config{
		URL:       os.Getenv("LIVEKIT_URL"),
		APIKey:    os.Getenv("LIVEKIT_API_KEY"),
		APISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
	return cfg, cfg.URL != "" && cfg.APIKey != "" && cfg.APISecret != ""
}

// videoGrant matches LiveKit's "video" JWT claim shape. Publish/subscribe are
// left unset (nil-equivalent by omission), which LiveKit defaults to allowed
// for a room participant — Phase 1 doesn't need finer-grained permissions.
type videoGrant struct {
	RoomJoin bool   `json:"roomJoin,omitempty"`
	Room     string `json:"room,omitempty"`
}

type claims struct {
	jwt.RegisteredClaims
	Video videoGrant `json:"video"`
	Name  string     `json:"name,omitempty"`
}

// MintToken signs a room-join token for identity/name in room. identity
// should match the id the realtime WebSocket already assigned that browser
// tab, so a LiveKit participant can be correlated back to its avatar.
func (c Config) MintToken(identity, name, room string) (string, error) {
	if identity == "" {
		return "", fmt.Errorf("livekit: identity required")
	}
	now := time.Now()
	cl := claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    c.APIKey,
			Subject:   identity,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
		},
		Video: videoGrant{RoomJoin: true, Room: room},
		Name:  name,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, cl)
	return tok.SignedString([]byte(c.APISecret))
}
