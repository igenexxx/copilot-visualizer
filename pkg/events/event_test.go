package events_test

import (
	"encoding/json"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

func TestEvent_ValidationAndSerialization(t *testing.T) {
	tests := []struct {
		name      string
		event     *events.Event
		shouldErr bool
	}{
		{
			name:      "nil event pointer fails validation",
			event:     nil,
			shouldErr: true,
		},
		{
			name: "missing event ID fails validation",
			event: &events.Event{
				ID:        "",
				SessionID: "sess-1",
				Type:      events.TypeSessionStart,
				AgentID:   "agent-main",
			},
			shouldErr: true,
		},
		{
			name: "missing session ID fails validation",
			event: &events.Event{
				ID:        "evt-1",
				SessionID: "",
				Type:      events.TypeSessionStart,
				AgentID:   "agent-main",
			},
			shouldErr: true,
		},
		{
			name: "missing event Type fails validation",
			event: &events.Event{
				ID:        "evt-1",
				SessionID: "sess-1",
				Type:      "",
				AgentID:   "agent-main",
			},
			shouldErr: true,
		},
		{
			name: "missing AgentID fails validation",
			event: &events.Event{
				ID:        "evt-1",
				SessionID: "sess-1",
				Type:      events.TypeAgentSpawn,
				AgentID:   "",
			},
			shouldErr: true,
		},
		{
			name: "valid full event succeeds",
			event: events.NewEvent("evt-valid-1", "sess-100", events.TypeToolCall, "agent-1", "Reading file").
				WithRole(events.RoleInspector).
				WithStation(events.StationFilingVault).
				WithSummary("Inspecting config.yaml").
				WithPayload("path", "/app/config.yaml").
				WithPayload("lines", 42),
			shouldErr: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.event.Validate()
			if tc.shouldErr && err == nil {
				t.Fatalf("expected validation error, got nil")
			}
			if !tc.shouldErr && err != nil {
				t.Fatalf("expected no validation error, got: %v", err)
			}

			// Test JSON serialization
			data, jsonErr := tc.event.ToJSON()
			if tc.shouldErr && jsonErr == nil {
				t.Fatalf("expected JSON serialization error, got nil")
			}
			if !tc.shouldErr {
				if jsonErr != nil {
					t.Fatalf("expected JSON serialization success, got: %v", jsonErr)
				}
				if len(data) == 0 {
					t.Fatalf("expected non-empty JSON output")
				}

				// Verify round-trip unmarshaling
				var decoded events.Event
				if err := json.Unmarshal(data, &decoded); err != nil {
					t.Fatalf("failed to unmarshal generated JSON: %v", err)
				}
				if decoded.ID != tc.event.ID {
					t.Errorf("decoded ID mismatch: got %q, want %q", decoded.ID, tc.event.ID)
				}
				if decoded.Station != tc.event.Station {
					t.Errorf("decoded Station mismatch: got %q, want %q", decoded.Station, tc.event.Station)
				}
			}
		})
	}
}

func TestEvent_NilPointerMethodSafety(t *testing.T) {
	// Adversarial test: Ensure chained builders on nil pointers do not panic
	var nilEvent *events.Event

	if got := nilEvent.WithRole(events.RoleCrafter); got != nil {
		t.Errorf("expected nil result on nil receiver WithRole")
	}
	if got := nilEvent.WithStation(events.StationCNCLathe); got != nil {
		t.Errorf("expected nil result on nil receiver WithStation")
	}
	if got := nilEvent.WithSummary("noop"); got != nil {
		t.Errorf("expected nil result on nil receiver WithSummary")
	}
	if got := nilEvent.WithPayload("key", "value"); got != nil {
		t.Errorf("expected nil result on nil receiver WithPayload")
	}
}
