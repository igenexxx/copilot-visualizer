package antigravity

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

// Provider implements the providers.Provider interface for Google Antigravity.
type Provider struct {
	mu          sync.RWMutex
	activeModel string
}

// New creates a new Antigravity provider instance.
func New() *Provider {
	return &Provider{
		activeModel: "gemini-3.7-flash",
	}
}

func (p *Provider) ID() string {
	return "antigravity"
}

func (p *Provider) Name() string {
	return "Google Antigravity"
}

func (p *Provider) Source() string {
	return "antigravity"
}

func (p *Provider) DefaultGlobPatterns(homeDir string) []string {
	return []string{
		filepath.Join(homeDir, ".gemini", "antigravity-cli", "brain", "*", ".system_generated", "logs", "transcript.jsonl"),
		filepath.Join(homeDir, ".gemini", "antigravity-cli", "brain", "*", "logs", "transcript.jsonl"),
	}
}

func (p *Provider) MatchesPath(path string) bool {
	norm := strings.ToLower(path)
	return strings.Contains(norm, "antigravity") || strings.Contains(norm, ".gemini")
}

func (p *Provider) ExtractSessionID(filePath string) string {
	// e.g. ~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript.jsonl
	parts := strings.Split(filepath.ToSlash(filePath), "/")
	for i, part := range parts {
		if part == "brain" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return filepath.Base(filepath.Dir(filePath))
}

func (p *Provider) detectModel(content string) string {
	lower := strings.ToLower(content)
	// Only detect model if this is an explicit setting change or system configuration block
	if !strings.Contains(lower, "user_settings_change") &&
		!strings.Contains(lower, "model selection") &&
		!strings.Contains(lower, "setting to") &&
		!strings.Contains(lower, "active model") &&
		!strings.Contains(lower, "model changed") {
		return ""
	}

	if strings.Contains(lower, "gemini 3.7 flash") || strings.Contains(lower, "gemini-3.7-flash") {
		return "gemini-3.7-flash"
	} else if strings.Contains(lower, "gemini 3.7 pro") || strings.Contains(lower, "gemini-3.7-pro") {
		return "gemini-3.7-pro"
	} else if strings.Contains(lower, "gemini 2.5 flash") || strings.Contains(lower, "gemini-2.5-flash") {
		return "gemini-2.5-flash"
	} else if strings.Contains(lower, "gemini 2.5 pro") || strings.Contains(lower, "gemini-2.5-pro") {
		return "gemini-2.5-pro"
	} else if strings.Contains(lower, "claude 3.7 sonnet") || strings.Contains(lower, "claude-3-7-sonnet") {
		return "claude-3-7-sonnet"
	} else if strings.Contains(lower, "claude 3.5 sonnet") || strings.Contains(lower, "claude-3-5-sonnet") {
		return "claude-3-5-sonnet"
	} else if strings.Contains(lower, "claude 3.5 haiku") || strings.Contains(lower, "claude-3-5-haiku") {
		return "claude-3-5-haiku"
	} else if strings.Contains(lower, "gpt-4o-mini") {
		return "gpt-4o-mini"
	} else if strings.Contains(lower, "gpt-4o") {
		return "gpt-4o"
	} else if strings.Contains(lower, "o3-mini") {
		return "o3-mini"
	}
	return ""
}

func (p *Provider) ParseLine(line string, sessionID string) []*events.Event {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}

	var entry struct {
		StepIndex int    `json:"step_index"`
		Type      string `json:"type"`
		Source    string `json:"source"`
		Status    string `json:"status"`
		Content   string `json:"content"`
		Thinking  string `json:"thinking"`
		ToolCalls []struct {
			Name string         `json:"name"`
			Args map[string]any `json:"args"`
		} `json:"tool_calls"`
	}

	if err := json.Unmarshal([]byte(line), &entry); err != nil {
		return nil
	}

	p.mu.Lock()
	if detected := p.detectModel(entry.Content); detected != "" {
		p.activeModel = detected
	}
	currentModel := p.activeModel
	p.mu.Unlock()

	var res []*events.Event

	// 1. Thinking / reasoning step
	if entry.Thinking != "" {
		preview := strings.Split(strings.TrimSpace(entry.Thinking), "\n")[0]
		preview = strings.Trim(preview, "*#` ")
		if len(preview) > 60 {
			preview = preview[:58] + "…"
		}
		if preview == "" {
			preview = "Analyzing next steps"
		}

		summaryClean := strings.TrimSpace(entry.Thinking)
		if len(summaryClean) > 160 {
			summaryClean = summaryClean[:158] + "…"
		}

		thinkOutTokens := len(entry.Thinking) * 100 / 365
		if thinkOutTokens < 40 {
			thinkOutTokens = 40
		}
		thinkInTokens := len(entry.Content) * 100 / 365
		if entry.StepIndex == 0 {
			thinkInTokens += 28250 // Baseline system prompt + tools + skills overhead
		}

		evt := events.NewEvent(
			fmt.Sprintf("think-%d-%d", entry.StepIndex, time.Now().UnixNano()),
			sessionID,
			events.TypeAgentThink,
			"agent-foreman",
			preview,
		).
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary(summaryClean).
			WithPayload("thinking", entry.Thinking).
			WithPayload("detectedSource", "antigravity").
			WithPayload("detectedModel", currentModel).
			WithPayload("inputTokens", thinkInTokens).
			WithPayload("outputTokens", thinkOutTokens).
			WithPayload("stepIndex", entry.StepIndex)

		res = append(res, evt)
	}

	// 2. Tool calls mapping
	for idx, tc := range entry.ToolCalls {
		evtID := fmt.Sprintf("tool-%d-%d-%d", entry.StepIndex, idx, time.Now().UnixNano())
		name := tc.Name
		args := tc.Args
		if args == nil {
			args = make(map[string]any)
		}

		argsBytes, _ := json.Marshal(args)
		toolInTokens := (len(entry.Content) + len(argsBytes)) * 100 / 365
		if toolInTokens < 120 {
			toolInTokens = 120
		}
		if entry.StepIndex == 0 && entry.Thinking == "" {
			toolInTokens += 28250
		}
		toolOutTokens := 60

		var role events.AgentRole = events.RoleCrafter
		var station events.StationType = events.StationForemanDesk
		var evtType events.Type = events.TypeToolCall
		title := fmt.Sprintf("Tool: %s", name)
		summary := fmt.Sprintf("Invoking %s", name)
		toolModel := currentModel

		switch name {
		case "view_file", "read_resource", "read_url_content":
			role = events.RoleInspector
			station = events.StationRepoShelf
			evtType = events.TypeFileRead
			if path, ok := args["AbsolutePath"].(string); ok {
				title = fmt.Sprintf("Reading: %s", filepath.Base(path))
				summary = fmt.Sprintf("Inspecting file: %s", path)
			}

		case "list_dir":
			role = events.RoleInspector
			station = events.StationRepoShelf
			evtType = events.TypeFileRead
			if path, ok := args["DirectoryPath"].(string); ok {
				title = fmt.Sprintf("Listing: %s", filepath.Base(path))
				summary = fmt.Sprintf("Listing directory: %s", path)
			}

		case "grep_search", "search_web":
			role = events.RoleInspector
			station = events.StationSearchRadar
			evtType = events.TypeToolCall
			if q, ok := args["Query"].(string); ok {
				title = fmt.Sprintf("Search: %q", q)
				summary = fmt.Sprintf("Scanning codebase for pattern %q", q)
			}

		case "replace_file_content", "write_to_file":
			role = events.RoleCrafter
			station = events.StationCNCLathe
			evtType = events.TypeFileWrite
			targetFile, _ := args["TargetFile"].(string)
			if targetFile != "" {
				title = fmt.Sprintf("Forging: %s", filepath.Base(targetFile))
				summary = fmt.Sprintf("Editing / writing code to %s", targetFile)
			} else {
				title = "Forging Code Part"
			}

		case "run_command":
			role = events.RoleTester
			station = events.StationTestFurnace
			evtType = events.TypeCommandRun
			if cmd, ok := args["CommandLine"].(string); ok {
				title = fmt.Sprintf("Exec: %s", cmd)
				summary = fmt.Sprintf("Executing shell command: %s", cmd)
			}

		case "call_mcp_tool":
			role = events.RoleOperator
			station = events.StationServerRack
			evtType = events.TypeMCPCall
			serverName, _ := args["ServerName"].(string)
			toolName, _ := args["ToolName"].(string)
			title = fmt.Sprintf("MCP: %s / %s", serverName, toolName)
			summary = fmt.Sprintf("Calling tool %s on MCP server %s", toolName, serverName)

		case "invoke_subagent", "define_subagent":
			role = events.RoleForeman
			station = events.StationSubagentOffice
			evtType = events.TypeSubagentDelegate
			title = "Summoning Subagent Specialist"
			summary = "Delegating subtask to child agent in glass suite"
			if subagents, ok := args["Subagents"].([]any); ok && len(subagents) > 0 {
				if firstSub, ok := subagents[0].(map[string]any); ok {
					subRole, _ := firstSub["Role"].(string)
					subModel, _ := firstSub["Model"].(string)
					if subRole != "" {
						title = fmt.Sprintf("Summoning: %s", subRole)
					}
					if subModel != "" {
						summary = fmt.Sprintf("Spawning %s subagent with model %s", subRole, subModel)
						if subModel == "flash" || subModel == "flash_lite" {
							toolModel = "gemini-3.7-flash"
						}
					}
				}
			}
		}

		evt := events.NewEvent(evtID, sessionID, evtType, "agent-foreman", title).
			WithRole(role).
			WithStation(station).
			WithSummary(summary).
			WithPayload("tool", name).
			WithPayload("args", args).
			WithPayload("detectedSource", "antigravity").
			WithPayload("detectedModel", toolModel).
			WithPayload("inputTokens", toolInTokens).
			WithPayload("outputTokens", toolOutTokens).
			WithPayload("stepIndex", entry.StepIndex)

		res = append(res, evt)
	}

	return res
}

func init() {
	providers.GlobalRegistry().Register(New())
}
