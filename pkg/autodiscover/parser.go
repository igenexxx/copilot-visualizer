package autodiscover

import (
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers"
	"github.com/zhenya/copilot-visualizer/pkg/providers/antigravity"
)

// SessionSource identifies which tool produced the session.
type SessionSource string

const (
	SourceAntigravity SessionSource = "antigravity"
	SourceClaudeCode  SessionSource = "claude_code"
	SourceCopilotCLI  SessionSource = "copilot_cli"
	SourceGeneric     SessionSource = "generic"
)

// DiscoveredSession contains metadata about a detected agent session.
type DiscoveredSession struct {
	ID           string        `json:"id"`
	Source       SessionSource `json:"source"`
	Path         string        `json:"path"`
	LastModified time.Time     `json:"lastModified"`
	Active       bool          `json:"active"`
	Provider     providers.Provider `json:"-"`
}

// TranscriptParser parses a single line from a specific session log format.
type TranscriptParser interface {
	Parse(line string, sessionID string) []*events.Event
}

// AntigravityParser wraps the modular antigravity.Provider for backward compatibility.
type AntigravityParser struct {
	impl *antigravity.Provider
}

// NewAntigravityParser creates an Antigravity parser instance.
func NewAntigravityParser() *AntigravityParser {
	return &AntigravityParser{
		impl: antigravity.New(),
	}
}

func (p *AntigravityParser) Parse(line string, sessionID string) []*events.Event {
	if p.impl == nil {
		p.impl = antigravity.New()
	}
	return p.impl.ParseLine(line, sessionID)
}
