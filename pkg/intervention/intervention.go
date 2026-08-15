package intervention

import (
	"fmt"
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// Decision represents the human verdict on a sensitive operation.
type Decision string

const (
	DecisionApproved Decision = "APPROVED"
	DecisionRejected Decision = "REJECTED"
	DecisionModified Decision = "MODIFIED"
)

// Checkpoint represents a pending sensitive action requiring human approval.
type Checkpoint struct {
	ID          string         `json:"id"`
	SessionID   string         `json:"sessionId"`
	ActionType  string         `json:"actionType"` // e.g. "run_command", "delete_file", "git_push"
	Description string         `json:"description"`
	Payload     map[string]any `json:"payload,omitempty"`
	CreatedAt   int64          `json:"createdAt"`
	Status      string         `json:"status"` // "PENDING", "APPROVED", "REJECTED", "MODIFIED"
	Decision    Decision       `json:"decision,omitempty"`
	Feedback    string         `json:"feedback,omitempty"`
}

// Broadcaster delivers visual events to the hub.
type Broadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// Manager coordinates human-in-the-loop interventions, checkpoints, and emergency stops.
type Manager struct {
	broadcaster   Broadcaster
	mu            sync.RWMutex
	emergencyStop bool
	checkpoints   map[string]*Checkpoint
	waitChannels  map[string]chan Decision
}

// NewManager creates a new human intervention manager.
func NewManager(broadcaster Broadcaster) *Manager {
	return &Manager{
		broadcaster:  broadcaster,
		checkpoints:  make(map[string]*Checkpoint),
		waitChannels: make(map[string]chan Decision),
	}
}

// IsEmergencyStopActive returns current red alert state.
func (m *Manager) IsEmergencyStopActive() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.emergencyStop
}

// SetEmergencyStop toggles the emergency pause on the factory floor.
func (m *Manager) SetEmergencyStop(active bool, reason string) error {
	m.mu.Lock()
	m.emergencyStop = active
	m.mu.Unlock()

	title := "🚨 EMERGENCY STOP ACTIVATED"
	if !active {
		title = "✅ EMERGENCY STOP CLEARED"
	}
	if reason == "" {
		if active {
			reason = "Developer activated emergency crane brake."
		} else {
			reason = "Developer resumed factory operations."
		}
	}

	evt := events.NewEvent(
		fmt.Sprintf("estop-%d", time.Now().UnixNano()),
		"global",
		events.TypeEmergencyStop,
		"agent-foreman",
		title,
	).
		WithRole(events.RoleForeman).
		WithStation(events.StationSecurityGate).
		WithSummary(reason).
		WithPayload("active", active).
		WithPayload("reason", reason)

	if m.broadcaster != nil {
		return m.broadcaster.BroadcastEvent(evt)
	}
	return nil
}

// SendIntercom delivers a developer guidance message directly into the visual stream.
func (m *Manager) SendIntercom(sessionID, message string) error {
	if message == "" {
		return fmt.Errorf("intercom message cannot be empty")
	}
	if sessionID == "" {
		sessionID = "global"
	}

	evt := events.NewEvent(
		fmt.Sprintf("intercom-%d", time.Now().UnixNano()),
		sessionID,
		events.TypeInterventionPrompt,
		"agent-foreman",
		"📻 Foreman Intercom: Developer Guidance",
	).
		WithRole(events.RoleForeman).
		WithStation(events.StationForemanDesk).
		WithSummary(message).
		WithPayload("message", message).
		WithPayload("sender", "developer")

	if m.broadcaster != nil {
		return m.broadcaster.BroadcastEvent(evt)
	}
	return nil
}

// RequestCheckpoint registers a sensitive operation and broadcasts an approval request.
func (m *Manager) RequestCheckpoint(sessionID, actionType, description string, payload map[string]any) (*Checkpoint, <-chan Decision) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cpID := fmt.Sprintf("cp-%d", time.Now().UnixNano())
	cp := &Checkpoint{
		ID:          cpID,
		SessionID:   sessionID,
		ActionType:  actionType,
		Description: description,
		Payload:     payload,
		CreatedAt:   time.Now().UnixMilli(),
		Status:      "PENDING",
	}

	ch := make(chan Decision, 1)
	m.checkpoints[cpID] = cp
	m.waitChannels[cpID] = ch

	evt := events.NewEvent(
		fmt.Sprintf("cpreq-%s", cpID),
		sessionID,
		events.TypeCheckpointRequest,
		"agent-foreman",
		fmt.Sprintf("⚠️ Checkpoint: %s", actionType),
	).
		WithRole(events.RoleForeman).
		WithStation(events.StationSecurityGate).
		WithSummary(description).
		WithPayload("checkpointId", cpID).
		WithPayload("actionType", actionType).
		WithPayload("description", description).
		WithPayload("data", payload)

	if m.broadcaster != nil {
		_ = m.broadcaster.BroadcastEvent(evt)
	}

	return cp, ch
}

// SubmitDecision records developer judgment on a pending checkpoint.
func (m *Manager) SubmitDecision(checkpointID string, decision Decision, feedback string) error {
	m.mu.Lock()
	cp, exists := m.checkpoints[checkpointID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("checkpoint %q not found", checkpointID)
	}

	if cp.Status != "PENDING" {
		m.mu.Unlock()
		return fmt.Errorf("checkpoint %q is already %s", checkpointID, cp.Status)
	}

	cp.Decision = decision
	cp.Status = string(decision)
	cp.Feedback = feedback

	if ch, ok := m.waitChannels[checkpointID]; ok {
		select {
		case ch <- decision:
		default:
		}
		delete(m.waitChannels, checkpointID)
	}
	m.mu.Unlock()

	title := fmt.Sprintf("Verdict: %s on %s", decision, cp.ActionType)
	evt := events.NewEvent(
		fmt.Sprintf("cpdec-%s", checkpointID),
		cp.SessionID,
		events.TypeCheckpointDecision,
		"agent-foreman",
		title,
	).
		WithRole(events.RoleForeman).
		WithStation(events.StationSecurityGate).
		WithSummary(fmt.Sprintf("Developer %s action with note: %s", decision, feedback)).
		WithPayload("checkpointId", checkpointID).
		WithPayload("decision", string(decision)).
		WithPayload("feedback", feedback)

	if m.broadcaster != nil {
		return m.broadcaster.BroadcastEvent(evt)
	}
	return nil
}

// ListPendingCheckpoints returns all checkpoints currently awaiting decision.
func (m *Manager) ListPendingCheckpoints() []*Checkpoint {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []*Checkpoint
	for _, cp := range m.checkpoints {
		if cp.Status == "PENDING" {
			list = append(list, cp)
		}
	}
	return list
}
