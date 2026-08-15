package mcpproxy_test

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/mcpproxy"
)

type mockBroadcaster struct {
	mu     sync.Mutex
	events []*events.Event
}

func (m *mockBroadcaster) BroadcastEvent(evt *events.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, evt)
	return nil
}

func (m *mockBroadcaster) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}

func TestMCPProxy_PipeAndInspection(t *testing.T) {
	mb := &mockBroadcaster{}
	p := mcpproxy.New(mb, "sess-test")

	// 1. Test tool call from client to server
	clientInput := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"github_search","arguments":{"q":"copilot"}}}`,
		`{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}`,
		`invalid json line should not break pipe`,
		``,
	}, "\n")

	var serverOutput bytes.Buffer
	err := p.PipeClientToServer(strings.NewReader(clientInput), &serverOutput)
	if err != nil {
		t.Fatalf("unexpected error piping client to server: %v", err)
	}

	if mb.Count() != 2 {
		t.Fatalf("expected 2 broadcast events for 2 valid methods, got %d", mb.Count())
	}

	// 2. Test response from server to client
	time.Sleep(10 * time.Millisecond) // small delay to test latency tracking
	serverInput := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"found items"}]}}`,
		`{"jsonrpc":"2.0","id":2,"result":{"serverInfo":{"name":"test-server"}}}`,
		`{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"Method not found"}}`,
	}, "\n")

	var clientOutput bytes.Buffer
	err = p.PipeServerToClient(strings.NewReader(serverInput), &clientOutput)
	if err != nil {
		t.Fatalf("unexpected error piping server to client: %v", err)
	}

	if mb.Count() != 5 { // 2 calls + 3 responses
		t.Fatalf("expected 5 total broadcast events, got %d", mb.Count())
	}
}

func TestMCPProxy_NilBroadcasterAndEmptySession(t *testing.T) {
	p := mcpproxy.New(nil, "")

	var out bytes.Buffer
	in := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}` + "\n")
	err := p.PipeClientToServer(in, &out)
	if err != nil {
		t.Fatalf("expected no error with nil broadcaster, got %v", err)
	}

	var clientOut bytes.Buffer
	respIn := strings.NewReader(`{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}` + "\n")
	err = p.PipeServerToClient(respIn, &clientOut)
	if err != nil {
		t.Fatalf("expected no error on response with nil broadcaster, got %v", err)
	}
}
