package providers_test

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers"
	"github.com/zhenya/copilot-visualizer/pkg/providers/antigravity"
	"github.com/zhenya/copilot-visualizer/pkg/providers/claude"
	"github.com/zhenya/copilot-visualizer/pkg/providers/copilot"
	"github.com/zhenya/copilot-visualizer/pkg/providers/generic"
)

func TestRegistry_RegisterAndRetrieve(t *testing.T) {
	reg := providers.NewRegistry()

	if len(reg.All()) != 0 {
		t.Fatalf("expected empty registry, got %d", len(reg.All()))
	}

	ant := antigravity.New()
	cld := claude.New()
	cpt := copilot.New()
	gen := generic.New()

	reg.Register(ant)
	reg.Register(cld)
	reg.Register(cpt)
	reg.Register(gen)
	reg.Register(nil) // nil safe

	if len(reg.All()) != 4 {
		t.Fatalf("expected 4 providers registered, got %d", len(reg.All()))
	}

	// Verify lookup
	p, ok := reg.Get("antigravity")
	if !ok || p == nil || p.ID() != "antigravity" {
		t.Errorf("failed to retrieve antigravity provider: %+v", p)
	}

	_, ok = reg.Get("non-existent")
	if ok {
		t.Errorf("expected not found for unknown provider")
	}
}

func TestRegistry_FindProviderForPath(t *testing.T) {
	reg := providers.NewRegistry()
	reg.Register(antigravity.New())
	reg.Register(claude.New())
	reg.Register(copilot.New())
	reg.Register(generic.New())

	testCases := []struct {
		name       string
		path       string
		expectedID string
	}{
		{
			name:       "Antigravity transcript path",
			path:       "/home/user/.gemini/antigravity-cli/brain/abc-123/.system_generated/logs/transcript.jsonl",
			expectedID: "antigravity",
		},
		{
			name:       "Claude Code session path",
			path:       "/home/user/.claude/projects/proj-1/logs/session.jsonl",
			expectedID: "claude_code",
		},
		{
			name:       "Copilot CLI session path",
			path:       "/home/user/.copilot/session-state/sess-99.jsonl",
			expectedID: "copilot_cli",
		},
		{
			name:       "Generic fallback jsonl path",
			path:       "/tmp/custom-logs/events.jsonl",
			expectedID: "generic",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			p := reg.FindProviderForPath(tc.path)
			if p == nil {
				t.Fatalf("expected provider for %s, got nil", tc.path)
			}
			if p.ID() != tc.expectedID {
				t.Errorf("expected provider %q, got %q", tc.expectedID, p.ID())
			}
		})
	}
}

func TestRegistry_CollectAllPatterns(t *testing.T) {
	reg := providers.NewRegistry()
	reg.Register(antigravity.New())
	reg.Register(claude.New())
	reg.Register(copilot.New())

	patterns := reg.CollectAllPatterns("/home/user")
	if len(patterns) < 3 {
		t.Errorf("expected multiple glob patterns, got %d", len(patterns))
	}
	foundAnt := false
	for _, pat := range patterns {
		if strings.Contains(pat, "antigravity") {
			foundAnt = true
			break
		}
	}
	if !foundAnt {
		t.Errorf("expected Antigravity pattern in collected list")
	}
}

func TestAntigravityProvider_ParsingAndModels(t *testing.T) {
	p := antigravity.New()

	// Session ID extraction
	sessPath := "/home/user/.gemini/antigravity-cli/brain/sess-uuid-777/.system_generated/logs/transcript.jsonl"
	sessID := p.ExtractSessionID(sessPath)
	if sessID != "sess-uuid-777" {
		t.Errorf("expected session ID sess-uuid-777, got %q", sessID)
	}

	// 1. Model detection line
	modelLine := `{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","content":"<USER_SETTINGS_CHANGE>\nThe user changed setting Model Selection from None to Gemini 3.7 Flash (Medium).\n</USER_SETTINGS_CHANGE>"}`
	_ = p.ParseLine(modelLine, "sess-1")

	// 2. Planning with thinking and multiple tool calls
	planLine := `{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","thinking":"Refactoring Go codebase for modular architecture","tool_calls":[{"name":"replace_file_content","args":{"TargetFile":"/pkg/providers/provider.go"}},{"name":"view_file","args":{"AbsolutePath":"/pkg/hub/hub.go"}},{"name":"run_command","args":{"CommandLine":"task test"}},{"name":"call_mcp_tool","args":{"ServerName":"git","ToolName":"commit"}},{"name":"invoke_subagent","args":{"Subagents":[{"Role":"Research Assistant","Model":"flash"}]}}]}`

	evts := p.ParseLine(planLine, "sess-1")
	if len(evts) != 6 { // 1 think + 5 tool calls
		t.Fatalf("expected 6 events, got %d", len(evts))
	}

	// Think event
	if evts[0].Type != events.TypeAgentThink || evts[0].Station != events.StationForemanDesk {
		t.Errorf("unexpected think event: %+v", evts[0])
	}
	if evts[0].Payload["detectedModel"] != "gemini-3.7-flash" {
		t.Errorf("expected detectedModel gemini-3.7-flash, got %v", evts[0].Payload["detectedModel"])
	}

	// File write (CNC Lathe)
	if evts[1].Type != events.TypeFileWrite || evts[1].Station != events.StationCNCLathe {
		t.Errorf("unexpected file write event: %+v", evts[1])
	}

	// File read (Filing Vault)
	if evts[2].Type != events.TypeFileRead || evts[2].Station != events.StationFilingVault {
		t.Errorf("unexpected file read event: %+v", evts[2])
	}

	// Command run (Test Furnace)
	if evts[3].Type != events.TypeCommandRun || evts[3].Station != events.StationTestFurnace {
		t.Errorf("unexpected command run event: %+v", evts[3])
	}

	// MCP tool call (Phone Booth)
	if evts[4].Type != events.TypeMCPCall || evts[4].Station != events.StationPhoneBooth {
		t.Errorf("unexpected mcp call event: %+v", evts[4])
	}

	// Subagent delegation
	if evts[5].Type != events.TypeSubagentDelegate {
		t.Errorf("unexpected subagent delegate event: %+v", evts[5])
	}
}

