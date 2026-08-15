package mcpproxy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// EventBroadcaster is an interface satisfied by the hub.
type EventBroadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// JSONRPCMessage represents a standard JSON-RPC 2.0 message envelope.
type JSONRPCMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   any             `json:"error,omitempty"`
}

// Proxy coordinates bidirectional stdio inspection between client and server.
type Proxy struct {
	broadcaster EventBroadcaster
	sessionID   string
	seq         uint64
	mu          sync.Mutex
	inFlight    map[string]time.Time
}

// New creates an MCP stdio proxy.
func New(broadcaster EventBroadcaster, sessionID string) *Proxy {
	if sessionID == "" {
		sessionID = fmt.Sprintf("sess-%d", time.Now().Unix())
	}
	return &Proxy{
		broadcaster: broadcaster,
		sessionID:   sessionID,
		inFlight:    make(map[string]time.Time),
	}
}

// PipeClientToServer reads messages from clientIn, records events, and writes to serverOut.
func (p *Proxy) PipeClientToServer(clientIn io.Reader, serverOut io.Writer) error {
	scanner := bufio.NewScanner(clientIn)
	// Allow large payloads (up to 10MB)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		p.inspectClientMessage(line)

		if _, err := fmt.Fprintln(serverOut, string(line)); err != nil {
			return err
		}
	}
	return scanner.Err()
}

// PipeServerToClient reads messages from serverIn, records responses, and writes to clientOut.
func (p *Proxy) PipeServerToClient(serverIn io.Reader, clientOut io.Writer) error {
	scanner := bufio.NewScanner(serverIn)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		p.inspectServerMessage(line)

		if _, err := fmt.Fprintln(clientOut, string(line)); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func (p *Proxy) inspectClientMessage(data []byte) {
	if len(data) == 0 {
		return
	}
	var msg JSONRPCMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}

	seq := atomic.AddUint64(&p.seq, 1)
	evtID := fmt.Sprintf("mcp-call-%d", seq)

	msgIDStr := fmt.Sprintf("%v", msg.ID)
	if msg.ID != nil {
		p.mu.Lock()
		p.inFlight[msgIDStr] = time.Now()
		p.mu.Unlock()
	}

	if msg.Method == "tools/call" {
		var toolCall struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		_ = json.Unmarshal(msg.Params, &toolCall)

		evt := events.NewEvent(
			evtID,
			p.sessionID,
			events.TypeMCPCall,
			"agent-operator",
			fmt.Sprintf("MCP Tool: %s", toolCall.Name),
		).
			WithRole(events.RoleOperator).
			WithStation(events.StationPhoneBooth).
			WithSummary(fmt.Sprintf("Calling tool %q on external MCP server", toolCall.Name)).
			WithPayload("tool", toolCall.Name).
			WithPayload("args", toolCall.Arguments).
			WithPayload("rpcId", msg.ID)

		if p.broadcaster != nil {
			_ = p.broadcaster.BroadcastEvent(evt)
		}
	} else if msg.Method != "" {
		evt := events.NewEvent(
			evtID,
			p.sessionID,
			events.TypeMCPCall,
			"agent-operator",
			fmt.Sprintf("MCP RPC: %s", msg.Method),
		).
			WithRole(events.RoleOperator).
			WithStation(events.StationPhoneBooth).
			WithSummary(fmt.Sprintf("JSON-RPC method %s", msg.Method)).
			WithPayload("method", msg.Method).
			WithPayload("rpcId", msg.ID)

		if p.broadcaster != nil {
			_ = p.broadcaster.BroadcastEvent(evt)
		}
	}
}

func (p *Proxy) inspectServerMessage(data []byte) {
	if len(data) == 0 {
		return
	}
	var msg JSONRPCMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}

	seq := atomic.AddUint64(&p.seq, 1)
	evtID := fmt.Sprintf("mcp-resp-%d", seq)

	msgIDStr := fmt.Sprintf("%v", msg.ID)
	var durationMs int64
	p.mu.Lock()
	if start, ok := p.inFlight[msgIDStr]; ok {
		durationMs = time.Since(start).Milliseconds()
		delete(p.inFlight, msgIDStr)
	}
	p.mu.Unlock()

	if msg.ID != nil {
		status := "SUCCESS"
		if msg.Error != nil {
			status = "ERROR"
		}

		evt := events.NewEvent(
			evtID,
			p.sessionID,
			events.TypeMCPResponse,
			"agent-operator",
			fmt.Sprintf("MCP Response [%s]", status),
		).
			WithRole(events.RoleOperator).
			WithStation(events.StationPhoneBooth).
			WithSummary(fmt.Sprintf("Received response in %dms", durationMs)).
			WithPayload("status", status).
			WithPayload("durationMs", durationMs).
			WithPayload("rpcId", msg.ID)

		if p.broadcaster != nil {
			_ = p.broadcaster.BroadcastEvent(evt)
		}
	}
}
