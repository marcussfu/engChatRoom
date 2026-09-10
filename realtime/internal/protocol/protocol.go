// Package protocol defines the wire messages shared between the Go realtime
// server and the TypeScript web client. Keep this in sync with
// web/src/net/types.ts.
package protocol

// Animation states an avatar can be in.
const (
	AnimIdle = "idle"
	AnimWalk = "walk"
)

// ClientMsg is anything the browser sends to the server.
//
//	{"t":"join","name":"marcus"}
//	{"t":"input","x":1.5,"z":-2.0,"yaw":0.78,"anim":"walk"}
type ClientMsg struct {
	T    string  `json:"t"`
	Name string  `json:"name"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
	Yaw  float64 `json:"yaw"`
	Anim string  `json:"anim"`
}

// PlayerState is one avatar's authoritative state as fanned out to clients.
type PlayerState struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	X     float64 `json:"x"`
	Z     float64 `json:"z"`
	Yaw   float64 `json:"yaw"`
	Anim  string  `json:"anim"`
	Color string  `json:"color"`
}

// ServerMsg is anything the server sends to the browser.
//
//	{"t":"welcome","id":"ab12","tickRate":15,"color":"#0090ff"}
//	{"t":"snapshot","players":[...]}
//	{"t":"leave","id":"ab12"}
type ServerMsg struct {
	T        string        `json:"t"`
	ID       string        `json:"id,omitempty"`
	TickRate int           `json:"tickRate,omitempty"`
	Color    string        `json:"color,omitempty"`
	Players  []PlayerState `json:"players,omitempty"`
}
