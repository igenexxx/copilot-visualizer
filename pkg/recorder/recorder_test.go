package recorder_test

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/recorder"
)

func TestRecorder_LifecycleAndSaveLoad(t *testing.T) {
	tempDir := t.TempDir()
	rec, err := recorder.New(tempDir)
	if err != nil {
		t.Fatalf("failed to initialize recorder: %v", err)
	}

	// 1. Initial State: No tape active
	if tape := rec.GetCurrentTape(); tape != nil {
		t.Fatalf("expected nil current tape, got %+v", tape)
	}

	// 2. Record Events
	t0 := time.Now().UnixMilli()
	rec.RecordEvent(events.NewEvent("e1", "sess-alpha", events.TypeSessionStart, "foreman", "Session Started"))
	rec.RecordEvent(events.NewEvent("e2", "sess-alpha", events.TypeFileWrite, "crafter", "Forge file.go"))
	rec.RecordDiff("pkg/file.go", "package old", "package new", 1, 1)

	// Adversarial: Record nil event (should be ignored safely)
	rec.RecordEvent(nil)

	cur := rec.GetCurrentTape()
	if cur == nil || len(cur.Events) != 2 {
		t.Fatalf("expected 2 recorded events, got %+v", cur)
	}
	if len(cur.FileDiffs) != 1 {
		t.Fatalf("expected 1 recorded diff, got %d", len(cur.FileDiffs))
	}

	// 3. Save Current Tape
	meta, err := rec.SaveCurrentTape()
	if err != nil {
		t.Fatalf("failed to save active tape: %v", err)
	}
	if meta.EventCount != 2 || meta.SessionID != "sess-alpha" {
		t.Fatalf("unexpected tape metadata: %+v", meta)
	}

	// 4. List Tapes
	tapes, err := rec.ListTapes()
	if err != nil {
		t.Fatalf("failed to list tapes: %v", err)
	}
	if len(tapes) != 1 || tapes[0].ID != meta.ID {
		t.Fatalf("expected 1 tape with ID %s, got %+v", meta.ID, tapes)
	}

	// 5. Load Tape from Disk
	loaded, err := rec.LoadTape(meta.ID)
	if err != nil {
		t.Fatalf("failed to load tape %s: %v", meta.ID, err)
	}
	if loaded.ID != meta.ID || len(loaded.Events) != 2 {
		t.Fatalf("loaded tape mismatch: %+v", loaded)
	}
	if loaded.FileDiffs["pkg/file.go"].NewContent != "package new" {
		t.Fatalf("expected diff content 'package new', got %s", loaded.FileDiffs["pkg/file.go"].NewContent)
	}

	_ = t0
}

func TestRecorder_AdversarialInputs(t *testing.T) {
	tempDir := t.TempDir()
	rec, err := recorder.New(tempDir)
	if err != nil {
		t.Fatalf("failed to initialize recorder: %v", err)
	}

	tests := []struct {
		name    string
		fn      func() error
		wantErr error
	}{
		{
			name: "save empty tape fails",
			fn: func() error {
				_, err := rec.SaveCurrentTape()
				return err
			},
			wantErr: recorder.ErrEmptyTape,
		},
		{
			name: "save nil tape fails",
			fn: func() error {
				_, err := rec.SaveTape(nil)
				return err
			},
			wantErr: recorder.ErrEmptyTape,
		},
		{
			name: "save tape with empty ID fails",
			fn: func() error {
				tape := &recorder.SessionTape{
					ID:     "",
					Events: []*events.Event{events.NewEvent("e1", "s1", events.TypeAgentThink, "a1", "title")},
				}
				_, err := rec.SaveTape(tape)
				return err
			},
			wantErr: recorder.ErrEmptyTapeID,
		},
		{
			name: "load with empty tape ID fails",
			fn: func() error {
				_, err := rec.LoadTape("")
				return err
			},
			wantErr: recorder.ErrEmptyTapeID,
		},
		{
			name: "load non-existent tape fails",
			fn: func() error {
				_, err := rec.LoadTape("non-existent-tape-12345")
				return err
			},
			wantErr: recorder.ErrTapeNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.fn()
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("expected error %v, got %v", tt.wantErr, err)
			}
		})
	}

	// Adversarial: Malformed JSON file in storage directory
	corruptPath := filepath.Join(tempDir, "corrupt.tape.json")
	_ = os.WriteFile(corruptPath, []byte("NOT_JSON_DATA"), 0o644)

	// Non-json file (should be ignored in ListTapes)
	_ = os.WriteFile(filepath.Join(tempDir, "readme.txt"), []byte("Ignore me"), 0o644)

	_, err = rec.LoadTape("corrupt")
	if !errors.Is(err, recorder.ErrInvalidTapeData) {
		t.Fatalf("expected ErrInvalidTapeData for corrupt JSON, got: %v", err)
	}

	// Adversarial: Non-existent directory error
	recBad, _ := recorder.New(filepath.Join(tempDir, "non_existent_subdir"))
	_ = os.RemoveAll(filepath.Join(tempDir, "non_existent_subdir"))
	_, _ = recBad.ListTapes()
}

func TestRecorder_RecordDiffWithoutTape(t *testing.T) {
	tempDir := t.TempDir()
	rec, _ := recorder.New(tempDir)

	// RecordDiff with empty filePath or before any event
	rec.RecordDiff("", "old", "new", 1, 0)
	rec.RecordDiff("pkg/foo.go", "old", "new", 1, 0) // no tape yet, should not panic
}

func TestRecorder_Concurrency(t *testing.T) {
	tempDir := t.TempDir()
	rec, err := recorder.New(tempDir)
	if err != nil {
		t.Fatalf("failed to initialize recorder: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			evt := events.NewEvent(
				fmt.Sprintf("e-%d", idx),
				"sess-concurrent",
				events.TypeToolCall,
				"worker-1",
				fmt.Sprintf("Tool call %d", idx),
			)
			rec.RecordEvent(evt)
			rec.RecordDiff(fmt.Sprintf("pkg/file_%d.go", idx), "old", "new", idx, 0)
			_ = rec.GetCurrentTape()
			_, _ = rec.ListTapes()
		}(i)
	}
	wg.Wait()

	meta, err := rec.SaveCurrentTape()
	if err != nil {
		t.Fatalf("failed to save concurrent tape: %v", err)
	}
	if meta.EventCount != 25 {
		t.Fatalf("expected 25 events recorded, got %d", meta.EventCount)
	}
}
