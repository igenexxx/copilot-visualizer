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

	"github.com/fsnotify/fsnotify"
	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers"
	_ "github.com/zhenya/copilot-visualizer/pkg/providers/antigravity"
	_ "github.com/zhenya/copilot-visualizer/pkg/providers/claude"
	_ "github.com/zhenya/copilot-visualizer/pkg/providers/copilot"
	_ "github.com/zhenya/copilot-visualizer/pkg/providers/generic"
)

// Broadcaster sends parsed live events.
type Broadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// Engine scans and automatically attaches to active AI coding agent sessions using modular providers.
// It utilizes a hybrid approach: native OS events (inotify/FSEvents/ReadDirectoryChangesW) via fsnotify for instant
// sub-millisecond reaction, coupled with a periodic heartbeat safety-net for WSL / network-mounted paths.
type Engine struct {
	broadcaster Broadcaster
	registry    *providers.Registry
	parser      TranscriptParser
	watchPaths  []string
	pollDelay   time.Duration

	mu             sync.RWMutex
	activeSession  *DiscoveredSession
	lastFileOffset int64
	running        bool
	cancel         context.CancelFunc
	fsWatcher      *fsnotify.Watcher
	watchedPaths   map[string]bool
}

// NewEngine initializes the session auto-discovery engine with default system locations from all registered providers.
func NewEngine(broadcaster Broadcaster, customPaths []string) *Engine {
	reg := providers.GlobalRegistry()
	home, _ := os.UserHomeDir()

	allPatterns := reg.CollectAllPatterns(home)
	allPaths := append(allPatterns, customPaths...)

	return &Engine{
		broadcaster:  broadcaster,
		registry:     reg,
		parser:       NewAntigravityParser(),
		watchPaths:   allPaths,
		pollDelay:    2 * time.Second,
		watchedPaths: make(map[string]bool),
	}
}

