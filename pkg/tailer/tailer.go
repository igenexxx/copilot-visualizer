package tailer

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// EventBroadcaster delivers parsed events.
type EventBroadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// Tailer reads JSONL lines from a file or stream and maps them to visual events.
type Tailer struct {
	broadcaster EventBroadcaster
	sessionID   string
	pollDelay   time.Duration
	mu          sync.Mutex
	running     bool
}

// New creates a new Tailer instance.
func New(broadcaster EventBroadcaster, sessionID string) *Tailer {
	if sessionID == "" {
		sessionID = fmt.Sprintf("session-%d", time.Now().Unix())
	}
	return &Tailer{
		broadcaster: broadcaster,
		sessionID:   sessionID,
		pollDelay:   100 * time.Millisecond,
	}
}

// ParseLine parses a generic or structured JSONL line and returns an Event if recognized.
func (t *Tailer) ParseLine(line string) *events.Event {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		// Treat non-JSON line as log output / thought
		return events.NewEvent(
			fmt.Sprintf("raw-%d", time.Now().UnixNano()),
			t.sessionID,
			events.TypeAgentThink,
			"agent-foreman",
			"Log entry",
		).
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary(line).
			WithPayload("text", line)
	}

	// If it's already an Event payload
	if evtType, ok := raw["type"].(string); ok && evtType != "" {
		id, _ := raw["id"].(string)
		if id == "" {
			id = fmt.Sprintf("evt-%d", time.Now().UnixNano())
		}
		title, _ := raw["title"].(string)
		if title == "" {
			title = fmt.Sprintf("Event: %s", evtType)
		}
		agentID, _ := raw["agentId"].(string)
		if agentID == "" {
			agentID = "agent-foreman"
		}

		evt := events.NewEvent(id, t.sessionID, events.Type(evtType), agentID, title)
		if role, ok := raw["agentRole"].(string); ok {
			evt.WithRole(events.AgentRole(role))
		}
		if station, ok := raw["station"].(string); ok {
			evt.WithStation(events.StationType(station))
		}
		if summary, ok := raw["summary"].(string); ok {
			evt.WithSummary(summary)
		}
		if payload, ok := raw["payload"].(map[string]any); ok {
			for k, v := range payload {
				evt.WithPayload(k, v)
			}
		}
		return evt
	}

	return nil
}

// TailReader continuously reads from an io.Reader until context is cancelled or EOF.
func (t *Tailer) TailReader(ctx context.Context, r io.Reader) error {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line := scanner.Text()
		evt := t.ParseLine(line)
		if evt != nil && t.broadcaster != nil {
			_ = t.broadcaster.BroadcastEvent(evt)
		}
	}
	return scanner.Err()
}

// TailFile watches a file on disk and processes appended lines.
func (t *Tailer) TailFile(ctx context.Context, filepath string) error {
	file, err := os.Open(filepath)
	if err != nil {
		return err
	}
	defer file.Close()

	reader := bufio.NewReader(file)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			evt := t.ParseLine(line)
			if evt != nil && t.broadcaster != nil {
				_ = t.broadcaster.BroadcastEvent(evt)
			}
		}

		if err != nil {
			if err == io.EOF {
				time.Sleep(t.pollDelay)
				continue
			}
			return err
		}
	}
}
