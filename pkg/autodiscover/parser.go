package autodiscover

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// SessionSource identifies which tool produced the session.
type SessionSource string

const (
	SourceAntigravity SessionSource = "antigravity"
	SourceClaudeCode  SessionSource = "claude_code"
	SourceCopilotCLI  SessionSource = "copilot_cli"
	SourceGeneric     SessionSource = "generic"
)

// DiscoveredSession contains metadata about a detected agent session.
type DiscoveredSession struct {
	ID           string        `json:"id"`
	Source       SessionSource `json:"source"`
	Path         string        `json:"path"`
	LastModified time.Time     `json:"lastModified"`
	Active       bool          `json:"active"`
}

// TranscriptParser parses a single line from a specific session log format.
type TranscriptParser interface {
	Parse(line string, sessionID string) []*events.Event
}

// AntigravityParser converts Antigravity transcript.jsonl entries to visualizer events.
type AntigravityParser struct{}

func (p *AntigravityParser) Parse(line string, sessionID string) []*events.Event {
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

	var res []*events.Event

	// 1. If there is reasoning / thinking text
	if entry.Thinking != "" {
		preview := strings.Split(strings.TrimSpace(entry.Thinking), "\n")[0]
		preview = strings.Trim(preview, "*#` ")
		if len(preview) > 60 {
			preview = preview[:58] + "…"
		}
		if preview == "" {
			preview = "Analyzing next steps"
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
			WithSummary(entry.Thinking).
			WithPayload("thinking", entry.Thinking).
			WithPayload("stepIndex", entry.StepIndex)

		res = append(res, evt)
	}

	// 2. Map tool calls to workstations
	for idx, tc := range entry.ToolCalls {
		evtID := fmt.Sprintf("tool-%d-%d-%d", entry.StepIndex, idx, time.Now().UnixNano())
		name := tc.Name
		args := tc.Args
		if args == nil {
			args = make(map[string]any)
		}

		var role events.AgentRole = events.RoleCrafter
		var station events.StationType = events.StationForemanDesk
		var evtType events.Type = events.TypeToolCall
		title := fmt.Sprintf("Tool: %s", name)
		summary := fmt.Sprintf("Invoking %s", name)

		switch name {
		case "view_file", "read_resource", "read_url_content":
			role = events.RoleInspector
			station = events.StationFilingVault
			evtType = events.TypeFileRead
			if path, ok := args["AbsolutePath"].(string); ok {
				title = fmt.Sprintf("Reading: %s", filepath.Base(path))
				summary = fmt.Sprintf("Inspecting file: %s", path)
			}

		case "list_dir":
			role = events.RoleInspector
			station = events.StationFilingVault
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
			station = events.StationPhoneBooth
			evtType = events.TypeMCPCall
			serverName, _ := args["ServerName"].(string)
			toolName, _ := args["ToolName"].(string)
			title = fmt.Sprintf("MCP: %s / %s", serverName, toolName)
			summary = fmt.Sprintf("Calling tool %s on MCP server %s", toolName, serverName)

		case "invoke_subagent":
			role = events.RoleForeman
			station = events.StationForemanDesk
			evtType = events.TypeSubagentDelegate
			title = "Summoning Subagent Specialist"
			summary = "Delegating subtask to child agent"
		}

		evt := events.NewEvent(evtID, sessionID, evtType, "agent-foreman", title).
			WithRole(role).
			WithStation(station).
			WithSummary(summary).
			WithPayload("tool", name).
			WithPayload("args", args).
			WithPayload("stepIndex", entry.StepIndex)

		res = append(res, evt)
	}

	return res
}
