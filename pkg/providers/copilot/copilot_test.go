package copilot_test

import (
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers/copilot"
)

func TestCopilot_BasicProperties(t *testing.T) {
	p := copilot.New()

	if p.ID() != "copilot_cli" || p.Name() != "GitHub Copilot CLI" || p.Source() != "copilot_cli" {
		t.Errorf("unexpected properties: %s / %s / %s", p.ID(), p.Name(), p.Source())
	}

	patterns := p.DefaultGlobPatterns("/home/user")
	if len(patterns) < 3 {
		t.Errorf("expected at least 3 default glob patterns, got %d", len(patterns))
	}

	// Test path matching
	matchTests := []struct {
		name     string
		path     string
		expected bool
	}{
		{"copilot session state jsonl", "/home/user/.copilot/session-state/d468159a-4ebc-4f53-b8fa-546d673d70ee/events.jsonl", true},
		{"copilot legacy flat jsonl", "/home/user/.copilot/session-state/sess-1.jsonl", true},
		{"config github-copilot", "/home/user/.config/github-copilot/logs/copilot.jsonl", true},
		{"antigravity logs", "/home/user/.gemini/antigravity/logs/transcript.jsonl", false},
		{"claude code transcripts", "/home/user/.claude/transcripts/sess.jsonl", false},
	}

	for _, tt := range matchTests {
		t.Run(tt.name, func(t *testing.T) {
			got := p.MatchesPath(tt.path)
			if got != tt.expected {
				t.Errorf("MatchesPath(%q) = %v, want %v", tt.path, got, tt.expected)
			}
		})
	}

	// Test session ID extraction
	idTests := []struct {
		name     string
		path     string
		expected string
	}{
		{
			name:     "subdirectory session-state with uuid",
			path:     "/home/user/.copilot/session-state/d468159a-4ebc-4f53-b8fa-546d673d70ee/events.jsonl",
			expected: "d468159a-4ebc-4f53-b8fa-546d673d70ee",
		},
		{
			name:     "flat session file",
			path:     "/home/user/.copilot/session-state/sess-alpha.jsonl",
			expected: "sess-alpha",
		},
		{
			name:     "logs directory session",
			path:     "/home/user/.config/github-copilot/logs/session-123.jsonl",
			expected: "session-123",
		},
	}

	for _, tt := range idTests {
		t.Run(tt.name, func(t *testing.T) {
			got := p.ExtractSessionID(tt.path)
			if got != tt.expected {
				t.Errorf("ExtractSessionID(%q) = %q, want %q", tt.path, got, tt.expected)
			}
		})
	}
}

