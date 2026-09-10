package game

import (
	"context"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/marcussfu/engchatroom/realtime/internal/protocol"
)

// TestRoomConcurrentBroadcast exercises the lock discipline: many goroutines
// mutating player state while the tick loop marshals and fans out snapshots.
// Run with -race.
func TestRoomConcurrentBroadcast(t *testing.T) {
	r := NewRoom(120)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.Run(ctx)

	const n = 8
	clients := make([]*Client, n)
	var drain sync.WaitGroup
	for i := range clients {
		c := &Client{
			room:  r,
			send:  make(chan []byte, 64),
			state: protocol.PlayerState{ID: strconv.Itoa(i), Anim: protocol.AnimIdle},
		}
		clients[i] = c
		r.add(c)

		drain.Add(1)
		go func(ch chan []byte) {
			defer drain.Done()
			for range ch { // consume until closed by r.remove
			}
		}(c.send)
	}

	var mut sync.WaitGroup
	for _, c := range clients {
		mut.Add(1)
		go func(c *Client) {
			defer mut.Done()
			for j := 0; j < 500; j++ {
				r.mu.Lock()
				c.state.X = float64(j)
				c.state.Anim = protocol.AnimWalk
				r.dirty = true
				r.mu.Unlock()
			}
		}(c)
	}
	mut.Wait()

	time.Sleep(30 * time.Millisecond) // let a few ticks fan out

	for _, c := range clients {
		r.remove(c)
	}
	drain.Wait()

	if got := r.count(); got != 0 {
		t.Fatalf("room not empty after removing all clients: %d", got)
	}
}

func TestNextColorCycles(t *testing.T) {
	r := NewRoom(15)
	first := r.nextColor()
	for i := 0; i < len(avatarColors)-1; i++ {
		r.nextColor()
	}
	if got := r.nextColor(); got != first {
		t.Fatalf("colour sequence did not wrap: first=%s wrapped=%s", first, got)
	}
}
