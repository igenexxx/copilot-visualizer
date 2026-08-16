package copilotstore_test

import (
	"database/sql"
	"path/filepath"
	"sync"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/copilotstore"
	_ "modernc.org/sqlite"
)

func createTestDB(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "session-store.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open test sqlite db: %v", err)
	}
	defer db.Close()

	schema := `
	CREATE TABLE sessions (
		id TEXT PRIMARY KEY,
		cwd TEXT,
		repository TEXT,
		host_type TEXT,
		branch TEXT,
		summary TEXT,
		created_at TEXT,
		updated_at TEXT
	);

	CREATE TABLE assistant_usage_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		turn_index INTEGER,
		agent_id TEXT,
		parent_tool_call_id TEXT,
		model TEXT NOT NULL,
		input_tokens INTEGER,
		output_tokens INTEGER,
		cache_read_tokens INTEGER,
		cache_write_tokens INTEGER,
		reasoning_tokens INTEGER,
		total_nano_aiu INTEGER,
		duration_ms INTEGER,
		created_at TEXT
	);
	`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("failed to create test schema: %v", err)
	}

	// Insert session metadata
	_, err = db.Exec(`
		INSERT INTO sessions (id, cwd, repository, branch, summary, created_at, updated_at)
		VALUES ('sess-101', '/home/user/project', 'user/project', 'main', 'Build refactor', '2026-08-16T12:00:00Z', '2026-08-16T12:05:00Z');
	`)
	if err != nil {
		t.Fatalf("failed to insert test session: %v", err)
	}

	// Insert 3 usage events
	_, err = db.Exec(`
		INSERT INTO assistant_usage_events 
		(session_id, turn_index, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, duration_ms)
		VALUES 
		('sess-101', 1, 'gpt-5.6-terra', 10000, 200, 9000, 500, 50, 2500000000, 1200),
		('sess-101', 2, 'gpt-5.6-terra', 12000, 400, 11000, 600, 100, 3000000000, 1800),
		('sess-101', 3, 'o3-mini', 8000, 150, 7500, 200, 30, 1500000000, 900);
	`)
	if err != nil {
		t.Fatalf("failed to insert test usage events: %v", err)
	}

	return dbPath
}

func TestReader_GetSessionUsageAndMetadata(t *testing.T) {
	dbPath := createTestDB(t)
	reader := copilotstore.NewReader(dbPath)

	if !reader.Exists() {
		t.Fatalf("expected reader.Exists() to be true for %s", dbPath)
	}
	if reader.DBPath() != dbPath {
		t.Errorf("expected DBPath %q, got %q", dbPath, reader.DBPath())
	}

	// Test Usage Summary
	usage, err := reader.GetSessionUsage("sess-101")
	if err != nil {
		t.Fatalf("GetSessionUsage failed: %v", err)
	}

	if usage.SessionID != "sess-101" {
		t.Errorf("expected session ID sess-101, got %q", usage.SessionID)
	}
	if usage.LatestModel != "o3-mini" {
		t.Errorf("expected latest model o3-mini, got %q", usage.LatestModel)
	}
	if usage.InputTokens != 30000 {
		t.Errorf("expected inputTokens 30000, got %d", usage.InputTokens)
	}
	if usage.OutputTokens != 750 {
		t.Errorf("expected outputTokens 750, got %d", usage.OutputTokens)
	}
	if usage.CacheReadTokens != 27500 {
		t.Errorf("expected cacheReadTokens 27500, got %d", usage.CacheReadTokens)
	}
	if usage.TotalNanoAiu != 7000000000 {
		t.Errorf("expected totalNanoAiu 7000000000, got %d", usage.TotalNanoAiu)
	}
	if usage.TurnCount != 3 {
		t.Errorf("expected turnCount 3, got %d", usage.TurnCount)
	}
	if usage.DurationMs != 3900 {
		t.Errorf("expected durationMs 3900, got %d", usage.DurationMs)
	}
	if usage.TotalCostUSD <= 0 {
		t.Errorf("expected positive TotalCostUSD, got %f", usage.TotalCostUSD)
	}

	// Test Metadata
	meta, err := reader.GetSessionMetadata("sess-101")
	if err != nil {
		t.Fatalf("GetSessionMetadata failed: %v", err)
	}

	if meta.Repository != "user/project" {
		t.Errorf("expected repository 'user/project', got %q", meta.Repository)
	}
	if meta.Branch != "main" {
		t.Errorf("expected branch 'main', got %q", meta.Branch)
	}
	if meta.Cwd != "/home/user/project" {
		t.Errorf("expected cwd '/home/user/project', got %q", meta.Cwd)
	}
}

func TestReader_NonExistentAndAdversarial(t *testing.T) {
	// Empty DB reader
	emptyReader := copilotstore.NewReader("/tmp/non-existent-session-store-xyz.db")
	if emptyReader.Exists() {
		t.Errorf("expected non-existent DB to return Exists() == false")
	}

	_, err := emptyReader.GetSessionUsage("sess-1")
	if err == nil {
		t.Errorf("expected error when querying non-existent DB, got nil")
	}

	// Existing DB but missing session ID
	dbPath := createTestDB(t)
	reader := copilotstore.NewReader(dbPath)

	_, err = reader.GetSessionUsage("")
	if err == nil {
		t.Errorf("expected error on empty session ID")
	}

	usage, err := reader.GetSessionUsage("unknown-sess")
	if err != nil {
		t.Fatalf("expected graceful empty summary for unknown session, got err: %v", err)
	}
	if usage.InputTokens != 0 || usage.TurnCount != 0 {
		t.Errorf("expected zeroed tokens for unknown session, got %d", usage.InputTokens)
	}

	meta, err := reader.GetSessionMetadata("unknown-sess")
	if err != nil {
		t.Fatalf("expected graceful empty metadata for unknown session, got err: %v", err)
	}
	if meta.Repository != "" {
		t.Errorf("expected empty repo, got %q", meta.Repository)
	}
}

func TestReader_Concurrency(t *testing.T) {
	dbPath := createTestDB(t)
	reader := copilotstore.NewReader(dbPath)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = reader.GetSessionUsage("sess-101")
			_, _ = reader.GetSessionMetadata("sess-101")
		}()
	}
	wg.Wait()
}
