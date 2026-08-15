package antigravity_test

import (
	"strings"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers/antigravity"
)

func TestAntigravity_BasicProperties(t *testing.T) {
	p := antigravity.New()

	if p.ID() != "antigravity" {
		t.Errorf("expected ID antigravity, got %q", p.ID())
	}
	if p.Name() != "Google Antigravity" {
		t.Errorf("expected Name Google Antigravity, got %q", p.Name())
	}
	if p.Source() != "antigravity" {
		t.Errorf("expected Source antigravity, got %q", p.Source())
	}

	patterns := p.DefaultGlobPatterns("/home/test")
	if len(patterns) != 2 {
		t.Errorf("expected 2 default glob patterns, got %d", len(patterns))
	}

	if !p.MatchesPath("/home/test/.gemini/antigravity-cli/brain/abc/logs/transcript.jsonl") {
		t.Errorf("expected match for antigravity path")
	}
	if p.MatchesPath("/home/test/.claude/logs/session.jsonl") {
		t.Errorf("expected no match for claude path")
	}

	id := p.ExtractSessionID("/home/test/.gemini/antigravity-cli/brain/sess-999/.system_generated/logs/transcript.jsonl")
	if id != "sess-999" {
		t.Errorf("expected sess-999, got %q", id)
	}

	idFallback := p.ExtractSessionID("/tmp/logs/direct.jsonl")
	if idFallback != "logs" {
		t.Errorf("expected fallback dir logs, got %q", idFallback)
	}
}

func TestAntigravity_ModelDetectionMatrix(t *testing.T) {
	testCases := []struct {
		modelContent string
		expected     string
	}{
		{"<USER_SETTINGS_CHANGE>Model Selection from None to Gemini 3.7 Flash (Medium)</USER_SETTINGS_CHANGE>", "gemini-3.7-flash"},
		{"<USER_SETTINGS_CHANGE>Model Selection from None to Gemini 3.7 Pro (Deep Reasoning)</USER_SETTINGS_CHANGE>", "gemini-3.7-pro"},
		{"<USER_SETTINGS_CHANGE>Model Selection to Gemini 2.5 Flash</USER_SETTINGS_CHANGE>", "gemini-2.5-flash"},
		{"<USER_SETTINGS_CHANGE>Model Selection to Gemini 2.5 Pro</USER_SETTINGS_CHANGE>", "gemini-2.5-pro"},
		{"Setting to Claude 3.7 Sonnet", "claude-3-7-sonnet"},
		{"Setting to Claude 3.5 Sonnet", "claude-3-5-sonnet"},
		{"Setting to Claude 3.5 Haiku", "claude-3-5-haiku"},
		{"Setting to GPT-4o-mini", "gpt-4o-mini"},
		{"Setting to GPT-4o", "gpt-4o"},
		{"Setting to OpenAI o3-mini", "o3-mini"},
	}

	for _, tc := range testCases {
		t.Run(tc.expected, func(t *testing.T) {
			p := antigravity.New()
			line := `{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","content":` + `"` + strings.ReplaceAll(tc.modelContent, `"`, `\"`) + `"}`
			_ = p.ParseLine(line, "sess-1")

			thinkLine := `{"step_index":1,"thinking":"Analyzing requirements"}`
			evts := p.ParseLine(thinkLine, "sess-1")
			if len(evts) != 1 {
				t.Fatalf("expected 1 think event, got %d", len(evts))
			}
			if evts[0].Payload["detectedModel"] != tc.expected {
				t.Errorf("expected model %q, got %q", tc.expected, evts[0].Payload["detectedModel"])
			}
		})
	}
}

func TestAntigravity_AllToolTypes(t *testing.T) {
	p := antigravity.New()

	toolsLine := `{"step_index":3,"tool_calls":[
		{"name":"list_dir","args":{"DirectoryPath":"/home/user/project"}},
		{"name":"view_file","args":{"AbsolutePath":"/home/user/project/main.go"}},
		{"name":"grep_search","args":{"Query":"InitHub"}},
		{"name":"replace_file_content","args":{"TargetFile":"/home/user/project/hub.go"}},
		{"name":"run_command","args":{"CommandLine":"go test -v"}},
		{"name":"call_mcp_tool","args":{"ServerName":"stitch","ToolName":"get_project"}},
		{"name":"invoke_subagent","args":{"Subagents":[{"Role":"Codebase Researcher","Model":"flash"}]}},
		{"name":"unknown_custom_tool","args":{"foo":"bar"}}
	]}`

	evts := p.ParseLine(toolsLine, "sess-test")
	if len(evts) != 8 {
		t.Fatalf("expected 8 events, got %d", len(evts))
	}

	expectedStations := []events.StationType{
		events.StationFilingVault,
		events.StationFilingVault,
		events.StationSearchRadar,
		events.StationCNCLathe,
		events.StationTestFurnace,
		events.StationPhoneBooth,
		events.StationForemanDesk,
		events.StationForemanDesk,
	}

	for idx, exp := range expectedStations {
		if evts[idx].Station != exp {
			t.Errorf("tool %d: expected station %v, got %v", idx, exp, evts[idx].Station)
		}
	}
}

func TestAntigravity_AdversarialInputs(t *testing.T) {
	p := antigravity.New()

	// Empty line
	if evts := p.ParseLine("", "s1"); evts != nil {
		t.Errorf("expected nil for empty line, got %+v", evts)
	}

	// Corrupted line
	if evts := p.ParseLine("{corrupted json", "s1"); evts != nil {
		t.Errorf("expected nil for corrupted json, got %+v", evts)
	}

	// Line with null args
	nullArgsLine := `{"step_index":1,"thinking":"Long thinking line that exceeds 160 characters to verify trimming behavior and ellipsis insertion when summary is long","tool_calls":[{"name":"write_to_file","args":null}]}`
	evts := p.ParseLine(nullArgsLine, "s1")
	if len(evts) != 2 {
		t.Fatalf("expected 2 events, got %d", len(evts))
	}
	if len(evts[0].Summary) > 160 {
		t.Errorf("expected summary trimmed to <=160, got %d chars", len(evts[0].Summary))
	}
}
