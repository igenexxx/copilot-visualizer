package sessionstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ErrInvalidSessionID is returned when an empty or malformed session ID is passed.
var ErrInvalidSessionID = errors.New("invalid session ID")

// RPGState persists hero progression and stats.
type RPGState struct {
	Level          int      `json:"level"`
	Title          string   `json:"title"`
	Exp            int      `json:"exp"`
	NextLevelExp   int      `json:"nextLevelExp"`
	HP             int      `json:"hp"`
	MaxHP          int      `json:"maxHp"`
	MP             int      `json:"mp"`
	MaxMP          int      `json:"maxMp"`
	UnlockedSkills []string `json:"unlockedSkills"`
}

// ModelUsage persists token usage and costs for a specific AI model.
type ModelUsage struct {
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	CacheTokens  int     `json:"cacheTokens"`
	CostUSD      float64 `json:"costUsd"`
}

// TokenomicsState persists financial telemetry and token gas gauges.
type TokenomicsState struct {
	TotalCostUSD      float64               `json:"totalCostUsd"`
	TotalInputTokens  int                   `json:"totalInputTokens"`
	TotalOutputTokens int                   `json:"totalOutputTokens"`
	TotalCacheTokens  int                   `json:"totalCacheTokens"`
	ActiveModels      map[string]ModelUsage `json:"activeModels"`
}

// WorkstationState persists thermal and wear telemetry for a factory station.
type WorkstationState struct {
	HeatLevel       float64 `json:"heatLevel"`
	TemperatureC    int     `json:"temperatureC"`
	WearPct         float64 `json:"wearPct"`
	TotalOperations int     `json:"totalOperations"`
	ItemsCount      int     `json:"itemsCount"`
}

// MetricsState persists summary operation metrics.
type MetricsState struct {
	TotalEvents  int `json:"totalEvents"`
	FilesWritten int `json:"filesWritten"`
	MCPCalls     int `json:"mcpCalls"`
	TestsRun     int `json:"testsRun"`
	ActiveAgents int `json:"activeAgents"`
}

// SessionState is the complete atomic snapshot of a session's visualizer state.
type SessionState struct {
	SessionID    string                      `json:"sessionId"`
	Source       string                      `json:"source"`
	UpdatedAt    int64                       `json:"updatedAt"`
	RPG          RPGState                    `json:"rpg"`
	Tokenomics   TokenomicsState             `json:"tokenomics"`
	Workstations map[string]WorkstationState `json:"workstations"`
	Metrics      MetricsState                `json:"metrics"`
}

type cachedState struct {
	state SessionState
	dirty bool
}

// Store coordinates in-memory write-back caching and debounced atomic persistence on disk.
type Store struct {
	baseDir       string
	flushInterval time.Duration

	mu      sync.RWMutex
	cache   map[string]*cachedState
	running bool
	stopCh  chan struct{}
	wg      sync.WaitGroup
}

// New creates a new session store. If baseDir is empty, defaults to ~/.copilot-visualizer/sessions.
func New(baseDir string) (*Store, error) {
	return NewWithInterval(baseDir, 15*time.Second)
}

// NewWithInterval creates a session store with a custom background flush interval.
func NewWithInterval(baseDir string, flushInterval time.Duration) (*Store, error) {
	if baseDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			baseDir = filepath.Join(".", ".copilot-visualizer", "sessions")
		} else {
			baseDir = filepath.Join(home, ".copilot-visualizer", "sessions")
		}
	}

	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create session store directory: %w", err)
	}

	if flushInterval <= 0 {
		flushInterval = 15 * time.Second
	}

	s := &Store{
		baseDir:       baseDir,
		flushInterval: flushInterval,
		cache:         make(map[string]*cachedState),
		stopCh:        make(chan struct{}),
	}

	s.startFlusher()
	return s, nil
}

func (s *Store) startFlusher() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	interval := s.flushInterval
	s.mu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-s.stopCh:
				_ = s.flushDirty()
				return
			case <-ticker.C:
				_ = s.flushDirty()
			}
		}
	}()
}

