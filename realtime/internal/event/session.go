// Package event runs the language-exchange session (docs/PLAN.md §一.B.12 /
// §八.1): a host starts a run of N timed rounds, each with its own TOPIC, and
// the room rotates partners between rounds.
//
// Session is a pure state machine: it never reads the clock or starts a
// goroutine — every method takes `now` from the caller. The room's existing
// tick drives Tick(), and tests fast-forward time by just passing later
// timestamps instead of waiting out a real 15-minute round.
//
// It does NOT know about seats or tables. Who moves where is decided
// client-side from the round number (web/src/engine/rotation.ts): black-chair
// (rotator) players shift to the next table each time the round advances.
package event

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

const (
	MaxRounds        = 16 // one full lap of the 16 numbered tables
	MinRoundSeconds  = 10 // short on purpose: lets a host smoke-test with 10s rounds
	MaxRoundSeconds  = 3600
	MaxExtendSeconds = 3600

	maxTopics     = 50
	maxTopicRunes = 100

	// finishedLinger is how long the "finished" state stays visible (to late
	// joiners too) before the session flips back to idle.
	finishedLinger = 30 * time.Second
)

var (
	ErrRunning    = errors.New("a session is already running — end it first")
	ErrNotRunning = errors.New("no session is running")
)

// DefaultTopics are used when the host doesn't supply any. Deliberately
// open-ended, everyday prompts that suit a beginner-to-intermediate speaker.
var DefaultTopics = []string{
	"What's your favorite food, and why?",
	"Describe your perfect weekend.",
	"Tell me about your hometown.",
	"What do you do for work or study?",
	"What's the best trip you've ever taken?",
	"What hobbies are you into right now?",
	"Talk about a movie or show you love.",
	"What was the best gift you've ever received?",
	"How do you usually spend your mornings?",
	"What are you looking forward to this year?",
}

type phase int

const (
	phaseIdle phase = iota
	phaseRunning
	phaseFinished
)

// Config is what the host chooses when starting a session.
type Config struct {
	Rounds       int
	RoundSeconds int
	// Topics is cycled if there are fewer than Rounds; empty means DefaultTopics.
	Topics []string
}

// Session is safe for concurrent use.
type Session struct {
	mu sync.Mutex

	phase      phase
	rounds     int
	round      int // 1-based while running/finished
	roundDur   time.Duration
	roundEnd   time.Time
	topics     []string // exactly `rounds` long once started
	finishedAt time.Time
}

// Start begins a new session. It fails if one is already running, but is
// fine right after a finished one (or while the finished banner lingers).
func (s *Session) Start(cfg Config, now time.Time) error {
	if cfg.Rounds < 1 || cfg.Rounds > MaxRounds {
		return fmt.Errorf("rounds must be between 1 and %d", MaxRounds)
	}
	if cfg.RoundSeconds < MinRoundSeconds || cfg.RoundSeconds > MaxRoundSeconds {
		return fmt.Errorf("round length must be between %d and %d seconds", MinRoundSeconds, MaxRoundSeconds)
	}

	base := cleanTopics(cfg.Topics)
	if len(base) == 0 {
		base = DefaultTopics
	}
	topics := make([]string, cfg.Rounds)
	for i := range topics {
		topics[i] = base[i%len(base)]
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phase == phaseRunning {
		return ErrRunning
	}
	s.phase = phaseRunning
	s.rounds = cfg.Rounds
	s.round = 1
	s.roundDur = time.Duration(cfg.RoundSeconds) * time.Second
	s.roundEnd = now.Add(s.roundDur)
	s.topics = topics
	return nil
}

// Next skips to the next round immediately, or finishes the session if this
// was the last one.
func (s *Session) Next(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phase != phaseRunning {
		return ErrNotRunning
	}
	s.advanceLocked(now)
	return nil
}

// Extend adds time to the current round.
func (s *Session) Extend(d time.Duration, now time.Time) error {
	if d < time.Second || d > MaxExtendSeconds*time.Second {
		return fmt.Errorf("extension must be between 1 and %d seconds", MaxExtendSeconds)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phase != phaseRunning {
		return ErrNotRunning
	}
	s.roundEnd = s.roundEnd.Add(d)
	return nil
}

// End finishes the session right now.
func (s *Session) End(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phase != phaseRunning {
		return ErrNotRunning
	}
	s.finishLocked(now)
	return nil
}

// Tick advances time-driven transitions: a round running out, or the
// "finished" banner expiring. It returns the current state and whether
// anything changed (so the caller knows to broadcast).
func (s *Session) Tick(now time.Time) (protocol.SessionState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	switch s.phase {
	case phaseRunning:
		if !now.Before(s.roundEnd) {
			s.advanceLocked(now)
			changed = true
		}
	case phaseFinished:
		if now.Sub(s.finishedAt) >= finishedLinger {
			s.resetLocked()
			changed = true
		}
	}
	return s.snapshotLocked(), changed
}

// Snapshot returns the current state without advancing anything.
func (s *Session) Snapshot() protocol.SessionState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *Session) advanceLocked(now time.Time) {
	if s.round >= s.rounds {
		s.finishLocked(now)
		return
	}
	s.round++
	// The next round starts when the boundary is *noticed* (within one room
	// tick of the real deadline) rather than being scheduled off the old
	// deadline — a host extension or a delayed tick can't leave the new round
	// short or already expired.
	s.roundEnd = now.Add(s.roundDur)
}

func (s *Session) finishLocked(now time.Time) {
	s.phase = phaseFinished
	s.finishedAt = now
}

// resetLocked returns to idle. Fields are cleared one by one rather than
// assigning a zero Session — that would also overwrite the mutex we're
// currently holding, and the deferred Unlock would then panic.
func (s *Session) resetLocked() {
	s.phase = phaseIdle
	s.rounds = 0
	s.round = 0
	s.roundDur = 0
	s.roundEnd = time.Time{}
	s.topics = nil
	s.finishedAt = time.Time{}
}

func (s *Session) snapshotLocked() protocol.SessionState {
	switch s.phase {
	case phaseRunning:
		return protocol.SessionState{
			Active:      true,
			Round:       s.round,
			Rounds:      s.rounds,
			RoundEndsAt: s.roundEnd.UnixMilli(),
			RoundMs:     s.roundDur.Milliseconds(),
			Topic:       s.topics[s.round-1],
		}
	case phaseFinished:
		return protocol.SessionState{
			Finished: true,
			Round:    s.round,
			Rounds:   s.rounds,
			RoundMs:  s.roundDur.Milliseconds(),
		}
	default:
		return protocol.SessionState{}
	}
}

// cleanTopics trims, drops blanks, clamps length, and caps how many are kept.
func cleanTopics(in []string) []string {
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if utf8.RuneCountInString(t) > maxTopicRunes {
			t = string([]rune(t)[:maxTopicRunes])
		}
		out = append(out, t)
		if len(out) == maxTopics {
			break
		}
	}
	return out
}
