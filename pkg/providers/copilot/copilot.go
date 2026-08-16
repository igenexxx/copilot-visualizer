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
		activeModel: "gpt-5",
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
		filepath.Join(homeDir, ".copilot", "session-state", "*", "events.jsonl"),
		filepath.Join(homeDir, ".copilot", "session-state", "*", "*.jsonl"),
		filepath.Join(homeDir, ".copilot", "session-state", "*.jsonl"),
		filepath.Join(homeDir, ".config", "github-copilot", "logs", "*.jsonl"),
		filepath.Join(homeDir, ".github-copilot", "*.jsonl"),
	}
}

func (p *Provider) MatchesPath(path string) bool {
	norm := strings.ToLower(filepath.ToSlash(path))
	return strings.Contains(norm, ".copilot") || strings.Contains(norm, "github-copilot") || strings.Contains(norm, "gh-copilot")
}

func (p *Provider) ExtractSessionID(filePath string) string {
	parts := strings.Split(filepath.ToSlash(filePath), "/")
	for i, part := range parts {
		if part == "session-state" && i+1 < len(parts) {
			candidate := parts[i+1]
			ext := filepath.Ext(candidate)
			clean := strings.TrimSuffix(candidate, ext)
			if clean != "events" && clean != "" {
				return clean
			}
		}
	}
	base := filepath.Base(filePath)
	ext := filepath.Ext(base)
	clean := strings.TrimSuffix(base, ext)
	if clean != "" && clean != "." && clean != "events" {
		return clean
	}
	dir := filepath.Base(filepath.Dir(filePath))
	if dir != "" && dir != "." && dir != "session-state" {
		return dir
	}
	return clean
}

