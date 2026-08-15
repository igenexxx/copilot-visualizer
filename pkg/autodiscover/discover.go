package autodiscover

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// Broadcaster sends parsed live events.
type Broadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// Engine scans and automatically attaches to active AI coding agent sessions.
type Engine struct {
	broadcaster Broadcaster
	parser      TranscriptParser
	watchPaths  []string
	pollDelay   time.Duration

	mu             sync.Mutex
	activeSession  *DiscoveredSession
	lastFileOffset int64
	running        bool
	cancel         context.CancelFunc
}

// NewEngine initializes the session auto-discovery engine with default system locations.
func NewEngine(broadcaster Broadcaster, customPaths []string) *Engine {
	home, _ := os.UserHomeDir()

	defaultPatterns := []string{
		// Antigravity sessions
		filepath.Join(home, ".gemini", "antigravity-cli", "brain", "*", ".system_generated", "logs", "transcript.jsonl"),
		filepath.Join(home, ".gemini", "antigravity-cli", "brain", "*", "logs", "transcript.jsonl"),
		// Claude Code sessions
		filepath.Join(home, ".claude", "projects", "*", "logs", "*.jsonl"),
		filepath.Join(home, ".claude", "sessions", "*.jsonl"),
		// Copilot CLI sessions
		filepath.Join(home, ".copilot", "session-state", "*.jsonl"),
		filepath.Join(home, ".config", "github-copilot", "logs", "*.jsonl"),
	}

	allPaths := append(defaultPatterns, customPaths...)
	return NewEngineWithWatchPaths(broadcaster, allPaths)
}

// NewEngineWithWatchPaths creates an engine strictly watching the specified patterns.
func NewEngineWithWatchPaths(broadcaster Broadcaster, paths []string) *Engine {
	return &Engine{
		broadcaster: broadcaster,
		parser:      &AntigravityParser{},
		watchPaths:  paths,
		pollDelay:   100 * time.Millisecond,
	}
}

// ScanSessions inspects watch paths and returns sorted discovered sessions.
func (e *Engine) ScanSessions() []DiscoveredSession {
	var results []DiscoveredSession

	for _, pattern := range e.watchPaths {
		matches, err := filepath.Glob(pattern)
		if err != nil || len(matches) == 0 {
			continue
		}

		for _, match := range matches {
			info, err := os.Stat(match)
			if err != nil || info.IsDir() {
				continue
			}

			// Identify source
			source := SourceGeneric
			if strings.Contains(match, "antigravity-cli") {
				source = SourceAntigravity
			} else if strings.Contains(match, ".claude") {
				source = SourceClaudeCode
			} else if strings.Contains(match, "copilot") {
				source = SourceCopilotCLI
			}

			// Extract session ID from directory name
			sessionID := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(match))))
			if sessionID == "" || sessionID == "." {
				sessionID = filepath.Base(match)
			}

			results = append(results, DiscoveredSession{
				ID:           sessionID,
				Source:       source,
				Path:         match,
				LastModified: info.ModTime(),
				Active:       time.Since(info.ModTime()) < 10*time.Minute,
			})
		}
	}

	// Sort by newest first
	sort.Slice(results, func(i, j int) bool {
		return results[i].LastModified.After(results[j].LastModified)
	})

	return results
}

// StartWatcher starts the background auto-attach scanner.
func (e *Engine) StartWatcher(ctx context.Context) {
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.running = true
	e.mu.Unlock()

	go e.run(ctx)
}

// StopWatcher stops the background watcher.
func (e *Engine) StopWatcher() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cancel != nil {
		e.cancel()
		e.cancel = nil
	}
	e.running = false
}

func (e *Engine) run(ctx context.Context) {
	ticker := time.NewTicker(e.pollDelay)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.pollActiveSession()
		}
	}
}

func (e *Engine) pollActiveSession() {
	sessions := e.ScanSessions()
	if len(sessions) == 0 {
		return
	}

	newest := sessions[0]

	e.mu.Lock()
	isNewSession := e.activeSession == nil || e.activeSession.Path != newest.Path
	if isNewSession {
		e.activeSession = &newest
		e.lastFileOffset = 0
		log.Printf("🔍 Auto-discovered active session: %s [%s] at %s", newest.ID, newest.Source, newest.Path)

		// Broadcast session discovered announcement
		startEvt := events.NewEvent(
			fmt.Sprintf("discover-%d", time.Now().UnixNano()),
			newest.ID,
			events.TypeSessionStart,
			"agent-foreman",
			fmt.Sprintf("Auto-Attached: %s (%s)", newest.Source, newest.ID[:min(8, len(newest.ID))]),
		).
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary(fmt.Sprintf("Tracking live transcript: %s", newest.Path)).
			WithPayload("source", string(newest.Source)).
			WithPayload("sessionPath", newest.Path)

		if e.broadcaster != nil {
			_ = e.broadcaster.BroadcastEvent(startEvt)
		}
	}

	sessionPath := e.activeSession.Path
	sessionID := e.activeSession.ID
	lastOffset := e.lastFileOffset
	e.mu.Unlock()

	// Read newly appended data
	file, err := os.Open(sessionPath)
	if err != nil {
		return
	}
	defer file.Close()

	if _, err := file.Seek(lastOffset, io.SeekStart); err != nil {
		return
	}

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 {
			continue
		}

		parsedEvents := e.parser.Parse(line, sessionID)
		for _, evt := range parsedEvents {
			if e.broadcaster != nil {
				_ = e.broadcaster.BroadcastEvent(evt)
			}
		}
	}

	newOffset, err := file.Seek(0, io.SeekCurrent)
	if err == nil {
		e.mu.Lock()
		e.lastFileOffset = newOffset
		e.mu.Unlock()
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
