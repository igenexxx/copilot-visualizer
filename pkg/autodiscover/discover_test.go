package autodiscover_test

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/autodiscover"
	"github.com/zhenya/copilot-visualizer/pkg/events"
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

func TestParser_AntigravityParsing(t *testing.T) {
	parser := &autodiscover.AntigravityParser{}

	// 1. Line with thinking and tool calls
	sampleLine := `{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","thinking":"Examining directory structure\nNeed to find main.go","tool_calls":[{"name":"view_file","args":{"AbsolutePath":"/path/to/main.go"}},{"name":"replace_file_content","args":{"TargetFile":"/path/to/auth.go"}}]}`

	evts := parser.Parse(sampleLine, "sess-123")
	if len(evts) != 3 { // 1 think event + 2 tool call events
		t.Fatalf("expected 3 events, got %d", len(evts))
	}

	// Verify think event
	if evts[0].Type != events.TypeAgentThink || evts[0].Station != events.StationForemanDesk {
		t.Errorf("unexpected think event mapping: %+v", evts[0])
	}

	// Verify view_file mapping to Repo Shelves
	if evts[1].Type != events.TypeFileRead || evts[1].Station != events.StationRepoShelf {
		t.Errorf("unexpected view_file mapping: %+v", evts[1])
	}

	// Verify replace_file_content mapping to CNC Lathe
	if evts[2].Type != events.TypeFileWrite || evts[2].Station != events.StationCNCLathe {
		t.Errorf("unexpected replace_file mapping: %+v", evts[2])
	}
}

func TestParser_AdversarialInputs(t *testing.T) {
	parser := &autodiscover.AntigravityParser{}

	// Empty string
	if res := parser.Parse("", "sess-1"); res != nil {
		t.Errorf("expected nil for empty string, got %+v", res)
	}

	// Malformed JSON
	if res := parser.Parse("{bad json", "sess-1"); res != nil {
		t.Errorf("expected nil for invalid json, got %+v", res)
	}

	// JSON with other tools
	line := `{"step_index":5,"tool_calls":[{"name":"grep_search","args":{"Query":"TokenValidator"}},{"name":"run_command","args":{"CommandLine":"go test"}},{"name":"call_mcp_tool","args":{"ServerName":"sec","ToolName":"scan"}},{"name":"invoke_subagent","args":{}}]}`
	evts := parser.Parse(line, "sess-1")
	if len(evts) != 4 {
		t.Fatalf("expected 4 events, got %d", len(evts))
	}
}

func TestEngine_AutoDiscoveryAndTailing(t *testing.T) {
	tmpDir := t.TempDir()
	logPath := filepath.Join(tmpDir, "transcript.jsonl")

	if err := os.WriteFile(logPath, []byte(""), 0o600); err != nil {
		t.Fatalf("failed to create log file: %v", err)
	}

	mb := &mockBroadcaster{}
	engine := autodiscover.NewEngineWithWatchPaths(mb, []string{logPath})
	engine.SetPollDelay(20 * time.Millisecond)

	sessions := engine.ScanSessions()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session discovered, got %d", len(sessions))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	engine.StartWatcher(ctx)

	// Repeated StartWatcher call should be a safe no-op
	engine.StartWatcher(ctx)

	// Append a line to the watched session file
	time.Sleep(50 * time.Millisecond)
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("failed to open file: %v", err)
	}
	_, _ = f.WriteString(`{"step_index":1,"thinking":"Working on auto-discover","tool_calls":[{"name":"write_to_file","args":{"TargetFile":"/app/main.go"}}]}` + "\n")
	_ = f.Close()

	time.Sleep(250 * time.Millisecond)
	engine.StopWatcher()

	if mb.Count() < 2 { // Auto-attached session announcement + think event + tool event
		t.Errorf("expected at least 2 events broadcasted, got %d", mb.Count())
	}
}

func TestEngine_DefaultConstructor(t *testing.T) {
	mb := &mockBroadcaster{}
	engine := autodiscover.NewEngine(mb, nil)
	// Scanning real paths should not panic
	_ = engine.ScanSessions()
}
