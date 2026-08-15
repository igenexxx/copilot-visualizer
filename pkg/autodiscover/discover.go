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
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers"
)

// Broadcaster sends parsed live events.
type Broadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// Engine scans and automatically attaches to active AI coding agent sessions using modular providers.
type Engine struct {
	broadcaster Broadcaster
	registry    *providers.Registry
	parser      TranscriptParser
	watchPaths  []string
	pollDelay   time.Duration

	mu             sync.Mutex
	activeSession  *DiscoveredSession
	lastFileOffset int64
	running        bool
	cancel         context.CancelFunc
}

// NewEngine initializes the session auto-discovery engine with default system locations from all registered providers.
func NewEngine(broadcaster Broadcaster, customPaths []string) *Engine {
	reg := providers.GlobalRegistry()
	home, _ := os.UserHomeDir()

	allPatterns := reg.CollectAllPatterns(home)
	allPaths := append(allPatterns, customPaths...)

	return &Engine{
		broadcaster: broadcaster,
		registry:    reg,
		parser:      NewAntigravityParser(),
		watchPaths:  allPaths,
		pollDelay:   1500 * time.Millisecond,
	}
}

// NewEngineWithWatchPaths creates an engine watching the specified paths.
func NewEngineWithWatchPaths(broadcaster Broadcaster, paths []string) *Engine {
	return &Engine{
		broadcaster: broadcaster,
		registry:    providers.GlobalRegistry(),
		parser:      NewAntigravityParser(),
		watchPaths:  paths,
		pollDelay:   1500 * time.Millisecond,
	}
}

// SetRegistry configures a custom provider registry.
func (e *Engine) SetRegistry(reg *providers.Registry) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.registry = reg
}

// SetPollDelay configures the background poll interval.
func (e *Engine) SetPollDelay(d time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.pollDelay = d
}

// ScanSessions inspects watch paths and returns sorted discovered sessions mapped to their respective providers.
func (e *Engine) ScanSessions() []DiscoveredSession {
	var results []DiscoveredSession
	reg := e.registry
	if reg == nil {
		reg = providers.GlobalRegistry()
	}

	seenPaths := make(map[string]bool)

	for _, pattern := range e.watchPaths {
		matches, err := filepath.Glob(pattern)
		if err != nil || len(matches) == 0 {
			continue
		}

		for _, match := range matches {
			cleanMatch := filepath.Clean(match)
			if seenPaths[cleanMatch] {
				continue
			}

			info, err := os.Stat(cleanMatch)
			if err != nil || info.IsDir() {
				continue
			}
			seenPaths[cleanMatch] = true

			// Find appropriate provider for this path
			p := reg.FindProviderForPath(cleanMatch)
			var source SessionSource = SourceGeneric
			sessionID := filepath.Base(cleanMatch)

			if p != nil {
				source = SessionSource(p.Source())
				sessionID = p.ExtractSessionID(cleanMatch)
			}

			results = append(results, DiscoveredSession{
				ID:           sessionID,
				Source:       source,
				Path:         cleanMatch,
				LastModified: info.ModTime(),
				Active:       time.Since(info.ModTime()) < 10*time.Minute,
				Provider:     p,
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
			fmt.Sprintf("Auto-Attached: %s (%s)", newest.Source, newest.ID[:minInt(8, len(newest.ID))]),
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
	provider := e.activeSession.Provider
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

		var parsedEvents []*events.Event
		if provider != nil {
			parsedEvents = provider.ParseLine(line, sessionID)
		} else if e.parser != nil {
			parsedEvents = e.parser.Parse(line, sessionID)
		}

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

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
