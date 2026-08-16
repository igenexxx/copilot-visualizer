package enricher

// UsageSummary holds unified, precise tokenomics and telemetry metrics across AI providers.
type UsageSummary struct {
	SessionID           string  `json:"sessionId"`
	Provider            string  `json:"provider"`
	Model               string  `json:"model"`
	ActiveContextTokens int64   `json:"activeContextTokens"`
	InputTokens         int64   `json:"inputTokens"`
	OutputTokens        int64   `json:"outputTokens"`
	CacheReadTokens  int64   `json:"cacheReadTokens"`
	CacheWriteTokens int64   `json:"cacheWriteTokens"`
	ReasoningTokens  int64   `json:"reasoningTokens"`
	TotalNanoAiu     int64   `json:"totalNanoAiu"`
	TotalCostUSD     float64 `json:"totalCostUsd"`
	DurationMs       int64   `json:"durationMs"`
	TurnCount        int     `json:"turnCount"`
	UpdatedAt        int64   `json:"updatedAt"`
}

// SessionMetadata holds repository and workspace context across AI providers.
type SessionMetadata struct {
	SessionID  string `json:"sessionId"`
	Provider   string `json:"provider"`
	Cwd        string `json:"cwd"`
	Repository string `json:"repository"`
	Branch     string `json:"branch"`
	Summary    string `json:"summary"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// SkillItem represents a registered or active agent skill.
type SkillItem struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	Path             string `json:"path"`
	Icon             string `json:"icon"`
	Category         string `json:"category"`
	Active           bool   `json:"active"`
	ActivationsCount int    `json:"activationsCount"`
	LastUsed         int64  `json:"lastUsed"`
}

// MCPServerItem represents a registered MCP server and its tool schemas.
type MCPServerItem struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	ToolsCount int      `json:"toolsCount"`
	Tools      []string `json:"tools"`
	Icon       string   `json:"icon"`
	Active     bool     `json:"active"`
	CallsCount int      `json:"callsCount"`
	LastUsed   int64    `json:"lastUsed"`
}

// RuleItem represents user instructions, governance rules, or project memories.
type RuleItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Type    string `json:"type"` // "global", "project", "memory"
	Icon    string `json:"icon"`
}

// SlashCommandItem represents a slash command available to the agent session.
type SlashCommandItem struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

// SessionContext represents the complete capability inventory of an AI session.
type SessionContext struct {
	SessionID     string             `json:"sessionId"`
	Provider      string             `json:"provider"`
	Skills        []SkillItem        `json:"skills"`
	MCPServers    []MCPServerItem    `json:"mcpServers"`
	Rules         []RuleItem         `json:"rules"`
	SlashCommands []SlashCommandItem `json:"slashCommands"`
	UpdatedAt     int64              `json:"updatedAt"`
}

// ProviderEnricher is the interface implemented by each AI client telemetry source.
type ProviderEnricher interface {
	ID() string
	Source() string
	WatchTargets(homeDir string) []string
	CanEnrich(sessionID string) bool
	EnrichUsage(sessionID string) (*UsageSummary, error)
	EnrichMetadata(sessionID string) (*SessionMetadata, error)
	EnrichContext(sessionID string) (*SessionContext, error)
}