func TestClaudeProvider_ParsingAndTools(t *testing.T) {
	p := claude.New()

	if p.ID() != "claude_code" || p.Source() != "claude_code" {
		t.Errorf("unexpected id/source: %s/%s", p.ID(), p.Source())
	}

	// Session ID
	if id := p.ExtractSessionID("/home/.claude/sessions/session-42.jsonl"); id != "session-42" {
		t.Errorf("unexpected session id: %q", id)
	}

	// Model & tool execution
	line := `{"model":"claude-3-7-sonnet-20250219","thinking":"Running test suite","tool_use":{"name":"Bash","input":{"command":"go test ./..."}}}`
	evts := p.ParseLine(line, "claude-sess")
	if len(evts) != 2 {
		t.Fatalf("expected 2 events (think + tool), got %d", len(evts))
	}

	if evts[0].Type != events.TypeAgentThink || evts[0].Payload["detectedModel"] != "claude-3-7-sonnet" {
		t.Errorf("unexpected claude think event: %+v", evts[0])
	}

	if evts[1].Type != events.TypeCommandRun || evts[1].Station != events.StationTestFurnace {
		t.Errorf("unexpected bash tool event: %+v", evts[1])
	}
}

func TestCopilotProvider_ParsingAndPrompts(t *testing.T) {
	p := copilot.New()

	if p.ID() != "copilot_cli" || p.Source() != "copilot_cli" {
		t.Errorf("unexpected id/source: %s/%s", p.ID(), p.Source())
	}

	line := `{"model":"gpt-4o","prompt":"Explain auth middleware","command":"git status","file":"pkg/auth/auth.go"}`
	evts := p.ParseLine(line, "copilot-sess")
	if len(evts) != 3 { // prompt + command + file
		t.Fatalf("expected 3 events, got %d", len(evts))
	}

	if evts[0].Type != events.TypeInterventionPrompt {
		t.Errorf("expected prompt event, got %+v", evts[0])
	}
	if evts[1].Type != events.TypeCommandRun {
		t.Errorf("expected command event, got %+v", evts[1])
	}
	if evts[2].Type != events.TypeFileWrite {
		t.Errorf("expected file event, got %+v", evts[2])
	}
}

func TestGenericProvider_Parsing(t *testing.T) {
	p := generic.New()

	// 1. Full visualizer Event JSON
	evtJSON := `{"id":"evt-1","sessionId":"s1","timestamp":1700000000000,"type":"file.write","agentId":"a1","title":"Writing Code"}`
	evts := p.ParseLine(evtJSON, "s1")
	if len(evts) != 1 || evts[0].Type != events.TypeFileWrite {
		t.Fatalf("expected valid parsed event, got %+v", evts)
	}

	// 2. Arbitrary log map
	rawJSON := `{"message":"Database connection initialized","level":"info"}`
	evts = p.ParseLine(rawJSON, "s1")
	if len(evts) != 1 || evts[0].Title != "Database connection initialized" {
		t.Fatalf("expected fallback generic event, got %+v", evts)
	}
}

func TestProviders_AdversarialInputs(t *testing.T) {
	allProviders := []providers.Provider{
		antigravity.New(),
		claude.New(),
		copilot.New(),
		generic.New(),
	}

	adversarialLines := []string{
		"",
		"   ",
		"\n\t\r",
		"{",
		"}",
		"{invalid json content 123",
		`{"step_index": -999, "tool_calls": null}`,
		`{"step_index": 0, "tool_calls": [{"name": "", "args": null}]}`,
		`{"model": 12345, "thinking": null, "tool_use": []}`,
		"\x00\x01\x02\xff\xfe",
	}

	for _, p := range allProviders {
		t.Run(p.Name(), func(t *testing.T) {
			for _, line := range adversarialLines {
				// Must never panic or crash
				res := p.ParseLine(line, "adv-sess")
				_ = res
			}

			// CleanPath check
			if res := providers.CleanPath("   /path/to/file//log.jsonl  "); res != filepath.Clean("/path/to/file/log.jsonl") {
				t.Errorf("CleanPath mismatch: %q", res)
			}
		})
	}
}

func TestProviders_Concurrency(t *testing.T) {
	reg := providers.NewRegistry()
	reg.Register(antigravity.New())
	reg.Register(claude.New())
	reg.Register(copilot.New())
	reg.Register(generic.New())

	var wg sync.WaitGroup
	line := `{"step_index":1,"thinking":"concurrent thinking","tool_calls":[{"name":"view_file","args":{"AbsolutePath":"/a.go"}}]}`

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			p := reg.FindProviderForPath("/home/.gemini/antigravity-cli/brain/abc/logs/transcript.jsonl")
			if p != nil {
				_ = p.ParseLine(line, "conc-sess")
			}
			_ = reg.All()
			_ = reg.CollectAllPatterns("/home/user")
		}(i)
	}

	wg.Wait()
}
