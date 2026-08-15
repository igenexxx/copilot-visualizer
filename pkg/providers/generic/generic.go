package generic

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/providers"
)

// Provider implements providers.Provider for generic visualizer events & jsonlines logs.
type Provider struct{}

// New creates a generic fallback provider.
func New() *Provider {
	return &Provider{}
}

func (p *Provider) ID() string {
	return "generic"
}

func (p *Provider) Name() string {
	return "Generic JSONLines Telemetry"
}

func (p *Provider) Source() string {
	return "generic"
}

func (p *Provider) DefaultGlobPatterns(homeDir string) []string {
	return []string{
		filepath.Join(homeDir, "logs", "*.jsonl"),
	}
}

func (p *Provider) MatchesPath(path string) bool {
	return strings.HasSuffix(path, ".jsonl") || strings.HasSuffix(path, ".json")
}

func (p *Provider) ExtractSessionID(filePath string) string {
	base := filepath.Base(filePath)
	ext := filepath.Ext(base)
	clean := strings.TrimSuffix(base, ext)
	if clean != "" && clean != "." {
		return clean
	}
	return filepath.Base(filepath.Dir(filePath))
}

func (p *Provider) ParseLine(line string, sessionID string) []*events.Event {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}

	// Try standard Event structure first
	var evt events.Event
	if err := json.Unmarshal([]byte(line), &evt); err == nil && evt.Type != "" {
		if evt.ID == "" {
			evt.ID = fmt.Sprintf("generic-%d", time.Now().UnixNano())
		}
		if evt.SessionID == "" {
			evt.SessionID = sessionID
		}
		if evt.Timestamp == 0 {
			evt.Timestamp = time.Now().UnixMilli()
		}
		return []*events.Event{&evt}
	}

	// Fallback raw generic map
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return nil
	}

	title := "Generic Event"
	if t, ok := raw["title"].(string); ok && t != "" {
		title = t
	} else if msg, ok := raw["message"].(string); ok && msg != "" {
		title = msg
	}

	e := events.NewEvent(
		fmt.Sprintf("gen-%d", time.Now().UnixNano()),
		sessionID,
		events.TypeAgentThink,
		"agent-generic",
		title,
	).
		WithRole(events.RoleForeman).
		WithStation(events.StationForemanDesk).
		WithPayload("data", raw).
		WithPayload("detectedSource", "generic")

	return []*events.Event{e}
}

func init() {
	providers.GlobalRegistry().Register(New())
}
