package providers

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// Provider defines the standard interface for any AI agent telemetry and transcript source.
type Provider interface {
	// ID returns the unique system key (e.g. "antigravity", "claude_code", "copilot_cli").
	ID() string

	// Name returns the human-readable provider name (e.g. "Google Antigravity", "Claude Code").
	Name() string

	// Source returns the source identifier string for frontend routing.
	Source() string

	// DefaultGlobPatterns returns default search patterns for session logs on the host OS.
	DefaultGlobPatterns(homeDir string) []string

	// MatchesPath checks if a discovered log file path belongs to this provider.
	MatchesPath(path string) bool

	// ExtractSessionID parses the unique session ID from the log file path.
	ExtractSessionID(filePath string) string

	// ParseLine converts a single raw transcript line into one or more Visualizer events.
	ParseLine(line string, sessionID string) []*events.Event
}

// Registry manages available AI agent providers with thread-safe access.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
	order     []string
}

// NewRegistry creates a new empty provider registry.
func NewRegistry() *Registry {
	return &Registry{
		providers: make(map[string]Provider),
		order:     make([]string, 0),
	}
}

// Register adds or replaces a provider in the registry.
func (r *Registry) Register(p Provider) {
	if p == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	id := p.ID()
	if _, exists := r.providers[id]; !exists {
		r.order = append(r.order, id)
	}
	r.providers[id] = p
}

// Get retrieves a provider by ID.
func (r *Registry) Get(id string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

// All returns a slice of all registered providers in registration order.
func (r *Registry) All() []Provider {
	r.mu.RLock()
	defer r.mu.RUnlock()

	res := make([]Provider, 0, len(r.order))
	for _, id := range r.order {
		if p, ok := r.providers[id]; ok {
			res = append(res, p)
		}
	}
	return res
}

// FindProviderForPath determines the best matching provider for a file path.
func (r *Registry) FindProviderForPath(path string) Provider {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, id := range r.order {
		p := r.providers[id]
		if p.MatchesPath(path) {
			return p
		}
	}

	// Fallback to generic provider if registered
	if gen, ok := r.providers["generic"]; ok {
		return gen
	}
	return nil
}

// CollectAllPatterns returns all default glob patterns from all registered providers.
func (r *Registry) CollectAllPatterns(homeDir string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var all []string
	for _, id := range r.order {
		p := r.providers[id]
		patterns := p.DefaultGlobPatterns(homeDir)
		all = append(all, patterns...)
	}
	return all
}

// DefaultRegistry is the global provider registry populated with standard built-in providers.
var (
	defaultRegistry     *Registry
	defaultRegistryOnce sync.Once
)

// GlobalRegistry returns the singleton global provider registry.
func GlobalRegistry() *Registry {
	defaultRegistryOnce.Do(func() {
		defaultRegistry = NewRegistry()
	})
	return defaultRegistry
}

// Helper utility to sanitize paths
func CleanPath(p string) string {
	return filepath.Clean(strings.TrimSpace(p))
}

// DiscoveredSessionMeta contains metadata for an inspected session file.
type DiscoveredSessionMeta struct {
	ID        string
	Source    string
	FilePath  string
	Provider  Provider
	ModTime   int64
	SizeBytes int64
}

// InspectFile checks if a file exists and matches any provider.
func InspectFile(reg *Registry, filePath string) (*DiscoveredSessionMeta, bool) {
	if reg == nil {
		reg = GlobalRegistry()
	}
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		return nil, false
	}

	p := reg.FindProviderForPath(filePath)
	if p == nil {
		return nil, false
	}

	sessID := p.ExtractSessionID(filePath)
	return &DiscoveredSessionMeta{
		ID:        sessID,
		Source:    p.Source(),
		FilePath:  filePath,
		Provider:  p,
		ModTime:   info.ModTime().UnixNano(),
		SizeBytes: info.Size(),
	}, true
}
