package event

import (
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)

func startedSession(t *testing.T, rounds, secs int, topics ...string) *Session {
	t.Helper()
	s := &Session{}
	if err := s.Start(Config{Rounds: rounds, RoundSeconds: secs, Topics: topics}, t0); err != nil {
		t.Fatalf("Start: %v", err)
	}
	return s
}

func TestIdleByDefault(t *testing.T) {
	s := &Session{}
	st := s.Snapshot()
	if st.Active || st.Finished || st.Round != 0 {
		t.Fatalf("zero Session = %+v, want idle", st)
	}
	if _, changed := s.Tick(t0); changed {
		t.Fatal("Tick on an idle session reported a change")
	}
}

func TestStartValidation(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
	}{
		{"zero rounds", Config{Rounds: 0, RoundSeconds: 60}},
		{"too many rounds", Config{Rounds: MaxRounds + 1, RoundSeconds: 60}},
		{"round too short", Config{Rounds: 2, RoundSeconds: MinRoundSeconds - 1}},
		{"round too long", Config{Rounds: 2, RoundSeconds: MaxRoundSeconds + 1}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := (&Session{}).Start(c.cfg, t0); err == nil {
				t.Fatalf("Start(%+v) succeeded, want error", c.cfg)
			}
		})
	}
}

func TestStartSnapshot(t *testing.T) {
	s := startedSession(t, 4, 900, "Food", "Travel")
	st := s.Snapshot()
	if !st.Active || st.Finished {
		t.Fatalf("state = %+v, want active", st)
	}
	if st.Round != 1 || st.Rounds != 4 {
		t.Errorf("round = %d/%d, want 1/4", st.Round, st.Rounds)
	}
	if st.RoundMs != 900_000 {
		t.Errorf("RoundMs = %d, want 900000", st.RoundMs)
	}
	if want := t0.Add(900 * time.Second).UnixMilli(); st.RoundEndsAt != want {
		t.Errorf("RoundEndsAt = %d, want %d", st.RoundEndsAt, want)
	}
	if st.Topic != "Food" {
		t.Errorf("Topic = %q, want Food", st.Topic)
	}
}

func TestStartWhileRunningFails(t *testing.T) {
	s := startedSession(t, 2, 60)
	if err := s.Start(Config{Rounds: 2, RoundSeconds: 60}, t0); err != ErrRunning {
		t.Fatalf("second Start err = %v, want ErrRunning", err)
	}
}

func TestDefaultTopicsWhenNoneGiven(t *testing.T) {
	s := startedSession(t, 2, 60)
	if got := s.Snapshot().Topic; got != DefaultTopics[0].Title {
		t.Fatalf("Topic = %q, want first default %q", got, DefaultTopics[0].Title)
	}
	// Blank-only topics count as none.
	s2 := &Session{}
	if err := s2.Start(Config{Rounds: 1, RoundSeconds: 60, Topics: []string{"  ", ""}}, t0); err != nil {
		t.Fatal(err)
	}
	if got := s2.Snapshot().Topic; got != DefaultTopics[0].Title {
		t.Fatalf("Topic = %q, want first default", got)
	}
}

func TestTopicsCycleWhenFewerThanRounds(t *testing.T) {
	s := startedSession(t, 3, 30, "A", "B")
	var got []string
	now := t0
	for i := 0; i < 3; i++ {
		got = append(got, s.Snapshot().Topic)
		now = now.Add(30 * time.Second)
		s.Tick(now)
	}
	if strings.Join(got, ",") != "A,B,A" {
		t.Fatalf("topics per round = %v, want [A B A]", got)
	}
}

func TestTickAdvancesRoundAtDeadline(t *testing.T) {
	s := startedSession(t, 3, 60, "A", "B", "C")

	if _, changed := s.Tick(t0.Add(59 * time.Second)); changed {
		t.Fatal("Tick before the deadline reported a change")
	}
	st, changed := s.Tick(t0.Add(60 * time.Second))
	if !changed {
		t.Fatal("Tick at the deadline did not report a change")
	}
	if st.Round != 2 || st.Topic != "B" {
		t.Fatalf("after deadline: round=%d topic=%q, want 2/B", st.Round, st.Topic)
	}
	// New round runs a full duration from when the boundary was noticed.
	if want := t0.Add(120 * time.Second).UnixMilli(); st.RoundEndsAt != want {
		t.Errorf("RoundEndsAt = %d, want %d", st.RoundEndsAt, want)
	}
}

