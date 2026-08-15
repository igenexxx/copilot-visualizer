package sessionstore_test

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/sessionstore"
)

func TestStore_DefaultConstructor(t *testing.T) {
	s, err := sessionstore.New("")
	if err != nil {
		t.Fatalf("failed to create default sessionstore: %v", err)
	}
	defer s.Close()
}

func TestStore_LifecycleAndPersistence(t *testing.T) {
	tempDir := t.TempDir()
	store, err := sessionstore.New(tempDir)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	sessID := "sess-alpha-001"

	// 1. Get non-existent session returns valid default
	st, err := store.GetState(sessID)
	if err != nil {
		t.Fatalf("unexpected error getting default state: %v", err)
	}
	if st.SessionID != sessID || st.RPG.Level != 1 {
		t.Errorf("unexpected default state: %+v", st)
	}

	// 2. Modify state and save
	st.RPG.Level = 3
	st.RPG.Exp = 450
	st.Tokenomics.TotalCostUSD = 0.125
	st.Workstations["cnc_lathe"] = sessionstore.WorkstationState{
		HeatLevel:       45.5,
		TemperatureC:    380,
		WearPct:         14.2,
		TotalOperations: 30,
	}

	if err := store.SaveState(st); err != nil {
		t.Fatalf("failed to save state: %v", err)
	}

	// 3. Immediately flush to disk
	if err := store.FlushAll(); err != nil {
		t.Fatalf("failed to flush all: %v", err)
	}

	// 4. Verify file exists on disk
	diskPath := filepath.Join(tempDir, sessID, "state.json")
	if _, err := os.Stat(diskPath); err != nil {
		t.Fatalf("expected state.json on disk: %v", err)
	}

	// 5. Create a new store instance to test reading from disk
	store2, err := sessionstore.New(tempDir)
	if err != nil {
		t.Fatalf("failed to create store2: %v", err)
	}
	defer store2.Close()

	loaded, err := store2.GetState(sessID)
	if err != nil {
		t.Fatalf("failed to load state from disk: %v", err)
	}

	if loaded.RPG.Level != 3 || loaded.Tokenomics.TotalCostUSD != 0.125 {
		t.Errorf("persisted state mismatch: %+v", loaded)
	}
	if loaded.Workstations["cnc_lathe"].TemperatureC != 380 {
		t.Errorf("workstation state mismatch: %+v", loaded.Workstations["cnc_lathe"])
	}
}

func TestStore_CorruptedAndNonExistentFiles(t *testing.T) {
	tempDir := t.TempDir()
	store, err := sessionstore.New(tempDir)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	corruptSess := "sess-corrupted"
	sessDir := filepath.Join(tempDir, corruptSess)
	if err := os.MkdirAll(sessDir, 0o755); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}

	// Write garbage data to state.json
	_ = os.WriteFile(filepath.Join(sessDir, "state.json"), []byte("NOT_JSON_GARBAGE"), 0o644)

	// Should safely recover and return default state without error
	st, err := store.GetState(corruptSess)
	if err != nil {
		t.Fatalf("expected graceful fallback on corrupted json: %v", err)
	}
	if st.RPG.Level != 1 {
		t.Errorf("expected level 1 default on corrupted state, got %d", st.RPG.Level)
	}
}

func TestStore_AdversarialInputs(t *testing.T) {
	tempDir := t.TempDir()
	store, err := sessionstore.New(tempDir)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	// 1. Nil state save
	if err := store.SaveState(nil); err == nil {
		t.Errorf("expected error saving nil state")
	}

	// 2. Empty session ID
	if _, err := store.GetState(""); !errors.Is(err, sessionstore.ErrInvalidSessionID) {
		t.Errorf("expected ErrInvalidSessionID for empty string, got %v", err)
	}

	// 3. Path traversal attack in session ID
	maliciousID := "../../../etc/passwd"
	st := sessionstore.NewDefaultState(maliciousID, "generic")
	if err := store.SaveState(st); err != nil {
		t.Fatalf("unexpected error on sanitized save: %v", err)
	}
	_ = store.FlushAll()

	// Ensure no file was written outside baseDir
	if _, err := os.Stat(filepath.Join(tempDir, "..", "passwd")); !os.IsNotExist(err) {
		t.Errorf("path traversal vulnerability detected!")
	}
}

func TestStore_BackgroundFlusherAndGracefulShutdown(t *testing.T) {
	tempDir := t.TempDir()
	store, err := sessionstore.NewWithInterval(tempDir, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	st := sessionstore.NewDefaultState("sess-auto-flush", "antigravity")
	st.RPG.Level = 5
	_ = store.SaveState(st)

	// Wait for background ticker to flush
	time.Sleep(120 * time.Millisecond)

	diskPath := filepath.Join(tempDir, "sess-auto-flush", "state.json")
	if _, err := os.Stat(diskPath); err != nil {
		t.Fatalf("expected state.json to be flushed automatically by ticker: %v", err)
	}

	// Graceful shutdown
	if err := store.Close(); err != nil {
		t.Fatalf("error on store.Close(): %v", err)
	}

	// Calling Close() again is safe
	if err := store.Close(); err != nil {
		t.Fatalf("double close error: %v", err)
	}
}

func TestStore_Concurrency(t *testing.T) {
	tempDir := t.TempDir()
	store, err := sessionstore.New(tempDir)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	var wg sync.WaitGroup
	sessionCount := 20
	iterations := 20

	for i := 0; i < sessionCount; i++ {
		wg.Add(1)
		go func(sessIdx int) {
			defer wg.Done()
			sessID := filepath.Join("sess", string(rune('A'+sessIdx)))
			for j := 0; j < iterations; j++ {
				st, _ := store.GetState(sessID)
				st.RPG.Exp += 10
				_ = store.SaveState(st)
			}
		}(i)
	}

	wg.Wait()
	_ = store.FlushAll()
}