func TestCopilot_StructuredEvents(t *testing.T) {
	p := copilot.New()

	tests := []struct {
		name          string
		line          string
		expectedCount int
		expectedType  events.Type
		expectedRole  events.AgentRole
		expectedModel string
	}{
		{
			name:          "session.start event",
			line:          `{"type":"session.start","data":{"sessionId":"sess-101","producer":"copilot-agent","model":"gpt-5.6-terra"}}`,
			expectedCount: 1,
			expectedType:  events.TypeSessionStart,
			expectedRole:  events.RoleForeman,
			expectedModel: "gpt-5",
		},
		{
			name:          "session.model_change event",
			line:          `{"type":"session.model_change","data":{"newModel":"o3-mini"}}`,
			expectedCount: 0,
		},
		{
			name:          "user.message prompt event",
			line:          `{"type":"user.message","data":{"content":"Refactor parser package"}}`,
			expectedCount: 1,
			expectedType:  events.TypeInterventionPrompt,
			expectedRole:  events.RoleForeman,
			expectedModel: "o3-mini",
		},
		{
			name:          "assistant.message reasoning and text",
			line:          `{"type":"assistant.message","data":{"reasoningText":"Thinking through steps","content":"Here is the plan"}}`,
			expectedCount: 2,
			expectedType:  events.TypeAgentThink,
			expectedRole:  events.RoleForeman,
			expectedModel: "o3-mini",
		},
		{
			name:          "tool.execution_start bash",
			line:          `{"type":"tool.execution_start","data":{"toolName":"bash","arguments":{"command":"go test ./..."}}}`,
			expectedCount: 1,
			expectedType:  events.TypeCommandRun,
			expectedRole:  events.RoleTester,
			expectedModel: "o3-mini",
		},
		{
			name:          "tool.execution_start glob read",
			line:          `{"type":"tool.execution_start","data":{"toolName":"glob","arguments":{"pattern":"*.go","paths":"/tmp"}}}`,
			expectedCount: 1,
			expectedType:  events.TypeFileRead,
			expectedRole:  events.RoleInspector,
			expectedModel: "o3-mini",
		},
		{
			name:          "tool.execution_start edit write",
			line:          `{"type":"tool.execution_start","data":{"toolName":"edit","arguments":{"path":"/pkg/main.go"}}}`,
			expectedCount: 1,
			expectedType:  events.TypeFileWrite,
			expectedRole:  events.RoleCrafter,
			expectedModel: "o3-mini",
		},
		{
			name:          "tool.execution_complete output",
			line:          `{"type":"tool.execution_complete","data":{"success":true,"result":{"content":"PASS: 12 tests passed"}}}`,
			expectedCount: 1,
			expectedType:  events.TypeCommandOutput,
			expectedRole:  events.RoleTester,
			expectedModel: "o3-mini",
		},
		{
			name:          "permission.requested checkpoint",
			line:          `{"type":"permission.requested","data":{"permissionRequest":{"intention":"Run tests"}}}`,
			expectedCount: 1,
			expectedType:  events.TypeCheckpointRequest,
			expectedRole:  events.RoleInspector,
			expectedModel: "o3-mini",
		},
		{
			name:          "permission.completed decision",
			line:          `{"type":"permission.completed","data":{"result":{"kind":"approved"}}}`,
			expectedCount: 1,
			expectedType:  events.TypeCheckpointDecision,
			expectedRole:  events.RoleInspector,
			expectedModel: "o3-mini",
		},
		{
			name:          "session.usage_checkpoint telemetry",
			line:          `{"type":"session.usage_checkpoint","data":{"totalNanoAiu":27353260000}}`,
			expectedCount: 1,
			expectedType:  events.TypeAgentThink,
			expectedRole:  events.RoleForeman,
			expectedModel: "o3-mini",
		},
		{
			name:          "session.shutdown",
			line:          `{"type":"session.shutdown","data":{}}`,
			expectedCount: 1,
			expectedType:  events.TypeSessionEnd,
			expectedRole:  events.RoleForeman,
			expectedModel: "o3-mini",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			evts := p.ParseLine(tt.line, "sess-test")
			if len(evts) != tt.expectedCount {
				t.Fatalf("expected %d events, got %d", tt.expectedCount, len(evts))
			}
			if tt.expectedCount > 0 {
				first := evts[0]
				if first.Type != tt.expectedType {
					t.Errorf("expected type %v, got %v", tt.expectedType, first.Type)
				}
				if first.AgentRole != tt.expectedRole {
					t.Errorf("expected role %v, got %v", tt.expectedRole, first.AgentRole)
				}
				if first.Payload["detectedModel"] != tt.expectedModel {
					t.Errorf("expected model %v, got %v", tt.expectedModel, first.Payload["detectedModel"])
				}
			}
		})
	}
}

func TestCopilot_LegacyParsingAndModels(t *testing.T) {
	p := copilot.New()

	testLines := []struct {
		name          string
		line          string
		expectedCount int
		expectedModel string
	}{
		{
			name:          "mini prompt and command",
			line:          `{"model":"gpt-4o-mini","prompt":"How to fix build?","command":"npm test"}`,
			expectedCount: 2,
			expectedModel: "gpt-4o-mini",
		},
		{
			name:          "o3 file write",
			line:          `{"model":"o3-mini","file":"src/engine.ts"}`,
			expectedCount: 1,
			expectedModel: "o3-mini",
		},
		{
			name:          "gpt-4o triple events",
			line:          `{"model":"gpt-4o","prompt":"Explain architecture","command":"git log -n 5","file":"README.md"}`,
			expectedCount: 3,
			expectedModel: "gpt-4o",
		},
	}

	for _, tc := range testLines {
		t.Run(tc.name, func(t *testing.T) {
			evts := p.ParseLine(tc.line, "cpt-sess")
			if len(evts) != tc.expectedCount {
				t.Fatalf("expected %d events, got %d", tc.expectedCount, len(evts))
			}
			for _, evt := range evts {
				if evt.Payload["detectedModel"] != tc.expectedModel {
					t.Errorf("expected model %q, got %q", tc.expectedModel, evt.Payload["detectedModel"])
				}
				if evt.Type != events.TypeInterventionPrompt && evt.Type != events.TypeCommandRun && evt.Type != events.TypeFileWrite {
					t.Errorf("unexpected event type: %v", evt.Type)
				}
			}
		})
	}
}

