package proctracer

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// MockBroadcaster captures events for unit testing.
type MockBroadcaster struct {
	mu     sync.Mutex
	events []*events.Event
}

func (b *MockBroadcaster) BroadcastEvent(evt *events.Event) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, evt)
	return nil
}

func (b *MockBroadcaster) GetEvents() []*events.Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	res := make([]*events.Event, len(b.events))
	copy(res, b.events)
	return res
}

func TestManager_LifecycleAndAutoAttach(t *testing.T) {
	mockReader := NewMockProcReader()
	myPID := os.Getpid()

	mockReader.PIDs = []int{myPID}
	mockReader.Stats[myPID] = &ProcessRawStat{
		PID:        myPID,
		Comm:       "antigravity",
		State:      "S",
		UTime:      10,
		STime:      10,
		NumThreads: 4,
		RSSPages:   800,
	}
	mockReader.Cmdlines[myPID] = []string{"antigravity", "--model", "gemini-3.7-flash"}
	mockReader.Statms[myPID] = &ProcessRawStatm{Size: 1500, Resident: 800}

	broadcaster := &MockBroadcaster{}
	mgr := NewManager(broadcaster, mockReader)
	mgr.SetPollInterval(20 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mgr.Start(ctx)
	// Give background worker time to scan & sample
	time.Sleep(100 * time.Millisecond)

	status := mgr.GetStatus()
	if status == nil {
		t.Fatalf("GetStatus() returned nil")
	}

	targets := mgr.GetDiscoveredTargets()
	if len(targets) == 0 {
		t.Errorf("expected at least 1 discovered target, got %d", len(targets))
	}

	snap, err := mgr.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot() error: %v", err)
	}
	if snap == nil {
		t.Fatalf("GetSnapshot() returned nil")
	}

	// Test Manual PID Attach
	snap2, err := mgr.AttachPID(myPID)
	if err != nil {
		t.Fatalf("AttachPID(%d) error: %v", myPID, err)
	}
	if snap2.Target.PID != myPID {
		t.Errorf("snap2.Target.PID = %d, want %d", snap2.Target.PID, myPID)
	}

	mgr.Stop()
}

func TestManager_ConcurrencyAndRaceSafety(t *testing.T) {
	mockReader := NewMockProcReader()
	myPID := os.Getpid()
	mockReader.PIDs = []int{myPID}
	mockReader.Stats[myPID] = &ProcessRawStat{PID: myPID, Comm: "copilot", State: "R"}
	mockReader.Cmdlines[myPID] = []string{"copilot", "--model", "gpt-4o"}

	broadcaster := &MockBroadcaster{}
	mgr := NewManager(broadcaster, mockReader)
	mgr.SetPollInterval(10 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				_ = mgr.GetStatus()
				_ = mgr.GetDiscoveredTargets()
				_, _ = mgr.GetSnapshot()
				time.Sleep(5 * time.Millisecond)
			}
		}()
	}
	wg.Wait()
	mgr.Stop()
}

func TestManager_NonSupportedEnvironment(t *testing.T) {
	mockReader := NewMockProcReader()
	mgr := NewManager(nil, mockReader)
	mgr.supported = false

	if mgr.IsSupported() {
		t.Errorf("IsSupported() should be false")
	}

	// Starting non-supported manager should do nothing
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)

	status := mgr.GetStatus()
	if status.Supported {
		t.Errorf("status.Supported should be false")
	}

	_, err := mgr.AttachPID(123)
	if err == nil {
		t.Errorf("AttachPID on unsupported system should return error")
	}

	snap, err := mgr.GetSnapshot()
	if err != nil || snap.Supported {
		t.Errorf("GetSnapshot on unsupported system should return Supported=false")
	}
}

func TestDetector_FindLockFile(t *testing.T) {
	_ = findLockFileForKind(TargetKindAntigravity, 1234)
	_ = findLockFileForKind(TargetKindCopilot, 1234)
	_ = findLockFileForKind(TargetKindClaude, 1234)
	_ = findLockFileForKind(TargetKindGeneric, 1234)
}