// NewEngineWithWatchPaths creates an engine watching the specified paths.
func NewEngineWithWatchPaths(broadcaster Broadcaster, paths []string) *Engine {
	return &Engine{
		broadcaster:  broadcaster,
		registry:     providers.GlobalRegistry(),
		parser:       NewAntigravityParser(),
		watchPaths:   paths,
		pollDelay:    2 * time.Second,
		watchedPaths: make(map[string]bool),
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

// StartWatcher starts the background hybrid OS-event + heartbeat scanner.
func (e *Engine) StartWatcher(ctx context.Context) {
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("⚠️ Failed to initialize OS file watcher, falling back to polling: %v", err)
	} else {
		e.fsWatcher = watcher
	}

	ctx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.running = true
	e.mu.Unlock()

	// Initial scan to establish watches and attach to active session
	e.syncWatches()
	e.pollActiveSession()

	go e.run(ctx, watcher)
}

// StopWatcher stops the background watcher and cleans up OS watch descriptors.
func (e *Engine) StopWatcher() {
	e.mu.Lock()
	if !e.running {
		e.mu.Unlock()
		return
	}
	if e.cancel != nil {
		e.cancel()
		e.cancel = nil
	}
	if e.fsWatcher != nil {
		_ = e.fsWatcher.Close()
		e.fsWatcher = nil
	}
	e.watchedPaths = make(map[string]bool)
	e.running = false
	e.mu.Unlock()
}

// addWatch adds a path to the fsnotify watcher safely. Must be called with e.mu held.
func (e *Engine) addWatch(targetPath string) {
	if e.fsWatcher == nil || targetPath == "" {
		return
	}
	clean := filepath.Clean(targetPath)
	if e.watchedPaths[clean] {
		return
	}

	if _, err := os.Stat(clean); err == nil {
		if err := e.fsWatcher.Add(clean); err == nil {
			e.watchedPaths[clean] = true
		}
	}
}

// syncWatches registers static root directories and discovered session folders with fsnotify.
func (e *Engine) syncWatches() {
	e.mu.Lock()
	defer e.mu.Unlock()

	// 1. Add static root folders from watch glob patterns
	for _, pattern := range e.watchPaths {
		rootDir := extractGlobRoot(pattern)
		if rootDir != "" {
			e.addWatch(rootDir)
		}
	}

	// 2. Add active session file and directory if set
	if e.activeSession != nil {
		e.addWatch(filepath.Dir(e.activeSession.Path))
		e.addWatch(e.activeSession.Path)
	}
}

func extractGlobRoot(pattern string) string {
	idx := strings.IndexAny(pattern, "*?[")
	if idx == -1 {
		return filepath.Dir(pattern)
	}
	sub := pattern[:idx]
	return filepath.Dir(sub)
}

func (e *Engine) run(ctx context.Context, watcher *fsnotify.Watcher) {
	heartbeat := time.NewTicker(e.pollDelay)
	defer heartbeat.Stop()

	for {
		if watcher != nil {
			select {
			case <-ctx.Done():
				return

			case evt, ok := <-watcher.Events:
				if !ok {
					return
				}
				e.handleFSEvent(evt)

			case _, ok := <-watcher.Errors:
				if !ok {
					return
				}

			case <-heartbeat.C:
				e.syncWatches()
				e.pollActiveSession()
			}
		} else {
			select {
			case <-ctx.Done():
				return
			case <-heartbeat.C:
				e.pollActiveSession()
			}
		}
	}
}

func (e *Engine) handleFSEvent(evt fsnotify.Event) {
	cleanName := filepath.Clean(evt.Name)

	e.mu.RLock()
	activePath := ""
	if e.activeSession != nil {
		activePath = e.activeSession.Path
	}
	e.mu.RUnlock()

	// Instant reactive read on Write to active transcript file
	if evt.Has(fsnotify.Write) && (activePath != "" && (cleanName == activePath || strings.HasSuffix(cleanName, "events.jsonl") || strings.HasSuffix(cleanName, "transcript.jsonl"))) {
		e.readAppendedEvents()
		return
	}

	// Dynamic directory / session file creation
	if evt.Has(fsnotify.Create) {
		if fi, err := os.Stat(cleanName); err == nil {
			if fi.IsDir() {
				e.mu.Lock()
				e.addWatch(cleanName)
				e.mu.Unlock()
			}
		}
		e.pollActiveSession()
		return
	}

	// Rename or removal of active log
	if evt.Has(fsnotify.Rename) || evt.Has(fsnotify.Remove) {
		e.pollActiveSession()
	}
}

func (e *Engine) readAppendedEvents() {
	e.mu.Lock()
	if e.activeSession == nil {
		e.mu.Unlock()
		return
	}
	sessionPath := e.activeSession.Path
	sessionID := e.activeSession.ID
	lastOffset := e.lastFileOffset
	provider := e.activeSession.Provider
	e.mu.Unlock()

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

		// Dynamically watch newly discovered session directory and file
		e.addWatch(filepath.Dir(newest.Path))
		e.addWatch(newest.Path)

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
	e.mu.Unlock()

	e.readAppendedEvents()
}

// GetActiveSession returns the currently attached active session if any.
func (e *Engine) GetActiveSession() *DiscoveredSession {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.activeSession == nil {
		return nil
	}
	copied := *e.activeSession
	return &copied
}

// AttachSession explicitly points the engine to track the specified session ID.
func (e *Engine) AttachSession(sessionID string) error {
	sessions := e.ScanSessions()
	for _, sess := range sessions {
		if sess.ID == sessionID {
			e.mu.Lock()
			e.activeSession = &sess
			e.lastFileOffset = 0
			e.mu.Unlock()
			return nil
		}
	}
	return fmt.Errorf("session %q not found", sessionID)
}

// GetSessionEvents reads and parses all events from the transcript file of a given session.
func (e *Engine) GetSessionEvents(sessionID string) []*events.Event {
	sessions := e.ScanSessions()
	for _, sess := range sessions {
		if sess.ID == sessionID {
			file, err := os.Open(sess.Path)
			if err != nil {
				return nil
			}
			defer file.Close()

			var results []*events.Event
			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				line := scanner.Text()
				if len(line) == 0 {
					continue
				}
				var evts []*events.Event
				if sess.Provider != nil {
					evts = sess.Provider.ParseLine(line, sessionID)
				} else if e.parser != nil {
					evts = e.parser.Parse(line, sessionID)
				}
				results = append(results, evts...)
			}
			return results
		}
	}
	return nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