func TestLastRoundEndingFinishesThenGoesIdle(t *testing.T) {
	s := startedSession(t, 2, 60)
	s.Tick(t0.Add(60 * time.Second)) // -> round 2

	st, changed := s.Tick(t0.Add(120 * time.Second)) // round 2 ends
	if !changed || !st.Finished || st.Active {
		t.Fatalf("after last round: %+v changed=%v, want finished", st, changed)
	}
	if st.Round != 2 || st.Rounds != 2 {
		t.Errorf("finished state kept round %d/%d, want 2/2", st.Round, st.Rounds)
	}

	// Still finished while the banner lingers...
	if st, changed := s.Tick(t0.Add(120*time.Second + 10*time.Second)); changed || !st.Finished {
		t.Fatalf("10s after finish: %+v changed=%v, want still finished", st, changed)
	}
	// ...then back to idle.
	st, changed = s.Tick(t0.Add(120*time.Second + finishedLinger))
	if !changed || st.Finished || st.Active {
		t.Fatalf("after linger: %+v changed=%v, want idle", st, changed)
	}
}

func TestStartAllowedAfterFinished(t *testing.T) {
	s := startedSession(t, 1, 30)
	if err := s.End(t0); err != nil {
		t.Fatal(err)
	}
	if err := s.Start(Config{Rounds: 2, RoundSeconds: 30}, t0.Add(time.Second)); err != nil {
		t.Fatalf("Start right after finish: %v", err)
	}
	if st := s.Snapshot(); !st.Active || st.Round != 1 || st.Rounds != 2 {
		t.Fatalf("restarted state = %+v", st)
	}
}

