// Command server is the Phase 0 realtime backend: one hard-coded room, a
// WebSocket endpoint, and a fixed-tick authoritative snapshot broadcast.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/marcussfu/engchatroom/realtime/internal/game"
	"github.com/marcussfu/engchatroom/realtime/internal/livekit"
	"github.com/marcussfu/engchatroom/realtime/internal/store"
)

func main() {
	// Optional: fill in LIVEKIT_* from realtime/.env for local dev (see
	// .env.example). Real environment variables always win — Load() never
	// overrides a var that's already set — so this is a no-op in CI/prod.
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf(".env: %v", err)
	}

	addr := envOr("ADDR", ":8787")
	tickRate := envIntOr("TICK_RATE", 15)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	room := game.NewRoom(tickRate)

	// Chat persistence is optional: no DATABASE_URL (or a Postgres that's
	// unreachable) just means chat still works live but history doesn't
	// survive a restart or reach a client that joins later — see
	// game.ChatStore's doc comment.
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		if st, err := store.Open(ctx, dsn); err != nil {
			log.Printf("postgres: %v — chat history disabled", err)
		} else if err := st.Migrate(ctx); err != nil {
			log.Printf("postgres migrate: %v — chat history disabled", err)
			st.Close()
		} else {
			defer st.Close()
			room.SetChatStore(st)
			log.Println("chat persistence enabled (Postgres)")
		}
	} else {
		log.Println("DATABASE_URL not set — chat history is in-memory only for this run")
	}

	go room.Run(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", room.ServeWS)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// /token is always routed — see TokenHandler's doc comment for why an
	// unconfigured server still needs the route to exist (CORS on the
	// preflight, specifically).
	lkCfg, lkOK := livekit.ConfigFromEnv()
	mux.HandleFunc("/token", livekit.TokenHandler(lkCfg, lkOK))
	if lkOK {
		log.Println("LiveKit token endpoint enabled at /token")
	} else {
		log.Println("LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET not set — /token will respond 503")
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("realtime server listening on %s (tick %d Hz)", addr, tickRate)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
	log.Println("shut down cleanly")
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envIntOr(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}
