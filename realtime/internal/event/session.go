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

	maxTopics = 50
	// maxTopicLineRunes caps a raw host-typed line (before "|"-delimited rich
	// content is split apart) — generous, since a rich line packs a title,
	// an article, and several questions onto one line (see parseTopicLine).
	maxTopicLineRunes = 800
	maxTitleRunes     = 100
	maxArticleRunes   = 400
	maxQuestionRunes  = 150
	maxQuestions      = 5

	// boardTopics is how many of the host's topics the wall TOPIC 1/2/3 boards
	// show — a fixed display, not the per-round rotation (see SessionState.Topics).
	boardTopics = 3

	// finishedLinger is how long the "finished" state stays visible (to late
	// joiners too) before the session flips back to idle.
	finishedLinger = 30 * time.Second
)

var (
	ErrRunning    = errors.New("a session is already running — end it first")
	ErrNotRunning = errors.New("no session is running")
)

// DefaultTopics are used when the host doesn't supply any, and also double as
// the preset library that a plain host-typed line can match by title (see
// parseTopicLine) — deliberately open-ended, everyday prompts with a short
// article and a few follow-up questions, suiting a beginner-to-intermediate
// speaker.
var DefaultTopics = []protocol.TopicCard{
	{
		Title:   "What's your favorite food, and why?",
		Article: "Food is one of the easiest ways to start a conversation — everyone has an opinion about it! Talk about a dish you love, a comfort food from home, or something new you tried recently.",
		Questions: []string{
			"What's one dish from your country everyone should try?",
			"Do you prefer cooking at home or eating out?",
			"What's the most unusual food you've ever tried?",
			"Is there a food you disliked as a kid but enjoy now?",
		},
	},
	{
		Title:   "Describe your perfect weekend.",
		Article: "Weekends look different for everyone — some people relax at home, others go out and explore. Share what a truly perfect weekend looks like for you.",
		Questions: []string{
			"Do you prefer a quiet weekend or a busy one?",
			"What's something you always do on weekends?",
			"Who do you usually spend your weekends with?",
			"What was your best weekend recently?",
		},
	},
	{
		Title:   "Tell me about your hometown.",
		Article: "Everyone comes from somewhere different, with its own food, weather, and way of life. Describe the place where you grew up.",
		Questions: []string{
			"What's the best thing about your hometown?",
			"How is it different from where you live now?",
			"What do visitors usually say about it?",
			"Would you ever move back there?",
		},
	},
	{
		Title:   "What do you do for work or study?",
		Article: "Work and school take up a big part of our lives. Talk about what you do, and what a typical day looks like for you.",
		Questions: []string{
			"What do you enjoy most about it?",
			"What's the most challenging part?",
			"What did you want to be when you were a kid?",
			"Where do you see yourself in five years?",
		},
	},
	{
		Title:   "What's the best trip you've ever taken?",
		Article: "Traveling — even a short trip nearby — often creates the stories we remember for years. Share a trip that stands out to you.",
		Questions: []string{
			"What made that trip so memorable?",
			"Did anything go wrong during the trip?",
			"Would you go back to that place?",
			"Where do you want to travel next?",
		},
	},
	{
		Title:   "What hobbies are you into right now?",
		Article: "Hobbies are a great window into what someone truly enjoys. Talk about how you like to spend your free time these days.",
		Questions: []string{
			"How did you get into that hobby?",
			"How much time do you spend on it each week?",
			"Is there a hobby you'd like to try but haven't yet?",
			"Do you know anyone else who shares this hobby?",
		},
	},
	{
		Title:   "Talk about a movie or show you love.",
		Article: "Movies and shows give us a lot to talk about — characters, stories, and surprising endings. Share one that really stuck with you.",
		Questions: []string{
			"What's it about, in a few sentences?",
			"Who's your favorite character, and why?",
			"Would you recommend it to a friend?",
			"What's a movie or show you didn't like, and why?",
		},
	},
	{
		Title:   "What was the best gift you've ever received?",
		Article: "A great gift often says a lot about the person who gave it. Share a gift that really meant something to you.",
		Questions: []string{
			"Who gave it to you?",
			"What made it so special?",
			"What's the best gift you've ever given someone else?",
			"Do you prefer giving or receiving gifts?",
		},
	},
	{
		Title:   "How do you usually spend your mornings?",
		Article: "Mornings can set the tone for the whole day. Describe your typical morning routine, from waking up to starting your day.",
		Questions: []string{
			"Are you a morning person or a night person?",
			"What's the first thing you do after waking up?",
			"Has your morning routine changed over the years?",
			"What would your ideal morning look like?",
		},
	},
	{
		Title:   "What are you looking forward to this year?",
		Article: "It's always good to have something to look forward to, whether it's big or small. Share a plan, goal, or event you're excited about.",
		Questions: []string{
			"Why does it matter to you?",
			"What are you doing to prepare for it?",
			"Is there anything you're a little nervous about?",
			"What did you look forward to last year?",
		},
	},
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
	topics     []protocol.TopicCard // exactly `rounds` long once started (cycled from baseCards)
	baseCards  []protocol.TopicCard // the host's own list, pre-cycling — see SessionState.Topics
	finishedAt time.Time
	// featuredTopic is which of baseCards[0:boardTopics] the host has put up
	// on the wall's big board (1-based; 0 = none) — see FeatureTopic.
	featuredTopic int
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

	lines := cleanTopics(cfg.Topics)
	var cards []protocol.TopicCard
	if len(lines) == 0 {
		cards = DefaultTopics
	} else {
		cards = make([]protocol.TopicCard, len(lines))
		for i, line := range lines {
			cards[i] = parseTopicLine(line)
		}
	}
	topics := make([]protocol.TopicCard, cfg.Rounds)
	for i := range topics {
		topics[i] = cards[i%len(cards)]
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
	s.baseCards = cards
	s.featuredTopic = 0
	return nil
}

// FeatureTopic sets which of the wall's TOPIC 1-3 boards (1-based) is also
// shown on the big board, or clears it with 0. Unlike Next/Extend/End this
// isn't tied to a running round — a host can feature a topic any time a
// session exists (including while the finished banner lingers), since it's
// a presentation choice, not a round-timing command.
func (s *Session) FeatureTopic(index int) error {
	if index < 0 || index > boardTopics {
		return fmt.Errorf("index must be between 0 and %d", boardTopics)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.featuredTopic = index
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
	s.baseCards = nil
	s.finishedAt = time.Time{}
	s.featuredTopic = 0
}

func (s *Session) snapshotLocked() protocol.SessionState {
	switch s.phase {
	case phaseRunning:
		return protocol.SessionState{
			Active:        true,
			Round:         s.round,
			Rounds:        s.rounds,
			RoundEndsAt:   s.roundEnd.UnixMilli(),
			RoundMs:       s.roundDur.Milliseconds(),
			Topic:         s.topics[s.round-1].Title,
			Topics:        firstN(s.baseCards, boardTopics),
			FeaturedTopic: s.featuredTopic,
		}
	case phaseFinished:
		return protocol.SessionState{
			Finished:      true,
			Round:         s.round,
			Rounds:        s.rounds,
			RoundMs:       s.roundDur.Milliseconds(),
			Topics:        firstN(s.baseCards, boardTopics),
			FeaturedTopic: s.featuredTopic,
		}
	default:
		return protocol.SessionState{}
	}
}

// firstN returns at most the first n elements of s (all of it if shorter).
func firstN[T any](s []T, n int) []T {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// cleanTopics trims, drops blanks, clamps length, and caps how many raw lines
// are kept — this runs *before* parseTopicLine splits a "|"-delimited line
// into its title/article/questions, so the length cap here is generous
// (maxTopicLineRunes), not the tighter per-field caps parseTopicLine applies
// afterward.
func cleanTopics(in []string) []string {
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if utf8.RuneCountInString(t) > maxTopicLineRunes {
			t = string([]rune(t)[:maxTopicLineRunes])
		}
		out = append(out, t)
		if len(out) == maxTopics {
			break
		}
	}
	return out
}

// parseTopicLine turns one cleaned host-typed line into a full topic card.
//
// A plain line (no "|") is matched case-insensitively against the preset
// library's titles (DefaultTopics) — a hit inherits that preset's article and
// questions; a miss becomes a bare custom title with neither (the wall
// board's lightbox then just shows the title alone).
//
// A line containing "|" is the host's own rich content, packed onto one line
// rather than a multi-field form: `title | article | question | question…`.
// This keeps the existing one-line-per-topic textarea instead of a bigger
// per-topic UI (see docs/PLAN.md for the reasoning).
func parseTopicLine(line string) protocol.TopicCard {
	if !strings.Contains(line, "|") {
		if preset, ok := presetByTitle(line); ok {
			return preset
		}
		// A line that is just a link is an embed for an untitled video topic,
		// not a title — otherwise the URL itself becomes the on-board title.
		if isEmbeddableURL(line) {
			return protocol.TopicCard{Title: "影片", EmbedURL: clampRunes(line, maxArticleRunes)}
		}
		return protocol.TopicCard{Title: clampRunes(line, maxTitleRunes)}
	}

	parts := strings.Split(line, "|")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	card := protocol.TopicCard{Title: clampRunes(parts[0], maxTitleRunes)}
	if len(parts) > 1 {
		card.Article = clampRunes(parts[1], maxArticleRunes)
	}
	for _, q := range parts[min(2, len(parts)):] {
		if q == "" {
			continue
		}
		// A segment that looks like a link (e.g. a YouTube video related to
		// the topic) is the embeddable link, not a discussion question — the
		// first one wins, in whatever position the host put it.
		if card.EmbedURL == "" && isEmbeddableURL(q) {
			card.EmbedURL = clampRunes(q, maxArticleRunes)
			continue
		}
		if len(card.Questions) < maxQuestions {
			card.Questions = append(card.Questions, clampRunes(q, maxQuestionRunes))
		}
	}
	return card
}

// isEmbeddableURL is a loose check for "this segment is a link the host
// meant as TopicCard.EmbedURL" rather than a discussion question.
func isEmbeddableURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// presetByTitle looks up a preset topic card by an exact, case-insensitive
// title match.
func presetByTitle(title string) (protocol.TopicCard, bool) {
	for _, c := range DefaultTopics {
		if strings.EqualFold(c.Title, title) {
			return c, true
		}
	}
	return protocol.TopicCard{}, false
}

func clampRunes(s string, max int) string {
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
}
