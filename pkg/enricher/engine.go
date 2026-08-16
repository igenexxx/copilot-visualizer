package enricher

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
)

// Engine orchestrates multi-provider session enrichment with zero polling using OS filesystem events.
type Engine struct {
	mu             sync.RWMutex
	providers      []ProviderEnricher
	hub            *hub.Hub
	fsWatcher      *fsnotify.Watcher
	watchedPaths   map[string]bool
	cacheUsage     map[string]*UsageSummary
	cacheMeta      map[string]*SessionMetadata
	cacheContext   map[string]*SessionContext
	activeSession  string
	debounceTimers map[string]*time.Timer
	cancelFunc     context.CancelFunc
	running        bool
}

// NewEngine initializes the SessionEnricher engine with default providers.
func NewEngine(h *hub.Hub) *Engine {
	e := &Engine{
		hub:            h,
		watchedPaths:   make(map[string]bool),
		cacheUsage:     make(map[string]*UsageSummary),
		cacheMeta:      make(map[string]*SessionMetadata),
		cacheContext:   make(map[string]*SessionContext),
		debounceTimers: make(map[string]*time.Timer),
		providers: []ProviderEnricher{
			NewCopilotEnricher(""),
			NewAntigravityEnricher(""),
			NewClaudeEnricher(""),
		},
	}
	return e
}

// RegisterProvider adds a custom provider enricher.
func (e *Engine) RegisterProvider(p ProviderEnricher) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.providers = append(e.providers, p)
}

// Start launches the reactive OS filesystem event watcher loop.
func (e *Engine) Start(ctx context.Context) error {
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return nil
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		e.mu.Unlock()
		return fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	ctx, cancel := context.WithCancel(ctx)
	e.fsWatcher = watcher
	e.cancelFunc = cancel
	e.running = true
	e.mu.Unlock()

	// Register watch targets from all providers
	homeDir, _ := os.UserHomeDir()
	e.mu.RLock()
	providers := append([]ProviderEnricher(nil), e.providers...)
	e.mu.RUnlock()

	for _, p := range providers {
		for _, target := range p.WatchTargets(homeDir) {
			e.addWatchTarget(target)
		}
	}

	go e.eventLoop(ctx, watcher)
	return nil
}

func (e *Engine) addWatchTarget(path string) {
	if path == "" {
		return
	}
	// If path doesn't exist yet, watch its parent directory if exists
	target := path
	if _, err := os.Stat(target); err != nil {
		parent := filepath.Dir(target)
		if _, err := os.Stat(parent); err == nil {
			target = parent
		} else {
			return
		}
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	if e.fsWatcher != nil && !e.watchedPaths[target] {
		_ = e.fsWatcher.Add(target)
		e.watchedPaths[target] = true
	}
}

func (e *Engine) eventLoop(ctx context.Context, watcher *fsnotify.Watcher) {
	for {
		select {
		case <-ctx.Done():
			_ = watcher.Close()
			return

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			_ = err

		case evt, ok := <-watcher.Events:
			if !ok {
				return
			}
			// On Write, Create, or Chmod events on databases/logs
			if evt.Has(fsnotify.Write) || evt.Has(fsnotify.Create) {
				e.handleFSEvent(evt.Name)
			}
		}
	}
}

func (e *Engine) handleFSEvent(path string) {
	e.mu.Lock()
	sessionID := e.activeSession
	e.mu.Unlock()

	if sessionID == "" {
		return
	}

	// Debounce by 40ms to coalesce rapid SQLite WAL writes
	e.mu.Lock()
	if t, exists := e.debounceTimers[sessionID]; exists {
		t.Stop()
	}
	e.debounceTimers[sessionID] = time.AfterFunc(40*time.Millisecond, func() {
		e.RefreshSession(sessionID)
	})
	e.mu.Unlock()
}

// AttachSession sets the active session and triggers an immediate refresh.
func (e *Engine) AttachSession(sessionID string) {
	if sessionID == "" {
		return
	}
	e.mu.Lock()
	e.activeSession = sessionID
	e.mu.Unlock()

	e.RefreshSession(sessionID)
}

// RefreshSession queries all providers for the session and updates the cache.
func (e *Engine) RefreshSession(sessionID string) {
	if sessionID == "" {
		return
	}

	e.mu.RLock()
	providers := append([]ProviderEnricher(nil), e.providers...)
	e.mu.RUnlock()

	for _, p := range providers {
		if p.CanEnrich(sessionID) {
			usage, err := p.EnrichUsage(sessionID)
			if err == nil && usage != nil {
				e.mu.Lock()
				e.cacheUsage[sessionID] = usage
				e.mu.Unlock()

				// Broadcast to connected WebSockets
				if e.hub != nil {
					evt := events.NewEvent(
						fmt.Sprintf("enrich-%s-%d", sessionID, time.Now().UnixNano()),
						sessionID,
						events.TypeAgentState,
						"enricher-daemon",
						fmt.Sprintf("Telemetric Refresh: %s", usage.Model),
					).WithPayload("usage", usage)
					_ = e.hub.BroadcastEvent(evt)
				}
			}

			meta, err := p.EnrichMetadata(sessionID)
			if err == nil && meta != nil {
				e.mu.Lock()
				e.cacheMeta[sessionID] = meta
				e.mu.Unlock()
			}

			sCtx, err := p.EnrichContext(sessionID)
			if err == nil && sCtx != nil {
				e.mu.Lock()
				e.cacheContext[sessionID] = sCtx
				e.mu.Unlock()
			}
			return
		}
	}
}

// GetUsage returns cached usage metrics with O(1) in-memory lookup.
func (e *Engine) GetUsage(sessionID string) *UsageSummary {
	if sessionID == "" {
		return nil
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.cacheUsage[sessionID]
}

// GetMetadata returns cached session metadata with O(1) in-memory lookup.
func (e *Engine) GetMetadata(sessionID string) *SessionMetadata {
	if sessionID == "" {
		return nil
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.cacheMeta[sessionID]
}

// GetContext returns cached session inventory and capability context with O(1) in-memory lookup.
func (e *Engine) GetContext(sessionID string) *SessionContext {
	if sessionID == "" {
		return nil
	}
	e.mu.RLock()
	sCtx, exists := e.cacheContext[sessionID]
	e.mu.RUnlock()
	if exists && sCtx != nil {
		return sCtx
	}

	// On-demand enrichment if not in cache yet
	e.mu.RLock()
	providers := append([]ProviderEnricher(nil), e.providers...)
	e.mu.RUnlock()

	for _, p := range providers {
		if p.CanEnrich(sessionID) {
			ctx, err := p.EnrichContext(sessionID)
			if err == nil && ctx != nil {
				e.mu.Lock()
				e.cacheContext[sessionID] = ctx
				e.mu.Unlock()
				return ctx
			}
		}
	}
	return nil
}

// GetAllUsage returns all cached session usages.
func (e *Engine) GetAllUsage() []*UsageSummary {
	e.mu.RLock()
	defer e.mu.RUnlock()
	res := make([]*UsageSummary, 0, len(e.cacheUsage))
	for _, u := range e.cacheUsage {
		res = append(res, u)
	}
	return res
}

// Stop gracefully shuts down the enricher engine.
func (e *Engine) Stop() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.running {
		return nil
	}
	e.running = false
	if e.cancelFunc != nil {
		e.cancelFunc()
	}
	for _, t := range e.debounceTimers {
		t.Stop()
	}
	return nil
}
