package copilot

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers"
)

// Provider implements providers.Provider for GitHub Copilot CLI.
type Provider struct {
	mu          sync.RWMutex
	activeModel string
}

// New creates a new GitHub Copilot CLI provider instance.
func New() *Provider {
	return &Provider{
		activeModel: "gpt-4o",
	}
}

func (p *Provider) ID() string {
	return "copilot_cli"
}

func (p *Provider) Name() string {
	return "GitHub Copilot CLI"
}

func (p *Provider) Source() string {
	return "copilot_cli"
}

func (p *Provider) DefaultGlobPatterns(homeDir string) []string {
	return []string{
		filepath.Join(homeDir, ".copilot", "session-state", "*.jsonl"),
		filepath.Join(homeDir, ".config", "github-copilot", "logs", "*.jsonl"),
		filepath.Join(homeDir, ".github-copilot", "*.jsonl"),
	}
}

func (p *Provider) MatchesPath(path string) bool {
	norm := strings.ToLower(path)
	return strings.Contains(norm, "copilot") || strings.Contains(norm, "github-copilot")
}

func (p *Provider) ExtractSessionID(filePath string) string {
	base := filepath.Base(filePath)
	ext := filepath.Ext(base)
	clean := strings.TrimSuffix(base, ext)
	if clean != "" && clean != "." {
		return clean
	}
	return filepath.Base(filepath.Dir(filePath))
}

func (p *Provider) ParseLine(line string, sessionID string) []*events.Event {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return nil
	}

	p.mu.Lock()
	if m, ok := raw["model"].(string); ok && m != "" {
		lower := strings.ToLower(m)
		if strings.Contains(lower, "o3") || strings.Contains(lower, "o1") {
			p.activeModel = "o3-mini"
		} else if strings.Contains(lower, "mini") {
			p.activeModel = "gpt-4o-mini"
		} else {
			p.activeModel = "gpt-4o"
		}
	}
	currentModel := p.activeModel
	p.mu.Unlock()

	var res []*events.Event
	now := time.Now().UnixNano()

	// 1. Prompt / Intent
	if prompt, ok := raw["prompt"].(string); ok && prompt != "" {
		preview := strings.Split(strings.TrimSpace(prompt), "\n")[0]
		if len(preview) > 60 {
			preview = preview[:58] + "…"
		}
		evt := events.NewEvent(fmt.Sprintf("copilot-prompt-%d", now), sessionID, events.TypeInterventionPrompt, "agent-copilot", preview).
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary(prompt).
			WithPayload("detectedSource", "copilot_cli").
			WithPayload("detectedModel", currentModel)
		res = append(res, evt)
	}

	// 2. Command / Execution
	if cmd, ok := raw["command"].(string); ok && cmd != "" {
		evt := events.NewEvent(fmt.Sprintf("copilot-cmd-%d", now), sessionID, events.TypeCommandRun, "agent-copilot", fmt.Sprintf("Copilot Exec: %s", cmd)).
			WithRole(events.RoleTester).
			WithStation(events.StationTestFurnace).
			WithSummary(cmd).
			WithPayload("command", cmd).
			WithPayload("detectedSource", "copilot_cli").
			WithPayload("detectedModel", currentModel)
		res = append(res, evt)
	}

	// 3. File Edit / Patch
	if file, ok := raw["file"].(string); ok && file != "" {
		evt := events.NewEvent(fmt.Sprintf("copilot-edit-%d", now), sessionID, events.TypeFileWrite, "agent-copilot", fmt.Sprintf("Copilot Edit: %s", filepath.Base(file))).
			WithRole(events.RoleCrafter).
			WithStation(events.StationCNCLathe).
			WithSummary(fmt.Sprintf("Editing %s", file)).
			WithPayload("file", file).
			WithPayload("detectedSource", "copilot_cli").
			WithPayload("detectedModel", currentModel)
		res = append(res, evt)
	}

	return res
}

func init() {
	providers.GlobalRegistry().Register(New())
}
