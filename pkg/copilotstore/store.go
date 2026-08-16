package copilotstore

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// UsageSummary contains aggregated tokenomics and telemetry metrics for a Copilot session.
type UsageSummary struct {
	SessionID        string  `json:"sessionId"`
	LatestModel      string  `json:"latestModel"`
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

// SessionMetadata holds repository and workspace context.
type SessionMetadata struct {
	SessionID  string `json:"sessionId"`
	Cwd        string `json:"cwd"`
	Repository string `json:"repository"`
	Branch     string `json:"branch"`
	Summary    string `json:"summary"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// Reader provides read-only access to Copilot CLI internal SQLite database.
type Reader struct {
	mu     sync.RWMutex
	dbPath string
}

// NewReader creates a new Reader for the given session-store.db path.
// If dbPath is empty, it defaults to ~/.copilot/session-store.db.
func NewReader(dbPath string) *Reader {
	if dbPath == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dbPath = filepath.Join(home, ".copilot", "session-store.db")
		}
	}
	return &Reader{
		dbPath: dbPath,
	}
}

// DBPath returns the configured SQLite database path.
func (r *Reader) DBPath() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.dbPath
}

// Exists checks whether the SQLite database file exists on disk.
func (r *Reader) Exists() bool {
	r.mu.RLock()
	p := r.dbPath
	r.mu.RUnlock()

	if p == "" {
		return false
	}
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

// openRO opens a read-only connection to the database.
func (r *Reader) openRO() (*sql.DB, error) {
	r.mu.RLock()
	p := r.dbPath
	r.mu.RUnlock()

	if p == "" {
		return nil, fmt.Errorf("empty database path")
	}

	dsn := fmt.Sprintf("file:%s?_pragma=query_only(true)&_pragma=busy_timeout(5000)&_pragma=synchronous(OFF)", filepath.ToSlash(p))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}
	return db, nil
}

// GetSessionUsage queries assistant_usage_events for exact token counts and nano AIUs.
func (r *Reader) GetSessionUsage(sessionID string) (*UsageSummary, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("sessionID cannot be empty")
	}
	if !r.Exists() {
		return nil, fmt.Errorf("copilot session-store.db not found at %s", r.dbPath)
	}

	db, err := r.openRO()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `
		SELECT 
			COALESCE(model, ''),
			COALESCE(SUM(input_tokens), 0),
			COALESCE(SUM(output_tokens), 0),
			COALESCE(SUM(cache_read_tokens), 0),
			COALESCE(SUM(cache_write_tokens), 0),
			COALESCE(SUM(reasoning_tokens), 0),
			COALESCE(SUM(total_nano_aiu), 0),
			COALESCE(SUM(duration_ms), 0),
			COUNT(id)
		FROM assistant_usage_events
		WHERE session_id = ?
		GROUP BY session_id;
	`

	var (
		model            string
		inputTokens      int64
		outputTokens     int64
		cacheReadTokens  int64
		cacheWriteTokens int64
		reasoningTokens  int64
		totalNanoAiu     int64
		durationMs       int64
		turnCount        int
	)

	err = db.QueryRow(query, sessionID).Scan(
		&model,
		&inputTokens,
		&outputTokens,
		&cacheReadTokens,
		&cacheWriteTokens,
		&reasoningTokens,
		&totalNanoAiu,
		&durationMs,
		&turnCount,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return &UsageSummary{
				SessionID: sessionID,
				UpdatedAt: time.Now().UnixMilli(),
			}, nil
		}
		return nil, fmt.Errorf("query assistant_usage_events failed: %w", err)
	}

	// Also find the latest model used if multiple models were active
	var latestModel string
	_ = db.QueryRow(`
		SELECT COALESCE(model, '') 
		FROM assistant_usage_events 
		WHERE session_id = ? 
		ORDER BY id DESC LIMIT 1;
	`, sessionID).Scan(&latestModel)

	if latestModel == "" {
		latestModel = model
	}

	// 1 Nano AIU = 1e-9 AIU. In GitHub Copilot billing: 1 AIU ≈ $0.0001 (or $0.10 per 1000 AIU).
	// Cost USD = (totalNanoAiu / 1e9) * 0.0001
	costUSD := (float64(totalNanoAiu) / 1e9) * 0.0001

	return &UsageSummary{
		SessionID:        sessionID,
		LatestModel:      latestModel,
		InputTokens:      inputTokens,
		OutputTokens:     outputTokens,
		CacheReadTokens:  cacheReadTokens,
		CacheWriteTokens: cacheWriteTokens,
		ReasoningTokens:  reasoningTokens,
		TotalNanoAiu:     totalNanoAiu,
		TotalCostUSD:     costUSD,
		DurationMs:       durationMs,
		TurnCount:        turnCount,
		UpdatedAt:        time.Now().UnixMilli(),
	}, nil
}

// GetSessionMetadata retrieves metadata from the sessions table.
func (r *Reader) GetSessionMetadata(sessionID string) (*SessionMetadata, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("sessionID cannot be empty")
	}
	if !r.Exists() {
		return nil, fmt.Errorf("copilot session-store.db not found at %s", r.dbPath)
	}

	db, err := r.openRO()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `
		SELECT 
			COALESCE(cwd, ''),
			COALESCE(repository, ''),
			COALESCE(branch, ''),
			COALESCE(summary, ''),
			COALESCE(created_at, ''),
			COALESCE(updated_at, '')
		FROM sessions
		WHERE id = ?;
	`

	var meta SessionMetadata
	meta.SessionID = sessionID

	err = db.QueryRow(query, sessionID).Scan(
		&meta.Cwd,
		&meta.Repository,
		&meta.Branch,
		&meta.Summary,
		&meta.CreatedAt,
		&meta.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return &meta, nil
		}
		return nil, fmt.Errorf("query sessions failed: %w", err)
	}

	return &meta, nil
}
