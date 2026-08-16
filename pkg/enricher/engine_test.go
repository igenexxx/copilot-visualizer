package enricher_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/enricher"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	_ "modernc.org/sqlite"
)

func TestCopilotEnricher(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "session-store.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, branch TEXT, summary TEXT, created_at TEXT, updated_at TEXT);
		CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY, session_id TEXT, turn_index INTEGER, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, total_nano_aiu INTEGER, duration_ms INTEGER);

		INSERT INTO sessions VALUES ('sess-cpt-1', '/repo', 'user/repo', 'main', 'test', '2026-08-16', '2026-08-16');
		INSERT INTO assistant_usage_events VALUES (1, 'sess-cpt-1', 1, 'gpt-5.6-terra', 20000, 500, 18000, 1000, 100, 5000000000, 2000);
	`)
	if err != nil {
		t.Fatalf("failed to setup schema: %v", err)
	}

	c := enricher.NewCopilotEnricher(dbPath)
	if !c.CanEnrich("sess-cpt-1") {
		t.Fatalf("expected CanEnrich to be true for sess-cpt-1")
	}

	usage, err := c.EnrichUsage("sess-cpt-1")
	if err != nil {
		t.Fatalf("EnrichUsage failed: %v", err)
	}
	if usage.Model != "gpt-5.6-terra" || usage.InputTokens != 20000 || usage.CacheReadTokens != 18000 {
		t.Errorf("unexpected usage: %+v", usage)
	}

	meta, err := c.EnrichMetadata("sess-cpt-1")
	if err != nil {
		t.Fatalf("EnrichMetadata failed: %v", err)
	}
	if meta.Repository != "user/repo" || meta.Branch != "main" {
		t.Errorf("unexpected meta: %+v", meta)
	}
}

func TestAntigravityEnricher(t *testing.T) {
	dir := t.TempDir()
	sessionID := "sess-gemini-1"
	brainLogsDir := filepath.Join(dir, "antigravity-cli", "brain", sessionID, ".system_generated", "logs")
	if err := os.MkdirAll(brainLogsDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}

	transcriptPath := filepath.Join(brainLogsDir, "transcript.jsonl")
	content := `{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","content":"<USER_SETTINGS_CHANGE>\nModel Selection: Gemini 3.7 Flash\n</USER_SETTINGS_CHANGE>\nImplement tests"}` + "\n" +
		`{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","content":"I will write the test suite."}` + "\n"

	if err := os.WriteFile(transcriptPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write file failed: %v", err)
	}

	a := enricher.NewAntigravityEnricher(dir)
	if !a.CanEnrich(sessionID) {
		t.Fatalf("expected CanEnrich to be true for %s", sessionID)
	}

	usage, err := a.EnrichUsage(sessionID)
	if err != nil {
		t.Fatalf("EnrichUsage failed: %v", err)
	}
	if usage.Model != "gemini-3.7-flash" || usage.TurnCount != 2 || usage.InputTokens <= 0 {
		t.Errorf("unexpected usage: %+v", usage)
	}
}

func TestClaudeEnricher(t *testing.T) {
	dir := t.TempDir()
	sessionID := "sess-claude-1"
	projectsDir := filepath.Join(dir, "projects")
	if err := os.MkdirAll(projectsDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}

	transcriptPath := filepath.Join(projectsDir, sessionID+".jsonl")
	content := `{"model":"claude-3-7-sonnet-20250219","usage":{"input_tokens":10000,"output_tokens":400,"cache_read_input_tokens":8000,"cache_creation_input_tokens":1000}}` + "\n"
	if err := os.WriteFile(transcriptPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write file failed: %v", err)
	}

	c := enricher.NewClaudeEnricher(dir)
	if !c.CanEnrich(sessionID) {
		t.Fatalf("expected CanEnrich to be true for %s", sessionID)
	}

	usage, err := c.EnrichUsage(sessionID)
	if err != nil {
		t.Fatalf("EnrichUsage failed: %v", err)
	}
	if usage.Model != "claude-3-7-sonnet-20250219" || usage.InputTokens != 10000 || usage.CacheReadTokens != 8000 {
		t.Errorf("unexpected usage: %+v", usage)
	}
}

func TestEngine_LifecycleAndReactiveEvents(t *testing.T) {
	h := hub.NewHub(20)
	defer h.Close()

	engine := enricher.NewEngine(h)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := engine.Start(ctx); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	engine.AttachSession("non-existent-session")
	if engine.GetUsage("non-existent-session") != nil {
		t.Errorf("expected nil for non-existent session")
	}

	_ = engine.GetAllUsage()
	if err := engine.Stop(); err != nil {
		t.Errorf("Stop failed: %v", err)
	}
}

func TestEngine_Concurrency(t *testing.T) {
	engine := enricher.NewEngine(nil)
	var wg sync.WaitGroup

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			sess := "sess-conc"
			engine.AttachSession(sess)
			_ = engine.GetUsage(sess)
			_ = engine.GetMetadata(sess)
			_ = engine.GetAllUsage()
		}(i)
	}
	wg.Wait()
}
