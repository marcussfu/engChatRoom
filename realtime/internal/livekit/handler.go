package livekit

import (
	"encoding/json"
	"net/http"
)

type tokenRequest struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
}

type tokenResponse struct {
	Token string `json:"token"`
	URL   string `json:"url"`
	Room  string `json:"room"`
}

// TokenHandler mints a LiveKit join token for the caller. It is always
// registered at /token (main.go no longer conditionally registers the route)
// even when LiveKit isn't configured, and responds 503 in that case — the
// route existing unconditionally is what lets it always send CORS headers.
// A route that only exists when configured means an unconfigured server's
// bare 404 has no CORS headers, which the browser reports as a confusing
// CORS failure on the *preflight* instead of a readable "503" the frontend
// can distinguish from a real error (see net/tokenClient.ts on the web side).
//
// Dev-only CORS: any origin may call this so the Vite dev server (a
// different port than the realtime server) can reach it directly — lock
// this down to the real web origin before deploying (see also ServeWS's
// InsecureSkipVerify note in internal/game/room.go, same Phase 0/1 caveat).
func TokenHandler(cfg Config, enabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !enabled {
			http.Error(w, "LiveKit not configured", http.StatusServiceUnavailable)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req tokenRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Identity == "" {
			http.Error(w, "identity required", http.StatusBadRequest)
			return
		}

		token, err := cfg.MintToken(req.Identity, req.Name, RoomName)
		if err != nil {
			http.Error(w, "could not mint token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(tokenResponse{Token: token, URL: cfg.URL, Room: RoomName})
	}
}
