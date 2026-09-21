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
//	{"t":"input","x":1.5,"z":-2.0,"yaw":0.78,"anim":"walk","zoneId":"table3","seatId":"3w"}
//	{"t":"chat","body":"hi!"}
//	{"t":"host","action":"start","key":"...","rounds":4,"roundSeconds":900,"topics":["Food"]}
//	{"t":"host","action":"next"|"end","key":"..."}
//	{"t":"host","action":"extend","key":"...","seconds":120}
type ClientMsg struct {
	T      string  `json:"t"`
	Name   string  `json:"name"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	Yaw    float64 `json:"yaw"`
	Anim   string  `json:"anim"`
	ZoneID string  `json:"zoneId"`
	SeatID string  `json:"seatId"`
	Body   string  `json:"body"`

	// Host console (language-exchange session control). Every host message
	// carries the shared secret in Key; see internal/game/host.go.
	Action       string   `json:"action"`
	Key          string   `json:"key"`
	Rounds       int      `json:"rounds"`
	RoundSeconds int      `json:"roundSeconds"`
	Topics       []string `json:"topics"`
	Seconds      int      `json:"seconds"`
}

// SessionState is the language-exchange session as every client sees it.
// Exactly one of three shapes: idle (all zero), running (Active), or just
// finished (Finished — lingers briefly so late joiners still see the
// wrap-up, then the server flips back to idle).
type SessionState struct {
	Active   bool `json:"active"`
	Finished bool `json:"finished"`
	// Round is 1-based; Rounds is the total for this session.
	Round  int `json:"round"`
	Rounds int `json:"rounds"`
	// RoundEndsAt is unix ms on the SERVER's clock — clients correct for skew
	// using ServerMsg.Now from the same message. RoundMs is the nominal round
	// length (a host extension moves RoundEndsAt but not RoundMs).
	RoundEndsAt int64  `json:"roundEndsAt"`
	RoundMs     int64  `json:"roundMs"`
	Topic       string `json:"topic"`
}

// PlayerState is one avatar's authoritative state as fanned out to clients.
type PlayerState struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	Yaw    float64 `json:"yaw"`
	Anim   string  `json:"anim"`
	Color  string  `json:"color"`
	ZoneID string  `json:"zoneId,omitempty"`
	SeatID string  `json:"seatId,omitempty"`
}

// ServerMsg is anything the server sends to the browser.
//
//	{"t":"welcome","id":"ab12","tickRate":15,"color":"#0090ff"}
//	{"t":"snapshot","players":[...]}
//	{"t":"leave","id":"ab12"}
//	{"t":"chat","id":"ab12","name":"marcus","body":"hi!","ts":1234567890123}
//	{"t":"session","session":{...},"now":1234567890123}
//	{"t":"hostResult","ok":true}  /  {"t":"hostResult","error":"wrong host key"}
type ServerMsg struct {
	T        string        `json:"t"`
	ID       string        `json:"id,omitempty"`
	TickRate int           `json:"tickRate,omitempty"`
	Color    string        `json:"color,omitempty"`
	Players  []PlayerState `json:"players,omitempty"`
	Name     string        `json:"name,omitempty"`
	Body     string        `json:"body,omitempty"`
	Ts       int64         `json:"ts,omitempty"`

	Session *SessionState `json:"session,omitempty"`
	// Now is the server's unix-ms clock when the message was built, so a client
	// can work out its own offset from it (see SessionState.RoundEndsAt).
	Now int64 `json:"now,omitempty"`
	// OK / Error answer a host command (only the sender gets these). OK is
	// omitted when false — clients treat "no ok" as failure and read Error.
	OK    bool   `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
}