func (p *Provider) detectModel(m string) string {
	lower := strings.ToLower(m)
	if lower == "" {
		return ""
	}
	if strings.Contains(lower, "gpt-5") {
		return "gpt-5"
	} else if strings.Contains(lower, "o3") {
		return "o3-mini"
	} else if strings.Contains(lower, "o1") {
		return "o1"
	} else if strings.Contains(lower, "mini") || strings.Contains(lower, "4o-mini") {
		return "gpt-4o-mini"
	} else if strings.Contains(lower, "claude-3-7") || strings.Contains(lower, "claude-3.7") {
		return "claude-3-7-sonnet"
	} else if strings.Contains(lower, "claude-3-5") || strings.Contains(lower, "claude-3.5") {
		return "claude-3-5-sonnet"
	} else if strings.Contains(lower, "gemini") {
		return "gemini-2.5-pro"
	} else if strings.Contains(lower, "gpt-4") {
		return "gpt-4o"
	}
	return m
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
		if detected := p.detectModel(m); detected != "" {
			p.activeModel = detected
		}
	}
	currentModel := p.activeModel
	p.mu.Unlock()

	var res []*events.Event
	now := time.Now().UnixNano()

	// Check if this is a Copilot CLI structured event (type + data)
	eventType, _ := raw["type"].(string)
	dataMap, _ := raw["data"].(map[string]any)
	if dataMap == nil {
		dataMap = make(map[string]any)
	}

	if eventType != "" {
		// 1. Session model change
		if eventType == "session.model_change" {
			if newM, ok := dataMap["newModel"].(string); ok && newM != "" {
				p.mu.Lock()
				p.activeModel = p.detectModel(newM)
				currentModel = p.activeModel
				p.mu.Unlock()
			}
		}

		// 2. Session start
		if eventType == "session.start" {
			sID, _ := dataMap["sessionId"].(string)
			if sID == "" {
				sID = sessionID
			}
			producer, _ := dataMap["producer"].(string)
			if producer == "" {
				producer = "copilot-agent"
			}
			evt := events.NewEvent(fmt.Sprintf("copilot-start-%d", now), sessionID, events.TypeSessionStart, "agent-copilot", "Copilot Session Started").
				WithRole(events.RoleForeman).
				WithStation(events.StationForemanDesk).
				WithSummary(fmt.Sprintf("Producer: %s, Model: %s", producer, currentModel)).
				WithPayload("detectedSource", "copilot_cli").
				WithPayload("detectedModel", currentModel).
				WithPayload("sessionData", dataMap)
			res = append(res, evt)
			return res
		}

		// 3. User message / prompt
		if eventType == "user.message" {
			userContent, _ := dataMap["content"].(string)
			if userContent == "" {
				userContent, _ = dataMap["transformedContent"].(string)
			}
			if userContent != "" {
				preview := strings.Split(strings.TrimSpace(userContent), "\n")[0]
				if len(preview) > 60 {
					preview = preview[:58] + "…"
				}
				evt := events.NewEvent(fmt.Sprintf("copilot-prompt-%d", now), sessionID, events.TypeInterventionPrompt, "agent-copilot", preview).
					WithRole(events.RoleForeman).
					WithStation(events.StationForemanDesk).
					WithSummary(userContent).
					WithPayload("prompt", userContent).
					WithPayload("detectedSource", "copilot_cli").
					WithPayload("detectedModel", currentModel)
				res = append(res, evt)
			}
		}

		// 4. Assistant message (reasoning, thought, response)
		if eventType == "assistant.message" {
			if m, ok := dataMap["model"].(string); ok && m != "" {
				p.mu.Lock()
				p.activeModel = p.detectModel(m)
				currentModel = p.activeModel
				p.mu.Unlock()
			}
			reasoning, _ := dataMap["reasoningText"].(string)
			if reasoning != "" {
				preview := strings.Split(strings.TrimSpace(reasoning), "\n")[0]
				preview = strings.Trim(preview, "*#` ")
				if len(preview) > 60 {
					preview = preview[:58] + "…"
				}
				if preview == "" {
					preview = "Copilot Thinking..."
				}
				evt := events.NewEvent(fmt.Sprintf("copilot-think-%d", now), sessionID, events.TypeAgentThink, "agent-copilot", preview).
					WithRole(events.RoleForeman).
					WithStation(events.StationForemanDesk).
					WithSummary(reasoning).
					WithPayload("thinking", reasoning).
					WithPayload("detectedSource", "copilot_cli").
					WithPayload("detectedModel", currentModel)
				res = append(res, evt)
			}
			content, _ := dataMap["content"].(string)
			if content != "" && content != reasoning {
				preview := strings.Split(strings.TrimSpace(content), "\n")[0]
				if len(preview) > 60 {
					preview = preview[:58] + "…"
				}
				evt := events.NewEvent(fmt.Sprintf("copilot-msg-%d", now), sessionID, events.TypeAgentThink, "agent-copilot", preview).
					WithRole(events.RoleForeman).
					WithStation(events.StationForemanDesk).
					WithSummary(content).
					WithPayload("content", content).
					WithPayload("detectedSource", "copilot_cli").
					WithPayload("detectedModel", currentModel)
				res = append(res, evt)
			}
		}

		// 5. Tool execution start
		if eventType == "tool.execution_start" {
			toolName, _ := dataMap["toolName"].(string)
			args, _ := dataMap["arguments"].(map[string]any)
			if args == nil {
				args = make(map[string]any)
			}
			if m, ok := dataMap["model"].(string); ok && m != "" {
				p.mu.Lock()
				p.activeModel = p.detectModel(m)
				currentModel = p.activeModel
				p.mu.Unlock()
			}

			var role events.AgentRole = events.RoleCrafter
			var station events.StationType = events.StationForemanDesk
			var evtType events.Type = events.TypeToolCall
			title := fmt.Sprintf("Copilot: %s", toolName)
			summary := fmt.Sprintf("Invoking %s", toolName)

			lowerName := strings.ToLower(toolName)
			switch {
			case lowerName == "bash" || lowerName == "shell" || lowerName == "exec":
				role = events.RoleTester
				station = events.StationTestFurnace
				evtType = events.TypeCommandRun
				if cmd, ok := args["command"].(string); ok && cmd != "" {
					title = fmt.Sprintf("Exec: %s", cmd)
					summary = fmt.Sprintf("Running shell command: %s", cmd)
				}
			case lowerName == "edit" || lowerName == "write_file" || lowerName == "create_file" || lowerName == "patch":
				role = events.RoleCrafter
				station = events.StationCNCLathe
				evtType = events.TypeFileWrite
				targetFile, _ := args["path"].(string)
				if targetFile == "" {
					targetFile, _ = args["filePath"].(string)
				}
				if targetFile != "" {
					title = fmt.Sprintf("Forging: %s", filepath.Base(targetFile))
					summary = fmt.Sprintf("Modifying code in %s", targetFile)
				}
			case lowerName == "view" || lowerName == "read_file" || lowerName == "glob" || lowerName == "file_search":
				role = events.RoleInspector
				station = events.StationRepoShelf
				evtType = events.TypeFileRead
				path, _ := args["path"].(string)
				if path == "" {
					path, _ = args["paths"].(string)
				}
				if pattern, ok := args["pattern"].(string); ok && pattern != "" {
					title = fmt.Sprintf("Glob: %s", pattern)
					summary = fmt.Sprintf("Scanning files matching %s", pattern)
				} else if path != "" {
					title = fmt.Sprintf("Reading: %s", filepath.Base(path))
					summary = fmt.Sprintf("Inspecting file: %s", path)
				}
			case lowerName == "grep" || lowerName == "search":
				role = events.RoleInspector
				station = events.StationSearchRadar
				evtType = events.TypeToolCall
				if q, ok := args["query"].(string); ok {
					title = fmt.Sprintf("Search: %q", q)
					summary = fmt.Sprintf("Searching for pattern %q", q)
				}
			}

			evt := events.NewEvent(fmt.Sprintf("copilot-tool-%d", now), sessionID, evtType, "agent-copilot", title).
				WithRole(role).
				WithStation(station).
				WithSummary(summary).
				WithPayload("tool", toolName).
				WithPayload("args", args).
				WithPayload("detectedSource", "copilot_cli").
				WithPayload("detectedModel", currentModel)
			res = append(res, evt)
		}

		// 6. Permission requested (Security Gate checkpoint)
		if eventType == "permission.requested" {
			summary := "Permission requested for command/tool execution"
			if pReq, ok := dataMap["permissionRequest"].(map[string]any); ok {
				if intention, ok := pReq["intention"].(string); ok && intention != "" {
					summary = intention
				}
			}
			evt := events.NewEvent(fmt.Sprintf("copilot-perm-%d", now), sessionID, events.TypeCheckpointRequest, "agent-copilot", "Checkpoint: Permission Required").
				WithRole(events.RoleInspector).
				WithStation(events.StationSecurityGate).
				WithSummary(summary).
				WithPayload("permissionData", dataMap).
				WithPayload("detectedSource", "copilot_cli").
				WithPayload("detectedModel", currentModel)
			res = append(res, evt)
		}

		// 7. Session shutdown
		if eventType == "session.shutdown" {
			evt := events.NewEvent(fmt.Sprintf("copilot-end-%d", now), sessionID, events.TypeSessionEnd, "agent-copilot", "Copilot Session Finished").
				WithRole(events.RoleForeman).
				WithStation(events.StationForemanDesk).
				WithSummary("Copilot session ended").
				WithPayload("detectedSource", "copilot_cli").
				WithPayload("detectedModel", currentModel)
			res = append(res, evt)
		}

		if len(res) > 0 {
			return res
		}
	}

	// Legacy / Direct schema fallback
	// Prompt / Intent
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

	// Command / Execution
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

	// File Edit / Patch
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
