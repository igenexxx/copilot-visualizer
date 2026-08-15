package claude_test

import (
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers/claude"
)

func TestClaude_BasicProperties(t *testing.T) {
	p := claude.New()

	if p.ID() != "claude_code" || p.Name() != "Claude Code (Anthropic)" || p.Source() != "claude_code" {
		t.Errorf("unexpected properties: %s / %s / %s", p.ID(), p.Name(), p.Source())
	}

	patterns := p.DefaultGlobPatterns("/home/user")
	if len(patterns) != 3 {
		t.Errorf("expected 3 default glob patterns, got %d", len(patterns))
	}

	if !p.MatchesPath("/home/user/.claude/projects/my-project/logs/trace.jsonl") {
		t.Errorf("expected match for claude path")
	}
	if p.MatchesPath("/home/user/.gemini/antigravity/logs/transcript.jsonl") {
		t.Errorf("expected no match for antigravity path")
	}

	id := p.ExtractSessionID("/home/user/.claude/sessions/session-42.jsonl")
	if id != "session-42" {
		t.Errorf("expected session-42, got %q", id)
	}
}

func TestClaude_ToolsAndModels(t *testing.T) {
	p := claude.New()

	testLines := []struct {
		line            string
		expectedType    events.Type
		expectedStation events.StationType
		expectedModel   string
	}{
		{
			line:            `{"model":"claude-3-7-sonnet","tool_use":{"name":"Read","input":{"file_path":"/src/main.rs"}}}`,
			expectedType:    events.TypeFileRead,
			expectedStation: events.StationFilingVault,
			expectedModel:   "claude-3-7-sonnet",
		},
		{
			line:            `{"model":"claude-3-5-haiku","tool_use":{"name":"Edit","input":{"file_path":"/src/lib.rs"}}}`,
			expectedType:    events.TypeFileWrite,
			expectedStation: events.StationCNCLathe,
			expectedModel:   "claude-3-5-haiku",
		},
		{
			line:            `{"model":"claude-3-5-sonnet","tool_use":{"name":"Grep","input":{"pattern":"Router"}}}`,
			expectedType:    events.TypeToolCall,
			expectedStation: events.StationSearchRadar,
			expectedModel:   "claude-3-5-sonnet",
		},
		{
			line:            `{"tool_use":{"name":"Bash","input":{"command":"cargo build"}}}`,
			expectedType:    events.TypeCommandRun,
			expectedStation: events.StationTestFurnace,
			expectedModel:   "claude-3-5-sonnet",
		},
	}

	for idx, tc := range testLines {
		evts := p.ParseLine(tc.line, "claude-sess")
		if len(evts) != 1 {
			t.Fatalf("case %d: expected 1 event, got %d", idx, len(evts))
		}
		if evts[0].Type != tc.expectedType || evts[0].Station != tc.expectedStation {
			t.Errorf("case %d: unexpected type/station: %v / %v", idx, evts[0].Type, evts[0].Station)
		}
		if evts[0].Payload["detectedModel"] != tc.expectedModel {
			t.Errorf("case %d: expected model %q, got %q", idx, tc.expectedModel, evts[0].Payload["detectedModel"])
		}
	}
}

func TestClaude_AdversarialInputs(t *testing.T) {
	p := claude.New()

	if evts := p.ParseLine("", "s1"); evts != nil {
		t.Errorf("expected nil on empty line")
	}
	if evts := p.ParseLine("{bad json", "s1"); evts != nil {
		t.Errorf("expected nil on malformed json")
	}

	line := `{"thinking":"Evaluating solution for recursive directory search","tool_use":{"name":"custom_tool","input":null}}`
	evts := p.ParseLine(line, "s1")
	if len(evts) != 2 {
		t.Fatalf("expected 2 events, got %d", len(evts))
	}
}
