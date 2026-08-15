package tailer_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/tailer"
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

func TestTailer_ParseLine(t *testing.T) {
	mb := &mockBroadcaster{}
	tail := tailer.New(mb, "sess-test")

	tests := []struct {
		name         string
		line         string
		expectNil    bool
		expectedType events.Type
	}{
		{
			name:      "empty string",
			line:      "   \n",
			expectNil: true,
		},
		{
			name:         "plain text string as think event",
			line:         "Analyzing codebase dependencies...",
			expectNil:    false,
			expectedType: events.TypeAgentThink,
		},
		{
			name:         "valid json event format",
			line:         `{"id":"evt-1","type":"file.write","title":"Updating auth.go","station":"cnc_lathe","agentRole":"crafter"}`,
			expectNil:    false,
			expectedType: events.TypeFileWrite,
		},
		{
			name:      "json without type field",
			line:      `{"status":"ok","count":42}`,
			expectNil: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := tail.ParseLine(tc.line)
			if tc.expectNil && res != nil {
				t.Fatalf("expected nil result, got %+v", res)
			}
			if !tc.expectNil {
				if res == nil {
					t.Fatalf("expected non-nil event, got nil")
				}
				if res.Type != tc.expectedType {
					t.Errorf("expected type %v, got %v", tc.expectedType, res.Type)
				}
			}
		})
	}
}

func TestTailer_TailReaderAndContextCancel(t *testing.T) {
	mb := &mockBroadcaster{}
	tail := tailer.New(mb, "sess-reader")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	input := strings.Join([]string{
		`{"id":"e1","type":"agent.spawn","title":"Worker spawned"}`,
		`{"id":"e2","type":"tool.call","title":"Search files"}`,
	}, "\n")

	err := tail.TailReader(ctx, strings.NewReader(input))
	if err != nil {
		t.Fatalf("unexpected error reading stream: %v", err)
	}

	if mb.Count() != 2 {
		t.Fatalf("expected 2 broadcasted events, got %d", mb.Count())
	}
}

func TestTailer_TailFile(t *testing.T) {
	tmpDir := t.TempDir()
	logFile := filepath.Join(tmpDir, "session.jsonl")

	if err := os.WriteFile(logFile, []byte(""), 0o600); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	mb := &mockBroadcaster{}
	tail := tailer.New(mb, "sess-file")

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = tail.TailFile(ctx, logFile)
	}()

	// Append lines
	time.Sleep(50 * time.Millisecond)
	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("failed to open file for append: %v", err)
	}
	_, _ = f.WriteString(`{"id":"e-appended","type":"file.read","title":"Reading main.go"}` + "\n")
	_ = f.Close()

	time.Sleep(150 * time.Millisecond)
	cancel()
	wg.Wait()

	if mb.Count() < 1 {
		t.Errorf("expected at least 1 event parsed from appended file, got %d", mb.Count())
	}
}
