package game

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/marcussfu/engchatroom/realtime/internal/event"
	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

// maxHostKeyFailures caps wrong-key guesses per connection. It's a speed bump
// for anyone poking at a public deployment, not real rate limiting (a client
// can reconnect to reset it) — proper host accounts arrive with auth (Phase 2).
const maxHostKeyFailures = 5

var (
	errHostDisabled = errors.New("host controls are disabled on this server (HOST_KEY is not set)")
	errBadHostKey   = errors.New("wrong host key")
	errTooManyTries = errors.New("too many wrong host keys on this connection — reconnect to try again")
)

// handleHost runs one host command (start / next / extend / end) from c and
// answers c with a hostResult. On success the new session state is broadcast
// to everyone.
//
// Called only from c's readPump goroutine, so c.hostFailures needs no lock and
// replying via c.trySend can't race the channel being closed (remove runs
// after readPump returns, on the same goroutine).
func (r *Room) handleHost(c *Client, msg protocol.ClientMsg) {
	if err := r.authorizeHost(c, msg.Key); err != nil {
		c.trySend(protocol.ServerMsg{T: "hostResult", Error: err.Error()})
		return
	}

	now := time.Now()
	var err error
	switch msg.Action {
	case "start":
		err = r.session.Start(event.Config{
			Rounds:       msg.Rounds,
			RoundSeconds: msg.RoundSeconds,
			Topics:       msg.Topics,
		}, now)
	case "next":
		err = r.session.Next(now)
	case "extend":
		err = r.session.Extend(time.Duration(msg.Seconds)*time.Second, now)
	case "end":
		err = r.session.End(now)
	default:
		err = fmt.Errorf("unknown host action %q", msg.Action)
	}
	if err != nil {
		c.trySend(protocol.ServerMsg{T: "hostResult", Error: err.Error()})
		return
	}

	log.Printf("host %s by %s", msg.Action, c.state.ID)
	// Answer the host first, then announce the new state to everyone (the host
	// included) — so a client sees "your command worked" before the state change.
	c.trySend(protocol.ServerMsg{T: "hostResult", OK: true})
	r.broadcastSession(r.session.Snapshot())
}

func (r *Room) authorizeHost(c *Client, key string) error {
	if r.hostKey == "" {
		return errHostDisabled
	}
	if c.hostFailures >= maxHostKeyFailures {
		return errTooManyTries
	}
	if subtle.ConstantTimeCompare([]byte(key), []byte(r.hostKey)) != 1 {
		c.hostFailures++
		return errBadHostKey
	}
	c.hostFailures = 0
	return nil
}