func TestCopilot_AdversarialInputs(t *testing.T) {
	p := copilot.New()

	edgeCases := []struct {
		name string
		line string
	}{
		{"empty string", ""},
		{"whitespace only", "    \n\t  "},
		{"malformed json", "{bad json"},
		{"empty json object", "{}"},
		{"json array", "[]"},
		{"json number", "12345"},
		{"empty user message", `{"type":"user.message","data":{}}`},
		{"empty assistant message", `{"type":"assistant.message","data":{}}`},
		{"empty tool start", `{"type":"tool.execution_start","data":{}}`},
	}

	for _, ec := range edgeCases {
		t.Run(ec.name, func(t *testing.T) {
			evts := p.ParseLine(ec.line, "s1")
			if ec.name == "empty tool start" {
				if len(evts) != 1 {
					t.Errorf("expected 1 event for empty tool start fallback, got %d", len(evts))
				}
			} else {
				if len(evts) != 0 {
					t.Errorf("expected 0 events for %s, got %d", ec.name, len(evts))
				}
			}
		})
	}
}

func TestCopilot_FullLifecycleHistorySimulation(t *testing.T) {
	p := copilot.New()
	sessionID := "f6cc59be-7d6f-48c3-880a-7398dbbeac5a"

	historyLines := []string{
		`{"type":"session.start","data":{"sessionId":"f6cc59be-7d6f-48c3-880a-7398dbbeac5a","producer":"copilot-agent","model":"gpt-5.6-terra"}}`,
		`{"type":"user.message","data":{"content":"Please add vitest tests to the parser module and run them"}}`,
		`{"type":"assistant.message","data":{"reasoningText":"Let's inspect existing tests and run vitest"}}`,
		`{"type":"permission.requested","data":{"permissionRequest":{"intention":"execute bash command: npm test"}}}`,
		`{"type":"permission.completed","data":{"result":{"kind":"approved"}}}`,
		`{"type":"tool.execution_start","data":{"toolName":"bash","arguments":{"command":"npm test"}}}`,
		`{"type":"tool.execution_complete","data":{"success":true,"result":{"content":"PASS src/parser.test.ts\n5 tests passed"}}}`,
		`{"type":"tool.execution_start","data":{"toolName":"edit","arguments":{"path":"src/parser.ts"}}}`,
		`{"type":"session.usage_checkpoint","data":{"totalNanoAiu":27353260000}}`,
		`{"type":"session.shutdown","data":{}}`,
	}

	var allEvents []*events.Event
	for _, line := range historyLines {
		evts := p.ParseLine(line, sessionID)
		allEvents = append(allEvents, evts...)
	}

	if len(allEvents) < 9 {
		t.Fatalf("expected at least 9 parsed events from lifecycle, got %d", len(allEvents))
	}

	// Verify stations coverage
	stationsSeen := make(map[events.StationType]bool)
	typesSeen := make(map[events.Type]bool)
	for _, evt := range allEvents {
		stationsSeen[evt.Station] = true
		typesSeen[evt.Type] = true
		if evt.SessionID != sessionID {
			t.Errorf("expected sessionID %q, got %q", sessionID, evt.SessionID)
		}
	}

	expectedStations := []events.StationType{
		events.StationForemanDesk,
		events.StationSecurityGate,
		events.StationTestFurnace,
		events.StationCNCLathe,
	}
	for _, s := range expectedStations {
		if !stationsSeen[s] {
			t.Errorf("expected station %s to be activated during Copilot lifecycle", s)
		}
	}

	expectedTypes := []events.Type{
		events.TypeSessionStart,
		events.TypeInterventionPrompt,
		events.TypeAgentThink,
		events.TypeCheckpointRequest,
		events.TypeCheckpointDecision,
		events.TypeCommandRun,
		events.TypeCommandOutput,
		events.TypeFileWrite,
		events.TypeSessionEnd,
	}
	for _, typ := range expectedTypes {
		if !typesSeen[typ] {
			t.Errorf("expected event type %s to be generated during Copilot lifecycle", typ)
		}
	}
}