// GetState retrieves the session snapshot from memory or reads it from disk.
func (s *Store) GetState(sessionID string) (*SessionState, error) {
	sessionID = sanitizeID(sessionID)
	if sessionID == "" {
		return nil, ErrInvalidSessionID
	}

	s.mu.RLock()
	if c, exists := s.cache[sessionID]; exists {
		clone := c.state
		s.mu.RUnlock()
		return &clone, nil
	}
	s.mu.RUnlock()

	// Load from disk
	filePath := filepath.Join(s.baseDir, sessionID, "state.json")
	data, err := os.ReadFile(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// Return default initial state
			def := NewDefaultState(sessionID, "generic")
			return def, nil
		}
		return nil, err
	}

	var state SessionState
	if err := json.Unmarshal(data, &state); err != nil {
		// Corrupted file on disk, return clean default
		return NewDefaultState(sessionID, "generic"), nil
	}

	s.mu.Lock()
	s.cache[sessionID] = &cachedState{
		state: state,
		dirty: false,
	}
	s.mu.Unlock()

	return &state, nil
}

// SaveState updates the in-memory session state and marks it dirty for background flushing.
func (s *Store) SaveState(state *SessionState) error {
	if state == nil {
		return errors.New("state cannot be nil")
	}
	sessionID := sanitizeID(state.SessionID)
	if sessionID == "" {
		return ErrInvalidSessionID
	}

	state.SessionID = sessionID
	state.UpdatedAt = time.Now().UnixMilli()

	s.mu.Lock()
	defer s.mu.Unlock()

	s.cache[sessionID] = &cachedState{
		state: *state,
		dirty: true,
	}
	return nil
}

// FlushAll immediately writes all dirty session snapshots to disk synchronously.
func (s *Store) FlushAll() error {
	return s.flushDirty()
}

// Close stops the background flusher and flushes all pending session states to disk.
func (s *Store) Close() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	s.running = false
	close(s.stopCh)
	s.mu.Unlock()

	s.wg.Wait()
	return nil
}

func (s *Store) flushDirty() error {
	s.mu.Lock()
	var toWrite []SessionState
	for id, c := range s.cache {
		if c.dirty {
			toWrite = append(toWrite, c.state)
			c.dirty = false
		}
		_ = id
	}
	baseDir := s.baseDir
	s.mu.Unlock()

	var firstErr error
	for _, st := range toWrite {
		if err := writeAtomicState(baseDir, st); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func writeAtomicState(baseDir string, state SessionState) error {
	sessDir := filepath.Join(baseDir, state.SessionID)
	if err := os.MkdirAll(sessDir, 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	finalPath := filepath.Join(sessDir, "state.json")
	tmpPath := filepath.Join(sessDir, "state.json.tmp")

	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return err
	}

	// Atomic rename to prevent partial read corruption
	return os.Rename(tmpPath, finalPath)
}

// NewDefaultState generates an initial baseline state for a new session.
func NewDefaultState(sessionID, source string) *SessionState {
	return &SessionState{
		SessionID: sessionID,
		Source:    source,
		UpdatedAt: time.Now().UnixMilli(),
		RPG: RPGState{
			Level:          1,
			Title:          "Junior Script Runner",
			Exp:            0,
			NextLevelExp:   350,
			HP:             100,
			MaxHP:          100,
			MP:             200000,
			MaxMP:          200000,
			UnlockedSkills: []string{"code_forge", "mcp_boost", "test_overdrive"},
		},
		Tokenomics: TokenomicsState{
			TotalCostUSD:      0,
			TotalInputTokens:  0,
			TotalOutputTokens: 0,
			TotalCacheTokens:  0,
			ActiveModels:      make(map[string]ModelUsage),
		},
		Workstations: make(map[string]WorkstationState),
		Metrics: MetricsState{
			TotalEvents:  0,
			FilesWritten: 0,
			MCPCalls:     0,
			TestsRun:     0,
			ActiveAgents: 1,
		},
	}
}

func sanitizeID(id string) string {
	clean := strings.TrimSpace(id)
	clean = strings.ReplaceAll(clean, "..", "")
	clean = strings.ReplaceAll(clean, "/", "_")
	clean = strings.ReplaceAll(clean, "\\", "_")
	return clean
}
