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
	if len(patterns) != 3 {
		t.Errorf("expected 3 default glob patterns, got %d", len(patterns))
	}

	if !p.MatchesPath("/home/user/.copilot/session-state/sess-1.jsonl") {
		t.Errorf("expected match for copilot path")
	}
	if p.MatchesPath("/home/user/.gemini/antigravity/logs/transcript.jsonl") {
		t.Errorf("expected no match for antigravity path")
	}

	id := p.ExtractSessionID("/home/user/.copilot/session-state/sess-alpha.jsonl")
	if id != "sess-alpha" {
		t.Errorf("expected sess-alpha, got %q", id)
	}
}

func TestCopilot_ParsingAndModels(t *testing.T) {
	p := copilot.New()

	testLines := []struct {
		line          string
		expectedCount int
		expectedModel string
	}{
		{
			line:          `{"model":"gpt-4o-mini","prompt":"How to fix build?","command":"npm test"}`,
			expectedCount: 2,
			expectedModel: "gpt-4o-mini",
		},
		{
			line:          `{"model":"o3-mini","file":"src/engine.ts"}`,
			expectedCount: 1,
			expectedModel: "o3-mini",
		},
		{
			line:          `{"model":"gpt-4o","prompt":"Explain architecture","command":"git log -n 5","file":"README.md"}`,
			expectedCount: 3,
			expectedModel: "gpt-4o",
		},
	}

	for idx, tc := range testLines {
		evts := p.ParseLine(tc.line, "cpt-sess")
		if len(evts) != tc.expectedCount {
			t.Fatalf("case %d: expected %d events, got %d", idx, tc.expectedCount, len(evts))
		}
		for _, evt := range evts {
			if evt.Payload["detectedModel"] != tc.expectedModel {
				t.Errorf("case %d: expected model %q, got %q", idx, tc.expectedModel, evt.Payload["detectedModel"])
			}
			if evt.Type != events.TypeInterventionPrompt && evt.Type != events.TypeCommandRun && evt.Type != events.TypeFileWrite {
				t.Errorf("case %d: unexpected event type: %v", idx, evt.Type)
			}
		}
	}
}

func TestCopilot_AdversarialInputs(t *testing.T) {
	p := copilot.New()

	if evts := p.ParseLine("", "s1"); evts != nil {
		t.Errorf("expected nil for empty line")
	}
	if evts := p.ParseLine("{bad json", "s1"); evts != nil {
		t.Errorf("expected nil for bad json")
	}
	if evts := p.ParseLine("{}", "s1"); len(evts) != 0 {
		t.Errorf("expected 0 events for empty json object")
	}
}
