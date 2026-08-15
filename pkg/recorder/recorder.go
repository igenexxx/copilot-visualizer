package recorder

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

var (
	ErrEmptyTape        = errors.New("cannot save empty session tape")
	ErrTapeNotFound     = errors.New("session tape not found")
	ErrInvalidTapeData  = errors.New("invalid session tape data")
	ErrEmptyTapeID      = errors.New("tape ID cannot be empty")
)

// SessionTape represents a serializable recording of an agent visualizer session.
type SessionTape struct {
	ID          string          `json:"id"`
	SessionID   string          `json:"sessionId"`
	Title       string          `json:"title"`
	CreatedAt   time.Time       `json:"createdAt"`
	DurationMs  int64           `json:"durationMs"`
	EventCount  int             `json:"eventCount"`
	Events      []*events.Event `json:"events"`
	FileDiffs   map[string]Diff `json:"fileDiffs,omitempty"` // relativePath -> diff snapshot
}

// Diff represents recorded code change details.
type Diff struct {
	FilePath     string `json:"filePath"`
	OldContent   string `json:"oldContent"`
	NewContent   string `json:"newContent"`
	AddedLines   int    `json:"addedLines"`
	RemovedLines int    `json:"removedLines"`
}

// TapeMeta provides summary metadata for tape listing.
type TapeMeta struct {
	ID         string    `json:"id"`
	SessionID  string    `json:"sessionId"`
	Title      string    `json:"title"`
	CreatedAt  time.Time `json:"createdAt"`
	DurationMs int64     `json:"durationMs"`
	EventCount int       `json:"eventCount"`
}

// Recorder records live visualizer events and manages saving/loading tapes to disk.
type Recorder struct {
	mu         sync.RWMutex
	storageDir string
	currentTape *SessionTape
}

// New creates a Tape Recorder with a designated storage directory.
func New(storageDir string) (*Recorder, error) {
	if storageDir == "" {
		storageDir = ".tapes"
	}

	if err := os.MkdirAll(storageDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create tape storage directory: %w", err)
	}

	return &Recorder{
		storageDir: storageDir,
	}, nil
}

// RecordEvent appends an event to the currently active session tape.
func (r *Recorder) RecordEvent(evt *events.Event) {
	if evt == nil {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.currentTape == nil || r.currentTape.SessionID != evt.SessionID {
		r.currentTape = &SessionTape{
			ID:        fmt.Sprintf("tape-%s-%d", evt.SessionID, time.Now().Unix()),
			SessionID: evt.SessionID,
			Title:     fmt.Sprintf("Session %s", evt.SessionID),
			CreatedAt: time.Now(),
			Events:    make([]*events.Event, 0, 100),
			FileDiffs: make(map[string]Diff),
		}
	}

	r.currentTape.Events = append(r.currentTape.Events, evt)
	r.currentTape.EventCount = len(r.currentTape.Events)

	if len(r.currentTape.Events) > 1 {
		first := r.currentTape.Events[0].Timestamp
		last := evt.Timestamp
		if last > first {
			r.currentTape.DurationMs = last - first
		}
	}
}

// RecordDiff saves a code diff snapshot associated with a file write event.
func (r *Recorder) RecordDiff(filePath, oldContent, newContent string, added, removed int) {
	if filePath == "" {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.currentTape != nil {
		r.currentTape.FileDiffs[filePath] = Diff{
			FilePath:     filePath,
			OldContent:   oldContent,
			NewContent:   newContent,
			AddedLines:   added,
			RemovedLines: removed,
		}
	}
}

// GetCurrentTape returns a deep copy of the currently active recording tape.
func (r *Recorder) GetCurrentTape() *SessionTape {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if r.currentTape == nil {
		return nil
	}

	copyTape := *r.currentTape
	copyTape.Events = make([]*events.Event, len(r.currentTape.Events))
	copy(copyTape.Events, r.currentTape.Events)
	return &copyTape
}

// SaveCurrentTape saves the active session recording to disk.
func (r *Recorder) SaveCurrentTape() (*TapeMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.currentTape == nil || len(r.currentTape.Events) == 0 {
		return nil, ErrEmptyTape
	}

	return r.saveTapeUnlocked(r.currentTape)
}

// SaveTape saves an explicit session tape to disk.
func (r *Recorder) SaveTape(tape *SessionTape) (*TapeMeta, error) {
	if tape == nil || len(tape.Events) == 0 {
		return nil, ErrEmptyTape
	}
	if tape.ID == "" {
		return nil, ErrEmptyTapeID
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	return r.saveTapeUnlocked(tape)
}

func (r *Recorder) saveTapeUnlocked(tape *SessionTape) (*TapeMeta, error) {
	fileName := fmt.Sprintf("%s.tape.json", tape.ID)
	targetPath := filepath.Join(r.storageDir, fileName)

	data, err := json.MarshalIndent(tape, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to encode tape JSON: %w", err)
	}

	if err := os.WriteFile(targetPath, data, 0o644); err != nil {
		return nil, fmt.Errorf("failed to write tape file: %w", err)
	}

	return &TapeMeta{
		ID:         tape.ID,
		SessionID:  tape.SessionID,
		Title:      tape.Title,
		CreatedAt:  tape.CreatedAt,
		DurationMs: tape.DurationMs,
		EventCount: len(tape.Events),
	}, nil
}

// LoadTape reads a saved session tape from disk by its Tape ID.
func (r *Recorder) LoadTape(tapeID string) (*SessionTape, error) {
	if tapeID == "" {
		return nil, ErrEmptyTapeID
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	targetPath := filepath.Join(r.storageDir, fmt.Sprintf("%s.tape.json", tapeID))
	file, err := os.Open(targetPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrTapeNotFound
		}
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read tape file: %w", err)
	}

	var tape SessionTape
	if err := json.Unmarshal(data, &tape); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidTapeData, err)
	}

	return &tape, nil
}

// ListTapes returns metadata summaries of all recorded session tapes on disk.
func (r *Recorder) ListTapes() ([]TapeMeta, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	entries, err := os.ReadDir(r.storageDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read tape directory: %w", err)
	}

	metas := make([]TapeMeta, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		filePath := filepath.Join(r.storageDir, entry.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var tape SessionTape
		if err := json.Unmarshal(data, &tape); err != nil {
			continue
		}

		metas = append(metas, TapeMeta{
			ID:         tape.ID,
			SessionID:  tape.SessionID,
			Title:      tape.Title,
			CreatedAt:  tape.CreatedAt,
			DurationMs: tape.DurationMs,
			EventCount: len(tape.Events),
		})
	}

	return metas, nil
}
