package enricher

// UsageSummary holds unified, precise tokenomics and telemetry metrics across AI providers.
type UsageSummary struct {
	SessionID        string  `json:"sessionId"`
	Provider         string  `json:"provider"`
	Model            string  `json:"model"`
	InputTokens      int64   `json:"inputTokens"`
	OutputTokens     int64   `json:"outputTokens"`
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

// ProviderEnricher is the interface implemented by each AI client telemetry source.
type ProviderEnricher interface {
	ID() string
	Source() string
	WatchTargets(homeDir string) []string
	CanEnrich(sessionID string) bool
	EnrichUsage(sessionID string) (*UsageSummary, error)
	EnrichMetadata(sessionID string) (*SessionMetadata, error)
}
