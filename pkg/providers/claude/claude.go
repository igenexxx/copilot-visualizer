package claude

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

// Provider implements providers.Provider for Anthropic Claude Code.
type Provider struct {
	mu          sync.RWMutex
	activeModel string
}

// New creates a new Claude Code provider instance.
func New() *Provider {
	return &Provider{
		activeModel: "claude-3-7-sonnet",
	}
}

func (p *Provider) ID() string {
	return "claude_code"
}

func (p *Provider) Name() string {
	return "Claude Code (Anthropic)"
}

func (p *Provider) Source() string {
	return "claude_code"
}

func (p *Provider) DefaultGlobPatterns(homeDir string) []string {
	return []string{
		filepath.Join(homeDir, ".claude", "projects", "*", "logs", "*.jsonl"),
		filepath.Join(homeDir, ".claude", "sessions", "*.jsonl"),
		filepath.Join(homeDir, ".claude", "transcripts", "*.jsonl"),
	}
}

func (p *Provider) MatchesPath(path string) bool {
	norm := strings.ToLower(path)
	return strings.Contains(norm, ".claude") || strings.Contains(norm, "claude-code")
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
	if model, ok := raw["model"].(string); ok && model != "" {
		if strings.Contains(model, "3-7") || strings.Contains(model, "3.7") {
			p.activeModel = "claude-3-7-sonnet"
		} else if strings.Contains(model, "haiku") {
			p.activeModel = "claude-3-5-haiku"
		} else {
			p.activeModel = "claude-3-5-sonnet"
		}
	}
	currentModel := p.activeModel
	p.mu.Unlock()

	var res []*events.Event
	now := time.Now().UnixNano()

	// 1. Thinking / Assistant text
	if thinking, ok := raw["thinking"].(string); ok && thinking != "" {
		preview := strings.Split(strings.TrimSpace(thinking), "\n")[0]
		if len(preview) > 60 {
			preview = preview[:58] + "…"
		}
		evt := events.NewEvent(fmt.Sprintf("claude-think-%d", now), sessionID, events.TypeAgentThink, "agent-claude", preview).
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary(thinking).
			WithPayload("detectedSource", "claude_code").
			WithPayload("detectedModel", currentModel)
		res = append(res, evt)
	}

	// 2. Tool calls / Tool use (e.g. Bash, Edit, Read, Grep, Glob)
	if toolUse, ok := raw["tool_use"].(map[string]any); ok {
		toolName, _ := toolUse["name"].(string)
		toolInput, _ := toolUse["input"].(map[string]any)
		if toolInput == nil {
			toolInput = make(map[string]any)
		}

		var role events.AgentRole = events.RoleCrafter
		var station events.StationType = events.StationForemanDesk
		var evtType events.Type = events.TypeToolCall
		title := fmt.Sprintf("Claude: %s", toolName)
		summary := fmt.Sprintf("Executing tool %s", toolName)

		switch strings.ToLower(toolName) {
		case "read", "view", "fileread":
			role = events.RoleInspector
			station = events.StationRepoShelf
			evtType = events.TypeFileRead
			if f, ok := toolInput["file_path"].(string); ok {
				title = fmt.Sprintf("Reading: %s", filepath.Base(f))
				summary = fmt.Sprintf("Inspecting %s", f)
			}
		case "edit", "write", "filewrite", "patch":
			role = events.RoleCrafter
			station = events.StationCNCLathe
			evtType = events.TypeFileWrite
			if f, ok := toolInput["file_path"].(string); ok {
				title = fmt.Sprintf("Forging: %s", filepath.Base(f))
				summary = fmt.Sprintf("Editing code in %s", f)
			}
		case "grep", "glob", "search":
			role = events.RoleInspector
			station = events.StationSearchRadar
			evtType = events.TypeToolCall
			if p, ok := toolInput["pattern"].(string); ok {
				title = fmt.Sprintf("Search: %q", p)
				summary = fmt.Sprintf("Scanning codebase for %s", p)
			}
		case "bash", "exec", "command":
			role = events.RoleTester
			station = events.StationTestFurnace
			evtType = events.TypeCommandRun
			if cmd, ok := toolInput["command"].(string); ok {
				title = fmt.Sprintf("Bash: %s", cmd)
				summary = fmt.Sprintf("Executing terminal command: %s", cmd)
			}
		}

		evt := events.NewEvent(fmt.Sprintf("claude-tool-%d", now), sessionID, evtType, "agent-claude", title).
			WithRole(role).
			WithStation(station).
			WithSummary(summary).
			WithPayload("tool", toolName).
			WithPayload("args", toolInput).
			WithPayload("detectedSource", "claude_code").
			WithPayload("detectedModel", currentModel)
		res = append(res, evt)
	}

	return res
}

func init() {
	providers.GlobalRegistry().Register(New())
}