func TestNextSkipsAheadAndFinishesOnLast(t *testing.T) {
	s := startedSession(t, 2, 600, "A", "B")
	if err := s.Next(t0.Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	st := s.Snapshot()
	if st.Round != 2 || st.Topic != "B" {
		t.Fatalf("after Next: round=%d topic=%q, want 2/B", st.Round, st.Topic)
	}
	// The skipped-to round gets a full duration from the skip, not the old deadline.
	if want := t0.Add(5*time.Second + 600*time.Second).UnixMilli(); st.RoundEndsAt != want {
		t.Errorf("RoundEndsAt = %d, want %d", st.RoundEndsAt, want)
	}
	if err := s.Next(t0.Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if !s.Snapshot().Finished {
		t.Fatal("Next on the last round should finish the session")
	}
}

func TestExtendMovesDeadlineNotNominalLength(t *testing.T) {
	s := startedSession(t, 2, 60)
	if err := s.Extend(30*time.Second, t0); err != nil {
		t.Fatal(err)
	}
	st := s.Snapshot()
	if want := t0.Add(90 * time.Second).UnixMilli(); st.RoundEndsAt != want {
		t.Errorf("RoundEndsAt = %d, want %d", st.RoundEndsAt, want)
	}
	if st.RoundMs != 60_000 {
		t.Errorf("RoundMs = %d, want it unchanged at 60000", st.RoundMs)
	}
	// The original deadline no longer ends the round.
	if _, changed := s.Tick(t0.Add(60 * time.Second)); changed {
		t.Fatal("round ended at the pre-extension deadline")
	}
	if _, changed := s.Tick(t0.Add(90 * time.Second)); !changed {
		t.Fatal("round did not end at the extended deadline")
	}
}

func TestExtendValidation(t *testing.T) {
	s := startedSession(t, 1, 60)
	for _, d := range []time.Duration{0, -time.Second, (MaxExtendSeconds + 1) * time.Second} {
		if err := s.Extend(d, t0); err == nil {
			t.Errorf("Extend(%v) succeeded, want error", d)
		}
	}
}

func TestCommandsRequireARunningSession(t *testing.T) {
	s := &Session{}
	if err := s.Next(t0); err != ErrNotRunning {
		t.Errorf("Next err = %v, want ErrNotRunning", err)
	}
	if err := s.Extend(time.Minute, t0); err != ErrNotRunning {
		t.Errorf("Extend err = %v, want ErrNotRunning", err)
	}
	if err := s.End(t0); err != ErrNotRunning {
		t.Errorf("End err = %v, want ErrNotRunning", err)
	}
}

func TestEndFinishesImmediately(t *testing.T) {
	s := startedSession(t, 4, 600)
	if err := s.End(t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	st := s.Snapshot()
	if st.Active || !st.Finished || st.Round != 1 || st.Rounds != 4 {
		t.Fatalf("after End: %+v, want finished at round 1/4", st)
	}
}

func TestCleanTopics(t *testing.T) {
	long := strings.Repeat("字", maxTopicLineRunes+50)
	got := cleanTopics([]string{"  keep  ", "", "   ", long})
	if len(got) != 2 || got[0] != "keep" {
		t.Fatalf("cleanTopics = %q", got)
	}
	if n := len([]rune(got[1])); n != maxTopicLineRunes {
		t.Errorf("long topic clamped to %d runes, want %d", n, maxTopicLineRunes)
	}

	many := make([]string, maxTopics+10)
	for i := range many {
		many[i] = "t"
	}
	if n := len(cleanTopics(many)); n != maxTopics {
		t.Errorf("kept %d topics, want cap of %d", n, maxTopics)
	}
}

func TestParseTopicLinePlainMatchesPreset(t *testing.T) {
	card := parseTopicLine(strings.ToUpper(DefaultTopics[0].Title))
	if card.Title != DefaultTopics[0].Title || card.Article != DefaultTopics[0].Article {
		t.Fatalf("parseTopicLine(preset title, different case) = %+v, want the preset card", card)
	}
}

func TestParseTopicLinePlainCustom(t *testing.T) {
	card := parseTopicLine("Something nobody configured")
	if card.Title != "Something nobody configured" || card.Article != "" || len(card.Questions) != 0 {
		t.Fatalf("parseTopicLine(unmatched custom) = %+v, want bare title only", card)
	}
}

func TestParseTopicLineRichDelimited(t *testing.T) {
	card := parseTopicLine(" My Topic | An article. | Q1? | Q2? | Q3? | Q4? | Q5? | Q6? ")
	if card.Title != "My Topic" || card.Article != "An article." {
		t.Fatalf("parseTopicLine(rich) title/article = %q/%q", card.Title, card.Article)
	}
	if len(card.Questions) != maxQuestions {
		t.Fatalf("questions = %v, want capped at %d", card.Questions, maxQuestions)
	}
	if card.Questions[0] != "Q1?" {
		t.Errorf("first question = %q, want Q1?", card.Questions[0])
	}
}

func TestParseTopicLineRichDelimitedWithEmbedURL(t *testing.T) {
	card := parseTopicLine("My Topic | An article. | https://youtube.com/embed/abc123 | Q1? | Q2?")
	if card.EmbedURL != "https://youtube.com/embed/abc123" {
		t.Fatalf("EmbedURL = %q, want the link", card.EmbedURL)
	}
	if len(card.Questions) != 2 || card.Questions[0] != "Q1?" || card.Questions[1] != "Q2?" {
		t.Fatalf("questions = %v, want [Q1? Q2?] (the link shouldn't count as one)", card.Questions)
	}
}

func TestFeatureTopicValidatesRange(t *testing.T) {
	s := &Session{}
	for _, bad := range []int{-1, boardTopics + 1} {
		if err := s.FeatureTopic(bad); err == nil {
			t.Errorf("FeatureTopic(%d) succeeded, want a range error", bad)
		}
	}
	if err := s.FeatureTopic(0); err != nil {
		t.Errorf("FeatureTopic(0) (clear) failed: %v", err)
	}
	if err := s.FeatureTopic(boardTopics); err != nil {
		t.Errorf("FeatureTopic(%d) failed: %v", boardTopics, err)
	}
}

func TestFeatureTopicReflectedInSnapshot(t *testing.T) {
	s := startedSession(t, 2, 60, "A", "B")
	if err := s.FeatureTopic(2); err != nil {
		t.Fatal(err)
	}
	if got := s.Snapshot().FeaturedTopic; got != 2 {
		t.Fatalf("FeaturedTopic = %d, want 2", got)
	}
	// Start() resets it for a fresh session.
	if err := s.End(t0); err != nil {
		t.Fatal(err)
	}
	if err := s.Start(Config{Rounds: 1, RoundSeconds: 30}, t0); err != nil {
		t.Fatal(err)
	}
	if got := s.Snapshot().FeaturedTopic; got != 0 {
		t.Fatalf("FeaturedTopic after restart = %d, want reset to 0", got)
	}
}
