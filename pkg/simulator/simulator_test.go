package simulator_test

import (
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
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

func TestSimulator_LifecycleSpeedAndStop(t *testing.T) {
	mb := &mockBroadcaster{}
	sim := simulator.New(mb)

	if sim.IsRunning() {
		t.Fatalf("expected simulator not running initially")
	}

	sim.SetSpeed(100.0) // high speed for fast test execution
	if got := sim.GetSpeed(); got != 100.0 {
		t.Errorf("expected speed 100.0, got %f", got)
	}

	// Adversarial: Negative or zero speed defaults to 1.0
	sim.SetSpeed(-5.0)
	if got := sim.GetSpeed(); got != 1.0 {
		t.Errorf("expected negative speed to fallback to 1.0, got %f", got)
	}
	sim.SetSpeed(100.0)

	// Start single run
	sim.Start(false)
	if !sim.IsRunning() {
		t.Fatalf("expected simulator to be running")
	}

	// Starting again while running should be a no-op
	sim.Start(false)

	// Wait for scenario to complete under high speed
	time.Sleep(300 * time.Millisecond)

	if mb.Count() < 10 {
		t.Errorf("expected at least 10 simulated events, got %d", mb.Count())
	}

	sim.Stop()
	if sim.IsRunning() {
		t.Fatalf("expected simulator not running after Stop()")
	}

	// Calling Stop again should be safe
	sim.Stop()
}

func TestSimulator_LoopingAndImmediateStop(t *testing.T) {
	mb := &mockBroadcaster{}
	sim := simulator.New(mb)
	sim.SetSpeed(200.0)

	sim.Start(true) // loop = true
	time.Sleep(100 * time.Millisecond)
	sim.Stop()

	time.Sleep(50 * time.Millisecond)
	if sim.IsRunning() {
		t.Fatalf("expected simulator to have stopped on cancel")
	}
}
