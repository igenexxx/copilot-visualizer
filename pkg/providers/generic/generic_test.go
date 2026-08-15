package generic_test

import (
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers/generic"
)

func TestGeneric_BasicProperties(t *testing.T) {
	p := generic.New()

	if p.ID() != "generic" || p.Name() != "Generic JSONLines Telemetry" || p.Source() != "generic" {
		t.Errorf("unexpected properties: %s / %s / %s", p.ID(), p.Name(), p.Source())
	}

	patterns := p.DefaultGlobPatterns("/home/user")
	if len(patterns) != 1 {
		t.Errorf("expected 1 pattern, got %d", len(patterns))
	}

	if !p.MatchesPath("/var/log/events.jsonl") || !p.MatchesPath("/var/log/trace.json") {
		t.Errorf("expected match for json/jsonl paths")
	}

	if id := p.ExtractSessionID("/var/log/custom-sess.jsonl"); id != "custom-sess" {
		t.Errorf("expected custom-sess, got %q", id)
	}
}

func TestGeneric_Parsing(t *testing.T) {
	p := generic.New()

	// 1. Standard Event json
	evtLine := `{"type":"file.write","title":"Updating Go module","agentId":"agent-1"}`
	evts := p.ParseLine(evtLine, "g-sess")
	if len(evts) != 1 || evts[0].Type != events.TypeFileWrite {
		t.Fatalf("expected valid parsed event: %+v", evts)
	}

	// 2. Generic map with message
	rawLine := `{"message":"Health check OK","status":200}`
	evts = p.ParseLine(rawLine, "g-sess")
	if len(evts) != 1 || evts[0].Title != "Health check OK" {
		t.Fatalf("expected fallback title 'Health check OK', got %+v", evts)
	}

	// 3. Generic map without message
	emptyTitleLine := `{"foo":"bar"}`
	evts = p.ParseLine(emptyTitleLine, "g-sess")
	if len(evts) != 1 || evts[0].Title != "Generic Event" {
		t.Fatalf("expected fallback 'Generic Event', got %+v", evts)
	}
}

func TestGeneric_AdversarialInputs(t *testing.T) {
	p := generic.New()

	if evts := p.ParseLine("", "s1"); evts != nil {
		t.Errorf("expected nil for empty line")
	}
	if evts := p.ParseLine("{bad json", "s1"); evts != nil {
		t.Errorf("expected nil for bad json")
	}
}
