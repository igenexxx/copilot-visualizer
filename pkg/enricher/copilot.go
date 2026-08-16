package enricher

import (
	"os"
	"path/filepath"

	"github.com/zhenya/copilot-visualizer/pkg/copilotstore"
)

// CopilotEnricher extracts exact token metrics and metadata from GitHub Copilot CLI's session-store.db.
type CopilotEnricher struct {
	reader *copilotstore.Reader
}

// NewCopilotEnricher creates a new CopilotEnricher.
func NewCopilotEnricher(dbPath string) *CopilotEnricher {
	return &CopilotEnricher{
		reader: copilotstore.NewReader(dbPath),
	}
}

func (c *CopilotEnricher) ID() string {
	return "copilot_enricher"
}

func (c *CopilotEnricher) Source() string {
	return "copilot_cli"
}

func (c *CopilotEnricher) WatchTargets(homeDir string) []string {
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	dbPath := filepath.Join(homeDir, ".copilot", "session-store.db")
	walPath := filepath.Join(homeDir, ".copilot", "session-store.db-wal")
	dirPath := filepath.Join(homeDir, ".copilot")
	return []string{dbPath, walPath, dirPath}
}

func (c *CopilotEnricher) CanEnrich(sessionID string) bool {
	if sessionID == "" || !c.reader.Exists() {
		return false
	}
	meta, err := c.reader.GetSessionMetadata(sessionID)
	if err == nil && meta != nil && (meta.Repository != "" || meta.Cwd != "") {
		return true
	}
	usage, err := c.reader.GetSessionUsage(sessionID)
	return err == nil && usage != nil && usage.TurnCount > 0
}

func (c *CopilotEnricher) EnrichUsage(sessionID string) (*UsageSummary, error) {
	u, err := c.reader.GetSessionUsage(sessionID)
	if err != nil {
		return nil, err
	}
	return &UsageSummary{
		SessionID:           sessionID,
		Provider:            "copilot_cli",
		Model:               u.LatestModel,
		ActiveContextTokens: u.ActiveContextTokens,
		InputTokens:         u.InputTokens,
		OutputTokens:        u.OutputTokens,
		CacheReadTokens:     u.CacheReadTokens,
		CacheWriteTokens:    u.CacheWriteTokens,
		ReasoningTokens:     u.ReasoningTokens,
		TotalNanoAiu:        u.TotalNanoAiu,
		TotalCostUSD:        u.TotalCostUSD,
		DurationMs:          u.DurationMs,
		TurnCount:           u.TurnCount,
		UpdatedAt:           u.UpdatedAt,
	}, nil
}

func (c *CopilotEnricher) EnrichMetadata(sessionID string) (*SessionMetadata, error) {
	m, err := c.reader.GetSessionMetadata(sessionID)
	if err != nil {
		return nil, err
	}
	return &SessionMetadata{
		SessionID:  sessionID,
		Provider:   "copilot_cli",
		Cwd:        m.Cwd,
		Repository: m.Repository,
		Branch:     m.Branch,
		Summary:    m.Summary,
		CreatedAt:  m.CreatedAt,
		UpdatedAt:  m.UpdatedAt,
	}, nil
}
