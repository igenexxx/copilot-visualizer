package intervention_test

import (
	"fmt"
	"sync"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/intervention"
)

type mockBroadcaster struct {
	mu     sync.Mutex
	events []*events.Event
}

func (m *mockBroadcaster) BroadcastEvent(evt *events.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, evt)
	return nil
}

func (m *mockBroadcaster) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}

func TestManager_EmergencyStop(t *testing.T) {
	mb := &mockBroadcaster{}
	mgr := intervention.NewManager(mb)

	if mgr.IsEmergencyStopActive() {
		t.Fatalf("expected emergency stop inactive by default")
	}

	// Toggle emergency stop ON
	err := mgr.SetEmergencyStop(true, "High memory pressure")
	if err != nil {
		t.Fatalf("unexpected error activating emergency stop: %v", err)
	}
	if !mgr.IsEmergencyStopActive() {
		t.Fatalf("expected emergency stop active")
	}

	// Toggle emergency stop OFF with empty reason (default fallback)
	err = mgr.SetEmergencyStop(false, "")
	if err != nil {
		t.Fatalf("unexpected error clearing emergency stop: %v", err)
	}
	if mgr.IsEmergencyStopActive() {
		t.Fatalf("expected emergency stop inactive")
	}

	if mb.Count() != 2 {
		t.Errorf("expected 2 broadcast events for emergency stop toggles, got %d", mb.Count())
	}
}

func TestManager_Intercom(t *testing.T) {
	mb := &mockBroadcaster{}
	mgr := intervention.NewManager(mb)

	// Adversarial: Empty message should error
	if err := mgr.SendIntercom("sess-1", ""); err == nil {
		t.Fatalf("expected error on empty intercom message, got nil")
	}

	// Valid intercom message
	err := mgr.SendIntercom("sess-1", "Focus on unit tests in pkg/auth")
	if err != nil {
		t.Fatalf("unexpected error sending intercom: %v", err)
	}

	if mb.Count() != 1 {
		t.Fatalf("expected 1 event, got %d", mb.Count())
	}
}

func TestManager_CheckpointsAndDecisions(t *testing.T) {
	mb := &mockBroadcaster{}
	mgr := intervention.NewManager(mb)

	// 1. Request checkpoint
	cp, ch := mgr.RequestCheckpoint("sess-1", "run_command", "Run rm -rf temp/", map[string]any{"cmd": "rm -rf temp/"})
	if cp == nil || cp.Status != "PENDING" {
		t.Fatalf("expected pending checkpoint, got %+v", cp)
	}

	pendingList := mgr.ListPendingCheckpoints()
	if len(pendingList) != 1 {
		t.Fatalf("expected 1 pending checkpoint, got %d", len(pendingList))
	}

	// 2. Adversarial: Decision on non-existent checkpoint
	if err := mgr.SubmitDecision("non-existent-id", intervention.DecisionApproved, ""); err == nil {
		t.Fatalf("expected error for non-existent checkpoint, got nil")
	}

	// 3. Submit Approval
	err := mgr.SubmitDecision(cp.ID, intervention.DecisionApproved, "Looks safe")
	if err != nil {
		t.Fatalf("unexpected error approving checkpoint: %v", err)
	}

	// Verify channel received decision
	select {
	case dec := <-ch:
		if dec != intervention.DecisionApproved {
			t.Fatalf("expected DecisionApproved, got %s", dec)
		}
	default:
		t.Fatalf("expected decision on wait channel")
	}

	// 4. Adversarial: Submitting decision again should fail
	if err := mgr.SubmitDecision(cp.ID, intervention.DecisionRejected, "Too late"); err == nil {
		t.Fatalf("expected error for already resolved checkpoint, got nil")
	}

	if len(mgr.ListPendingCheckpoints()) != 0 {
		t.Fatalf("expected 0 pending checkpoints after decision, got %d", len(mgr.ListPendingCheckpoints()))
	}
}

func TestManager_Concurrency(t *testing.T) {
	mb := &mockBroadcaster{}
	mgr := intervention.NewManager(mb)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			cp, ch := mgr.RequestCheckpoint(
				"sess-concur",
				"file.write",
				fmt.Sprintf("Edit file %d", idx),
				nil,
			)
			_ = mgr.SubmitDecision(cp.ID, intervention.DecisionApproved, "ok")
			select {
			case <-ch:
			default:
			}
		}(i)
	}
	wg.Wait()
}
