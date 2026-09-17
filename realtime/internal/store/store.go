// Package store is the realtime server's Postgres persistence layer. Phase 1
// only needs room chat history, so this stays deliberately small: one table,
// hand-written SQL via pgx (no sqlc yet — see docs/PLAN.md §二 tech table;
// worth adding once there's more than one table's worth of queries).
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

// chatHistoryHardLimit caps how many rows RecentChatMessages will ever
// return, regardless of what a caller asks for — a defensive ceiling, not a
// tuning knob.
const chatHistoryHardLimit = 200

type Store struct {
	pool *pgxpool.Pool
}

// Open connects and verifies the connection with a ping. Callers own the
// returned Store and must call Close when done (typically deferred in main).
func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

// Migrate creates the schema if it doesn't exist yet. Plain idempotent DDL
// rather than a migration tool (golang-migrate/atlas, per PLAN §七) — there's
// exactly one table; a real migration pipeline is worth it once the schema
// actually needs to evolve across deployed versions.
func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS chat_messages (
			id         BIGSERIAL PRIMARY KEY,
			room_id    TEXT NOT NULL,
			user_id    TEXT NOT NULL,
			name       TEXT NOT NULL,
			body       TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		CREATE INDEX IF NOT EXISTS chat_messages_room_created_idx
			ON chat_messages (room_id, created_at);
	`)
	if err != nil {
		return fmt.Errorf("store: migrate: %w", err)
	}
	return nil
}

// SaveChatMessage persists one chat line. Satisfies internal/game.ChatStore.
func (s *Store) SaveChatMessage(ctx context.Context, roomID, userID, name, body string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO chat_messages (room_id, user_id, name, body) VALUES ($1, $2, $3, $4)`,
		roomID, userID, name, body,
	)
	if err != nil {
		return fmt.Errorf("store: save chat message: %w", err)
	}
	return nil
}

// RecentChatMessages returns up to limit messages for roomID, oldest first,
// pre-shaped as the "chat" ServerMsg the WebSocket already sends live chat
// as — so a caller can just replay them to a newly joined client. Returns
// protocol.ServerMsg (not a store-local type) so internal/game.ChatStore can
// declare this method without importing this package. Satisfies
// internal/game.ChatStore.
func (s *Store) RecentChatMessages(ctx context.Context, roomID string, limit int) ([]protocol.ServerMsg, error) {
	if limit <= 0 || limit > chatHistoryHardLimit {
		limit = chatHistoryHardLimit
	}
	rows, err := s.pool.Query(ctx, `
		SELECT user_id, name, body, created_at
		FROM chat_messages
		WHERE room_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, roomID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: recent chat messages: %w", err)
	}
	defer rows.Close()

	var msgs []protocol.ServerMsg
	for rows.Next() {
		var (
			userID, name, body string
			createdAt          time.Time
		)
		if err := rows.Scan(&userID, &name, &body, &createdAt); err != nil {
			return nil, fmt.Errorf("store: scan chat message: %w", err)
		}
		msgs = append(msgs, protocol.ServerMsg{
			T:    "chat",
			ID:   userID,
			Name: name,
			Body: body,
			Ts:   createdAt.UnixMilli(),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: recent chat messages: %w", err)
	}

	// Query is newest-first (so LIMIT keeps the most recent rows); flip to
	// chronological order for replay to a joining client.
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs, nil
}
