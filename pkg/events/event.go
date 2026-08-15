package events

import (
	"encoding/json"
	"fmt"
	"time"
)

// Type represents the discrete event category across the agent lifecycle.
type Type string

const (
	TypeSessionStart     Type = "session.start"
	TypeSessionEnd       Type = "session.end"
	TypeAgentSpawn       Type = "agent.spawn"
	TypeAgentState       Type = "agent.state"
	TypeAgentThink       Type = "agent.think"
	TypeToolCall         Type = "tool.call"
	TypeToolResult       Type = "tool.result"
	TypeFileRead         Type = "file.read"
	TypeFileWrite        Type = "file.write"
	TypeCommandRun       Type = "command.run"
	TypeCommandOutput    Type = "command.output"
	TypeMCPCall          Type = "mcp.call"
	TypeMCPResponse      Type = "mcp.response"
	TypeSubagentDelegate   Type = "subagent.delegate"
	TypeSubagentReturn     Type = "subagent.return"
	TypeInterventionPrompt Type = "intervention.prompt"
	TypeCheckpointRequest  Type = "checkpoint.request"
	TypeCheckpointDecision Type = "checkpoint.decision"
	TypeEmergencyStop      Type = "emergency.stop"
)

// AgentRole defines the specialization of the agent in the workshop.
type AgentRole string

const (
	RoleForeman   AgentRole = "foreman"   // Master orchestrator / planner
	RoleCrafter   AgentRole = "crafter"   // Code writer / refactorer
	RoleInspector AgentRole = "inspector" // Searcher / linter / reviewer
	RoleTester    AgentRole = "tester"    // Command runner / test runner
	RoleOperator  AgentRole = "operator"  // MCP & external bridge specialist
)

// StationType identifies which workstation on the factory floor is engaged.
type StationType string

const (
	StationForemanDesk     StationType = "foreman_desk"     // Central blueprint & planning hub
	StationFilingVault     StationType = "filing_vault"     // File reads & codebase navigation
	StationRepoShelf       StationType = "repo_shelf"       // Project directory modular shelves (/pkg, /cmd, /web)
	StationServerRack      StationType = "server_rack"      // MCP server vault & fiber database racks
	StationSubagentOffice  StationType = "subagent_office"  // Glass-walled subagent suite
	StationSearchRadar     StationType = "search_radar"     // Grep & symbol search
	StationCNCLathe        StationType = "cnc_lathe"        // File edits, patch writes & code forging
	StationTestFurnace     StationType = "test_furnace"     // Shell execution, test runs & builds
	StationPhoneBooth      StationType = "phone_booth"      // MCP calls & remote servers
	StationConveyor        StationType = "conveyor"         // Output delivery & artifact transit
	StationSecurityGate    StationType = "security_gate"    // Safety barrier & checkpoint approval
)

// Event is the canonical payload sent across the WebSocket event stream.
type Event struct {
	ID        string         `json:"id"`
	SessionID string         `json:"sessionId"`
	Timestamp int64          `json:"timestamp"` // Unix timestamp in milliseconds
	Type      Type           `json:"type"`
	AgentID   string         `json:"agentId"`
	AgentRole AgentRole      `json:"agentRole,omitempty"`
	Station   StationType    `json:"station,omitempty"`
	Title     string         `json:"title"`
	Summary   string         `json:"summary,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
}

// NewEvent creates a timestamped Event instance.
func NewEvent(id, sessionID string, eventType Type, agentID string, title string) *Event {
	return &Event{
		ID:        id,
		SessionID: sessionID,
		Timestamp: time.Now().UnixMilli(),
		Type:      eventType,
		AgentID:   agentID,
		Title:     title,
		Payload:   make(map[string]any),
	}
}

// WithRole sets the agent role on the event.
func (e *Event) WithRole(role AgentRole) *Event {
	if e != nil {
		e.AgentRole = role
	}
	return e
}

// WithStation sets the workstation type.
func (e *Event) WithStation(station StationType) *Event {
	if e != nil {
		e.Station = station
	}
	return e
}

// WithSummary sets the summary text.
func (e *Event) WithSummary(summary string) *Event {
	if e != nil {
		e.Summary = summary
	}
	return e
}

// WithPayload sets or updates key-value pairs in the payload map.
func (e *Event) WithPayload(key string, value any) *Event {
	if e == nil {
		return e
	}
	if e.Payload == nil {
		e.Payload = make(map[string]any)
	}
	e.Payload[key] = value
	return e
}

// Validate checks essential invariants for the event.
func (e *Event) Validate() error {
	if e == nil {
		return fmt.Errorf("event cannot be nil")
	}
	if e.ID == "" {
		return fmt.Errorf("event ID is required")
	}
	if e.Type == "" {
		return fmt.Errorf("event Type is required")
	}
	if e.SessionID == "" {
		return fmt.Errorf("event SessionID is required")
	}
	if e.AgentID == "" {
		return fmt.Errorf("event AgentID is required")
	}
	return nil
}

// ToJSON serializes the event to bytes.
func (e *Event) ToJSON() ([]byte, error) {
	if err := e.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(e)
}
